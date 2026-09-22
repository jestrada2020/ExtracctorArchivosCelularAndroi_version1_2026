#!/usr/bin/env bash
# ==============================================================================
# Generador del instalador portable: Extractor Android MTP (2026)
#
# Crea un único archivo autoinstalable (dist/ExtractorAndroidMTP-instalador.sh)
# que contiene la aplicación completa. Cópialo a otra laptop o PC con Linux y
# ejecútalo allí:  bash ExtractorAndroidMTP-instalador.sh
# ==============================================================================

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${APP_DIR}/dist"
OUTPUT="${DIST_DIR}/ExtractorAndroidMTP-instalador.sh"

# Archivos que forman la aplicación (nada de logs, pid ni lanzadores locales)
APP_FILES=(server.js index.html app.js styles.css start.sh stop.sh README.md assets)

cd "$APP_DIR"
for f in "${APP_FILES[@]}"; do
  if [ ! -e "$f" ]; then
    echo "Error: falta '$f' en ${APP_DIR}"
    exit 1
  fi
done

if ! command -v node >/dev/null 2>&1 || ! node --check server.js || ! node --check app.js; then
  echo "Error: server.js o app.js tienen errores de sintaxis (o falta Node.js). Corrígelos antes de empaquetar."
  exit 1
fi

mkdir -p "$DIST_DIR"
VERSION="$(date +%Y.%m.%d-%H%M)"

# Cabecera: el script de instalación que se ejecuta en el otro equipo
cat > "$OUTPUT" <<'INSTALLER'
#!/usr/bin/env bash
# ==============================================================================
# Instalador portable: Extractor Android MTP
#
# Uso:
#   bash ExtractorAndroidMTP-instalador.sh                 Instalar o actualizar
#   bash ExtractorAndroidMTP-instalador.sh --desinstalar   Quitar la aplicación
#   bash ExtractorAndroidMTP-instalador.sh --sin-dependencias
#                                  Instalar sin tocar paquetes del sistema
#   bash ExtractorAndroidMTP-instalador.sh -y              No hacer preguntas
# ==============================================================================

set -e

APP_NAME="Extractor Android MTP"
APP_VERSION="__VERSION__"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/extractor-android-mtp"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_NAME="ExtractorAndroid.desktop"

BOLD="\033[1m"; GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; CYAN="\033[0;36m"; NC="\033[0m"
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✘ $*${NC}"; exit 1; }

ASSUME_YES=false
SKIP_DEPS=false
UNINSTALL=false
for arg in "$@"; do
  case "$arg" in
    -y|--si) ASSUME_YES=true ;;
    --sin-dependencias) SKIP_DEPS=true ;;
    --desinstalar) UNINSTALL=true ;;
    -h|--ayuda|--help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) fail "Opción desconocida: $arg (usa --ayuda)" ;;
  esac
done

confirm() {
  # confirm "pregunta" -> 0 si la respuesta es sí (por defecto sí)
  if [ "$ASSUME_YES" = true ] || [ ! -t 0 ]; then
    return 0
  fi
  local resp
  read -r -p "$1 (S/n) " resp
  [[ -z "$resp" || "$resp" =~ ^[sSyY] ]]
}

desktop_dir() {
  local d=""
  if command -v xdg-user-dir >/dev/null 2>&1; then
    d="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  fi
  if [ -z "$d" ] || [ "$d" = "$HOME" ] || [ ! -d "$d" ]; then
    for c in "$HOME/Escritorio" "$HOME/Desktop"; do
      [ -d "$c" ] && { d="$c"; break; }
    done
  fi
  [ -n "$d" ] && [ -d "$d" ] && [ "$d" != "$HOME" ] && echo "$d"
  return 0
}

