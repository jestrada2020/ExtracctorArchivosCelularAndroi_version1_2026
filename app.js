const sections = [
  {
    id: "preparacion",
    kicker: "fase 1",
    title: "Preparacion y deteccion",
    description: "Confirma que el telefono aparece en USB y activa el modo MTP en Android.",
    cards: [
      {
        title: "Detectar el dispositivo en USB",
        description: "Lista los dispositivos conectados. Busca tu marca/modelo.",
        code: "lsusb",
        notes: ["Si no aparece, cambia cable o puerto y vuelve a probar."]
      },
      {
        title: "Ver montajes MTP activos",
        description: "Verifica que GVFS detecto el dispositivo.",
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
        description: "Util cuando el dispositivo se ve, pero no lista carpetas.",
        code: "systemctl --user restart gvfs-daemon",
        notes: ["Si reinicias GVFS, desconecta y reconecta el USB."]
      }
    ]
  },
  {
    id: "exploracion",
    kicker: "fase 3",
    title: "Exploracion de carpetas",
    description: "Explora el almacenamiento interno y ubica las carpetas clave.",
    cards: [
      {
        title: "Listar almacenamientos",
        description: "Reemplaza DEVICE_ID por el que obtuviste en GVFS.",
        code: "gio list \"mtp://DEVICE_ID/\"",
        notes: ["Suele mostrar 'Almacenamiento interno compartido' y 'disk'."]
      },
      {
        title: "Listar carpetas internas",
        description: "Explora el almacenamiento interno para ubicar Documentos, Descargas o apps.",
        code: "gio list \"mtp://DEVICE_ID/Almacenamiento interno compartido/\"",
        notes: ["Carpetas tipicas: Download, Documents, Telegram, DCIM, Android/media."]
      },
      {
        title: "Buscar archivos por extension",
        description: "Filtra por cualquier extension.",
        code: "gio list \"mtp://DEVICE_ID/Almacenamiento interno compartido/Download/\" | grep -i \\.pdf",
        notes: ["Cambia '.pdf' por la extension que necesites (.jpg, .mp4, etc)."]
      }
    ]
  },
  {
    id: "extraccion",
    kicker: "fase 4",
    title: "Extraccion de archivos",
    description: "Copia archivos individuales, carpetas completas o multiples archivos con script.",
    cards: [
      {
        title: "Crear directorio destino",
        description: "Define donde se guardaran los archivos extraidos.",
        code: "mkdir -p ~/Extraidos_Android",
        notes: ["Usa una ruta con espacio suficiente."]
      },
      {
        title: "Copiar archivo individual",
        description: "Recuerda codificar espacios como %20 en la ruta MTP.",
        code: "gio copy \"mtp://DEVICE_ID/Almacenamiento%20interno%20compartido/Download/archivo.pdf\" ~/Extraidos_Android/",
        notes: ["Si el nombre tiene espacios, reemplaza por %20."]
      },
      {
        title: "Script para multiples archivos",
        description: "Copia varios archivos filtrados por extension.",
        code: "DEST=\"~/Extraidos_Android\"\nBASE=\"mtp://DEVICE_ID/Almacenamiento%20interno%20compartido/Download\"\nEXT=\"pdf\"\n\nmkdir -p \"$DEST\"\n\ngio list \"mtp://DEVICE_ID/Almacenamiento interno compartido/Download/\" | grep -i \"\\.$EXT\" | while IFS= read -r file; do\n  encoded=$(echo \"$file\" | sed 's/ /%20/g')\n  gio copy \"$BASE/$encoded\" \"$DEST/\"\ndone",
        notes: ["Cambia EXT por la extension que necesites."]
      }
    ]
  },
  {
    id: "verificacion",
    kicker: "fase 5",
    title: "Verificacion y conteo",
    description: "Confirma que los archivos se copiaron y mide el espacio total.",
    cards: [
      {
        title: "Contar archivos copiados",
        description: "Cuenta archivos por extension en el destino.",
        code: "find ~/Extraidos_Android -name \"*.pdf\" -type f | wc -l",
        notes: ["Cambia la extension si es otro tipo de archivo."]
      },
      {
        title: "Ver tamano total",
        description: "Mide el espacio usado por la extraccion.",
        code: "du -sh ~/Extraidos_Android/",
        notes: ["Si el tamano no coincide, revisa errores en la copia."]
      }
    ]
  },
  {
    id: "limpieza",
    kicker: "fase 6",
    title: "Limpieza segura en el celular",
    description: "Elimina archivos solo despues de verificar la copia.",
    cards: [
      {
        title: "Eliminar archivo individual",
        description: "gio trash no funciona en MTP, usa gio remove.",
        code: "gio remove \"mtp://DEVICE_ID/Almacenamiento%20interno%20compartido/Download/archivo.pdf\"",
        notes: ["Eliminacion permanente. Verifica antes."]
      },
      {
        title: "Eliminar multiples archivos",
        description: "Elimina archivos filtrados por extension.",
        code: "BASE=\"mtp://DEVICE_ID/Almacenamiento%20interno%20compartido/Download\"\nEXT=\"pdf\"\n\ngio list \"mtp://DEVICE_ID/Almacenamiento interno compartido/Download/\" | grep -i \"\\.$EXT\" | while IFS= read -r file; do\n  encoded=$(echo \"$file\" | sed 's/ /%20/g')\n  gio remove \"$BASE/$encoded\"\ndone",
        notes: ["Cambia EXT por la extension que necesites borrar."]
      }
    ]
  },
  {
    id: "problemas",
    kicker: "ayuda",
    title: "Solucion de problemas",
    description: "Reacciones rapidas para errores comunes en MTP.",
    cards: [
      {
        title: "Carpetas vacias",
        description: "Desbloquea el telefono y acepta el acceso a datos.",
        code: "gio mount -u \"mtp://DEVICE_ID/\"\ngio mount \"mtp://DEVICE_ID/\"",
        notes: ["Cambia a 'Solo carga' y vuelve a 'Transferencia de archivos'."]
      },
      {
        title: "Errores por espacios en nombres",
        description: "Codifica espacios como %20.",
        code: "gio copy \"mtp://device/path/mi%20archivo.pdf\" /destino/",
        notes: ["Evita usar rutas con espacios sin codificar."]
      },
      {
        title: "Archivos fantasma en el celular",
        description: "Si el celular muestra archivos ya eliminados, limpia el cache.",
        code: "# En el celular:\n# Configuracion > Apps > Mostrar apps del sistema\n# Almacenamiento de medios > Borrar datos\n# Administrador de archivos > Borrar cache\n# Reiniciar el celular",
        notes: ["El indice de medios puede mostrar archivos que ya no existen."]
      }
    ]
  },
  {
    id: "alternativas",
    kicker: "alternativas",
    title: "Opciones avanzadas",
    description: "Metodos mas estables si MTP falla con muchos archivos.",
    cards: [
      {
        title: "ADB: copiar archivos",
        description: "Usa ADB para explorar y extraer archivos via USB.",
        code: "adb shell ls /sdcard/Download/\nadb pull /sdcard/Download/archivo.pdf /destino/",
        notes: ["Instala ADB y habilita Depuracion USB en Android."]
      },
      {
        title: "ADB: copiar por extension",
        description: "Busca y descarga archivos por extension.",
        code: "EXT=\"pdf\"\nadb shell \"find /sdcard -name '*.$EXT'\" | while read -r f; do adb pull \"$f\" /destino/; done",
        notes: ["Cambia EXT para otros tipos de archivo."]
      },
      {
        title: "jmtpfs: montar como carpeta",
        description: "Permite usar comandos normales como cp o find.",
        code: "mkdir ~/android\njmtpfs ~/android\ncp ~/android/Download/*.pdf /destino/\nfusermount -u ~/android",
        notes: ["Instala jmtpfs si necesitas una alternativa a GVFS."]
      }
    ]
  }
];

