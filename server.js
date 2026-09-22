const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = 3000;
const PUBLIC_FILES = new Set(["/", "/index.html", "/styles.css", "/app.js"]);

// ========================================================
// PRESUPUESTO DE MEMORIA Y CACHE
// Todos los cachés son acotados: nunca crecen sin control y
// se purgan solos para no robarle RAM al proceso en ejecución.
// ========================================================
const CACHE = {
  // Listados de directorios MTP (solo diagnóstico: la extracción siempre lee fresco)
  dirTtlMs: 30000,
  dirNegativeTtlMs: 15000,
  dirMaxBuckets: 240,
  dirMaxItems: 3000,
  dirSkipAbove: 1200,
  // Archivos estáticos servidos al navegador
  staticMaxAgeSec: 300,
  staticMaxBytes: 2 * 1024 * 1024,
  // Retención de trabajos en memoria
  jobTtlMs: 10 * 60 * 1000,
  previewTtlMs: 30 * 60 * 1000,
  sweepMs: 60 * 1000,
  maxJobs: 6,
  maxFilesPerJob: 30000,
  // Búferes de procesos hijo y cuerpos HTTP
  execMaxBuffer: 8 * 1024 * 1024,
  bodyMaxBytes: 24 * 1024 * 1024
};

const jobs = new Map();

// ========================================================
// COLA SERIE DE ACCESO AL DISPOSITIVO (MTP es un canal único)
// Evita que el diagnóstico o una recarga de la interfaz
// compitan con la copia en curso y la ahoguen.
// ========================================================
const GIO_CONCURRENCY = 1;
const gioQueue = [];
let gioActive = 0;

const pumpGioQueue = () => {
  while (gioActive < GIO_CONCURRENCY && gioQueue.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < gioQueue.length; i++) {
      if (gioQueue[i].priority < gioQueue[bestIndex].priority) {
        bestIndex = i;
      }
    }
    const task = gioQueue.splice(bestIndex, 1)[0];
    if (task.settled) {
      continue;
    }
    task.settled = true;
    if (task.waitTimer) {
      clearTimeout(task.waitTimer);
      task.waitTimer = null;
    }
    gioActive += 1;
    task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        gioActive -= 1;
        pumpGioQueue();
      });
  }
};

// priority: 1 = proceso principal (extracción), 5 = consultas de la interfaz
const runOnDevice = (run, { priority = 5, maxWaitMs = 0 } = {}) =>
  new Promise((resolve, reject) => {
    const task = { run, resolve, reject, priority, settled: false, waitTimer: null };
    if (maxWaitMs > 0) {
      task.waitTimer = setTimeout(() => {
        if (task.settled) {
          return;
        }
        task.settled = true;
        const index = gioQueue.indexOf(task);
        if (index >= 0) {
          gioQueue.splice(index, 1);
        }
        reject(new Error("El dispositivo está ocupado con el proceso en curso. Reintenta al terminar."));
      }, maxWaitMs);
    }
    gioQueue.push(task);
    pumpGioQueue();
  });

// ========================================================
// CACHE LRU + TTL DE LISTADOS DE DIRECTORIOS
// ========================================================
const dirCache = new Map();
let dirCacheItems = 0;
const cacheStats = { hits: 0, misses: 0, evictions: 0 };

const dirKey = (deviceId, subPath, detailed) => `${deviceId}\u0000${detailed ? "d" : "s"}\u0000${subPath}`;

const dirCacheDrop = (key) => {
  const entry = dirCache.get(key);
  if (!entry) {
    return;
  }
  dirCache.delete(key);
  dirCacheItems -= entry.weight;
};

const dirCacheGet = (deviceId, subPath, detailed) => {
  // Un listado detallado también sirve para una petición simple
  const keys = detailed ? [dirKey(deviceId, subPath, true)] : [dirKey(deviceId, subPath, false), dirKey(deviceId, subPath, true)];
  const now = Date.now();
  for (const key of keys) {
    const entry = dirCache.get(key);
    if (!entry) {
      continue;
    }
    if (entry.expires <= now) {
      dirCacheDrop(key);
      continue;
    }
    // Refrescar posición LRU
    dirCache.delete(key);
    dirCache.set(key, entry);
    cacheStats.hits += 1;
    return entry.result;
  }
  cacheStats.misses += 1;
  return null;
};

// Se cachean también los fallos (carpetas que no existen en ese teléfono):
// son la mayoría de los sondeos del diagnóstico y reintentarlos cuesta caro.
const dirCacheSet = (deviceId, subPath, detailed, result) => {
  if (result.ok && result.items.length > CACHE.dirSkipAbove) {
    return; // Directorios enormes no se retienen: pesan más de lo que ahorran
  }
  const key = dirKey(deviceId, subPath, detailed);
  dirCacheDrop(key);
  const weight = result.ok ? result.items.length || 1 : 1;
  const ttl = result.ok ? CACHE.dirTtlMs : CACHE.dirNegativeTtlMs;
  dirCache.set(key, { result, weight, expires: Date.now() + ttl });
  dirCacheItems += weight;

  while (dirCache.size > 0 && (dirCacheItems > CACHE.dirMaxItems || dirCache.size > CACHE.dirMaxBuckets)) {
    const oldest = dirCache.keys().next().value;
    dirCacheDrop(oldest);
    cacheStats.evictions += 1;
  }
};

