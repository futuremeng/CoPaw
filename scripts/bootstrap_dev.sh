#!/usr/bin/env bash
set -euo pipefail

if [ -t 1 ]; then
    BOLD="\033[1m"
    GREEN="\033[0;32m"
    YELLOW="\033[0;33m"
    RED="\033[0;31m"
    RESET="\033[0m"
else
    BOLD="" GREEN="" YELLOW="" RED="" RESET=""
fi

info()  { printf "${GREEN}[copaw]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[copaw]${RESET} %s\n" "$*"; }
error() { printf "${RED}[copaw]${RESET} %s\n" "$*" >&2; }
die()   { error "$@"; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_VERSION_FILE="$ROOT_DIR/.python-version"
EXTRAS="dev"
RECREATE=0
PYTHON_VERSION="3.10"

usage() {
    cat <<'EOF'
Bootstrap CoPaw development environment in the current repository.

Usage:
  bash scripts/bootstrap_dev.sh [--extras dev] [--recreate]

Options:
  --extras <LIST>   Editable install extras, comma-separated. Default: dev
  --recreate        Remove any existing .venv and rebuild it from scratch
  -h, --help        Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --extras)
            EXTRAS="$2"
            shift 2
            ;;
        --recreate)
            RECREATE=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ -f "$PYTHON_VERSION_FILE" ]]; then
    PYTHON_VERSION="$(tr -d '[:space:]' < "$PYTHON_VERSION_FILE")"
fi

export UV_VENV_CLEAR=1

choose_pypi_mirror() {
    if curl -fsSL --connect-timeout 3 --max-time 5 https://pypi.org/simple/ > /dev/null 2>&1; then
        echo "https://pypi.org/simple/"
    else
        echo "https://mirrors.aliyun.com/pypi/simple/"
    fi
}

PYPI_MIRROR=$(choose_pypi_mirror)

ensure_uv() {
    if command -v uv &>/dev/null; then
        info "uv found: $(command -v uv)"
        return
    fi

    for candidate in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
        if [ -x "$candidate" ]; then
            export PATH="$(dirname "$candidate"):$PATH"
            info "uv found: $candidate"
            return
        fi
    done

    info "Installing uv..."
    curl --proto '=https' --tlsv1.2 -LsSf https://releases.astral.sh/github/uv/releases/download/0.11.8/uv-installer.sh | sh

    if [ -f "$HOME/.local/bin/env" ]; then
        # shellcheck disable=SC1091
        . "$HOME/.local/bin/env"
    fi
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

    command -v uv &>/dev/null || die "Failed to install uv. Please install it manually: https://docs.astral.sh/uv/"
    info "uv installed successfully"
}

venv_python_version() {
    "$VENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'
}

repair_qwenpaw_runtime_after_hanlp() {
    local venv_python="$VENV_DIR/bin/python"

    info "Restoring QwenPaw runtime compatibility after HanLP install..."
    uv pip install --python "$venv_python" --no-deps \
        "typing-extensions>=4.15.0" \
        "protobuf>=6.33.6" \
        --index-url "$PYPI_MIRROR"
    "$venv_python" - <<'PY'
from typing_extensions import Sentinel
import hanlp  # noqa: F401
import pydantic  # noqa: F401
from google.protobuf import runtime_version  # noqa: F401
print(Sentinel.__name__)
PY
}

install_hanlp_runtime() {
    local venv_python="$VENV_DIR/bin/python"
    local python_mm

    python_mm="$(venv_python_version)"
    if [[ "$python_mm" == "3.10" ]]; then
        info "Installing HanLP full runtime into development environment..."
        uv pip install --python "$venv_python" "hanlp[full]" --index-url "$PYPI_MIRROR"
        repair_qwenpaw_runtime_after_hanlp
        if [[ -n "${COPAW_HANLP_HOME:-}" ]]; then
            mkdir -p "$COPAW_HANLP_HOME"
            info "Using HanLP cache directory: $COPAW_HANLP_HOME"
        fi
        return
    fi

    warn "Skipping direct HanLP install because .venv is Python $python_mm, not 3.10."
    warn "Use a Python 3.10 dev environment for direct install, or configure a HanLP sidecar instead."
}

if [[ $RECREATE -eq 1 && -d "$VENV_DIR" ]]; then
    rm -rf "$VENV_DIR"
fi

ensure_uv

if [[ -d "$VENV_DIR" ]]; then
    info "Existing development environment found, upgrading..."
else
    info "Creating development environment (Python $PYTHON_VERSION)..."
fi

uv venv "$VENV_DIR" --python "$PYTHON_VERSION" --quiet --clear

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    die "Failed to create development virtual environment"
fi

EXTRAS_SUFFIX=""
if [[ -n "$EXTRAS" ]]; then
    EXTRAS_SUFFIX="[$EXTRAS]"
fi

info "Using $("$VENV_DIR/bin/python" --version 2>&1)"
info "Installing editable package with extras: ${EXTRAS:-none}"
uv pip install --python "$VENV_DIR/bin/python" -e "$ROOT_DIR$EXTRAS_SUFFIX" --index-url "$PYPI_MIRROR"
install_hanlp_runtime

echo
printf "${GREEN}${BOLD}Bootstrap complete.${RESET}\n"
echo "Activate with: source .venv/bin/activate"
echo
echo "HanLP status:"
if [[ "$(venv_python_version)" == "3.10" ]]; then
    echo "  - hanlp[full] has been installed into this .venv."
else
    echo "  - Direct install was skipped because this .venv is not Python 3.10."
fi
echo "  - Sidecar remains optional for strict dependency isolation."
echo "  - Optional cache path: export COPAW_HANLP_HOME=~/.hanlp"
