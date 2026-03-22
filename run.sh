#!/usr/bin/env bash

set -euo pipefail

PORT="${1:-4173}"
PYTHON_BIN="./.venv/bin/python"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  PYTHON_BIN="python3"
fi

exec "${PYTHON_BIN}" ./server.py "${PORT}"