const dirCacheInvalidatePath = (deviceId, subPath) => {
  dirCacheDrop(dirKey(deviceId, subPath, true));
  dirCacheDrop(dirKey(deviceId, subPath, false));
};

const dirCacheInvalidateDevice = (deviceId) => {
  for (const key of Array.from(dirCache.keys())) {
    if (!deviceId || key.startsWith(`${deviceId}\u0000`)) {
      dirCacheDrop(key);
    }
  }
};

const parentOf = (filePath) => {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : "";
};

// Ubicaciones conocidas donde Android guarda archivos
const KNOWN_LOCATIONS = [
  "Download",
  "Documents",
  "DCIM",
  "DCIM/Camera",
  "DCIM/Screenshots",
  "DCIM/PhotosEditor",
  "Pictures",
  "Pictures/scanner",
  "Pictures/PhotosEditor",
  "Pictures/Screenshots",
  "Music",
  "Movies",
  "Recordings",
  "Audiobooks",
  "Telegram/Telegram Documents",
  "Telegram/Telegram Audio",
  "Telegram/Telegram Video",
  "Telegram/Telegram Images",
  "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents",
  "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Audio",
  "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video",
  "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images",
  "CamScanner",
  "MIUI/Gallery/cloud/owner"
];

// Carpetas de miniaturas y cachés de apps: nunca guardan archivos del usuario
// y listarlas por MTP cuesta minutos. Se omiten en cualquier modo de búsqueda.
const SEARCH_EXCLUDE = new Set([
  ".thumbnails",
  "thumbnails",
  ".cache",
  "cache",
  ".gs",
  ".gs_fs0",
  "bugreportcache",
  ".dlprovider",
  ".trashed",
  ".trash",
  "lost.dir"
]);

// En modo "rápido", el recorrido de la raíz no entra en los sandbox de las
// apps: WhatsApp y Telegram ya están en KNOWN_LOCATIONS y el resto de
// Android/data son cientos de carpetas sin archivos del usuario.
const ROOT_SCAN_EXCLUDE = new Set([...SEARCH_EXCLUDE, "android"]);
const ROOT_SCAN_DEPTH = 2;

// Extensiones por categoría
const FILE_TYPES = {
  pdf: [".pdf"],
  documents: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt", ".csv", ".rtf"],
  images: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".svg"],
  videos: [".mp4", ".mkv", ".avi", ".mov", ".webm", ".3gp", ".flv", ".ts"],
  audio: [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus", ".amr"],
  all: [
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt", ".csv", ".rtf",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".svg",
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".3gp", ".flv", ".ts",
    ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus", ".amr"
  ]
};

const respondJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    // Estado volátil: el navegador nunca debe reutilizar una respuesta vieja
    "Cache-Control": "no-store"
  });
  res.end(body);
};

// Lee el cuerpo en búferes (sin concatenar cadenas gigantes) y libera
// la lista de fragmentos en cuanto termina de parsear.
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let chunks = [];
    let bytes = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) {
        return;
      }
      bytes += chunk.length;
      if (bytes > CACHE.bodyMaxBytes) {
        aborted = true;
        chunks = null;
        reject(new Error("Cuerpo de la petición demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("error", (err) => {
      if (aborted) {
        return;
      }
      aborted = true;
      chunks = null;
      reject(err);
    });

    req.on("end", () => {
      if (aborted) {
        return;
      }
      if (bytes === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks, bytes);
      chunks = null;
      try {
        const parsed = JSON.parse(raw.toString("utf8"));
        resolve(parsed);
      } catch (err) {
        reject(new Error("JSON invalido"));
      }
    });
  });