stop_running() {
  if [ -x "$INSTALL_DIR/stop.sh" ]; then
    "$INSTALL_DIR/stop.sh" >/dev/null 2>&1 || true
  fi
  # Sólo procesos node que corren desde la carpeta instalada (nunca otros programas)
  local pid
  for pid in $(pgrep -f "server\.js" 2>/dev/null); do
    if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$INSTALL_DIR" ] \
      && [[ "$(basename "$(readlink "/proc/$pid/exe" 2>/dev/null)")" == node* ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

echo -e "${BOLD}${CYAN}=======================================================${NC}"
echo -e "${BOLD}${CYAN}   ${APP_NAME} - Instalador portable (v${APP_VERSION})${NC}"
echo -e "${BOLD}${CYAN}=======================================================${NC}"
echo ""

[ "$(uname -s)" = "Linux" ] || fail "Este instalador es sólo para Linux."
[ "$(id -u)" -ne 0 ] || fail "No ejecutes el instalador con sudo/root. Se pedirá la contraseña sólo cuando haga falta."

# ------------------------------------------------------------------------------
# Desinstalación
# ------------------------------------------------------------------------------
if [ "$UNINSTALL" = true ]; then
  echo -e "${BOLD}Desinstalando ${APP_NAME}...${NC}"
  stop_running
  rm -f "$APPS_DIR/$DESKTOP_NAME"
  DDIR="$(desktop_dir)"
  [ -n "$DDIR" ] && rm -f "$DDIR/$DESKTOP_NAME"
  rm -rf "$INSTALL_DIR"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  ok "Aplicación eliminada. Tus archivos extraídos (~/Extraidos_Android) no se tocaron."
  exit 0
fi

# ------------------------------------------------------------------------------
# 1. Dependencias del sistema
# ------------------------------------------------------------------------------
echo -e "${BOLD}1. Dependencias del sistema${NC}"

PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf >/dev/null 2>&1; then PKG=dnf
elif command -v pacman >/dev/null 2>&1; then PKG=pacman
elif command -v zypper >/dev/null 2>&1; then PKG=zypper
fi

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$major" -ge 16 ] 2>/dev/null
}

MISSING=()
node_ok || MISSING+=(node)
command -v gio >/dev/null 2>&1 || MISSING+=(gio)
command -v xdg-open >/dev/null 2>&1 || MISSING+=(xdg-open)
command -v curl >/dev/null 2>&1 || MISSING+=(curl)
# Soporte MTP de GVFS (sin él, el celular no se monta)
HAS_MTP=false
for f in /usr/libexec/gvfsd-mtp /usr/lib/gvfs/gvfsd-mtp /usr/lib/*/gvfs/gvfsd-mtp /usr/lib*/gvfs/gvfsd-mtp; do
  [ -e "$f" ] && { HAS_MTP=true; break; }
done
[ "$HAS_MTP" = true ] || MISSING+=(gvfs-mtp)

if [ ${#MISSING[@]} -eq 0 ]; then
  ok "Node.js $(node -v), GIO/GVFS-MTP, xdg-open y curl ya están instalados."
elif [ "$SKIP_DEPS" = true ]; then
  warn "Faltan: ${MISSING[*]} (omitido por --sin-dependencias)."
elif [ -z "$PKG" ]; then
  warn "Faltan: ${MISSING[*]}. No se reconoció el gestor de paquetes; instálalos manualmente."
else
  echo -e "  Faltan: ${YELLOW}${MISSING[*]}${NC}"
  case "$PKG" in
    apt)    PKGS=(nodejs gvfs-backends gvfs-fuse xdg-utils curl libnotify-bin) ;;
    dnf)    PKGS=(nodejs gvfs-mtp gvfs-fuse xdg-utils curl libnotify) ;;
    pacman) PKGS=(nodejs gvfs-mtp xdg-utils curl libnotify) ;;
    zypper) PKGS=(nodejs gvfs-backends gvfs-fuse xdg-utils curl libnotify-tools) ;;
  esac
  if confirm "  ¿Instalar con ${PKG}: ${PKGS[*]}? (pide contraseña de administrador)"; then
    case "$PKG" in
      apt)    sudo apt-get update && sudo apt-get install -y "${PKGS[@]}" ;;
      dnf)    sudo dnf install -y "${PKGS[@]}" ;;
      pacman) sudo pacman -S --needed --noconfirm "${PKGS[@]}" ;;
      zypper) sudo zypper --non-interactive install "${PKGS[@]}" ;;
    esac || warn "La instalación de paquetes falló; revisa los mensajes anteriores."
  else
    warn "Instalación de paquetes omitida."
  fi
fi

if ! node_ok; then
  if command -v node >/dev/null 2>&1; then
    warn "Node.js $(node -v) es muy antiguo: se necesita v16 o superior."
  else
    warn "Node.js no está instalado."
  fi
  warn "Instala una versión reciente (https://nodejs.org) y vuelve a ejecutar este instalador."
fi

# ADB es opcional
if command -v adb >/dev/null 2>&1; then
  ok "ADB (opcional) disponible."
else
  echo -e "  ${CYAN}ℹ${NC} ADB (opcional) no instalado; la extracción por MTP funciona sin él."
fi
echo ""

# ------------------------------------------------------------------------------
# 2. Copia de la aplicación
# ------------------------------------------------------------------------------
echo -e "${BOLD}2. Instalando la aplicación en ${INSTALL_DIR}${NC}"
if [ -d "$INSTALL_DIR" ]; then
  echo "  Se encontró una instalación previa: se actualizará."
