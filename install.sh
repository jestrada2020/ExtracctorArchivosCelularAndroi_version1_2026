#!/usr/bin/env bash
# ==============================================================================
# Instalador y Verificador Preliminar: Extractor Android MTP (2026)
# ==============================================================================

set -e

# Colores para salida agradable
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m" # Sin color

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo -e "${BOLD}${CYAN}=======================================================${NC}"
echo -e "${BOLD}${CYAN}   Extractor Android MTP - Instalador y Verificador    ${NC}"
echo -e "${BOLD}${CYAN}=======================================================${NC}"
echo ""

# ------------------------------------------------------------------------------
# 1. Verificación del Sistema Operativo
# ------------------------------------------------------------------------------
echo -e "${BOLD}1. Verificando Sistema Operativo...${NC}"
OS_NAME="$(uname -s)"
if [ "$OS_NAME" != "Linux" ]; then
  echo -e "${RED}✘ Este instalador está diseñado para sistemas operativos Linux.${NC}"
  echo "Sistema detectado: $OS_NAME"
  exit 1
fi

DISTRO="Linux desconocido"
if [ -f /etc/os-release ]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  DISTRO="$PRETTY_NAME"
fi
echo -e "${GREEN}✓ Sistema compatible detectado:${NC} $DISTRO ($(uname -m))"
echo ""

# ------------------------------------------------------------------------------
# 2. Verificación de Dependencias Esenciales
# ------------------------------------------------------------------------------
echo -e "${BOLD}2. Verificando dependencias necesarias...${NC}"
MISSING_DEPS=()

# Node.js
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v)"
  NODE_MAJOR="$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 16 ]; then
    echo -e "  ${GREEN}✓ Node.js:${NC} Instalado ($NODE_VER)"
  else
    echo -e "  ${YELLOW}⚠ Node.js:${NC} Versión antigua ($NODE_VER). Se recomienda v16+."
  fi
else
  echo -e "  ${RED}✘ Node.js:${NC} No encontrado."
  MISSING_DEPS+=("nodejs")
fi

# GIO / GVFS
if command -v gio >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓ GIO (GNOME VFS):${NC} Instalado ($(which gio))"
else
  echo -e "  ${RED}✘ GIO (GVFS):${NC} No encontrado."
  MISSING_DEPS+=("gvfs-backends")
fi

# xdg-open
if command -v xdg-open >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓ xdg-open:${NC} Instalado"
else
  echo -e "  ${YELLOW}⚠ xdg-open:${NC} No encontrado (gestor de ventanas sin xdg-utils)."
  MISSING_DEPS+=("xdg-utils")
fi

# ADB (Opcional)
if command -v adb >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓ ADB (Opcional):${NC} Instalado ($(which adb))"
else
  echo -e "  ${CYAN}ℹ ADB (Opcional):${NC} No instalado. (MTP funcionará sin problemas)."
fi

# Intentar instalar dependencias faltantes si existen
if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}Se detectaron componentes faltantes: ${MISSING_DEPS[*]}${NC}"
  echo "¿Deseas que intentemos instalarlos usando el gestor de paquetes de tu sistema? (S/n)"
  read -r -t 15 RESP || RESP="S"
  if [[ "$RESP" =~ ^[sSyY]?$ ]]; then
    if command -v apt >/dev/null 2>&1; then
      echo "Instalando con apt (requiere privilegios sudo)..."
      sudo apt update && sudo apt install -y "${MISSING_DEPS[@]}"
    elif command -v dnf >/dev/null 2>&1; then
      echo "Instalando con dnf (requiere privilegios sudo)..."
      sudo dnf install -y "${MISSING_DEPS[@]}"
    elif command -v pacman >/dev/null 2>&1; then
      echo "Instalando con pacman (requiere privilegios sudo)..."
      sudo pacman -S --noconfirm "${MISSING_DEPS[@]}"
    else
      echo -e "${RED}No se pudo detectar el gestor de paquetes. Por favor instala manualmente: ${MISSING_DEPS[*]}${NC}"
    fi
  else
    echo -e "${YELLOW}Instalación de paquetes omitida por el usuario.${NC}"
  fi