const spawnGio = (args, timeout, job, maxBuffer) =>
  new Promise((resolve, reject) => {
    if (job && job.cancelled) {
      reject(new Error("Operación cancelada"));
      return;
    }

    const proc = execFile("gio", args, { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (job && job.activeChildProcess === proc) {
        job.activeChildProcess = null;
      }
      if (err) {
        if (job && job.cancelled) {
          reject(new Error("Operación cancelada"));
          return;
        }
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });

    if (job) {
      job.activeChildProcess = proc;
    }
  });

// Todo acceso al dispositivo pasa por la cola serie: un solo proceso gio a la
// vez. El trabajo en curso tiene prioridad sobre las consultas de la interfaz.
const execGio = (args, timeout = 120000, job = null, options = {}) => {
  const {
    priority = job ? 1 : 5,
    maxWaitMs = job ? 0 : 120000,
    maxBuffer = CACHE.execMaxBuffer
  } = options;

  if (job && job.cancelled) {
    return Promise.reject(new Error("Operación cancelada"));
  }

  return runOnDevice(() => spawnGio(args, timeout, job, maxBuffer), { priority, maxWaitMs });
};

const parseMtpVolumes = (output) => {
  const devices = [];
  const blocks = output.split(/\n(?=Volume\()/g);
  blocks.forEach((block) => {
    if (!block.includes("GProxyVolumeMonitorMTP")) {
      return;
    }
    const match = block.match(/activation_root=mtp:\/\/([^/]+)\//);
    if (!match) {
      return;
    }
    const id = match[1];
    devices.push({
      id,
      activationRoot: `mtp://${id}/`
    });
  });
  return devices;
};

const listMounts = async () => {
  try {
    const output = await execGio(["mount", "-li"]);
    const devices = parseMtpVolumes(output);
    if (devices.length) {
      return devices;
    }
  } catch (_err) {
    // fall through
  }

  const uid = process.getuid();
  const gvfsPath = `/run/user/${uid}/gvfs`;
  if (!fs.existsSync(gvfsPath)) {
    return [];
  }
  const entries = fs.readdirSync(gvfsPath);
  return entries
    .filter((entry) => entry.startsWith("mtp:host="))
    .map((entry) => ({
      id: entry.replace("mtp:host=", ""),
      activationRoot: `mtp://${entry.replace("mtp:host=", "")}/`
    }));
};

const buildMtpUri = (deviceId, subPath) => {
  const cleanPath = subPath ? `/${subPath.replace(/^\//, "")}` : "";
  return `mtp://${deviceId}${cleanPath}`;
};

const encodeMtpPath = (subPath) =>
  subPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const parseDetailedLine = (line) => {
  const parts = line.split("\t");
  const name = parts[0] ? parts[0].trim() : "";
  let size = 0;
  let mtime = 0;
  let isDir = false;

  if (parts.length > 1) {
    const s = parseInt(parts[1], 10);
    if (!isNaN(s)) size = s;
  }
  if (parts.length > 2 && parts[2].includes("directory")) {
    isDir = true;
  }
  if (parts.length > 3) {
    const mMatch = parts[3].match(/time::modified=(\d+)/);
    if (mMatch) {
      mtime = parseInt(mMatch[1], 10);
    }
  }
  return { name, size, mtime, isDir };
};

// Parseo en una sola pasada: sin arrays intermedios por cada .map/.filter
const parseListOutput = (output, detailed) => {
  const items = [];
  let start = 0;
  while (start <= output.length) {
    let end = output.indexOf("\n", start);
    if (end === -1) {
      end = output.length;
    }
    const line = output.slice(start, end).trim();
    start = end + 1;
    if (!line) {
      if (end >= output.length) {
        break;
      }
      continue;
    }
    if (detailed) {
      const parsed = parseDetailedLine(line);
      if (parsed.name) {
        items.push(parsed);
      }
    } else {
      items.push({ name: line, size: 0, mtime: 0, isDir: false });
    }
    if (end >= output.length) {
      break;
    }
  }
  return items;
};

const gioList = async (deviceId, subPath, detailed = false, options = {}) => {
  const { job = null, priority, maxWaitMs } = options;
  const execOptions = {};
  if (priority !== undefined) execOptions.priority = priority;
  if (maxWaitMs !== undefined) execOptions.maxWaitMs = maxWaitMs;

  const uri = buildMtpUri(deviceId, subPath);
  let items = null;

  if (detailed) {
    try {
      const output = await execGio(["list", "-a", "standard::size,time::modified", uri], 30000, job, execOptions);
      items = parseListOutput(output, true);
    } catch (err) {
      if (job && job.cancelled) {
        throw err;
      }
      // Fallback si -a no es soportado
    }
  }

  if (items === null) {
    const output = await execGio(["list", uri], 60000, job, execOptions);
    items = parseListOutput(output, false);
  }

  return items;
};

// cache: "use" para diagnóstico (lectura + escritura del caché),
//        "off" para búsqueda/extracción, que siempre exige datos frescos.
const tryListDirectory = async (deviceId, subPath, detailed = false, options = {}) => {
  const { cache = "off" } = options;

  if (cache === "use") {
    const cached = dirCacheGet(deviceId, subPath, detailed);
    if (cached) {
      return cached;
    }
  }

  let result;
  try {
    result = { ok: true, items: await gioList(deviceId, subPath, detailed, options) };
  } catch (err) {
    result = { ok: false, items: [], error: err.message };
  }

  if (cache === "use" && !(options.job && options.job.cancelled)) {
    dirCacheSet(deviceId, subPath, detailed, result);
  }
  return result;
};

// Genera un nombre no duplicado en el destino
const getAvailableFilePath = (targetPath) => {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let counter = 1;
  while (fs.existsSync(path.join(dir, `${base} (${counter})${ext}`))) {
    counter++;
  }
  return path.join(dir, `${base} (${counter})${ext}`);
};

// Libera la lista de archivos de un trabajo terminado: es lo que más pesa.
const releaseJobFiles = (job) => {
  if (!job) {
    return;
  }
  job.seenPaths = null;
  if (!job.files || job.files.length === 0) {
    return;
  }
  job.totalFiles = job.files.length;
  job.files = [];
  job.selectedFiles = null;
  job.seenPaths = null;
};

const isJobActive = (job) => job.status === "running";

const jobExpiryMs = (job) => (job.scanOnly ? CACHE.previewTtlMs : CACHE.jobTtlMs);

// Purga periódica: los trabajos terminados no se quedan ocupando RAM.
const sweepJobs = () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (isJobActive(job)) {
      continue;
    }
    if (!job.finishedAt) {
      job.finishedAt = now;
      continue;
    }
    if (now - job.finishedAt > jobExpiryMs(job)) {
      jobs.delete(id);
    }
  }

  // Tope duro: conserva sólo los más recientes
  if (jobs.size > CACHE.maxJobs) {
    const finished = Array.from(jobs.entries())
      .filter(([, job]) => !isJobActive(job))
      .sort((a, b) => (a[1].finishedAt || 0) - (b[1].finishedAt || 0));
    let excess = jobs.size - CACHE.maxJobs;
    for (const [id] of finished) {
      if (excess <= 0) {
        break;
      }
      jobs.delete(id);
      excess -= 1;
    }
  }

  // Caducar entradas del caché de directorios ya vencidas
  const nowMs = Date.now();
  for (const [key, entry] of Array.from(dirCache.entries())) {
    if (entry.expires <= nowMs) {
      dirCacheDrop(key);
    }
  }
};

const sweepTimer = setInterval(sweepJobs, CACHE.sweepMs);
if (typeof sweepTimer.unref === "function") {
  sweepTimer.unref();
}

const createJob = (payload) => {
  sweepJobs();

  const id = Math.random().toString(36).slice(2, 10);
  const job = {
    id,
    status: "running",
    stage: payload.scanOnly ? "search" : "search",
    scanOnly: Boolean(payload.scanOnly),
    searchProgress: 0,
    extractProgress: 0,
    deleteProgress: 0,
    currentPath: "",
    currentLocation: "",
    found: 0,
    copied: 0,
    deleted: 0,
    skipped: 0,
    total: 0,
    type: payload.type,
    destination: payload.destination,
    structureMode: payload.structureMode || "preserve",
    deleteAfter: Boolean(payload.deleteAfter),
    files: [],
    selectedFiles: payload.selectedFiles || null,
    currentFileIndex: 0,
    locationStats: {},
    error: null,
    cancelled: false,
    dateFilter: payload.dateFilter || "all",
    minSize: Number(payload.minSize || 0),
    maxSize: Number(payload.maxSize || 0),
    activeChildProcess: null,
    seenPaths: null,
    totalFiles: 0,
    limitReached: false,
    createdAt: Date.now(),
    finishedAt: null
  };
  jobs.set(id, job);
  return job;
};

// Verificar si un archivo coincide con las extensiones buscadas
const matchesFileType = (filename, type) => {
  const extensions = FILE_TYPES[type] || [`.${type}`];
  const lowerName = filename.toLowerCase();
  return extensions.some((ext) => lowerName.endsWith(ext));
};

// Determinar si un nombre parece archivo (tiene extensión de 1-5 chars)
const looksLikeFile = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot - 1 >= 1 && name.length - dot - 1 <= 5;
};