fi
stop_running

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PAYLOAD_LINE=$(awk '/^__PAYLOAD_BELOW__$/ { print NR + 1; exit 0 }' "$0")
tail -n +"$PAYLOAD_LINE" "$0" | base64 -d | tar -xzf - -C "$TMP_DIR" \
  || fail "El instalador está dañado (no se pudo extraer la aplicación). Vuelve a copiarlo."

mkdir -p "$INSTALL_DIR"
# Se reemplazan los archivos de la app; server.log y demás se conservan
cp -a "$TMP_DIR"/. "$INSTALL_DIR"/
chmod +x "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh" "$INSTALL_DIR/server.js"
echo "$APP_VERSION" > "$INSTALL_DIR/VERSION"

# Desinstalador local
cp "$0" "$INSTALL_DIR/instalador.sh"
cat > "$INSTALL_DIR/desinstalar.sh" <<EOF
#!/usr/bin/env bash
exec bash "$INSTALL_DIR/instalador.sh" --desinstalar "\$@"
EOF
chmod +x "$INSTALL_DIR/desinstalar.sh" "$INSTALL_DIR/instalador.sh"
ok "Archivos copiados (versión ${APP_VERSION})."
echo ""

# ------------------------------------------------------------------------------
# 3. Ícono en el menú de aplicaciones y en el Escritorio
# ------------------------------------------------------------------------------
echo -e "${BOLD}3. Creando accesos directos${NC}"
mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/$DESKTOP_NAME" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=${APP_NAME}
GenericName=Extractor de Archivos y Liberador de Memoria
Comment=Extrae archivos de tu celular Android y verifica la memoria liberada
Exec="${INSTALL_DIR}/start.sh"
Path=${INSTALL_DIR}
Icon=${INSTALL_DIR}/assets/icon.svg
Terminal=false
Categories=Utility;FileManager;FileTransfer;
Keywords=android;mtp;celular;movil;extraer;usb;
StartupNotify=true
EOF
chmod +x "$APPS_DIR/$DESKTOP_NAME"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
ok "Menú de aplicaciones: $APPS_DIR/$DESKTOP_NAME"

DDIR="$(desktop_dir)"
if [ -n "$DDIR" ]; then
  cp "$APPS_DIR/$DESKTOP_NAME" "$DDIR/$DESKTOP_NAME"
  chmod +x "$DDIR/$DESKTOP_NAME"
  # GNOME/Ubuntu: marcar el lanzador como confiable para poder abrirlo con doble clic
  gio set "$DDIR/$DESKTOP_NAME" metadata::trusted true >/dev/null 2>&1 || true
  ok "Escritorio: $DDIR/$DESKTOP_NAME"
else
  warn "No se encontró carpeta de Escritorio; usa el menú de aplicaciones."
fi
echo ""

# ------------------------------------------------------------------------------
# Resumen
# ------------------------------------------------------------------------------
echo -e "${BOLD}${GREEN}=======================================================${NC}"
echo -e "${BOLD}${GREEN}   ¡${APP_NAME} instalado correctamente!${NC}"
echo -e "${BOLD}${GREEN}=======================================================${NC}"
echo ""
echo "  • Ábrelo con el ícono '${APP_NAME}' del Escritorio o del menú."
echo "  • O desde la terminal: ${INSTALL_DIR}/start.sh"
echo "  • Para desinstalar:    ${INSTALL_DIR}/desinstalar.sh"
echo ""
if [ -n "$DDIR" ]; then
  echo "  Si el ícono del Escritorio no abre, haz clic derecho sobre él → 'Permitir ejecutar'."
  echo ""
fi

if node_ok && [ -t 0 ] && [ "$ASSUME_YES" = false ] && confirm "¿Abrir la aplicación ahora?"; then
  "$INSTALL_DIR/start.sh"
fi
exit 0
__PAYLOAD_BELOW__
INSTALLER

sed -i "s/__VERSION__/${VERSION}/" "$OUTPUT"

# Carga útil: la aplicación comprimida en base64 al final del script
tar -czf - "${APP_FILES[@]}" | base64 >> "$OUTPUT"
chmod +x "$OUTPUT"

echo "✓ Instalador generado: ${OUTPUT}"
echo "  Versión: ${VERSION}  ·  Tamaño: $(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "Cópialo a la otra laptop/PC y ejecútalo allí con:"
echo "  bash ExtractorAndroidMTP-instalador.sh"