const quickChecklist = [
  "Cable USB confiable y telefono desbloqueado",
  "Modo USB en Transferencia de archivos (MTP)",
  "DEVICE_ID identificado en GVFS",
  "Destino local con espacio suficiente",
  "Verificacion antes de eliminar en el celular"
];

const menu = document.getElementById("menu");
const sectionsContainer = document.getElementById("sections");
const menuLinks = [];

sections.forEach((section) => {
  const link = document.createElement("a");
  link.href = `#${section.id}`;
  link.textContent = section.title;
  menu.appendChild(link);
  menuLinks.push(link);

  const template = document.getElementById("section-template");
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
quickChecklist.forEach((item) => {
  const li = document.createElement("li");
  li.textContent = item;
  checklist.appendChild(li);
});

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          menuLinks.forEach((link) => {
            link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
          });
        }
      });
    },
    { threshold: 0.4 }
  );

  document.querySelectorAll(".section").forEach((section) => observer.observe(section));
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

const detectDevice = document.getElementById("detect-device");
const detectStatus = document.getElementById("detect-status");
const startExploration = document.getElementById("start-exploration");
const deviceTree = document.getElementById("device-tree");
const extractForm = document.getElementById("extract-form");
const extractResult = document.getElementById("extract-result");
const destinationInput = document.getElementById("destination");
const fileTypeSelect = document.getElementById("file-type");
const customExtInput = document.getElementById("custom-ext");
const searchModeSelect = document.getElementById("search-mode");
const deleteAfterCheck = document.getElementById("delete-after");
const searchBar = document.getElementById("search-bar");
const searchMeta = document.getElementById("search-meta");
const extractBar = document.getElementById("extract-bar");
const extractMeta = document.getElementById("extract-meta");
const deleteBar = document.getElementById("delete-bar");
const deleteMeta = document.getElementById("delete-meta");
const locationStats = document.getElementById("location-stats");
const remountBtn = document.getElementById("remount-btn");