// Filtro por fecha (mtime en segundos)
const matchesDateFilter = (mtimeSeconds, filter) => {
  if (!filter || filter === "all" || !mtimeSeconds) return true;
  const now = Math.floor(Date.now() / 1000);
  const diffSec = now - mtimeSeconds;
  if (diffSec < 0) return true;
  if (filter === "24h") return diffSec <= 86400;
  if (filter === "7d") return diffSec <= 7 * 86400;
  if (filter === "30d") return diffSec <= 30 * 86400;
  if (filter === "year") return diffSec <= 365 * 86400;
  return true;
};

// Filtro por tamaño (en bytes vs min/max en KB)
const matchesSizeFilter = (sizeBytes, minSizeKb, maxSizeKb) => {
  if (!sizeBytes || sizeBytes === 0) return true; // si el tamaño no se pudo obtener, no descartar
  const sizeKb = sizeBytes / 1024;
  if (minSizeKb > 0 && sizeKb < minSizeKb) return false;
  if (maxSizeKb > 0 && sizeKb > maxSizeKb) return false;
  return true;
};

// Buscar archivos recursivamente en una carpeta
const searchInFolder = async (job, deviceId, basePath, type, maxDepth = 10, dateFilter = "all", minSize = 0, maxSize = 0, excludeDirs = SEARCH_EXCLUDE) => {
  const files = [];

  const walk = async (subPath, depth) => {
    if (depth > maxDepth || job.cancelled) return;

    job.currentPath = subPath;
    // cache "off": la búsqueda siempre trabaja con el estado real del teléfono
    const { ok, items } = await tryListDirectory(deviceId, subPath, true, { job, cache: "off" });
    if (!ok) return;

    for (const item of items) {
      if (job.cancelled) return;
      const entry = item.name;
      const childPath = `${subPath}/${entry}`;

      if (matchesFileType(entry, type)) {
        if (!matchesDateFilter(item.mtime, dateFilter)) continue;
        if (!matchesSizeFilter(item.size, minSize, maxSize)) continue;

        // Las carpetas conocidas y el recorrido de la raíz se solapan:
        // sin esta comprobación el mismo archivo se listaba, copiaba y
        // guardaba en memoria dos veces.
        if (job.seenPaths) {
          if (job.seenPaths.has(childPath)) continue;
          job.seenPaths.add(childPath);
        }

        if (job.found >= CACHE.maxFilesPerJob) {
          // Tope de seguridad: evita que un escaneo masivo agote la RAM
          job.limitReached = true;
          return;
        }

        files.push({
          path: childPath,
          name: entry,
          location: basePath,
          size: item.size || 0,
          mtime: item.mtime || 0
        });
        job.found = job.found + 1;
        continue;
      }

      if (looksLikeFile(entry)) continue;
      if (excludeDirs.has(entry.toLowerCase())) continue;

      await walk(childPath, depth + 1);
    }
  };

  await walk(basePath, 0);
  return files;
};

