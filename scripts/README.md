# Scripts

Run from **repo root**.

## Bootstrap local dev environment

```bash
bash scripts/bootstrap_dev.sh
```

- Creates or repairs `.venv` in the repo root using a supported Python version.
- Installs the project in editable mode with `.[dev]` by default.
- Pass `--extras dev,full` to include the full optional dependency set.
- Pass `--recreate` to force rebuilding `.venv` from scratch.

## One-click source rebuild and start

```bash
bash scripts/source_one_click_start.sh
```

- Performs end-to-end source-mode startup in one command:
	- Stops the existing process on target port (graceful shutdown, then force kill on timeout)
	- Runs `git pull --ff-only`
	- Creates/activates `.venv`
	- Installs editable Python dependencies
	- Builds `console/` frontend and copies assets to `src/copaw/console`
	- Starts `copaw app --host 0.0.0.0 --port 8088`
- Useful options:
	- `--port 3000` to change service port
	- `--skip-pull` to skip Git update
	- `--no-stop` to skip automatic process stopping
	- `--stop-wait 30` to change graceful-stop timeout
	- `--no-shortcut` to skip shortcut injection

Shortcut commands installed by default:

```bash
copaw-rebuild
```

- Adds `copaw-rebuild` into `~/.local/bin`.
- Injects shell bridge for:

```bash
copaw rebuild
```

- Reload shell once after first install to apply bridge and PATH changes:
	- zsh: `source ~/.zshrc`
	- bash: `source ~/.bashrc`

## Build wheel (with latest console)

```bash
bash scripts/wheel_build.sh
```

- Builds the console frontend (`console/`), copies `console/dist` to `src/copaw/console/dist`, then builds the wheel. Output: `dist/*.whl`.

## Build website

```bash
bash scripts/website_build.sh
```

- Installs dependencies (pnpm or npm) and runs the Vite build. Output: `website/dist/`.

## Build Docker image

```bash
bash scripts/docker_build.sh [IMAGE_TAG] [EXTRA_ARGS...]
```

- Default tag: `copaw:latest`. Uses `deploy/Dockerfile` (multi-stage: builds console then Python app).
- Example: `bash scripts/docker_build.sh myreg/copaw:v1 --no-cache`.

## Local merge gate

```bash
bash scripts/local-gate.sh
```

- Runs a minimal local quality gate for merge-risk regressions.
- Includes: sync status check, console build, backend smoke checks, knowledge route check, and i18n missing-key audit.
- Exits with non-zero status on first failure.
- Run full backend unit tests in strict mode:

```bash
LOCAL_GATE_STRICT=1 bash scripts/local-gate.sh
```

## Run Test

```bash
# Run all tests
python scripts/run_tests.py

# Run all unit tests
python scripts/run_tests.py -u

# Run unit tests for a specific module
python scripts/run_tests.py -u providers

# Run integration tests
python scripts/run_tests.py -i

# Run all tests and generate a coverage report
python scripts/run_tests.py -a -c

# Run tests in parallel (requires pytest-xdist)
python scripts/run_tests.py -p

# Show help
python scripts/run_tests.py -h
```

## Multibook 24h reproducibility

Trigger one project pipeline run and optionally wait until it reaches a terminal status:

```bash
python scripts/run_multibook_repro.py \
	--agent-id <agent_id> \
	--project-id <project_id> \
	--template-id books-alignment-v1 \
	--parameters '{"goal":"multibook-24h-repro"}' \
	--wait
```

Validate run outputs against the reproducibility checklist:

```bash
python scripts/verify_multibook_repro.py \
	--run-detail logs/multibook-run-<run_id>-<timestamp>.json \
	--project-dir <absolute_project_dir> \
	--strict-status \
	--min-depth 8 \
	--require-pairwise-count 6
```

Notes:

- If `--run-detail` is not provided, `verify_multibook_repro.py` can fetch details from API via `--agent-id --project-id --run-id`.
- Set `COPAW_API_TOKEN` when your API requires bearer auth.