fi
echo ""

# ------------------------------------------------------------------------------
# 3. Permisos de Ejecución
# ------------------------------------------------------------------------------
echo -e "${BOLD}3. Configurando permisos de archivos...${NC}"
chmod +x "$APP_DIR/start.sh" "$APP_DIR/stop.sh" "$APP_DIR/install.sh"
chmod +x "$APP_DIR/server.js" 2>/dev/null || true
echo -e "  ${GREEN}✓ Permisos de ejecución concedidos a scripts del sistema.${NC}"
echo ""

# ------------------------------------------------------------------------------
# 4. Creación del Lanzador e Ícono de Escritorio (.desktop)
# ------------------------------------------------------------------------------
echo -e "${BOLD}4. Creando acceso directo en el Escritorio y Menú de Aplicaciones...${NC}"

ICON_PATH="$APP_DIR/assets/icon.svg"
START_SCRIPT="$APP_DIR/start.sh"
DESKTOP_FILE="$APP_DIR/ExtractorAndroid.desktop"

# Generar archivo .desktop
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Extractor Android MTP
GenericName=Extractor de Archivos y Liberador de Memoria
Comment=Extrae archivos de tu celular Android y verifica la memoria liberada
Exec="$START_SCRIPT"
Icon=$ICON_PATH
Terminal=false
Categories=Utility;FileManager;FileTransfer;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE"

# Instalar en el menú de aplicaciones del usuario (~/.local/share/applications/)
USER_APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$USER_APPS_DIR"
cp "$DESKTOP_FILE" "$USER_APPS_DIR/ExtractorAndroid.desktop"
echo -e "  ${GREEN}✓ Instalado en el menú de aplicaciones del sistema:${NC} $USER_APPS_DIR"

# Instalar en el Escritorio si existe la carpeta
DESKTOP_DIRS=("$HOME/Escritorio" "$HOME/Desktop")
INSTALLED_ON_DESKTOP=false

for DDIR in "${DESKTOP_DIRS[@]}"; do
  if [ -d "$DDIR" ]; then
    cp "$DESKTOP_FILE" "$DDIR/ExtractorAndroid.desktop"
    chmod +x "$DDIR/ExtractorAndroid.desktop"
    # Para GNOME / Ubuntu: marcar como confiable
    if command -v gio >/dev/null 2>&1; then
      gio set "$DDIR/ExtractorAndroid.desktop" metadata::trusted true 2>/dev/null || true
    fi
    echo -e "  ${GREEN}✓ Ícono creado en tu Escritorio:${NC} $DDIR/ExtractorAndroid.desktop"
    INSTALLED_ON_DESKTOP=true
  fi
done

if [ "$INSTALLED_ON_DESKTOP" = false ]; then
  echo -e "  ${YELLOW}ℹ No se encontró carpeta ~/Escritorio o ~/Desktop. Se creó en $USER_APPS_DIR.${NC}"
fi
echo ""

# ------------------------------------------------------------------------------
# 5. Verificación Final y Resumen
# ------------------------------------------------------------------------------
echo -e "${BOLD}${GREEN}=======================================================${NC}"
echo -e "${BOLD}${GREEN}   ¡INSTALACIÓN Y CONFIGURACIÓN COMPLETADAS CON ÉXITO! ${NC}"
echo -e "${BOLD}${GREEN}=======================================================${NC}"
echo ""
echo "Opciones para ejecutar la aplicación:"
echo -e "  1. Haz doble clic en el ícono ${BOLD}'Extractor Android MTP'${NC} en tu Escritorio."
echo -e "  2. Búscalo en tu menú de inicio / lanzador de aplicaciones."
echo -e "  3. O ejecuta en esta terminal:"
echo -e "     ${CYAN}./start.sh${NC}"
echo ""
echo "Para detener la aplicación en cualquier momento ejecuta: ${CYAN}./stop.sh${NC}"
echo ""