// Obtener almacenamientos disponibles (interno y SD) con reintentos
const getStorages = async (deviceId, options = {}) => {
  // La raíz del dispositivo casi nunca cambia: se cachea siempre.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { ok, items } = await tryListDirectory(deviceId, "", false, { cache: "use", ...options });
    if (ok && items.length > 0) {
      return items.map((i) => i.name).filter((item) => !item.startsWith("."));
    }
    if (options.job && options.job.cancelled) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return ["Almacenamiento interno compartido"];
};

// Inspeccionar tipos de memoria, capacidades y carpetas clave
const getStorageInfo = async (deviceId, { fresh = false } = {}) => {
  if (fresh) {
    // Un snapshot "después" debe medir la realidad, no el caché
    dirCacheInvalidateDevice(deviceId);
  }
  await execGio(["mount", `mtp://${deviceId}/`], 15000).catch(() => {});
  const storages = await getStorages(deviceId);
  const storageResults = [];

  for (const storageName of storages) {
    let size = 0;
    let free = 0;
    let used = 0;
    let type = "MTP";

    try {
      const uri = buildMtpUri(deviceId, storageName);
      const output = await execGio(["info", "-f", uri], 15000, null, { maxBuffer: 256 * 1024 });
      const sizeMatch = output.match(/filesystem::size:\s*(\d+)/);
      const freeMatch = output.match(/filesystem::free:\s*(\d+)/);
      const usedMatch = output.match(/filesystem::used:\s*(\d+)/);
      const typeMatch = output.match(/filesystem::type:\s*([^\n\r]+)/);

      if (sizeMatch) size = parseInt(sizeMatch[1], 10);
      if (freeMatch) free = parseInt(freeMatch[1], 10);
      if (usedMatch) used = parseInt(usedMatch[1], 10);
      if (typeMatch) type = typeMatch[1].trim();

      if (size > 0 && free > 0 && used === 0) {
        used = Math.max(0, size - free);
      }
    } catch (_err) {
      try {
        const uid = process.getuid();
        const gvfsBase = `/run/user/${uid}/gvfs/mtp:host=${deviceId}`;
        const targetPath = path.join(gvfsBase, storageName);
        if (fs.existsSync(targetPath)) {
          const stats = fs.statfsSync(targetPath);
          size = stats.bsize * stats.blocks;
          free = stats.bsize * stats.bfree;
          used = size - free;
        }
      } catch (_fErr) {}
    }

    const percentUsed = size > 0 ? Math.min(100, Math.round((used / size) * 100)) : 0;
    const isSD =
      storageName.toLowerCase().includes("sd") ||
      storageName.toLowerCase().includes("card") ||
      storageName.toLowerCase().includes("disk") ||
      storageName.toLowerCase().includes("extern");

    storageResults.push({
      name: storageName,
      label: isSD ? "Tarjeta SD / Memoria Externa" : "Almacenamiento Interno Compartido",
      isSD,
      type,
      totalBytes: size,
      freeBytes: free,
      usedBytes: used,
      percentUsed
    });
  }

  // Carpetas clave para auditar capacidad y contenido
  const AUDIT_FOLDERS = [
    { name: "DCIM (Cámara y Fotos)", path: "DCIM" },
    { name: "Fotos y Galería (Pictures)", path: "Pictures" },
    { name: "Descargas (Download)", path: "Download" },
    { name: "Documentos", path: "Documents" },
    { name: "Música y Audios", path: "Music" },
    { name: "Videos y Películas", path: "Movies" },
    { name: "WhatsApp Media", path: "Android/media/com.whatsapp/WhatsApp/Media" },
    { name: "Telegram", path: "Telegram" }
  ];

  const folderResults = [];

  for (const storage of storageResults) {
    for (const folder of AUDIT_FOLDERS) {
      const folderSubPath = `${storage.name}/${folder.path}`;
      try {
        // cache "use": el diagnóstico se repite (inicial, final, re-verificación)
        const { ok, items } = await tryListDirectory(deviceId, folderSubPath, true, { cache: "use" });
        if (ok && items.length > 0) {
          let folderTotalSize = 0;
          const filesCount = items.length;
          for (const item of items) {
            folderTotalSize += item.size || 0;
          }
          folderResults.push({
            storage: storage.name,
            folderName: folder.name,
            subPath: folder.path,
            fullPath: folderSubPath,
            sizeBytes: folderTotalSize,
            filesCount
          });
        }
      } catch (_) {}
    }
  }

  return {
    timestamp: Date.now(),
    storages: storageResults,
    folders: folderResults
  };
};

