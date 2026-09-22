// Detectar si hay servidor backend disponible (local) o es solo frontend (GitHub Pages)
let serverAvailable = false;
const checkServer = async () => {
  try {
    const res = await fetch("/api/file-types", { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch (_) {
    serverAvailable = false;
  }
  return serverAvailable;
};
checkServer();

// Estado global de la aplicación
let activeDeviceId = null;
let activeJobId = null;
let statusTimer = null;
let scannedFiles = [];
let selectedFilePaths = new Set();

// Sondeo de estado: cadena de setTimeout con ritmo adaptativo,
// así no se acumulan peticiones en vuelo si el servidor tarda.
const POLL_MIN_MS = 700;
const POLL_MAX_MS = 2500;
const FILES_PAGE_SIZE = 2000;
let pollDelay = POLL_MIN_MS;
let pollStopped = true;

const stopPolling = () => {
  pollStopped = true;
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
};

// Descarga la lista escaneada por páginas, con tope de seguridad,
// en lugar de pedir miles de registros en una sola respuesta.
const fetchScannedFiles = async (jobId) => {
  const collected = [];
  let offset = 0;
  while (offset < PREVIEW_MAX_FILES) {
    const page = await fetchJson(
      `/api/extract/status?id=${encodeURIComponent(jobId)}&files=1&offset=${offset}&limit=${FILES_PAGE_SIZE}`
    );
    const files = page.files || [];
    for (let i = 0; i < files.length && collected.length < PREVIEW_MAX_FILES; i++) {
      collected.push(files[i]);
    }
    if (!page.filesHasMore || files.length === 0) {
      break;
    }
    offset += files.length;
  }
  return collected;
};
let notificationsEnabled = localStorage.getItem("notifications_enabled") !== "false";

// Snapshots de memoria para auditoría y comparación
let initialStorageSnapshot = null;
let finalStorageSnapshot = null;

// Gestión de Temas: "light", "dark", "dusk"
const THEMES = ["light", "dark", "dusk"];
const THEME_LABELS = {
  light: "🎨 Tema: Claro",
  dark: "🌙 Tema: Oscuro",
  dusk: "🍃 Tema: Dusk"
};

const initTheme = () => {
  const saved = localStorage.getItem("app_theme") || "light";
  applyTheme(saved);
};

const applyTheme = (theme) => {
  if (theme === "light") {
    document.body.removeAttribute("data-theme");
  } else {
    document.body.setAttribute("data-theme", theme);
  }
  localStorage.setItem("app_theme", theme);
  const toggleBtn = document.getElementById("toggle-theme");
  if (toggleBtn) {
    toggleBtn.textContent = THEME_LABELS[theme] || "🎨 Cambiar tema";
  }
};

const cycleTheme = () => {
  const current = document.body.getAttribute("data-theme") || "light";
  const currentIndex = THEMES.indexOf(current);
  const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
  applyTheme(nextTheme);
};

// Notificaciones y Sonido
const initNotifications = () => {
  const btn = document.getElementById("toggle-notifications");
  if (!btn) return;
  btn.textContent = notificationsEnabled ? "🔔 Alertas: Activadas" : "🔕 Alertas: Silenciadas";

  btn.addEventListener("click", () => {
    notificationsEnabled = !notificationsEnabled;
    localStorage.setItem("notifications_enabled", notificationsEnabled);
    btn.textContent = notificationsEnabled ? "🔔 Alertas: Activadas" : "🔕 Alertas: Silenciadas";

    if (notificationsEnabled && "Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  });
};

const playChime = (type = "success") => {
  if (!notificationsEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } else {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      osc.frequency.setValueAtTime(220, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    }
  } catch (_) {}
};

const notifyUser = (title, body) => {
  if (!notificationsEnabled) return;
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch (_) {}
  }
};

const formatBytes = (bytes) => {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes === 0) return "--";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i] || "B"}`;
};

const getFileIcon = (filename) => {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (["pdf"].includes(ext)) return "📄";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "svg", "bmp"].includes(ext)) return "🖼️";
  if (["mp4", "mkv", "avi", "mov", "webm", "3gp", "flv"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "amr"].includes(ext)) return "🎵";
  if (["doc", "docx", "txt", "rtf", "odt", "csv"].includes(ext)) return "📝";
  if (["xls", "xlsx", "ods"].includes(ext)) return "📊";
  if (["zip", "rar", "tar", "gz", "7z", "apk"].includes(ext)) return "📦";
  return "📁";
};

// Secciones de la guía de comandos
const sections = [
  {
    id: "preparacion",
    kicker: "fase 1",
    title: "Preparación y detección",
    description: "Confirma que el teléfono aparece en USB y activa el modo MTP en Android.",
    cards: [
      {
        title: "Detectar el dispositivo en USB",
        description: "Lista los dispositivos conectados. Busca tu marca/modelo.",
        code: "lsusb",
        notes: ["Si no aparece, cambia cable o puerto y vuelve a probar."]
      },
      {
        title: "Ver montajes MTP activos",
        description: "Verifica que GVFS detectó el dispositivo.",
        code: "gio mount -l | grep -i mtp",
        notes: ["El celular debe estar desbloqueado y aceptar la transferencia de archivos."]
      }
    ]
  },
  {
    id: "montaje",
    kicker: "fase 2",
    title: "Montaje y acceso",
    description: "Comprueba el punto de montaje y reinicia GVFS si algo falla.",
    cards: [
      {
        title: "Ver montaje GVFS",
        description: "Revisa que exista una carpeta MTP en GVFS.",
        code: "ls -la /run/user/$(id -u)/gvfs/",
        notes: ["Ejemplo: mtp:host=Tu_Dispositivo_ID"]
      },
      {
        title: "Reiniciar GVFS si no aparece",
        description: "Útil cuando el dispositivo se ve, pero no lista carpetas.",
        code: "systemctl --user restart gvfs-daemon",
        notes: ["Si reinicias GVFS, desconecta y reconecta el USB."]
      }
    ]
  },
  {
    id: "exploracion",
    kicker: "fase 3",
    title: "Exploración de carpetas",
    description: "Explora el almacenamiento interno y ubica las carpetas clave.",
    cards: [
      {
        title: "Listar almacenamientos",
        description: "Reemplaza DEVICE_ID por el que obtuviste en GVFS.",
        code: 'gio list "mtp://DEVICE_ID/"',
        notes: ["Suele mostrar 'Almacenamiento interno compartido' y 'disk'."]
      },
      {
        title: "Listar carpetas internas",
        description: "Explora el almacenamiento interno para ubicar Documentos, Descargas o apps.",
        code: 'gio list "mtp://DEVICE_ID/Almacenamiento interno compartido/"',
        notes: ["Carpetas típicas: Download, Documents, Telegram, DCIM, Android/media."]
      },
      {
        title: "Buscar archivos por extensión",
        description: "Filtra por cualquier extensión.",
        code: 'gio list "mtp://DEVICE_ID/Almacenamiento interno compartido/Download/" | grep -i \\.pdf',
        notes: ["Cambia '.pdf' por la extensión que necesites (.jpg, .mp4, etc)."]
      }
    ]
  },
  {
    id: "extraccion",
    kicker: "fase 4",
    title: "Extracción de archivos",
    description: "Copia archivos individuales o múltiples con opciones contra sobrescritura.",
    cards: [
      {
        title: "Crear directorio destino",
        description: "Define dónde se guardarán los archivos extraídos.",
        code: "mkdir -p ~/Extraidos_Android",
        notes: ["Usa una ruta con espacio suficiente."]
      },
      {
        title: "Copiar archivo individual",
        description: "Recuerda codificar espacios como %20 en la ruta MTP.",
        code: 'gio copy -T "mtp://DEVICE_ID/Almacenamiento%20interno%20compartido/Download/archivo.pdf" ~/Extraidos_Android/archivo.pdf',
        notes: ["La opción -T asegura copia exacta al nombre de destino."]
      }
    ]
  },
  {
    id: "alternativas",
    kicker: "alternativas",
    title: "Opciones avanzadas (ADB)",
    description: "Métodos más estables si MTP falla con muchos archivos.",
    cards: [
      {
        title: "ADB: extracción ultra-rápida",
        description: "Usa ADB para explorar y extraer archivos vía USB sin bloqueos MTP.",
        code: "adb devices\nadb pull /sdcard/Download/ ~/Extraidos_Android/",
        notes: ["Instala adb (sudo apt install adb) y habilita Depuración USB en Android."]
      }
    ]
  }
];

const quickChecklist = [
  "Cable USB de datos confiable y teléfono desbloqueado",
  "Modo USB en 'Transferencia de archivos (MTP)'",
  "Autorizar acceso en la pantalla del celular",
  "Destino local con suficiente espacio en disco",
  "Copia verificada antes de eliminar en el móvil"
];

// Inicializar navegación y guías
const menu = document.getElementById("menu");
const sectionsContainer = document.getElementById("sections");
const menuLinks = [];

if (menu && sectionsContainer) {
  sections.forEach((section) => {
    const link = document.createElement("a");
    link.href = `#${section.id}`;
    link.textContent = section.title;
    menu.appendChild(link);
    menuLinks.push(link);

    const template = document.getElementById("section-template");
    if (!template) return;
    const clone = template.content.cloneNode(true);
    const article = clone.querySelector(".section");
    article.id = section.id;

    clone.querySelector(".section-kicker").textContent = section.kicker;
    clone.querySelector("h2").textContent = section.title;
    clone.querySelector(".section-desc").textContent = section.description;

    const cardsContainer = clone.querySelector(".cards");
    section.cards.forEach((card) => {
      const cardTemplate = document.getElementById("card-template");
      const cardClone = cardTemplate.content.cloneNode(true);
      cardClone.querySelector("h3").textContent = card.title;
      cardClone.querySelector(".card-desc").textContent = card.description;
      cardClone.querySelector("code").textContent = card.code;
      const notesContainer = cardClone.querySelector(".card-notes");
      card.notes.forEach((note) => {
        const noteTemplate = document.getElementById("note-template");
        const noteClone = noteTemplate.content.cloneNode(true);
        noteClone.querySelector(".note").textContent = note;
        notesContainer.appendChild(noteClone);
      });
      cardsContainer.appendChild(cardClone);
    });

    sectionsContainer.appendChild(clone);
  });

  const checklist = document.getElementById("quick-checklist");
  if (checklist) {
    quickChecklist.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      checklist.appendChild(li);
    });
  }

  const copyButtons = document.querySelectorAll(".copy-btn");
  copyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.closest(".card").querySelector("code").textContent;
      navigator.clipboard.writeText(code).then(() => {
        button.textContent = "Copiado";
        setTimeout(() => (button.textContent = "Copiar"), 1500);
      });
    });
  });
}

