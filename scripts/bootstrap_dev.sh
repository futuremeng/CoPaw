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
BOOTSTRAP_MAIN=1
BOOTSTRAP_SIDECAR=1
SIDECAR_PYTHON_VERSION="${COPAW_HANLP_SIDECAR_PYTHON_VERSION:-3.10}"

usage() {
    cat <<'EOF'
Bootstrap CoPaw development environment in the current repository.

Usage:
    bash scripts/bootstrap_dev.sh [--extras dev] [--recreate] [--with-sidecar|--sidecar-only|--main-only]

Options:
  --extras <LIST>   Editable install extras, comma-separated. Default: dev
  --recreate        Remove any existing .venv and rebuild it from scratch
    --with-sidecar    Bootstrap and verify HanLP sidecar in addition to main env (default behavior)
    --sidecar-only    Bootstrap and verify sidecar only (skip main env)
    --main-only       Bootstrap and verify main env only
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
        --with-sidecar)
            BOOTSTRAP_SIDECAR=1
            shift
            ;;
        --sidecar-only)
            BOOTSTRAP_MAIN=0
            BOOTSTRAP_SIDECAR=1
            shift
            ;;
        --main-only)
            BOOTSTRAP_MAIN=1
            BOOTSTRAP_SIDECAR=0
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

resolve_sidecar_python() {
    if [[ -n "${COPAW_NLP_PYTHON_EXECUTABLE:-}" ]]; then
        printf '%s\n' "$COPAW_NLP_PYTHON_EXECUTABLE"
        return
    fi
    if [[ -n "${COPAW_HANLP_SIDECAR_PYTHON:-}" ]]; then
        printf '%s\n' "$COPAW_HANLP_SIDECAR_PYTHON"
        return
    fi
    printf '%s\n' "$ROOT_DIR/.venv-hanlp/bin/python"
}

is_truthy() {
    local value="${1:-}"
    value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

ensure_runtime_compatibility() {
    local venv_python="$1"
    local runtime_label="$2"

    if "$venv_python" - <<'PY' > /dev/null 2>&1
from typing_extensions import Sentinel
from google.protobuf import runtime_version  # noqa: F401
print(Sentinel.__name__)
PY
    then
        info "$runtime_label compatibility already satisfied."
        return
    fi

    info "Repairing $runtime_label compatibility..."
    uv pip install --python "$venv_python" --no-deps \
        "typing-extensions>=4.15.0" \
        "protobuf>=6.33.6" \
        --index-url "$PYPI_MIRROR"
    "$venv_python" - <<'PY'
from typing_extensions import Sentinel
from google.protobuf import runtime_version  # noqa: F401
print(Sentinel.__name__)
PY
}

bootstrap_main_env() {
    local extras_suffix=""

    if [[ $RECREATE -eq 1 && -d "$VENV_DIR" ]]; then
        rm -rf "$VENV_DIR"
    fi

    if [[ -d "$VENV_DIR" ]]; then
        info "Existing development environment found, upgrading..."
    else
        info "Creating development environment (Python $PYTHON_VERSION)..."
    fi

    uv venv "$VENV_DIR" --python "$PYTHON_VERSION" --quiet --clear

    if [[ ! -x "$VENV_DIR/bin/python" ]]; then
        die "Failed to create development virtual environment"
    fi

    if [[ -n "$EXTRAS" ]]; then
        extras_suffix="[$EXTRAS]"
    fi

    info "Using $("$VENV_DIR/bin/python" --version 2>&1)"
    info "Installing editable package with extras: ${EXTRAS:-none}"
    uv pip install --python "$VENV_DIR/bin/python" -e "$ROOT_DIR$extras_suffix" --index-url "$PYPI_MIRROR"
    ensure_runtime_compatibility "$VENV_DIR/bin/python" "Main runtime"
}

verify_hanlp_sidecar() {
    local sidecar_python="$1"
    "$sidecar_python" - <<'PY'
import hanlp  # noqa: F401
print("hanlp sidecar ready")
PY
}

bootstrap_hanlp_sidecar() {
    local sidecar_python
    local sidecar_dir
    local sidecar_mm

    sidecar_python="$(resolve_sidecar_python)"

    if [[ "$sidecar_python" == */bin/python ]]; then
        sidecar_dir="${sidecar_python%/bin/python}"
        if [[ -z "$sidecar_dir" ]]; then
            die "Unable to derive sidecar directory from interpreter path: $sidecar_python"
        fi
    else
        die "Sidecar python path must point to a venv interpreter ending with /bin/python: $sidecar_python"
    fi

    if [[ $RECREATE -eq 1 && -d "$sidecar_dir" ]]; then
        rm -rf "$sidecar_dir"
    fi

    if [[ ! -x "$sidecar_python" ]]; then
        info "Creating HanLP sidecar environment at $sidecar_dir (Python $SIDECAR_PYTHON_VERSION)..."
        uv venv "$sidecar_dir" --python "$SIDECAR_PYTHON_VERSION" --quiet --clear
    else
        info "Using existing HanLP sidecar interpreter: $sidecar_python"
    fi

    sidecar_mm="$("$sidecar_python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
    if [[ "$sidecar_mm" != "3.10" ]]; then
        warn "HanLP sidecar is running Python $sidecar_mm (3.10 recommended)."
    fi

    info "Installing HanLP full runtime into sidecar..."
    uv pip install --python "$sidecar_python" "hanlp[full]" --index-url "$PYPI_MIRROR"
    verify_hanlp_sidecar "$sidecar_python"
    ensure_runtime_compatibility "$sidecar_python" "Sidecar runtime"

    if [[ -n "${COPAW_HANLP_HOME:-}" ]]; then
        mkdir -p "$COPAW_HANLP_HOME"
        info "Using HanLP cache directory: $COPAW_HANLP_HOME"
    fi

    info "HanLP sidecar ready: $sidecar_python"
    info "Export for runtime: COPAW_HANLP_SIDECAR_ENABLED=1"
    info "Export for runtime: COPAW_HANLP_SIDECAR_PYTHON=$sidecar_python"
}

ensure_uv

if [[ $BOOTSTRAP_MAIN -eq 1 ]]; then
    bootstrap_main_env
fi

if [[ $BOOTSTRAP_SIDECAR -eq 1 ]]; then
    bootstrap_hanlp_sidecar
fi

echo
printf "${GREEN}${BOLD}Bootstrap complete.${RESET}\n"
if [[ $BOOTSTRAP_MAIN -eq 1 ]]; then
    echo "Main env activate with: source .venv/bin/activate"
fi
echo
echo "Bootstrap summary:"
if [[ $BOOTSTRAP_MAIN -eq 1 ]]; then
    echo "  - Main runtime initialized and compatibility-verified."
fi
if [[ $BOOTSTRAP_SIDECAR -eq 1 ]]; then
    echo "  - HanLP sidecar initialized and verified."
else
    echo "  - HanLP sidecar not initialized in this run (use --with-sidecar or --sidecar-only)."
fi
echo "  - Optional cache path: export COPAW_HANLP_HOME=~/.hanlp"
