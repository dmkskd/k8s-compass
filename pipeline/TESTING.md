# Pipeline Testing

## Quick Start

```bash
cd pipeline

# Quick smoke test (no network, ~10 seconds)
./scripts/test-pipeline.sh --quick

# Full integration test (requires network)
./scripts/test-pipeline.sh --full

# Full test without LLM calls
./scripts/test-pipeline.sh --full --no-llm

# Full test without API keys
./scripts/test-pipeline.sh --full --no-api
```

## Test Script Options

| Option | Description |
|--------|-------------|
| `--quick` | Quick smoke test - unit tests + read-only commands (default) |
| `--full` | Full integration test - includes network and pipeline runs |
| `--no-llm` | Skip LLM-dependent tests (faster, no API costs) |
| `--no-api` | Skip tests requiring API keys (YOUTUBE_API_KEY, etc.) |

## What Gets Tested

### Quick Mode (`--quick`)
- Unit tests (pytest)
- Read-only commands: `release versions`, `repo list`, `release status`, `content list`, `kep list-labels`

### Full Mode (`--full`)

| Phase | Tests | Dependencies |
|-------|-------|--------------|
| 0. Unit Tests | pytest | None |
| 1. Read-only | util versions, repo list, etc. | None |
| 2. Network | content fetch-sched (dry-run) | Internet |
| 3. Core Pipeline | release process 1.35 | Internet, cached data |
| 4. LLM | util suggest-labels | LLM provider |
| 5. API Keys | content fetch-youtube | YOUTUBE_API_KEY |
| 6. Export | export parquet, export docs | None |

## Manual Testing

For commands not covered by the script:

```bash
# One-off KEP metadata extraction (expensive)
uv run k8s-pipeline kep extract-metadata --max 5

# Taxonomy building
uv run k8s-pipeline kep build-taxonomy --method clustering

# Model comparison
uv run k8s-pipeline kep compare-models 1.35 qwen3:8b qwen3:32b --max 2

# Label suggestions
uv run k8s-pipeline kep suggest-labels KEP-1287 --method hybrid

# Version comparisons (read-only)
uv run k8s-pipeline component compare-flags 1.34 1.35
uv run k8s-pipeline component compare-kubectl 1.34 1.35
uv run k8s-pipeline component compare-gates 1.34 1.35
```

## Environment Variables

| Variable | Required For | Default |
|----------|--------------|---------|
| `GITHUB_TOKEN` | Higher rate limits for PR fetching | Anonymous (60/hr) |
| `YOUTUBE_API_KEY` | content fetch-youtube command | None |
| LLM config | release enrich-*, kep enrich, kep suggest-labels --method llm | See llm_config.yaml |

## Troubleshooting

### "No staged data for version X"
```bash
uv run k8s-pipeline release stage 1.35
```

### "Repo not found"
```bash
uv run k8s-pipeline repo sync kubernetes enhancements website
```

### LLM errors
Check `llm_config.yaml` and ensure your provider is configured correctly.

## CLI Command Reference

The new CLI uses nested subcommands:

```bash
# Old (legacy)                          # New
k8s-pipeline process-release 1.35       k8s-pipeline release process 1.35
k8s-pipeline stage-release 1.35         k8s-pipeline release stage 1.35
k8s-pipeline build-release 1.35         k8s-pipeline release build 1.35
k8s-pipeline enrich-changes 1.35        k8s-pipeline release enrich-changes 1.35
k8s-pipeline enrich-release-notes 1.35  k8s-pipeline release enrich-notes 1.35
k8s-pipeline fetch 1.35                 k8s-pipeline openapi fetch 1.35
k8s-pipeline diff --all                 k8s-pipeline openapi diff --all
k8s-pipeline build-features 1.35        k8s-pipeline kep build 1.35
k8s-pipeline enrich-features 1.35       k8s-pipeline kep enrich 1.35
k8s-pipeline link-keps 1.35             k8s-pipeline kep link 1.35
k8s-pipeline extract-component-flags    k8s-pipeline component flags 1.35
k8s-pipeline extract-kubectl 1.35       k8s-pipeline component kubectl 1.35
k8s-pipeline extract-feature-gates      k8s-pipeline component gates 1.35
k8s-pipeline export-parquet             k8s-pipeline export parquet
k8s-pipeline schema-docs                k8s-pipeline export docs
k8s-pipeline sync-repos                 k8s-pipeline repo sync
k8s-pipeline list-repos                 k8s-pipeline repo list
k8s-pipeline list-versions              k8s-pipeline release versions
k8s-pipeline clear                      k8s-pipeline util clear-cache
k8s-pipeline suggest-labels             k8s-pipeline kep suggest-labels
k8s-pipeline build-taxonomy             k8s-pipeline kep build-taxonomy
k8s-pipeline compare-models             k8s-pipeline kep compare-models
k8s-pipeline fetch-prs                  k8s-pipeline release fetch-prs
k8s-pipeline providers                  k8s-pipeline release providers
```