let activeDeviceId = null;
let statusTimer = null;

detectStatus.textContent = "Listo para detectar dispositivo.";

// Mostrar/ocultar campo de extension personalizada
fileTypeSelect.addEventListener("change", () => {
  const customField = document.getElementById("custom-ext-field");
  if (fileTypeSelect.value === "custom") {
    customField.style.display = "block";
  } else {
    customField.style.display = "none";
  }
});

const buildTreeUI = (node, container) => {
  const ul = document.createElement("ul");
  const li = document.createElement("li");
  li.textContent = node.name;
  li.dataset.path = node.path;
  ul.appendChild(li);

  if (node.children && node.children.length) {
    const childrenUl = document.createElement("ul");
    node.children.forEach((child) => {
      buildTreeUI(child, childrenUl);
    });
    li.appendChild(childrenUl);
  }

  container.appendChild(ul);
};

let lastHighlighted = null;

const highlightPath = (pathToHighlight, stage = "active") => {
  // Solo quitar la animación del elemento anterior, no de todos
  if (lastHighlighted) {
    lastHighlighted.classList.remove("active", "searching", "extracting", "deleting");
  }

  if (!pathToHighlight) {
    lastHighlighted = null;
    return;
  }

  // Buscar el elemento exacto o el más cercano
  let target = deviceTree.querySelector(`[data-path="${CSS.escape(pathToHighlight)}"]`);

  // Si no encontramos el path exacto, buscar el padre más cercano
  if (!target) {
    const pathParts = pathToHighlight.split("/");
    while (pathParts.length > 0 && !target) {
      pathParts.pop();
      const parentPath = pathParts.join("/");
      if (parentPath) {
        target = deviceTree.querySelector(`[data-path="${CSS.escape(parentPath)}"]`);
      }
    }
  }

  if (target) {
    target.classList.add(stage);
    lastHighlighted = target;
    // Hacer scroll al elemento
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

// Log de actividad en el árbol
let treeLog = null;

const initTreeLog = () => {
  // Eliminar log existente si hay uno
  const existingLog = deviceTree.querySelector(".tree-log");
  if (existingLog) existingLog.remove();

  treeLog = document.createElement("div");
  treeLog.className = "tree-log";
  treeLog.innerHTML = "<div class='tree-log-entry info'>Esperando inicio de operación...</div>";
  deviceTree.appendChild(treeLog);
};

const addLogEntry = (message, type = "info") => {
  if (!treeLog) initTreeLog();

  const entry = document.createElement("div");
  entry.className = `tree-log-entry ${type}`;

  const time = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entry.textContent = `[${time}] ${message}`;

  treeLog.appendChild(entry);
  treeLog.scrollTop = treeLog.scrollHeight;

  // Limitar a 50 entradas
  while (treeLog.children.length > 50) {
    treeLog.removeChild(treeLog.firstChild);
  }
};

const clearTreeLog = () => {
  if (treeLog) {
    treeLog.innerHTML = "";
  }
};

const markPathStatus = (pathToMark, status) => {
  let target = deviceTree.querySelector(`[data-path="${CSS.escape(pathToMark)}"]`);

  // Si no encontramos el path exacto, buscar el padre más cercano
  if (!target) {
    const pathParts = pathToMark.split("/");
    while (pathParts.length > 0 && !target) {
      pathParts.pop();
      const parentPath = pathParts.join("/");
      if (parentPath) {
        target = deviceTree.querySelector(`[data-path="${CSS.escape(parentPath)}"]`);
      }
    }
  }

  if (target) {
    target.classList.remove("searching", "extracting", "deleting");
    target.classList.add(status);
  }
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Error en la solicitud");
  }
  return response.json();
};

const updateLocationStats = (stats) => {
  if (!stats || Object.keys(stats).length === 0) {
    locationStats.innerHTML = "";
    return;
  }

  let html = "<div class='stats-title'>Archivos por ubicacion:</div><ul class='stats-list'>";
  for (const [location, count] of Object.entries(stats)) {
    const shortLoc = location.split("/").slice(-2).join("/");
    html += `<li><span class="stats-loc">${shortLoc}</span><span class="stats-count">${count}</span></li>`;
  }
  html += "</ul>";
  locationStats.innerHTML = html;
};

detectDevice.addEventListener("click", () => {
  detectDevice.disabled = true;
  detectStatus.textContent = "Detectando dispositivo...";
  detectStatus.classList.remove("warn", "success");
  detectStatus.classList.add("warn");

  fetchJson("/api/device")
    .then((payload) => {
      if (!payload.devices || payload.devices.length === 0) {
        detectStatus.textContent = "No se detectaron dispositivos MTP. Verifica la conexion y autoriza en el celular.";
        detectStatus.classList.remove("success");
        detectStatus.classList.add("warn");
        detectDevice.disabled = false;
        return;
      }
      activeDeviceId = payload.devices[0].id;
      detectStatus.textContent = `Dispositivo detectado: ${activeDeviceId}`;
      detectStatus.classList.remove("warn");
      detectStatus.classList.add("success");
      startExploration.disabled = false;
      remountBtn.disabled = false;

      // Cargar árbol automáticamente al detectar
      loadDeviceTree();
    })
    .catch((err) => {
      detectStatus.textContent = `Error en deteccion: ${err.message}`;
      detectStatus.classList.remove("success");
      detectStatus.classList.add("warn");
      detectDevice.disabled = false;
    });
});

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
      detectStatus.classList.remove("warn");
      detectStatus.classList.add("success");
      remountBtn.disabled = false;
    })
    .catch((err) => {
      detectStatus.textContent = `Error reconectando: ${err.message}`;
      detectStatus.classList.add("warn");
      remountBtn.disabled = false;
    });
});