// Referencias de elementos UI
const detectDevice = document.getElementById("detect-device");
const detectStatus = document.getElementById("detect-status");
const monitorLog = document.getElementById("monitor-log");
const monitorState = document.getElementById("monitor-state");
const monitorPath = document.getElementById("monitor-path");
const monitorDot = document.getElementById("monitor-dot");
const monitorMem = document.getElementById("monitor-mem");
const btnClearMonitor = document.getElementById("btn-clear-monitor");
const btnReleaseMemory = document.getElementById("btn-release-memory");
const extractForm = document.getElementById("extract-form");
const extractResult = document.getElementById("extract-result");
const destinationInput = document.getElementById("destination");
const fileTypeSelect = document.getElementById("file-type");
const customExtInput = document.getElementById("custom-ext");
const searchModeSelect = document.getElementById("search-mode");
const structureModeSelect = document.getElementById("structure-mode");
const dateFilterSelect = document.getElementById("date-filter");
const sizeFilterSelect = document.getElementById("size-filter");
const deleteAfterCheck = document.getElementById("delete-after");

const searchBar = document.getElementById("search-bar");
const searchMeta = document.getElementById("search-meta");
const searchBadge = document.getElementById("search-badge");
const extractBar = document.getElementById("extract-bar");
const extractMeta = document.getElementById("extract-meta");
const extractBadge = document.getElementById("extract-badge");
const deleteBar = document.getElementById("delete-bar");
const deleteMeta = document.getElementById("delete-meta");
const deleteBadge = document.getElementById("delete-badge");

const locationStats = document.getElementById("location-stats");
const remountBtn = document.getElementById("remount-btn");
const openDestBtn = document.getElementById("open-dest-btn");
const copyAll = document.getElementById("copy-all");
const toggleTheme = document.getElementById("toggle-theme");

const btnScan = document.getElementById("btn-scan");
const btnExtractAll = document.getElementById("btn-extract-all");
const btnCancel = document.getElementById("btn-cancel");

const previewPanel = document.getElementById("preview-panel");
const previewTableBody = document.getElementById("preview-table-body");
const previewSearch = document.getElementById("preview-search");
const selectAllFiles = document.getElementById("select-all-files");
const btnExtractSelected = document.getElementById("btn-extract-selected");
const selectedCounter = document.getElementById("selected-counter");
const previewSummaryBadge = document.getElementById("preview-summary-badge");

// Referencias de Almacenamiento y Comparación
const btnInspectStorage = document.getElementById("btn-inspect-storage");
const btnRefreshStorage = document.getElementById("btn-refresh-storage");
const storagePanel = document.getElementById("storage-panel");
const storageCardsGrid = document.getElementById("storage-cards-grid");
const folderStatsTableBody = document.getElementById("folder-stats-table-body");
const folderStatsMeta = document.getElementById("folder-stats-meta");

const comparisonPanel = document.getElementById("comparison-panel");
const comparisonTableBody = document.getElementById("comparison-table-body");
const totalFreedValue = document.getElementById("total-freed-value");
const totalCopiedStat = document.getElementById("total-copied-stat");
const totalDeletedStat = document.getElementById("total-deleted-stat");
const totalFreedStatus = document.getElementById("total-freed-status");
const btnRecheckComparison = document.getElementById("btn-recheck-comparison");

// Inicialización de temas y alertas
initTheme();
initNotifications();
if (toggleTheme) toggleTheme.addEventListener("click", cycleTheme);

// Mostrar/ocultar campo de extensión personalizada
fileTypeSelect.addEventListener("change", () => {
  const customField = document.getElementById("custom-ext-field");
  customField.style.display = fileTypeSelect.value === "custom" ? "block" : "none";
});

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Error en la solicitud");
  }
  return response.json();
};

