#!/usr/bin/env bash
# ==============================================================================
# Detener servidor Extractor Android MTP
# ==============================================================================

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${APP_DIR}/.server.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    kill "$PID" 2>/dev/null || true
    echo "✓ Servidor detenido (PID: $PID)."
    rm -f "$PID_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Fallback: procesos node que corren desde esta carpeta (nunca otros programas)
PIDS=""
for P in $(pgrep -f "server\.js" 2>/dev/null); do
  if [ "$(readlink "/proc/$P/cwd" 2>/dev/null)" = "$APP_DIR" ] \
    && [[ "$(basename "$(readlink "/proc/$P/exe" 2>/dev/null)")" == node* ]]; then
    PIDS="$PIDS $P"
  fi
done
PIDS="${PIDS# }"
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null || true
  echo "✓ Proceso(s) de servidor detenido(s): $PIDS"
else
  echo "No hay ningún servidor de Extractor Android activo."
fi