const loadDeviceTree = () => {
  if (!activeDeviceId) return;

  deviceTree.innerHTML = "";
  deviceTree.textContent = "Cargando arbol del dispositivo...";

  fetchJson(`/api/tree?deviceId=${encodeURIComponent(activeDeviceId)}&depth=4&maxNodes=1500`)
    .then((payload) => {
      deviceTree.innerHTML = "";
      buildTreeUI(payload.tree, deviceTree);
      if (payload.truncated) {
        const note = document.createElement("div");
        note.className = "tree-placeholder";
        note.textContent = `Arbol truncado (${payload.nodeCount} nodos). La extraccion buscara en mas ubicaciones.`;
        deviceTree.appendChild(note);
      }
    })
    .catch((err) => {
      deviceTree.innerHTML = "";
      const note = document.createElement("div");
      note.className = "tree-placeholder";
      note.textContent = `Error cargando arbol: ${err.message}`;
      deviceTree.appendChild(note);
    });
};

startExploration.addEventListener("click", loadDeviceTree);

const copyAll = document.getElementById("copy-all");
copyAll.addEventListener("click", () => {
  const summary = sections
    .map((section) => {
      const commands = section.cards.map((card) => card.code).join("\n\n");
      return `# ${section.title}\n${commands}`;
    })
    .join("\n\n");
  navigator.clipboard.writeText(summary).then(() => {
    copyAll.textContent = "Resumen copiado";
    setTimeout(() => (copyAll.textContent = "Copiar resumen rapido"), 1600);
  });
});

