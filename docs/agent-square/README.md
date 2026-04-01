# Agent Square Bundle Import Notes

This folder documents the minimal import strategy for agent exchange bundles.

## Scope Decision

Current import behavior is intentionally split into two stages:

1. Import stage (default in Agent Square)
- Import agent identity and AGENTS content.
- Optionally import skills and builtin tool activation.
- Import workflows as flow description artifacts under project artifacts.
- Do not auto-convert workflow descriptions into CoPaw pipeline templates.

2. Upgrade stage (explicit, future or manual)
- If a flow description should become a runnable pipeline,
  perform a dedicated conversion and validation flow.
- Pipeline conversion is not part of the one-click import.

## Why This Split

CoPaw pipeline is strongly constrained (step contract, dependency validation,
run orchestration). Many upstream workflows are descriptive and not guaranteed to
meet pipeline constraints. Forcing conversion at import time increases failure
risk and complexity.

## Bundle Import Toggles

In bundle payload, use import toggles to selectively enable resource import:

- skills: true or false
- tools: true or false
- flow_descriptions: true or false

See gitagent-index-example.json for a complete example.
