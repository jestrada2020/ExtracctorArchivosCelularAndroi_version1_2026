#!/usr/bin/env bash
# ==============================================================================
# Lanzador de la Aplicación Extractor Android MTP (2026)
# ==============================================================================

set -e

# Obtener directorio del script
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

PORT=3000
URL="http://127.0.0.1:${PORT}"
ICON_PATH="${APP_DIR}/assets/icon.svg"

# Notificación visual al hacer clic en el ícono
if command -v notify-send >/dev/null 2>&1; then
  notify-send -i "$ICON_PATH" "Extractor Android MTP" "Cargando servidor y abriendo aplicación..." 2>/dev/null || true
fi

# Asegurar detección de Node.js tanto en entornos GUI como en terminal
if ! command -v node >/dev/null 2>&1; then
  if [ -x "/usr/bin/node" ]; then
    export PATH="/usr/bin:$PATH"
  elif [ -x "/usr/local/bin/node" ]; then
    export PATH="/usr/local/bin:$PATH"
  elif [ -d "$HOME/.nvm/versions/node" ]; then
    NVM_NODE_BIN=$(find "$HOME/.nvm/versions/node" -maxdepth 3 -type f -name "node" 2>/dev/null | head -n 1)
    if [ -n "$NVM_NODE_BIN" ]; then
      export PATH="$(dirname "$NVM_NODE_BIN"):$PATH"
    fi
  fi
fi

# Verificar si node está disponible
if ! command -v node >/dev/null 2>&1; then
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -u critical "Extractor Android MTP" "Error: Node.js no encontrado. Ejecuta ./install.sh"
  fi
  echo "Error: Node.js no está instalado o no se encuentra en el PATH."
  echo "Por favor ejecuta primero: ./install.sh"
  exit 1
fi

# Verificar si el servidor ya está activo
SERVER_RUNNING=false
if curl -s --max-time 1 "${URL}/api/file-types" >/dev/null 2>&1; then
  SERVER_RUNNING=true
fi

if [ "$SERVER_RUNNING" = false ]; then
  echo "Iniciando servidor local en ${URL}..."
  # Ejecutar en segundo plano desacoplado
  nohup node server.js > "${APP_DIR}/server.log" 2>&1 &
  SERVER_PID=$!
  disown $SERVER_PID 2>/dev/null || true
  echo "$SERVER_PID" > "${APP_DIR}/.server.pid"

  # Esperar a que el puerto responda (hasta 5 segundos)
  READY=false
  for i in {1..10}; do
    if curl -s --max-time 1 "${URL}/api/file-types" >/dev/null 2>&1; then
      READY=true
      break
    fi
    sleep 0.5
  done

  if [ "$READY" = true ]; then
    echo "✓ Servidor iniciado correctamente (PID: $SERVER_PID)."
  else
    echo "Advertencia: El servidor tardó en responder. Revisa server.log."
  fi
else
  echo "✓ El servidor ya se encuentra en ejecución en ${URL}."
fi

# Abrir en el navegador predeterminado
if command -v xdg-open >/dev/null 2>&1; then
  echo "Abriendo navegador en ${URL}..."
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v sensible-browser >/dev/null 2>&1; then
  sensible-browser "$URL" >/dev/null 2>&1 &
else
  echo "Abre tu navegador web y entra a: ${URL}"
fi

echo "======================================================="
echo " Extractor Android MTP activo en: ${URL}"
echo " Para detener el servidor ejecuta: ./stop.sh"
echo "======================================================="