// Escanear y extraer archivos
const scanAndExtract = async (job, deviceId, payload) => {
  const {
    type,
    destination,
    searchMode = "known",
    structureMode = "preserve",
    deleteAfter = false,
    scanOnly = false,
    selectedFiles = null,
    dateFilter = "all",
    minSize = 0,
    maxSize = 0
  } = payload;

  try {
    await execGio(["mount", `mtp://${deviceId}/`], 15000, job).catch(() => {});

    let allFiles = [];

    if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
      // Extracción directa de archivos previamente seleccionados
      allFiles = selectedFiles;
      job.searchProgress = 100;
      job.found = allFiles.length;
      job.total = allFiles.length;
      job.files = allFiles;
    } else {
      // Búsqueda completa
      const storages = await getStorages(deviceId, { job, priority: 1 });
      if (job.cancelled) {
        job.status = "cancelled";
        return;
      }

      // Cada ubicación lleva su propia profundidad y exclusiones: la raíz en
      // modo rápido se recorre en superficie, no hasta 8 niveles.
      let locationsToSearch = [];
      if (searchMode === "known") {
        for (const storage of storages) {
          for (const location of KNOWN_LOCATIONS) {
            locationsToSearch.push({ path: `${storage}/${location}`, depth: 8, exclude: SEARCH_EXCLUDE });
          }
          locationsToSearch.push({ path: storage, depth: ROOT_SCAN_DEPTH, exclude: ROOT_SCAN_EXCLUDE });
        }
      } else {
        for (const storage of storages) {
          locationsToSearch.push({ path: storage, depth: 20, exclude: SEARCH_EXCLUDE });
        }
      }

      const totalLocations = locationsToSearch.length;
      let searchedLocations = 0;
      job.seenPaths = new Set();

      for (const location of locationsToSearch) {
        if (job.cancelled) {
          job.status = "cancelled";
          return;
        }

        job.currentLocation = location.path;
        job.searchProgress = Math.round((searchedLocations / totalLocations) * 90);

        const files = await searchInFolder(
          job,
          deviceId,
          location.path,
          type,
          location.depth,
          dateFilter,
          minSize,
          maxSize,
          location.exclude
        );

        if (files.length > 0) {
          job.locationStats[location.path] = (job.locationStats[location.path] || 0) + files.length;
          // push(...files) con decenas de miles de elementos desborda la pila
          for (let i = 0; i < files.length; i++) {
            allFiles.push(files[i]);
          }
        }

        searchedLocations++;
      }

      job.searchProgress = 100;
      job.total = allFiles.length;
      job.files = allFiles;
      // El índice de deduplicación ya no hace falta: se libera
      job.seenPaths = null;
    }

    if (job.cancelled) {
      job.status = "cancelled";
      return;
    }

    // Modo solo escaneo: termina y ofrece la lista en la interfaz
    if (scanOnly) {
      job.stage = "preview";
      job.status = "done";
      job.totalFiles = job.files.length;
      job.finishedAt = Date.now();
      return;
    }

    if (allFiles.length === 0) {
      job.stage = "extract";
      job.status = "done";
      job.extractProgress = 100;
      job.finishedAt = Date.now();
      releaseJobFiles(job);
      return;
    }

    // Inicio de la extracción
    job.stage = "extract";
    job.extractProgress = 0;
    fs.mkdirSync(destination, { recursive: true });

    const copyTimeout = allFiles.length > 500 ? 180000 : allFiles.length > 100 ? 120000 : 60000;

    for (let i = 0; i < allFiles.length; i++) {
      if (job.cancelled) {
        job.status = "cancelled";
        return;
      }

      const file = allFiles[i];
      job.currentPath = file.path;
      job.currentFileIndex = i;

      try {
        let targetDir = destination;
        let targetFilename = file.name;

        if (structureMode === "preserve") {
          const segments = file.path.split("/").filter(Boolean);
          if (segments.length > 2) {
            const relativeFolder = segments.slice(1, -1).join("/");
            targetDir = path.join(destination, relativeFolder);
          }
        }

        fs.mkdirSync(targetDir, { recursive: true });
        let targetFilePath = path.join(targetDir, targetFilename);

        if (structureMode === "flat_skip" && fs.existsSync(targetFilePath)) {
          file.localDestPath = targetFilePath;
          job.skipped = (job.skipped || 0) + 1;
          job.extractProgress = Math.round(((i + 1) / allFiles.length) * 100);
          continue;
        } else if (structureMode === "flat_rename" || (structureMode === "preserve" && fs.existsSync(targetFilePath))) {
          targetFilePath = getAvailableFilePath(targetFilePath);
        }

        file.localDestPath = targetFilePath;

        const encoded = encodeMtpPath(file.path);
        const uri = buildMtpUri(deviceId, encoded);

        await execGio(["copy", "-T", uri, targetFilePath], copyTimeout, job);
        job.copied += 1;
      } catch (err) {
        console.error(`Error copiando ${file.path}: ${err.message}`);
        file.copyError = err.message;
      }

      job.extractProgress = Math.round(((i + 1) / allFiles.length) * 100);
    }

    // Fase de eliminación segura
    if (deleteAfter && job.copied > 0 && !job.cancelled) {
      job.stage = "delete";
      job.deleteProgress = 0;
      let deleteAttempts = 0;

      for (let i = 0; i < allFiles.length; i++) {
        if (job.cancelled) {
          job.status = "cancelled";
          return;
        }

        const file = allFiles[i];
        deleteAttempts++;
        job.currentPath = file.path;
        job.currentFileIndex = i;

        // Verificación de integridad estricta antes de borrar
        const localTarget = file.localDestPath;
        const existsLocally = localTarget && fs.existsSync(localTarget);
        const localSize = existsLocally ? fs.statSync(localTarget).size : 0;

        if (!existsLocally || (localSize === 0 && (file.size || 0) > 0)) {
          console.warn(`Omitiendo eliminación de ${file.path}: no verificado localmente en ${localTarget}`);
          job.deleteProgress = Math.round((deleteAttempts / allFiles.length) * 100);
          continue;
        }

        try {
          const encoded = encodeMtpPath(file.path);
          const uri = buildMtpUri(deviceId, encoded);
          await execGio(["remove", uri], allFiles.length > 500 ? 60000 : 30000, job);
          job.deleted += 1;
          // El directorio cambió: su listado cacheado ya no es válido
          dirCacheInvalidatePath(deviceId, parentOf(file.path));
        } catch (err) {
          console.error(`Error eliminando ${file.path}: ${err.message}`);
        }

        job.deleteProgress = Math.round((deleteAttempts / allFiles.length) * 100);
      }
    }

    if (!job.cancelled) {
      job.deleteProgress = 100;
      job.status = "done";
    }
  } catch (err) {
    if (job.cancelled) {
      job.status = "cancelled";
    } else {
      job.status = "error";
      job.error = err.message;
    }
  } finally {
    job.finishedAt = Date.now();
    job.activeChildProcess = null;
    if (!job.scanOnly) {
      // La interfaz ya no necesita la lista completa tras extraer: se libera
      releaseJobFiles(job);
    }
  }
};

