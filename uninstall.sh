#!/usr/bin/env bash
# ==============================================================================
# Desinstalador de accesos directos: Extractor Android MTP
# ==============================================================================

set -e

echo "Desinstalando accesos directos de Extractor Android MTP..."

rm -f "$HOME/.local/share/applications/ExtractorAndroid.desktop"
rm -f "$HOME/Escritorio/ExtractorAndroid.desktop"
rm -f "$HOME/Desktop/ExtractorAndroid.desktop"
rm -f "$(dirname "${BASH_SOURCE[0]}")/ExtractorAndroid.desktop"
rm -f "$(dirname "${BASH_SOURCE[0]}")/.server.pid"

./stop.sh 2>/dev/null || true

echo "✓ Accesos directos eliminados y procesos detenidos."