const toggleTheme = document.getElementById("toggle-theme");
toggleTheme.addEventListener("click", () => {
  const isDusk = document.body.hasAttribute("data-theme");
  if (isDusk) {
    document.body.removeAttribute("data-theme");
  } else {
    document.body.setAttribute("data-theme", "dusk");
  }
});

extractForm.addEventListener("submit", (event) => {
  event.preventDefault();
  extractResult.textContent = "";
  locationStats.innerHTML = "";

  if (!activeDeviceId) {
    extractResult.textContent = "Primero detecta el dispositivo.";
    extractResult.classList.add("warn");
    return;
  }

  let fileType = fileTypeSelect.value;
  if (fileType === "custom") {
    fileType = customExtInput.value.trim().replace(/^\./, "");
    if (!fileType) {
      extractResult.textContent = "Ingresa una extension valida.";
      extractResult.classList.add("warn");
      return;
    }
  }

  const destination = destinationInput.value.trim();
  const searchMode = searchModeSelect.value;
  const deleteAfter = deleteAfterCheck.checked;

  // Confirmar si se va a eliminar
  if (deleteAfter) {
    const confirm = window.confirm(
      "Has seleccionado ELIMINAR los archivos del celular despues de extraerlos.\n\n" +
      "Esta accion es PERMANENTE y no se puede deshacer.\n\n" +
      "¿Deseas continuar?"
    );
    if (!confirm) return;
  }

  // Reset barras de progreso
  searchBar.style.width = "0%";
  extractBar.style.width = "0%";
  deleteBar.style.width = "0%";
  searchMeta.textContent = `Buscando archivos .${fileType} en el dispositivo...`;
  extractMeta.textContent = "Extraccion en espera.";
  deleteMeta.textContent = deleteAfter ? "Eliminacion en espera." : "No se eliminaran archivos.";
  extractResult.classList.remove("warn", "success");

  // Limpiar estados previos del árbol
  lastHighlighted = null;
  const treeItems = deviceTree.querySelectorAll("li");
  treeItems.forEach((item) => {
    item.classList.remove("active", "searching", "extracting", "deleting", "found", "copied", "deleted");
  });

  // Inicializar log del árbol
  initTreeLog();
  clearTreeLog();
  addLogEntry(`Iniciando búsqueda de archivos .${fileType}...`, "info");

  if (statusTimer) {
    clearInterval(statusTimer);
  }

  fetchJson("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: activeDeviceId,
      type: fileType,
      destination: destination || "",
      searchMode: searchMode,
      deleteAfter: deleteAfter
    })
  })
    .then((payload) => {
      const jobId = payload.jobId;

      let lastStage = "";
      let lastFound = 0;
      let lastCopied = 0;
      let lastDeleted = 0;
      let lastPath = "";

      statusTimer = setInterval(async () => {
        try {
          const job = await fetchJson(`/api/extract/status?id=${encodeURIComponent(jobId)}`);

          searchBar.style.width = `${job.searchProgress}%`;
          extractBar.style.width = `${job.extractProgress}%`;
          deleteBar.style.width = `${job.deleteProgress || 0}%`;

          if (job.stage === "search") {
            const shortPath = job.currentPath ? job.currentPath.split("/").slice(-2).join("/") : "iniciando...";
            searchMeta.textContent = `Buscando en: ${shortPath} (${job.found} encontrados)`;
            extractMeta.textContent = "Extraccion en espera.";

            // Resaltar ruta actual en azul (buscando)
            highlightPath(job.currentPath, "searching");

            // Marcar ubicación anterior como encontrada si cambió
            if (job.currentLocation && job.currentLocation !== lastPath) {
              if (lastPath) {
                markPathStatus(lastPath, "found");
              }
              addLogEntry(`Explorando: ${job.currentLocation}`, "search");
              lastPath = job.currentLocation;
            }

            // Log cuando encuentra archivos nuevos
            if (job.found > lastFound) {
              addLogEntry(`Encontrados: ${job.found} archivos`, "search");
              lastFound = job.found;
            }

          } else if (job.stage === "extract") {
            // Primera vez que entra a extract
            if (lastStage !== "extract") {
              if (lastPath) markPathStatus(lastPath, "found");
              addLogEntry(`Búsqueda completada: ${job.found} archivos encontrados`, "info");
              addLogEntry(`Iniciando extracción a: ${job.destination}`, "extract");
            }

            searchMeta.textContent = `Busqueda completada: ${job.found} archivos encontrados.`;
            extractMeta.textContent = `Extrayendo ${job.copied} de ${job.total} archivos...`;
            updateLocationStats(job.locationStats);

            // Resaltar archivo actual en verde (extrayendo)
            highlightPath(job.currentPath, "extracting");

            // Marcar archivos ya copiados
            if (job.copied > lastCopied) {
              for (let i = lastCopied; i < job.copied; i++) {
                if (job.files && job.files[i]) {
                  markPathStatus(job.files[i].path, "copied");
                }
              }
              if (job.copied % 5 === 0 || job.copied === 1) {
                addLogEntry(`Extraídos: ${job.copied}/${job.total} archivos`, "extract");
              }
              lastCopied = job.copied;
            }

          } else if (job.stage === "delete") {
            // Primera vez que entra a delete
            if (lastStage !== "delete") {
              addLogEntry(`Extracción completada: ${job.copied} archivos`, "extract");
              addLogEntry(`Iniciando eliminación del celular...`, "delete");
            }

            extractMeta.textContent = `Extraccion completada: ${job.copied} archivos.`;
            deleteMeta.textContent = `Eliminando ${job.deleted} de ${job.total} archivos...`;

            // Resaltar archivo actual en rojo (eliminando)
            highlightPath(job.currentPath, "deleting");

            // Marcar archivos ya eliminados
            if (job.deleted > lastDeleted) {
              for (let i = lastDeleted; i < job.deleted; i++) {
                if (job.files && job.files[i]) {
                  markPathStatus(job.files[i].path, "deleted");
                }
              }
              if (job.deleted % 5 === 0 || job.deleted === 1) {
                addLogEntry(`Eliminados: ${job.deleted}/${job.total} archivos`, "delete");
              }
              lastDeleted = job.deleted;
            }
          }

          lastStage = job.stage;

          if (job.status === "done") {
            clearInterval(statusTimer);
            statusTimer = null;

            let resultMsg = `Completado: ${job.copied} archivos ${job.type.toUpperCase()} extraidos`;
            if (job.deleteAfter) {
              resultMsg += `, ${job.deleted} eliminados del celular`;
            }
            resultMsg += `.\nDestino: ${job.destination}`;

            extractMeta.textContent = `Extraccion completada: ${job.copied} archivos.`;
            if (job.deleteAfter) {
              deleteMeta.textContent = `Eliminacion completada: ${job.deleted} archivos.`;
              addLogEntry(`Eliminación completada: ${job.deleted} archivos`, "delete");
            }

            addLogEntry(`¡PROCESO COMPLETADO!`, "info");
            addLogEntry(`Total extraídos: ${job.copied} archivos`, "extract");

            extractResult.textContent = resultMsg;
            extractResult.classList.add("success");
            highlightPath("", "active");
          }

          if (job.status === "error") {
            clearInterval(statusTimer);
            statusTimer = null;
            addLogEntry(`ERROR: ${job.error}`, "delete");
            extractResult.textContent = `Error: ${job.error}`;
            extractResult.classList.add("warn");
          }
        } catch (err) {
          clearInterval(statusTimer);
          statusTimer = null;
          extractResult.textContent = `Error consultando estado: ${err.message}`;
          extractResult.classList.add("warn");
        }
      }, 800);
    })
    .catch((err) => {
      extractResult.textContent = `Error iniciando extraccion: ${err.message}`;
      extractResult.classList.add("warn");
    });
});
