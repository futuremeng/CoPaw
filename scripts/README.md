# Scripts

Run from **repo root**.

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

# Run local Cognee chat-closure smoke test
python scripts/run_tests.py --smoke-cognee

# Run smoke test with graph-only retrieval mode
python scripts/run_tests.py --smoke-cognee --smoke-search-mode graph

# Run all tests and generate a coverage report
python scripts/run_tests.py -a -c

# Run tests in parallel (requires pytest-xdist)
python scripts/run_tests.py -p

# Show help
python scripts/run_tests.py -h
```

## Cognee chat closure smoke test

Use this script for a local manual check of the Cognee-backed conversation closure:

```bash
python scripts/cognee_chat_smoke.py
```

Optional flags:

```bash
python scripts/cognee_chat_smoke.py --search-mode graph
python scripts/cognee_chat_smoke.py --query "What did we index?"
python scripts/cognee_chat_smoke.py --keep-artifacts
```

Notes:

- Requires `cognee` installed in your active Python environment.
- This smoke test indexes one text source, searches it, then renders chat-style knowledge context text.