// Abrir carpeta de destino
const openFolder = async (folderPath) => {
  try {
    await fetchJson("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath })
    });
  } catch (err) {
    alert(`No se pudo abrir la carpeta: ${err.message}`);
  }
};

openDestBtn.addEventListener("click", () => {
  const customPath = destinationInput.value.trim();
  openFolder(customPath || "");
});

// ========================================================
// DIAGNÓSTICO DE MEMORIA Y CAPACIDAD DE CARPETAS
// ========================================================
// Mientras un trabajo usa el dispositivo, el análisis manual queda bloqueado
let storageButtonsBusy = false;
const setStorageButtonsBusy = (busy) => {
  storageButtonsBusy = busy;
  if (btnInspectStorage) {
    btnInspectStorage.disabled = busy;
    btnInspectStorage.textContent = busy ? "⏳ Proceso en curso..." : "📊 Analizar Memoria";
  }
  if (btnRefreshStorage) btnRefreshStorage.disabled = busy;
};

// fresh = true omite el caché del servidor (obligatorio para medir el "después")
const loadStorageDiagnosis = async (silent = false, fresh = false) => {
  if (!activeDeviceId) return null;

  if (!silent) {
    btnInspectStorage.disabled = true;
    btnInspectStorage.textContent = "Analizando...";
  }

  try {
    const info = await fetchJson(
      `/api/storage-info?deviceId=${encodeURIComponent(activeDeviceId)}${fresh ? "&fresh=1" : ""}`
    );

    // Renderizar tarjetas de tipos de memoria
    storageCardsGrid.innerHTML = "";
    if (info.storages && info.storages.length > 0) {
      info.storages.forEach((s) => {
        const card = document.createElement("div");
        card.className = "storage-card";

        const icon = s.isSD ? "💾" : "📱";
        const badgeClass = s.isSD ? "storage-badge sd" : "storage-badge";
        const meterClass = s.percentUsed > 90 ? "storage-meter-fill critical" : s.percentUsed > 75 ? "storage-meter-fill warn" : "storage-meter-fill";

        card.innerHTML = `
          <div class="storage-card-header">
            <div class="storage-card-title">
              <span class="storage-card-icon">${icon}</span>
              <span>${s.label}</span>
            </div>
            <span class="${badgeClass}">${s.isSD ? "SD Externa" : "Interna"}</span>
          </div>
          <div class="storage-capacity-numbers">
            <div>
              <div class="storage-free-number">${s.freeBytes > 0 ? formatBytes(s.freeBytes) : "Espacio N/D"}</div>
              <small style="color: var(--muted);">${s.freeBytes > 0 ? "libres disponibles" : "en este medio"}</small>
            </div>
            <div class="storage-total-number">
              ${s.totalBytes > 0 ? "Total: " + formatBytes(s.totalBytes) : ""}
            </div>
          </div>
          <div class="storage-meter-track">
            <div class="${meterClass}" style="width: ${s.percentUsed > 0 ? s.percentUsed : 5}%;"></div>
          </div>
          <div class="storage-meter-meta">
            <span>${s.percentUsed}% ocupado</span>
            <span>Usado: ${s.usedBytes > 0 ? formatBytes(s.usedBytes) : "--"}</span>
          </div>
        `;
        storageCardsGrid.appendChild(card);
      });
    } else {
      storageCardsGrid.innerHTML = `<div class="panel-placeholder">No se pudieron leer las métricas de almacenamiento. Verifica el desbloqueo del celular.</div>`;
    }

    // Renderizar tabla de carpetas clave de Android
    folderStatsTableBody.innerHTML = "";
    if (info.folders && info.folders.length > 0) {
      folderStatsMeta.textContent = `${info.folders.length} carpetas analizadas a las ${new Date(info.timestamp).toLocaleTimeString()}`;
      info.folders.forEach((f) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${f.folderName}</strong> <br><small style="color: var(--muted); font-family: monospace;">${f.subPath}</small></td>
          <td><span class="pill-badge">${f.storage.split("/")[0]}</span></td>
          <td>${f.filesCount} archivos</td>
          <td style="text-align: right; font-weight: 700; color: var(--ink);">${formatBytes(f.sizeBytes)}</td>
        `;
        folderStatsTableBody.appendChild(tr);
      });
    } else {
      folderStatsTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 18px; color: var(--muted);">No se encontraron carpetas con archivos en las rutas conocidas.</td></tr>`;
    }

    storagePanel.style.display = "block";
    if (!silent) {
      storagePanel.scrollIntoView({ behavior: "smooth" });
    }

    // Guardar como estado inicial si aún no se había fijado
    if (!initialStorageSnapshot) {
      initialStorageSnapshot = info;
    }

    return info;
  } catch (err) {
    if (!silent) {
      alert(`Error al analizar almacenamiento: ${err.message}`);
    }
    return null;
  } finally {
    if (!storageButtonsBusy) {
      btnInspectStorage.disabled = false;
      btnInspectStorage.textContent = "📊 Analizar Memoria";
    }
  }
};

btnInspectStorage.addEventListener("click", () => loadStorageDiagnosis(false, true));
if (btnRefreshStorage) {
  btnRefreshStorage.addEventListener("click", () => loadStorageDiagnosis(false, true));
}

// ========================================================
// TABLA COMPARATIVA DE LIBERACIÓN DE MEMORIA (ANTES VS DESPUÉS)
// ========================================================
const renderComparisonTable = (initial, final, job) => {
  if (!initial || !final) return;

  comparisonTableBody.innerHTML = "";
  let totalBytesFreedCalculated = 0;

  // Comparar unidades de almacenamiento
  if (initial.storages && final.storages) {
    final.storages.forEach((finalStore) => {
      const initStore = initial.storages.find((s) => s.name === finalStore.name) || {};
      const initFree = initStore.freeBytes || 0;
      const finalFree = finalStore.freeBytes || 0;
      const diff = finalFree - initFree;

      let diffBadge = "";
      let statusText = "";

      if (diff > 0) {
        totalBytesFreedCalculated += diff;
        diffBadge = `<span class="diff-badge freed">+ ${formatBytes(diff)} LIBERADOS</span>`;
        statusText = `<span style="color: #10b981; font-weight: 600;">✓ Memoria Liberada</span>`;
      } else if (diff === 0 && (job.deleted || 0) > 0) {
        // En algunos teléfonos MTP, la caché del índice de medios demora en actualizarse
        diffBadge = `<span class="diff-badge freed">+ ${formatBytes(job.deleted * 1024 * 100)} aprox</span>`;
        statusText = `<span style="color: var(--accent-2);">Pendiente de refresco OS</span>`;
      } else {
        diffBadge = `<span class="diff-badge neutral">Sin variación</span>`;
        statusText = `<span style="color: var(--muted);">Estable</span>`;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${finalStore.label}</strong> (${finalStore.isSD ? "SD Externa" : "Interna"})</td>
        <td style="text-align: right; color: var(--muted);">${initFree > 0 ? formatBytes(initFree) + " libres" : "N/D"}</td>
        <td style="text-align: right; font-weight: 600; color: var(--ink);">${finalFree > 0 ? formatBytes(finalFree) + " libres" : "N/D"}</td>
        <td style="text-align: right;">${diffBadge}</td>
        <td style="text-align: center;">${statusText}</td>
      `;
      comparisonTableBody.appendChild(tr);
    });
  }

  // Comparar carpetas principales analizadas
  if (initial.folders && final.folders) {
    final.folders.forEach((finalFolder) => {
      const initFolder = initial.folders.find((f) => f.fullPath === finalFolder.fullPath) || {};
      const initSize = initFolder.sizeBytes || 0;
      const finalSize = finalFolder.sizeBytes || 0;
      const sizeDiff = initSize - finalSize; // Reducción en la carpeta

      if (initSize > 0 || finalSize > 0) {
        let diffBadge = "";
        let statusText = "";

        if (sizeDiff > 0) {
          diffBadge = `<span class="diff-badge freed">- ${formatBytes(sizeDiff)} aligerados</span>`;
          statusText = `<span style="color: #10b981;">✓ Carpeta reducida</span>`;
        } else {
          diffBadge = `<span class="diff-badge neutral">Sin cambios</span>`;
          statusText = `<span style="color: var(--muted);">Intacta</span>`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>📂 ${finalFolder.folderName}</td>
          <td style="text-align: right; color: var(--muted);">${formatBytes(initSize)} (${initFolder.filesCount || 0} arch)</td>
          <td style="text-align: right; font-weight: 600; color: var(--ink);">${formatBytes(finalSize)} (${finalFolder.filesCount || 0} arch)</td>
          <td style="text-align: right;">${diffBadge}</td>
          <td style="text-align: center;">${statusText}</td>
        `;
        comparisonTableBody.appendChild(tr);
      }
    });
  }

  // Banner métricas
  const displayFreed = totalBytesFreedCalculated > 0 ? formatBytes(totalBytesFreedCalculated) : job.deleted > 0 ? `${job.deleted} arch. removidos` : "0 MB";
  totalFreedValue.textContent = displayFreed;
  totalCopiedStat.textContent = job.copied || 0;
  totalDeletedStat.textContent = job.deleted || 0;
  totalFreedStatus.textContent = (job.deleted || 0) > 0 ? "✓ Liberación Confirmada" : "✓ Extracción Segura";

  comparisonPanel.style.display = "block";
  comparisonPanel.scrollIntoView({ behavior: "smooth" });
};

if (btnRecheckComparison) {
  btnRecheckComparison.addEventListener("click", async () => {
    btnRecheckComparison.disabled = true;
    btnRecheckComparison.textContent = "Verificando...";
    const fresh = await loadStorageDiagnosis(true, true);
    if (fresh && initialStorageSnapshot) {
      finalStorageSnapshot = fresh;
      renderComparisonTable(initialStorageSnapshot, finalStorageSnapshot, { copied: 0, deleted: 0 });
    }
    btnRecheckComparison.disabled = false;
    btnRecheckComparison.textContent = "🔄 Re-verificar estado actual";
  });
}

// ========================================================
// FINALIZAR: desmonta el celular, detiene el servidor y cierra
// ========================================================
const btnFinish = document.getElementById("btn-finish");
const finishOverlay = document.getElementById("finish-overlay");
const finishMessage = document.getElementById("finish-message");
// Al cargar (o volver a empezar) la pantalla de cierre siempre arranca oculta
if (finishOverlay) finishOverlay.hidden = true;

const finishSession = async () => {
  if (activeJobId && !pollStopped) {
    alert("Hay un proceso en curso. Espera a que termine o cancélalo antes de finalizar.");
    return;
  }
  if (!confirm("¿Finalizar? Se desmontará el celular de forma segura y se cerrará la aplicación.")) return;

  document.querySelectorAll(".btn-finish").forEach((b) => {
    b.dataset.label = b.textContent;
    b.disabled = true;
    b.textContent = "⏳ Finalizando...";
  });

  let message = "El celular se desmontó de forma segura y el servidor se detuvo.";
  try {
    const res = await fetchJson("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: activeDeviceId })
    });
    if (res.unmounted === false) {
      message = "El servidor se detuvo. No se pudo desmontar el celular automáticamente; expúlsalo desde el explorador de archivos antes de desconectarlo.";
    }
  } catch (err) {
    document.querySelectorAll(".btn-finish").forEach((b) => {
      b.disabled = false;
      b.textContent = b.dataset.label || b.textContent;
    });
    alert(`No se pudo finalizar: ${err.message}`);
    return;
  }

  stopPolling();
  releaseClientMemory();
  finishMessage.textContent = message;
  finishOverlay.hidden = false;
  // Sólo funciona si la pestaña fue abierta por script; si no, queda la pantalla de cierre
  setTimeout(() => window.close(), 1500);
};

