const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = 3000;
const PUBLIC_FILES = new Set(["/", "/index.html", "/styles.css", "/app.js"]);

const jobs = new Map();

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

// Extensiones por categoría
const FILE_TYPES = {
  pdf: [".pdf"],
  documents: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt"],
  images: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic"],
  videos: [".mp4", ".mkv", ".avi", ".mov", ".webm", ".3gp"],
  audio: [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"],
  all: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt",
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic",
        ".mp4", ".mkv", ".avi", ".mov", ".webm", ".3gp",
        ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]
};

const respondJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 50_000_000) {
        reject(new Error("Body demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("JSON invalido"));
      }
    });
  });

const execGio = (args, timeout = 120000) =>
  new Promise((resolve, reject) => {
    execFile("gio", args, { timeout, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });

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

const gioList = async (deviceId, subPath) => {
  const uri = buildMtpUri(deviceId, subPath);
  const output = await execGio(["list", uri]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

const tryListDirectory = async (deviceId, subPath) => {
  try {
    const items = await gioList(deviceId, subPath);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const TREE_EXCLUDE = new Set([
  ".thumbnails",
  "Thumbnails",
  ".cache",
  "cache",
  ".gs",
  ".gs_fs0",
  ".images",
  ".temp",
  ".temp_mivideo",
  ".dlprovider",
  ".fe_tmp",
  "BugReportCache"
]);

const shouldExcludeFromTree = (entry) => {
  if (!entry) {
    return false;
  }
  if (entry.startsWith(".")) {
    return true;
  }
  return TREE_EXCLUDE.has(entry);
};

const buildTree = async (deviceId, basePath, maxDepth, maxNodes) => {
  const root = { name: basePath, path: basePath, children: [] };
  let nodeCount = 1;

  const walk = async (node, depth) => {
    if (depth > maxDepth || nodeCount >= maxNodes) {
      return;
    }
    const { ok, items } = await tryListDirectory(deviceId, node.path);
    if (!ok) {
      return;
    }
    for (const entry of items) {
      if (nodeCount >= maxNodes) {
        return;
      }
      if (shouldExcludeFromTree(entry)) {
        continue;
      }
      const childPath = `${node.path}/${entry}`;
      const childNode = { name: entry, path: childPath, children: [] };
      node.children.push(childNode);
      nodeCount += 1;
      const childList = await tryListDirectory(deviceId, childPath);
      if (childList.ok) {
        await walk(childNode, depth + 1);
      }
    }
  };

  await walk(root, 0);

  return {
    tree: root,
    truncated: nodeCount >= maxNodes,
    nodeCount
  };
};

const createJob = (payload) => {
  const id = Math.random().toString(36).slice(2, 10);
  const job = {
    id,
    status: "running",
    stage: "search",
    searchProgress: 0,
    extractProgress: 0,
    deleteProgress: 0,
    currentPath: "",
    currentLocation: "",
    found: 0,
    copied: 0,
    deleted: 0,
    total: 0,
    type: payload.type,
    destination: payload.destination,
    deleteAfter: payload.deleteAfter || false,
    files: [],
    currentFileIndex: 0,
    locationStats: {},
    error: null
  };
  jobs.set(id, job);
  return job;
};

// Verificar si un archivo coincide con las extensiones buscadas
const matchesFileType = (filename, type) => {
  const extensions = FILE_TYPES[type] || [`.${type}`];
  const lowerName = filename.toLowerCase();
  return extensions.some(ext => lowerName.endsWith(ext));
};

// Determinar si un nombre parece archivo (tiene extension de 1-5 chars)
const looksLikeFile = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && (name.length - dot - 1) >= 1 && (name.length - dot - 1) <= 5;
};

// Buscar archivos recursivamente en una carpeta
const searchInFolder = async (job, deviceId, basePath, type, maxDepth = 10) => {
  const files = [];

  const walk = async (subPath, depth) => {
    if (depth > maxDepth) return;

    job.currentPath = subPath;
    const { ok, items } = await tryListDirectory(deviceId, subPath);
    if (!ok) return;

    for (const entry of items) {
      const childPath = `${subPath}/${entry}`;

      // Primero verificar si coincide con el tipo buscado → es archivo
      if (matchesFileType(entry, type)) {
        files.push({
          path: childPath,
          name: entry,
          location: basePath
        });
        job.found = job.found + 1;
        continue;
      }

      // Si parece archivo (tiene extension) pero no coincide → saltar
      if (looksLikeFile(entry)) continue;

      // No tiene extension → probablemente es carpeta, recursar
      await walk(childPath, depth + 1);
    }
  };

  await walk(basePath, 0);
  return files;
};

// Obtener almacenamientos disponibles (interno y SD) con reintentos
const getStorages = async (deviceId) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { ok, items } = await tryListDirectory(deviceId, "");
    if (ok && items.length > 0) {
      return items.filter(item => !item.startsWith("."));
    }
    // Esperar antes de reintentar - MTP es intermitente
    await new Promise(r => setTimeout(r, 1500));
  }
  return ["Almacenamiento interno compartido"];
};

// Escanear y extraer archivos de todas las ubicaciones conocidas
const scanAndExtract = async (job, deviceId, type, destination, searchMode) => {
  try {
    // Montar dispositivo
    await execGio(["mount", `mtp://${deviceId}/`]).catch(() => {});

    const allFiles = [];
    const storages = await getStorages(deviceId);

    let locationsToSearch = [];

    if (searchMode === "known") {
      // Buscar en ubicaciones conocidas
      for (const storage of storages) {
        for (const location of KNOWN_LOCATIONS) {
          locationsToSearch.push(`${storage}/${location}`);
        }
        // También buscar en la raíz del almacenamiento para subcarpetas con códigos
        locationsToSearch.push(storage);
      }
    } else {
      // Buscar en todo el almacenamiento
      for (const storage of storages) {
        locationsToSearch.push(storage);
      }
    }

    const totalLocations = locationsToSearch.length;
    let searchedLocations = 0;

    for (const location of locationsToSearch) {
      job.currentLocation = location;
      job.searchProgress = Math.round((searchedLocations / totalLocations) * 90);

      const files = await searchInFolder(job, deviceId, location, type, searchMode === "known" ? 8 : 20);

      if (files.length > 0) {
        job.locationStats[location] = files.length;
        allFiles.push(...files);
      }

      searchedLocations++;
    }

    job.searchProgress = 100;
    job.stage = "extract";
    job.total = allFiles.length;
    job.files = allFiles;

    if (allFiles.length === 0) {
      job.status = "done";
      job.extractProgress = 100;
      return;
    }

    // Crear directorio destino
    fs.mkdirSync(destination, { recursive: true });

    // Timeout adaptativo: más archivos → más tiempo por archivo (MTP se ralentiza)
    const copyTimeout = allFiles.length > 500 ? 180000 : allFiles.length > 100 ? 120000 : 60000;

    // Copiar archivos
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      job.currentPath = file.path;
      job.currentFileIndex = i;
      try {
        const encoded = encodeMtpPath(file.path);
        const uri = buildMtpUri(deviceId, encoded);
        await execGio(["copy", uri, destination], copyTimeout);
        job.copied += 1;
        job.extractProgress = Math.round((job.copied / allFiles.length) * 100);
      } catch (err) {
        // Continuar con el siguiente archivo si hay error
        console.error(`Error copiando ${file.path}: ${err.message}`);
      }
    }

    // Eliminar archivos si se solicitó
    if (job.deleteAfter && job.copied > 0) {
      job.stage = "delete";
      job.deleteProgress = 0;
      let deleteAttempts = 0;

      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        deleteAttempts++;
        job.currentPath = file.path;
        job.currentFileIndex = i;
        try {
          const encoded = encodeMtpPath(file.path);
          const uri = buildMtpUri(deviceId, encoded);
          await execGio(["remove", uri], allFiles.length > 500 ? 60000 : 30000);
          job.deleted += 1;
        } catch (err) {
          console.error(`Error eliminando ${file.path}: ${err.message}`);
        }
        // Actualizar progreso sin importar si hubo éxito o error
        job.deleteProgress = Math.round((deleteAttempts / allFiles.length) * 100);
      }
    }

    job.deleteProgress = 100;
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err.message;
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && PUBLIC_FILES.has(url.pathname)) {
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const fullPath = path.join(__dirname, filePath);
    try {
      const data = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath);
      const contentType = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end("Not found");
    }
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

  if (req.method === "GET" && url.pathname === "/api/tree") {
    const deviceId = url.searchParams.get("deviceId");
    const base = url.searchParams.get("base") || "Almacenamiento interno compartido";
    const depth = Number(url.searchParams.get("depth") || 5);
    const maxNodes = Number(url.searchParams.get("maxNodes") || 5000);

    if (!deviceId) {
      respondJson(res, 400, { error: "deviceId requerido" });
      return;
    }

    try {
      await execGio(["mount", `mtp://${deviceId}/`]).catch(() => {});

      // Reintentar si MTP no responde inmediatamente
      let result = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        result = await buildTree(deviceId, base, depth, maxNodes);
        if (result.nodeCount > 1) break;
        await new Promise(r => setTimeout(r, 1500));
      }

      respondJson(res, 200, result);
    } catch (err) {
      respondJson(res, 500, { error: err.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/file-types") {
    respondJson(res, 200, {
      types: Object.keys(FILE_TYPES),
      details: FILE_TYPES
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/extract") {
    try {
      const payload = await readBody(req);
      const deviceId = payload.deviceId;
      const type = (payload.type || "pdf").toLowerCase();
      const searchMode = payload.searchMode || "known"; // "known" o "full"
      const deleteAfter = payload.deleteAfter || false;
      const destination = payload.destination ||
        path.join(process.env.HOME || "/home/usuario", "Extraidos_Android", type.toUpperCase());

      if (!deviceId) {
        respondJson(res, 400, { error: "deviceId requerido" });
        return;
      }

      const job = createJob({ type, destination, deleteAfter });
      respondJson(res, 202, { jobId: job.id });

      scanAndExtract(job, deviceId, type, destination, searchMode).catch((err) => {
        job.status = "error";
        job.error = err.message;
      });
    } catch (err) {
      respondJson(res, 400, { error: err.message });
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
    // Respuesta ligera: enviar todo excepto la lista completa de archivos
    const includeFiles = url.searchParams.get("files") === "1";
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 200);

    const lite = {
      id: job.id,
      status: job.status,
      stage: job.stage,
      searchProgress: job.searchProgress,
      extractProgress: job.extractProgress,
      deleteProgress: job.deleteProgress,
      currentPath: job.currentPath,
      currentLocation: job.currentLocation,
      found: job.found,
      copied: job.copied,
      deleted: job.deleted,
      total: job.total,
      type: job.type,
      destination: job.destination,
      deleteAfter: job.deleteAfter,
      currentFileIndex: job.currentFileIndex,
      locationStats: job.locationStats,
      error: job.error,
      totalFiles: job.files.length
    };

    if (includeFiles) {
      lite.files = job.files.slice(offset, offset + limit);
      lite.filesOffset = offset;
      lite.filesHasMore = (offset + limit) < job.files.length;
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

      // Desmontar y volver a montar
      await execGio(["mount", "-u", `mtp://${deviceId}/`]).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 1000));
      await execGio(["mount", `mtp://${deviceId}/`]).catch(() => {});

      respondJson(res, 200, { success: true });
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