// ========================================================
// CACHE DE ARCHIVOS ESTATICOS
// Se sirven desde RAM y se revalidan por mtime+tamaño, de modo que
// el navegador responde con 304 y no se relee el disco en cada visita.
// ========================================================
const staticCache = new Map();
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml"
};

const getStaticAsset = (fullPath) => {
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch (_) {
    staticCache.delete(fullPath);
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }

  const signature = `${stat.mtimeMs.toFixed(0)}-${stat.size}`;
  const cached = staticCache.get(fullPath);
  if (cached && cached.signature === signature) {
    return cached;
  }

  const asset = {
    data: fs.readFileSync(fullPath),
    signature,
    etag: `W/"${signature}"`,
    contentType: CONTENT_TYPES[path.extname(fullPath)] || "application/octet-stream"
  };

  // Sólo se retienen archivos pequeños; los grandes se sirven sin cachear
  if (stat.size <= CACHE.staticMaxBytes) {
    staticCache.set(fullPath, asset);
  } else {
    staticCache.delete(fullPath);
  }
  return asset;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if ((req.method === "GET" || req.method === "HEAD") && PUBLIC_FILES.has(url.pathname)) {
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const fullPath = path.join(__dirname, filePath);

    const asset = getStaticAsset(fullPath);
    if (!asset) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const headers = {
      "Content-Type": asset.contentType,
      "ETag": asset.etag,
      "Cache-Control": "no-cache"
    };

    // Revalidación barata: si el navegador ya lo tiene, no se reenvía nada
    if (req.headers["if-none-match"] === asset.etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    headers["Content-Length"] = asset.data.length;
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(asset.data);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/device") {
    try {
      const devices = await listMounts();
      respondJson(res, 200, { devices });
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/memory") {
    const mem = process.memoryUsage();
    respondJson(res, 200, {
      heapUsedMB: Math.round((mem.heapUsed / 1048576) * 10) / 10,
      rssMB: Math.round((mem.rss / 1048576) * 10) / 10,
      jobs: jobs.size,
      activeJobs: Array.from(jobs.values()).filter((job) => job.status === "running").length,
      retainedFiles: Array.from(jobs.values()).reduce((acc, job) => acc + job.files.length, 0),
      dirCache: { buckets: dirCache.size, items: dirCacheItems, ...cacheStats },
      staticCache: staticCache.size,
      deviceQueue: { active: gioActive, pending: gioQueue.length }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cache/clear") {
    dirCacheInvalidateDevice(null);
    staticCache.clear();
    sweepJobs();
    if (typeof global.gc === "function") {
      global.gc();
    }
    respondJson(res, 200, { success: true, heapUsedMB: Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10 });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/file-types") {
    respondJson(res, 200, {
      types: Object.keys(FILE_TYPES),
      details: FILE_TYPES
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/storage-info") {
    const deviceId = url.searchParams.get("deviceId");
    if (!deviceId) {
      respondJson(res, 400, { error: "deviceId requerido" });
      return;
    }

    try {
      const fresh = url.searchParams.get("fresh") === "1";
      const info = await getStorageInfo(deviceId, { fresh });
      respondJson(res, 200, info);
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/extract") {
    try {
      const payload = await readBody(req);
      const deviceId = payload.deviceId;
      const type = (payload.type || "pdf").toLowerCase();
      const searchMode = payload.searchMode || "known";
      const structureMode = payload.structureMode || "preserve";
      const deleteAfter = Boolean(payload.deleteAfter);
      const scanOnly = Boolean(payload.scanOnly);
      const selectedFiles = payload.selectedFiles || null;
      const dateFilter = payload.dateFilter || "all";
      const minSize = Number(payload.minSize || 0);
      const maxSize = Number(payload.maxSize || 0);
      const destination =
        payload.destination || path.join(process.env.HOME || "/home/usuario", "Extraidos_Android", type.toUpperCase());

      if (!deviceId) {
        respondJson(res, 400, { error: "deviceId requerido" });
        return;
      }

      const job = createJob({
        type,
        destination,
        structureMode,
        deleteAfter,
        scanOnly,
        selectedFiles,
        dateFilter,
        minSize,
        maxSize
      });
      respondJson(res, 202, { jobId: job.id });

      scanAndExtract(job, deviceId, {
        type,
        destination,
        searchMode,
        structureMode,
        deleteAfter,
        scanOnly,
        selectedFiles,
        dateFilter,
        minSize,
        maxSize
      }).catch((err) => {
        if (!job.cancelled) {
          job.status = "error";
          job.error = err.message;
        }
      });
    } catch (err) {
      respondJson(res, 400, { error: err.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/extract/cancel") {
    try {
      const payload = await readBody(req);
      const id = payload.jobId;
      const job = jobs.get(id);
      if (!job) {
        respondJson(res, 404, { error: "Trabajo no encontrado" });
        return;
      }
      job.cancelled = true;
      job.status = "cancelled";
      job.finishedAt = Date.now();
      if (job.activeChildProcess) {
        try {
          job.activeChildProcess.kill("SIGKILL");
        } catch (_) {}
        job.activeChildProcess = null;
      }
      if (!job.scanOnly) {
        releaseJobFiles(job);
      }
      respondJson(res, 200, { success: true, message: "Proceso cancelado" });
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/open-folder") {
    try {
      const payload = await readBody(req);
      const folderPath = payload.folderPath || path.join(process.env.HOME || "/home/usuario", "Extraidos_Android");
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
      execFile("xdg-open", [folderPath], (err) => {
        if (err) {
          respondJson(res, 500, { error: `No se pudo abrir la carpeta: ${err.message}` });
          return;
        }
        respondJson(res, 200, { success: true });
      });
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/extract/status") {
    const id = url.searchParams.get("id");
    const job = jobs.get(id);
    if (!job) {
      respondJson(res, 404, { error: "job no encontrado" });
      return;
    }

    const includeFiles = url.searchParams.get("files") === "1";
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    // Página acotada: nunca se serializa la lista completa de una sola vez
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") || 500)));

    const lite = {
      id: job.id,
      status: job.status,
      stage: job.stage,
      scanOnly: job.scanOnly,
      searchProgress: job.searchProgress,
      extractProgress: job.extractProgress,
      deleteProgress: job.deleteProgress,
      currentPath: job.currentPath,
      currentLocation: job.currentLocation,
      found: job.found,
      copied: job.copied,
      deleted: job.deleted,
      skipped: job.skipped || 0,
      total: job.total,
      type: job.type,
      destination: job.destination,
      structureMode: job.structureMode,
      deleteAfter: job.deleteAfter,
      currentFileIndex: job.currentFileIndex,
      locationStats: job.locationStats,
      error: job.error,
      cancelled: job.cancelled,
      limitReached: Boolean(job.limitReached),
      totalFiles: job.totalFiles || job.files.length
    };

    if (includeFiles) {
      lite.files = job.files.slice(offset, offset + limit);
      lite.filesOffset = offset;
      lite.filesHasMore = offset + limit < job.files.length;
    }

    respondJson(res, 200, lite);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/remount") {
    try {
      const payload = await readBody(req);
      const deviceId = payload.deviceId;

      if (!deviceId) {
        respondJson(res, 400, { error: "deviceId requerido" });
        return;
      }

      // Se remonta el dispositivo: cualquier listado cacheado queda obsoleto
      dirCacheInvalidateDevice(deviceId);
      await execGio(["mount", "-u", `mtp://${deviceId}/`]).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await execGio(["mount", `mtp://${deviceId}/`]).catch(() => {});

      respondJson(res, 200, { success: true });
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/shutdown") {
    try {
      const running = Array.from(jobs.values()).some((job) => job.status === "running");
      if (running) {
        respondJson(res, 409, { error: "Hay un proceso en curso. Cancélalo antes de finalizar." });
        return;
      }

      const payload = await readBody(req).catch(() => ({}));
      const deviceId = payload.deviceId;
      let unmounted = null;
      if (deviceId) {
        // Desmontaje seguro para poder desconectar el cable USB
        unmounted = await execGio(["mount", "-u", `mtp://${deviceId}/`], 15000)
          .then(() => true)
          .catch(() => false);
      }

      respondJson(res, 200, { success: true, unmounted });

      // Se cierra después de enviar la respuesta
      setTimeout(() => {
        try {
          fs.unlinkSync(path.join(__dirname, ".server.pid"));
        } catch (_) {}
        console.log("Servidor detenido desde el botón Finalizar.");
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
      }, 300);
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor en http://${HOST}:${PORT}`);
});
