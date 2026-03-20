#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-4173}"

echo "Serving Latex Online at http://127.0.0.1:${PORT}/"
exec python3 -m http.server "${PORT}"