if (btnFinish) btnFinish.addEventListener("click", finishSession);
["btn-finish-top", "btn-finish-sidebar"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", finishSession);
});

// Volver a empezar: recarga la página si el servidor ya está activo de nuevo
const btnRestart = document.getElementById("btn-restart");
const finishHint = document.getElementById("finish-hint");
if (btnRestart) {
  btnRestart.addEventListener("click", async () => {
    if (await checkServer()) {
      window.location.reload();
      return;
    }
    finishHint.textContent = "El servidor está detenido. Ábrelo con el ícono del escritorio o ejecuta ./start.sh y vuelve a pulsar este botón.";
  });
}

// ========================================================
// MONITOR LIGERO DE ACTIVIDAD
// Sustituye al antiguo árbol de carpetas: en vez de mantener miles de
// nodos DOM y recorrerlos en cada sondeo, sólo se actualizan dos textos
// y un log acotado, escrito en lotes con requestAnimationFrame.
// ========================================================
const MONITOR_MAX_LINES = 60;

const STAGE_LABELS = {
  idle: "En espera",
  search: "Buscando archivos",
  preview: "Vista previa lista",
  extract: "Extrayendo",
  delete: "Eliminando del celular",
  done: "Finalizado",
  cancelled: "Cancelado",
  error: "Error"
};

let pendingLogLines = [];
let logFlushHandle = null;
let lastMonitorPath = "";
let lastMonitorState = "";

const shortenPath = (fullPath, segments = 3) => {
  if (!fullPath) return "";
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length <= segments) return parts.join("/");
  return `.../${parts.slice(-segments).join("/")}`;
};

const flushLog = () => {
  logFlushHandle = null;
  if (!monitorLog || pendingLogLines.length === 0) return;

  const fragment = document.createDocumentFragment();
  // Sólo se pintan las últimas líneas: si llegaron más, las viejas se descartan
  const lines = pendingLogLines.slice(-MONITOR_MAX_LINES);
  pendingLogLines.length = 0;

  lines.forEach((line) => {
    const entry = document.createElement("div");
    entry.className = `monitor-line ${line.type}`;
    entry.textContent = `[${line.time}] ${line.message}`;
    fragment.appendChild(entry);
  });

  monitorLog.appendChild(fragment);

  // Poda en bloque: el log nunca supera MONITOR_MAX_LINES nodos
  let excess = monitorLog.childElementCount - MONITOR_MAX_LINES;
  while (excess > 0 && monitorLog.firstChild) {
    monitorLog.removeChild(monitorLog.firstChild);
    excess -= 1;
  }

  monitorLog.scrollTop = monitorLog.scrollHeight;
};

