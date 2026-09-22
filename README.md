# Extractor de Archivos y Liberador de Memoria Android (MTP / ADB) - Versión 2026

Aplicación web local de alto rendimiento y seguridad para auditar el almacenamiento de tu celular Android, extraer fotos, videos, audios, documentos o cualquier extensión personalizada a tu PC Linux, y verificar con exactitud la memoria liberada.

---

## ✨ Características Principales

### 📊 Diagnóstico de Memoria y Comparativa de Liberación
- **Inspección Rápida de Memorias**: Botón **"📊 Analizar Memoria"** para ver al instante la capacidad total, libre y porcentaje de uso del **Almacenamiento Interno** y de la **Tarjeta SD externa**.
- **Capacidad de Carpetas Clave**: Muestreo automático del espacio ocupado por carpetas críticas como `DCIM (Cámara)`, `WhatsApp Media`, `Download`, `Pictures`, `Telegram`, `Music`, etc.
- **Tabla de Comparación "Antes vs Después"**:
  - Al completar la extracción (con o sin eliminación), genera una tabla comparativa de auditoría.
  - Compara el estado inicial contra el actual y calcula con precisión matemática el **espacio recuperado** (`+ X.XX GB LIBERADOS`).

### 🛡️ Seguridad y Control de Datos
- **Control Inteligente de Duplicados**:
  - *Conservar estructura de carpetas (Recomendado)*: Organiza los archivos recreando las subcarpetas del móvil (ej: `WhatsApp/Media`, `DCIM/Camera`, `Download`) evitando sobrescrituras.
  - *Renombrado automático*: Agrega un sufijo secuencial (`archivo (1).ext`) si el archivo ya existe en el PC.
  - *Omitir existentes* o *Sobrescribir siempre*.
- **Botón de Cancelación Inmediata**: Permite abortar la búsqueda, extracción o eliminación en cualquier instante sin dejar procesos colgados.
- **Verificación Estricta de Integridad antes de Borrar**: Comprueba que cada archivo exista localmente en el PC y su tamaño sea válido antes de ejecutar el borrado en el móvil.
- **Apertura Directa de Carpetas**: Botón con `xdg-open` para abrir la carpeta destino directamente en tu gestor de archivos (Nautilus, Dolphin, Thunar, etc.).

### ⚡ Rendimiento y Consumo de Memoria
- **Sin árbol de carpetas**: el antiguo explorador recorría miles de carpetas del móvil por MTP y mantenía hasta 5.000 nodos en el navegador. Se sustituyó por un **monitor de actividad** que muestra sólo la ruta en curso y las últimas 60 líneas de registro, dejando el canal USB y la RAM libres para la búsqueda y la copia.
- **Cola serie de acceso al dispositivo**: MTP es un canal único. Todas las operaciones se encolan y **el proceso en ejecución tiene prioridad** sobre las consultas de la interfaz, que esperan su turno en vez de competir por el puerto.
- **Caché LRU con caducidad para el diagnóstico**: los listados de carpetas (incluidas las que no existen en tu teléfono) se reutilizan durante 30 segundos. Un segundo análisis de memoria pasa de ~31 llamadas al dispositivo a 3. La extracción **nunca** usa caché: siempre lee el estado real.
- **Sin duplicados en la búsqueda**: las carpetas conocidas y el recorrido de la raíz se solapaban y cada archivo se listaba, copiaba y guardaba dos veces. Ahora se deduplica por ruta.
- **Tabla de resultados por bloques**: con 12.000 archivos encontrados se crean ~150 filas en pantalla en vez de 12.000, y se añaden más sólo al desplazarse.
- **Liberación automática**: al terminar una extracción el servidor suelta la lista de archivos, y los trabajos viejos se purgan solos. El botón **♻️ Liberar memoria** vacía los cachés del servidor y del navegador al instante.
- **Sondeo adaptativo**: el estado se consulta en cadena (nunca dos peticiones a la vez) y el intervalo se relaja de 0,7 s a 2,5 s cuando el proceso no avanza.

### 🔍 Interactividad y Experiencia de Usuario
- **Modo "Escanear y Previsualizar"**:
  - Previsualiza los archivos en una tabla interactiva antes de copiarlos.
  - Casillas para seleccionar/deseleccionar todo o individualmente.
  - Buscador de texto en tiempo real para filtrar la lista al instante.
