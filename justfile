# K8s Compass

default:
    @just --list

# ── Web ──────────────────────────────────────────────────────────────────────

# Run bun commands in packages/web (e.g., just web dev, just web build)
web *ARGS:
    cd packages/web && bun run {{ARGS}}

# ── Pipeline ─────────────────────────────────────────────────────────────────

# Run k8s pipeline commands (e.g., just k8s-pipeline process-release 1.35)
k8s-pipeline *ARGS:
    cd pipeline && uv run k8s-pipeline {{ARGS}}