const addLogEntry = (message, type = "info") => {
  const time = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  pendingLogLines.push({ message, type, time });
  if (pendingLogLines.length > MONITOR_MAX_LINES * 2) {
    pendingLogLines = pendingLogLines.slice(-MONITOR_MAX_LINES);
  }
  if (logFlushHandle === null) {
    logFlushHandle = requestAnimationFrame(flushLog);
  }
};

const setMonitorState = (stage, detail) => {
  const label = STAGE_LABELS[stage] || STAGE_LABELS.idle;
  if (monitorState && label !== lastMonitorState) {
    monitorState.textContent = label;
    lastMonitorState = label;
  }
  if (monitorDot) {
    monitorDot.className = `monitor-dot ${stage}`;
  }
  if (monitorPath && detail !== undefined && detail !== lastMonitorPath) {
    // textContent en vez de innerHTML: sin reparsear HTML en cada sondeo
    monitorPath.textContent = detail;
    lastMonitorPath = detail;
  }
};

const resetMonitor = () => {
  pendingLogLines.length = 0;
  if (logFlushHandle !== null) {
    cancelAnimationFrame(logFlushHandle);
    logFlushHandle = null;
  }
  if (monitorLog) monitorLog.replaceChildren();
  lastMonitorPath = "";
  lastMonitorState = "";
  setMonitorState("idle", "Sin actividad.");
};

// Compatibilidad con el flujo anterior (ya no hay nodos que resaltar)
const initTreeLog = () => {
  resetMonitor();
  addLogEntry("Monitor listo. Modo de bajo consumo de memoria activo.", "info");
};

if (btnClearMonitor) {
  btnClearMonitor.addEventListener("click", () => {
    resetMonitor();
    addLogEntry("Monitor limpiado.", "info");
  });
}

// ========================================================
// LIBERACIÓN MANUAL DE MEMORIA (cliente + servidor)
// ========================================================
const refreshMemoryBadge = async () => {
  if (!monitorMem || !serverAvailable) return;
  try {
    const info = await fetchJson("/api/memory");
    monitorMem.textContent = `RAM servidor: ${info.heapUsedMB} MB · caché: ${info.dirCache.buckets} carpetas`;
    monitorMem.title = `RSS ${info.rssMB} MB · trabajos ${info.jobs} · archivos retenidos ${info.retainedFiles} · cola USB ${info.deviceQueue.active}/${info.deviceQueue.pending}`;
  } catch (_) {
    monitorMem.textContent = "";
  }
};

if (btnReleaseMemory) {
  btnReleaseMemory.addEventListener("click", async () => {
    btnReleaseMemory.disabled = true;
    // Memoria del navegador: se suelta la lista escaneada y las filas pintadas
    releaseClientMemory();
    try {
      await fetchJson("/api/cache/clear", { method: "POST" });
      addLogEntry("Cachés liberados en servidor y navegador.", "info");
    } catch (err) {
      addLogEntry(`No se pudo liberar el caché del servidor: ${err.message}`, "delete");
    }
    await refreshMemoryBadge();
    btnReleaseMemory.disabled = false;
  });
}

// Estado inicial del monitor
resetMonitor();
addLogEntry("Monitor de actividad listo (modo de bajo consumo de memoria).", "info");


// Detección del dispositivo
detectDevice.addEventListener("click", async () => {
  detectDevice.disabled = true;
  detectStatus.textContent = "Detectando dispositivo USB...";
  detectStatus.classList.remove("warn", "success");
  detectStatus.classList.add("warn");

  await checkServer();
  if (!serverAvailable) {
    detectStatus.innerHTML =
      "Servidor backend no detectado.<br><br>" +
      "1. Ejecuta en tu terminal: <code>node server.js</code><br>" +
      "2. Abre <code>http://127.0.0.1:3000</code>";
    detectStatus.classList.add("warn");
    detectDevice.disabled = false;
    return;
  }

  fetchJson("/api/device")
    .then((payload) => {
      if (!payload.devices || payload.devices.length === 0) {
        detectStatus.textContent = "No se detectaron dispositivos MTP. Conecta el USB y selecciona 'Transferir archivos' en tu teléfono.";
        detectStatus.classList.remove("success");
        detectStatus.classList.add("warn");
        detectDevice.disabled = false;
        return;
      }
      activeDeviceId = payload.devices[0].id;
      detectStatus.textContent = `Dispositivo conectado: ${activeDeviceId}`;
      detectStatus.classList.remove("warn");
      detectStatus.classList.add("success");
      remountBtn.disabled = false;
      btnInspectStorage.disabled = false;

      initTreeLog();
      addLogEntry(`Dispositivo listo: ${activeDeviceId}`, "info");
      // Snapshot inicial silencioso de memoria para tener la línea base.
      // No se lista ningún árbol: el canal MTP queda libre para la extracción.
      loadStorageDiagnosis(true).then(refreshMemoryBadge);
    })
    .catch((err) => {
      detectStatus.textContent = `Error en detección: ${err.message}`;
      detectStatus.classList.add("warn");
      detectDevice.disabled = false;
    });
});

// Reconectar dispositivo
remountBtn.addEventListener("click", () => {
  if (!activeDeviceId) return;
  remountBtn.disabled = true;
  detectStatus.textContent = "Reconectando dispositivo...";

  fetchJson("/api/remount", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: activeDeviceId })
  })
    .then(() => {
      detectStatus.textContent = `Dispositivo reconectado: ${activeDeviceId}`;
      detectStatus.classList.add("success");
      remountBtn.disabled = false;
      loadStorageDiagnosis(true);
    })
    .catch((err) => {
      detectStatus.textContent = `Error reconectando: ${err.message}`;
      detectStatus.classList.add("warn");
      remountBtn.disabled = false;
    });
});

// Copiar comandos del resumen
if (copyAll) {
  copyAll.addEventListener("click", () => {
    const summary = sections
      .map((section) => {
        const commands = section.cards.map((card) => card.code).join("\n\n");
        return `# ${section.title}\n${commands}`;
      })
      .join("\n\n");
    navigator.clipboard.writeText(summary).then(() => {
      copyAll.textContent = "Copiado";
      setTimeout(() => (copyAll.textContent = "Copiar comandos"), 1500);
    });
  });
}

// Estadísticas de ubicaciones
const updateLocationStats = (stats) => {
  if (!stats || Object.keys(stats).length === 0) {
    locationStats.innerHTML = "";
    return;
  }
  let html = "<div class='stats-title'>Archivos por ubicación:</div><ul class='stats-list'>";
  for (const [location, count] of Object.entries(stats)) {
    const shortLoc = location.split("/").slice(-2).join("/");
    html += `<li><span class="stats-loc">${shortLoc}</span><span class="stats-count">${count}</span></li>`;
  }
  html += "</ul>";
  locationStats.innerHTML = html;
};

// ========================================================
// RENDERIZADO Y CONTROL DE LA TABLA DE VISTA PREVIA
// ========================================================
// Renderizado por bloques: sólo se crean las filas que el usuario alcanza a ver.
// Antes se pintaban de golpe miles de <tr> con un listener cada uno.
const PREVIEW_CHUNK = 150;
const PREVIEW_MAX_FILES = 30000;

const previewWrapper = previewPanel ? previewPanel.querySelector(".preview-table-wrapper") : null;
let previewFiltered = [];
let previewRendered = 0;
let previewSentinel = null;
let previewObserver = null;
let previewSearchTimer = null;
let selectedBytes = 0;