- **Filtros Avanzados**:
  - *Filtro por fecha*: Cualquier fecha, últimas 24h, últimos 7 días, últimos 30 días, último año.
  - *Filtro por tamaño mínimo*: > 1 MB, > 10 MB, > 50 MB, > 100 MB.
- **Monitor de Actividad en Vivo**: ruta en proceso, estado y registro acotado, con un indicador del consumo de RAM del servidor y del tamaño de la caché.
- **Modo Oscuro Real (Dark Mode)**: Selector de temas de 3 estados (☀️ Claro, 🌙 Oscuro OLED de alto contraste, 🍃 Dusk).
- **Notificaciones y Sonidos**: Alertas sonoras sutiles con Web Audio API y notificaciones nativas de escritorio del navegador.

---

## 🚀 Instalación Rápida con Acceso Directo e Ícono

Hemos incluido un script de instalación automatizado que verifica tu sistema, configura permisos y crea un acceso directo en tu Escritorio y menú de aplicaciones.

### Paso 1: Ejecutar el Instalador
Abre una terminal en la carpeta del proyecto y corre:
```bash
./install.sh
```
El instalador:
1. Comprobará tu versión de Linux (Ubuntu, Debian, Fedora, Arch, etc.).
2. Verificará que Node.js, `gio` y `xdg-open` estén listos.
3. Creará el acceso directo con su ícono oficial en tu **Escritorio** (`~/Escritorio/ExtractorAndroid.desktop`) y en el **Menú de aplicaciones**.
4. Marcará el acceso directo como confiable para que puedas abrirlo haciendo doble clic.

### Paso 2: Iniciar la Aplicación
Puedes iniciarla de cualquiera de estas formas:
1. **Doble clic en el ícono** del Escritorio: `Extractor Android MTP`.
2. O desde la terminal ejecutando:
   ```bash
   ./start.sh
   ```
*(El script `./start.sh` inicia el servidor en segundo plano y abre automáticamente tu navegador web en `http://127.0.0.1:3000`)*.

Para terminar, pulsa **⏏️ Finalizar y desconectar** (barra principal o menú lateral): desmonta el celular de forma segura y detiene el servidor. Desde la pantalla de cierre, **🔄 Volver a empezar** recarga la aplicación cuando el servidor vuelve a estar activo.

También puedes detener el servidor desde la terminal:
```bash
./stop.sh
```

---

## 💻 Instalar en otras laptops o PC

1. En este equipo genera el instalador:
   ```bash
   ./crear_instalador.sh
   ```
2. Copia `dist/ExtractorAndroidMTP-instalador.sh` al otro equipo (USB, correo, red...).
3. En el otro equipo ejecútalo **sin sudo** (pedirá la contraseña sólo si faltan paquetes):
   ```bash
   bash ExtractorAndroidMTP-instalador.sh
   ```

Instala dependencias (Node.js, GVFS-MTP, xdg-utils, curl) con apt, dnf, pacman o zypper, copia la app en `~/.local/share/extractor-android-mtp` y crea el ícono en el Escritorio y en el menú. Ejecutarlo de nuevo actualiza la instalación. Opciones: `--desinstalar`, `--sin-dependencias`, `-y` (sin preguntas). También se puede desinstalar con `~/.local/share/extractor-android-mtp/desinstalar.sh`.

---

## 📂 Archivos del Proyecto

- `install.sh`: Script instalador y verificador preliminar del sistema.
- `start.sh`: Lanzador de un solo clic que inicia el servidor y abre el navegador.
- `stop.sh`: Detiene limpiamente el servidor en segundo plano.
- `uninstall.sh`: Elimina los accesos directos creados.
- `crear_instalador.sh`: Genera `dist/ExtractorAndroidMTP-instalador.sh`, un único archivo autoinstalable para llevar la aplicación a otras laptops o PC.
- `server.js`: Backend HTTP en Node.js puro (cero dependencias npm externas).
- `index.html`: Interfaz web con panel de diagnóstico, monitor de actividad, previsualización y comparativa.
- `styles.css`: Estilos visuales con soporte para tema Claro, Oscuro y Dusk.
- `app.js`: Lógica del cliente, gráficos de almacenamiento, cálculo de memoria liberada y notificaciones.
- `assets/icon.svg`: Ícono vectorial en alta resolución para el escritorio y lanzadores.