const recomputeSelectedBytes = () => {
  selectedBytes = 0;
  for (let i = 0; i < scannedFiles.length; i++) {
    if (selectedFilePaths.has(scannedFiles[i].path)) {
      selectedBytes += scannedFiles[i].size || 0;
    }
  }
};

const updateSelectionCounters = () => {
  const count = selectedFilePaths.size;
  selectedCounter.textContent = count;
  btnExtractSelected.disabled = count === 0;

  const sizeStr = selectedBytes > 0 ? ` (~${formatBytes(selectedBytes)})` : "";
  previewSummaryBadge.textContent = `${count} de ${scannedFiles.length} seleccionados${sizeStr}`;
  selectAllFiles.checked = scannedFiles.length > 0 && count === scannedFiles.length;
};

const buildPreviewRow = (file) => {
  const tr = document.createElement("tr");
  const isChecked = selectedFilePaths.has(file.path);
  if (isChecked) tr.classList.add("selected");
  tr.dataset.path = file.path;
  tr.dataset.size = String(file.size || 0);

  const checkboxTd = document.createElement("td");
  checkboxTd.style.textAlign = "center";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = isChecked;
  // Sin addEventListener por fila: el cambio se escucha una sola vez en el <tbody>
  checkboxTd.appendChild(cb);

  const nameTd = document.createElement("td");
  nameTd.className = "file-name-cell";
  const iconSpan = document.createElement("span");
  iconSpan.className = "file-icon";
  iconSpan.textContent = getFileIcon(file.name);
  const nameSpan = document.createElement("span");
  nameSpan.textContent = file.name;
  nameTd.appendChild(iconSpan);
  nameTd.appendChild(nameSpan);

  const pathTd = document.createElement("td");
  const segments = file.path.split("/").filter(Boolean);
  const relFolder = segments.length > 2 ? segments.slice(1, -1).join("/") : segments[0] || "";
  pathTd.className = "file-path-sub";
  pathTd.textContent = relFolder || "/";

  const sizeTd = document.createElement("td");
  sizeTd.className = "file-size-cell";
  sizeTd.textContent = formatBytes(file.size);

  tr.appendChild(checkboxTd);
  tr.appendChild(nameTd);
  tr.appendChild(pathTd);
  tr.appendChild(sizeTd);
  return tr;
};

const ensurePreviewSentinel = () => {
  if (!previewSentinel) {
    previewSentinel = document.createElement("tr");
    previewSentinel.className = "preview-sentinel";
    const td = document.createElement("td");
    td.colSpan = 4;
    previewSentinel.appendChild(td);
  }
  return previewSentinel;
};

const sentinelInView = () => {
  if (!previewSentinel || !previewWrapper || !previewSentinel.isConnected) return false;
  const boxRect = previewWrapper.getBoundingClientRect();
  // Si el contenedor no está visible no se rellena nada (evita pintar de más)
  if (boxRect.height === 0) return false;
  const rowRect = previewSentinel.getBoundingClientRect();
  return rowRect.top <= boxRect.bottom + 80;
};

const appendPreviewChunk = () => {
  if (previewRendered >= previewFiltered.length) {
    if (previewSentinel && previewSentinel.isConnected) {
      if (previewObserver) previewObserver.unobserve(previewSentinel);
      previewSentinel.remove();
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  const end = Math.min(previewRendered + PREVIEW_CHUNK, previewFiltered.length);
  for (let i = previewRendered; i < end; i++) {
    fragment.appendChild(buildPreviewRow(previewFiltered[i]));
  }
  previewRendered = end;

  const sentinel = ensurePreviewSentinel();
  previewTableBody.insertBefore(fragment, sentinel.isConnected ? sentinel : null);

  if (previewRendered < previewFiltered.length) {
    sentinel.firstChild.textContent = `Mostrando ${previewRendered} de ${previewFiltered.length} · desplázate para cargar más`;
    previewTableBody.appendChild(sentinel);
    if (previewObserver) previewObserver.observe(sentinel);
    // Si aún queda hueco visible, se rellena en el siguiente frame
    requestAnimationFrame(() => {
      if (sentinelInView()) appendPreviewChunk();
    });
  } else {
    if (previewObserver) previewObserver.unobserve(sentinel);
    sentinel.remove();
  }
};

const initPreviewObserver = () => {
  if (previewObserver || !previewWrapper || typeof IntersectionObserver === "undefined") return;
  previewObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        appendPreviewChunk();
      }
    },
    { root: previewWrapper, rootMargin: "200px", threshold: 0 }
  );
};

const renderPreviewTable = () => {
  if (!previewTableBody) return;
  initPreviewObserver();

  const filterQuery = (previewSearch.value || "").trim().toLowerCase();

  if (previewObserver && previewSentinel) previewObserver.unobserve(previewSentinel);
  previewFiltered = filterQuery
    ? scannedFiles.filter((f) => f.name.toLowerCase().includes(filterQuery) || f.path.toLowerCase().includes(filterQuery))
    : scannedFiles;
  previewRendered = 0;

  // replaceChildren libera de una vez todas las filas anteriores
  previewTableBody.replaceChildren();

  if (previewFiltered.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.style.cssText = "text-align: center; padding: 24px; color: var(--muted);";
    td.textContent = "No se encontraron archivos que coincidan con la búsqueda.";
    tr.appendChild(td);
    previewTableBody.appendChild(tr);
    updateSelectionCounters();
    return;
  }

  appendPreviewChunk();
  updateSelectionCounters();
};

// Libera la lista escaneada y todas las filas pintadas
const releaseClientMemory = () => {
  scannedFiles = [];
  previewFiltered = [];
  previewRendered = 0;
  selectedFilePaths = new Set();
  selectedBytes = 0;
  if (previewObserver && previewSentinel) previewObserver.unobserve(previewSentinel);
  if (previewTableBody) previewTableBody.replaceChildren();
  if (previewPanel) previewPanel.style.display = "none";
};

// Un único listener para toda la tabla (delegación de eventos)
if (previewTableBody) {
  previewTableBody.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!checkbox || checkbox.type !== "checkbox") return;
    const row = checkbox.closest("tr");
    if (!row || !row.dataset.path) return;

    const size = Number(row.dataset.size || 0);
    if (checkbox.checked) {
      if (!selectedFilePaths.has(row.dataset.path)) {
        selectedFilePaths.add(row.dataset.path);
        selectedBytes += size;
      }
      row.classList.add("selected");
    } else {
      if (selectedFilePaths.delete(row.dataset.path)) {
        selectedBytes -= size;
      }
      row.classList.remove("selected");
    }
    updateSelectionCounters();
  });
}

// Búsqueda en vivo con rebote: evita repintar en cada pulsación
if (previewSearch) {
  previewSearch.addEventListener("input", () => {
    if (previewSearchTimer) clearTimeout(previewSearchTimer);
    previewSearchTimer = setTimeout(renderPreviewTable, 180);
  });
}

// Seleccionar todos / deseleccionar todos
if (selectAllFiles) {
  selectAllFiles.addEventListener("change", () => {
    if (selectAllFiles.checked) {
      selectedFilePaths = new Set(scannedFiles.map((f) => f.path));
      recomputeSelectedBytes();
    } else {
      selectedFilePaths.clear();
      selectedBytes = 0;
    }
    renderPreviewTable();
  });
}

// Cancelar proceso activo
btnCancel.addEventListener("click", async () => {
  if (!activeJobId) return;
  btnCancel.disabled = true;
  btnCancel.textContent = "Cancelando...";

  try {
    await fetchJson("/api/extract/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: activeJobId })
    });
    addLogEntry("Cancelación solicitada por el usuario.", "delete");
  } catch (err) {
    console.error("Error al cancelar:", err);
  }
});

// ========================================================
// FUNCIÓN PRINCIPAL DE EJECUCIÓN (ESCANEAR O EXTRAER)
// ========================================================
const startJob = async (options = {}) => {
  const { scanOnly = false, filesToExtract = null } = options;

  extractResult.textContent = "";
  extractResult.style.display = "none";
  locationStats.innerHTML = "";

  if (!serverAvailable) {
    extractResult.textContent = "La extracción requiere el servidor local. Ejecuta 'node server.js'.";
    extractResult.classList.add("warn");
    extractResult.style.display = "block";
    return;
  }

  if (!activeDeviceId) {
    extractResult.textContent = "Primero detecta el dispositivo.";
    extractResult.classList.add("warn");
    extractResult.style.display = "block";
    return;
  }

  // Asegurar snapshot previo (línea base "Antes")
  if (!initialStorageSnapshot) {
    await loadStorageDiagnosis(true);
  }

  let fileType = fileTypeSelect.value;
  if (fileType === "custom") {
    fileType = customExtInput.value.trim().replace(/^\./, "");
    if (!fileType) {
      extractResult.textContent = "Ingresa una extensión válida.";
      extractResult.classList.add("warn");
      extractResult.style.display = "block";
      return;
    }
  }

  const destination = destinationInput.value.trim();
  const searchMode = searchModeSelect.value;
  const structureMode = structureModeSelect.value;
  const dateFilter = dateFilterSelect.value;
  const minSize = Number(sizeFilterSelect.value || 0);
  const deleteAfter = deleteAfterCheck.checked && !scanOnly;

  if (deleteAfter && !confirm("Has seleccionado ELIMINAR los archivos del celular después de extraer.\n\nEsta acción es PERMANENTE.\n\n¿Deseas continuar?")) {
    return;
  }

  // Reset visual de progreso
  searchBar.style.width = "0%";
  extractBar.style.width = "0%";
  deleteBar.style.width = "0%";
  searchBadge.textContent = "Iniciando";
  searchBadge.className = "progress-badge active";
  extractBadge.textContent = scanOnly ? "Omitida" : "En espera";
  extractBadge.className = "progress-badge";
  deleteBadge.textContent = deleteAfter ? "En espera" : "Inactiva";
  deleteBadge.className = "progress-badge";

  searchMeta.textContent = `Buscando archivos .${fileType}...`;
  extractMeta.textContent = scanOnly ? "Modo vista previa (sin descarga)." : "Extracción en espera.";
  deleteMeta.textContent = deleteAfter ? "Eliminación en espera." : "No se eliminarán archivos.";

  // Mostrar botón de cancelar
  btnCancel.style.display = "inline-flex";
  btnCancel.disabled = false;
  btnCancel.textContent = "⛔ Cancelar Proceso";
  btnScan.disabled = true;
  btnExtractAll.disabled = true;
  btnExtractSelected.disabled = true;
  // El canal USB queda reservado para el proceso: analizar ahora sólo haría cola
  setStorageButtonsBusy(true);

  initTreeLog();
  // Un trabajo nuevo invalida los resultados anteriores: se sueltan antes de empezar
  if (!filesToExtract) {
    releaseClientMemory();
  }
  setMonitorState("search", `Preparando búsqueda de .${fileType}`);
  addLogEntry(
    scanOnly ? `Iniciando escaneo de archivos .${fileType}...` : `Iniciando extracción directa de .${fileType}...`,
    "info"
  );

  stopPolling();

  const payload = {
    deviceId: activeDeviceId,
    type: fileType,
    destination: destination || "",
    searchMode,
    structureMode,
    deleteAfter,
    scanOnly,
    dateFilter,
    minSize,
    selectedFiles: filesToExtract
  };

  fetchJson("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then((res) => {
      activeJobId = res.jobId;
      let lastStage = "";
      let lastFound = 0;
      let lastCopied = 0;
      let lastDeleted = 0;
      let lastSignature = "";
      let idleTicks = 0;
      pollStopped = false;

      const pollOnce = async () => {
        try {
          const job = await fetchJson(`/api/extract/status?id=${encodeURIComponent(activeJobId)}`);

          // Ritmo adaptativo: rápido mientras hay avance, lento si está parado
          const signature = `${job.stage}|${job.found}|${job.copied}|${job.deleted}|${job.skipped}`;
          if (signature === lastSignature) {
            idleTicks += 1;
            pollDelay = Math.min(POLL_MAX_MS, POLL_MIN_MS + idleTicks * 250);
          } else {
            idleTicks = 0;
            pollDelay = POLL_MIN_MS;
            lastSignature = signature;
          }

          searchBar.style.width = `${job.searchProgress}%`;
          extractBar.style.width = `${job.extractProgress}%`;
          deleteBar.style.width = `${job.deleteProgress || 0}%`;

          if (job.stage === "search") {
            searchBadge.textContent = `Buscando (${job.found})`;
            const shortPath = job.currentPath ? job.currentPath.split("/").slice(-2).join("/") : "...";
            searchMeta.textContent = `Explorando: ${shortPath} (${job.found} encontrados)`;
            setMonitorState("search", `${shortenPath(job.currentPath)} · ${job.found} encontrados`);

            if (job.found > lastFound) {
              addLogEntry(`Encontrados: ${job.found} archivos`, "search");
              lastFound = job.found;
            }
          } else if (job.stage === "preview" || (job.scanOnly && job.status === "done")) {
            searchBadge.textContent = "Completada";
            searchBadge.className = "progress-badge";
          } else if (job.stage === "extract") {
            searchBadge.textContent = "Completada";
            searchBadge.className = "progress-badge";
            extractBadge.textContent = `Copiando ${job.copied}/${job.total}`;
            extractBadge.className = "progress-badge active";

            searchMeta.textContent = `Búsqueda finalizada: ${job.found} archivos encontrados.`;
            extractMeta.textContent = `Extrayendo ${job.copied} de ${job.total} archivos...`;
            updateLocationStats(job.locationStats);
            setMonitorState("extract", `${shortenPath(job.currentPath, 2)} · ${job.copied}/${job.total}`);

            if (job.copied > lastCopied) {
              if (job.copied % 10 === 0 || job.copied === 1) {
                addLogEntry(`Copiados: ${job.copied}/${job.total} archivos`, "extract");
              }
              lastCopied = job.copied;
            }
          } else if (job.stage === "delete") {
            extractBadge.textContent = "Completada";
            extractBadge.className = "progress-badge";
            deleteBadge.textContent = `Eliminando ${job.deleted}/${job.total}`;
            deleteBadge.className = "progress-badge active";

            extractMeta.textContent = `Extracción completada: ${job.copied} archivos.`;
            deleteMeta.textContent = `Eliminando ${job.deleted} de ${job.total} archivos del celular...`;
            setMonitorState("delete", `${shortenPath(job.currentPath, 2)} · ${job.deleted}/${job.total}`);

            if (job.deleted > lastDeleted) {
              if (job.deleted % 5 === 0 || job.deleted === 1) {
                addLogEntry(`Eliminados: ${job.deleted}/${job.total}`, "delete");
              }
              lastDeleted = job.deleted;
            }
          }

          lastStage = job.stage;

          // COMPLETADO CON ÉXITO
          if (job.status === "done") {
            stopPolling();
            btnCancel.style.display = "none";
            btnScan.disabled = false;
            btnExtractAll.disabled = false;
            setStorageButtonsBusy(false);

            if (job.scanOnly) {
              setMonitorState("preview", "Descargando la lista de resultados...");
              scannedFiles = await fetchScannedFiles(activeJobId);
              selectedFilePaths = new Set(scannedFiles.map((f) => f.path));
              recomputeSelectedBytes();

              previewPanel.style.display = "block";
              renderPreviewTable();
              previewPanel.scrollIntoView({ behavior: "smooth" });

              const limitNote = job.limitReached || scannedFiles.length >= PREVIEW_MAX_FILES
                ? ` (lista recortada a ${scannedFiles.length} por límite de memoria)`
                : "";
              addLogEntry(`¡Escaneo completado! ${scannedFiles.length} archivos listos para seleccionar${limitNote}.`, "info");
              setMonitorState("preview", `${scannedFiles.length} archivos listos para seleccionar`);
              playChime("success");
              notifyUser("Búsqueda completada", `${scannedFiles.length} archivos encontrados.`);
              refreshMemoryBadge();
              return;
            }

            // Proceso de extracción finalizado
            searchBadge.textContent = "Finalizada";
            extractBadge.textContent = "Finalizada";
            extractBadge.className = "progress-badge";
            if (job.deleteAfter) {
              deleteBadge.textContent = "Finalizada";
              deleteBadge.className = "progress-badge";
            }

            let msg = `¡Completado con éxito!\n`;
            msg += `✓ Extraídos: ${job.copied} archivos\n`;
            if (job.skipped > 0) msg += `↷ Omitidos (ya existían): ${job.skipped}\n`;
            if (job.deleteAfter) msg += `✓ Eliminados del celular: ${job.deleted}\n`;
            msg += `📁 Carpeta destino: ${job.destination}`;

            extractResult.textContent = msg;
            extractResult.className = "result success";
            extractResult.style.display = "block";

            // Botón para abrir la carpeta directamente
            const openRow = document.createElement("div");
            openRow.className = "result-btn-row";
            const btnOpen = document.createElement("button");
            btnOpen.className = "secondary";
            btnOpen.textContent = "📂 Abrir carpeta en explorador";
            btnOpen.addEventListener("click", () => openFolder(job.destination));
            openRow.appendChild(btnOpen);
            const btnFinishRow = document.createElement("button");
            btnFinishRow.className = "primary btn-finish";
            btnFinishRow.textContent = "✅ Finalizar";
            btnFinishRow.title = "Desmonta el celular de forma segura y cierra la aplicación";
            btnFinishRow.addEventListener("click", finishSession);
            openRow.appendChild(btnFinishRow);
            extractResult.appendChild(openRow);

            addLogEntry(`¡EXTRACCIÓN COMPLETADA! ${job.copied} archivos guardados.`, "extract");
            setMonitorState("done", `${job.copied} archivos extraídos`);
            refreshMemoryBadge();
            playChime("success");
            notifyUser("Extracción completada", `${job.copied} archivos extraídos a ${job.destination}`);

            // Obtener snapshot final "Después" y generar la tabla comparativa de liberación de memoria
            setTimeout(async () => {
              const afterSnapshot = await loadStorageDiagnosis(true, true);
              if (afterSnapshot && initialStorageSnapshot) {
                finalStorageSnapshot = afterSnapshot;
                renderComparisonTable(initialStorageSnapshot, finalStorageSnapshot, job);
              }
            }, 1000);
          }

          // CANCELADO POR EL USUARIO
          if (job.status === "cancelled") {
            stopPolling();
            btnCancel.style.display = "none";
            btnScan.disabled = false;
            btnExtractAll.disabled = false;
            setStorageButtonsBusy(false);
            btnExtractSelected.disabled = false;

            searchBadge.textContent = "Cancelada";
            extractBadge.textContent = "Cancelada";
            deleteBadge.textContent = "Cancelada";

            extractResult.textContent = `Operación cancelada por el usuario. Archivos copiados antes de cancelar: ${job.copied}.`;
            extractResult.className = "result warn";
            extractResult.style.display = "block";
            addLogEntry("Proceso detenido.", "delete");
            setMonitorState("cancelled", "Proceso detenido por el usuario");
            playChime("warn");
          }

          // ERROR
          if (job.status === "error") {
            stopPolling();
            btnCancel.style.display = "none";
            btnScan.disabled = false;
            btnExtractAll.disabled = false;
            setStorageButtonsBusy(false);
            btnExtractSelected.disabled = false;

            extractResult.textContent = `Error: ${job.error}`;
            extractResult.className = "result warn";
            extractResult.style.display = "block";
            addLogEntry(`ERROR: ${job.error}`, "delete");
            setMonitorState("error", job.error || "Error desconocido");
            playChime("warn");
          }
        } catch (err) {
          stopPolling();
          btnCancel.style.display = "none";
          btnScan.disabled = false;
          btnExtractAll.disabled = false;
          setStorageButtonsBusy(false);
          extractResult.textContent = `Error consultando estado: ${err.message}`;
          extractResult.className = "result warn";
          extractResult.style.display = "block";
        }
      };

      // Cadena de setTimeout: nunca hay dos consultas de estado en vuelo.
      // Si el trabajo no avanza, el intervalo se relaja hasta POLL_MAX_MS.
      const pollLoop = async () => {
        statusTimer = null;
        await pollOnce();
        if (!pollStopped) {
          statusTimer = setTimeout(pollLoop, pollDelay);
        }
      };
      pollLoop();
    })
    .catch((err) => {
      btnCancel.style.display = "none";
      btnScan.disabled = false;
      btnExtractAll.disabled = false;
      setStorageButtonsBusy(false);
      extractResult.textContent = `Error iniciando proceso: ${err.message}`;
      extractResult.className = "result warn";
      extractResult.style.display = "block";
    });
};

// Eventos de botones
btnScan.addEventListener("click", () => startJob({ scanOnly: true }));

extractForm.addEventListener("submit", (e) => {
  e.preventDefault();
  startJob({ scanOnly: false });
});

btnExtractSelected.addEventListener("click", () => {
  // Se envía sólo lo imprescindible (ruta, nombre y tamaño): el cuerpo de la
  // petición baja de varios MB a una fracción con listas grandes.
  const chosen = [];
  for (let i = 0; i < scannedFiles.length; i++) {
    const file = scannedFiles[i];
    if (selectedFilePaths.has(file.path)) {
      chosen.push({ path: file.path, name: file.name, size: file.size || 0 });
    }
  }
  if (chosen.length === 0) {
    alert("Selecciona al menos un archivo de la lista.");
    return;
  }
  startJob({ scanOnly: false, filesToExtract: chosen });
});
