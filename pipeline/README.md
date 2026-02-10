# K8s API Pipeline

Fetches Kubernetes OpenAPI specs and generates JSON/Parquet data for the web app.

## Quick Start

```bash
cd pipeline

# Launch the interactive TUI (recommended)
uv run k8s-pipeline tui

# Or use CLI commands directly:

# Process a single release (all steps including LLM enrichment)
uv run k8s-pipeline release process 1.35

# Process without LLM enrichment (faster, no API costs)
uv run k8s-pipeline release process 1.35 --no-enrich
```

## Interactive TUI

The TUI provides a visual interface for managing the pipeline:

```bash
uv run k8s-pipeline tui
# or
uv run k8s-tui
```

Features:
- **Status panel** - See staged data, built releases, and Parquet files at a glance
- **Version selector** - Click to select which K8s version to process
- **Tabbed commands** - Stage, Build, Enrich, Export, and Repos tabs
- **Live output** - Watch command output in real-time
- **Quick actions** - One-click "Process" and "Export" buttons
- **Options** - Toggle force rebuild, with-PRs, skip-enrich

Keyboard shortcuts:
- `q` - Quit
- `r` - Refresh status
- `c` - Clear log
- `1-5` - Switch tabs (Stage, Build, Enrich, Export, Repos)
- `Escape` - Cancel running command

## CLI Structure

The CLI uses a nested subcommand structure:

```
k8s-pipeline <group> <command> [options]
```

### Command Groups

| Group | Description |
|-------|-------------|
| `release` | Release processing (stage, build, enrich) |
| `kep` | KEP feature extraction and enrichment |
| `openapi` | OpenAPI spec fetching and diffing |
| `component` | Component flags, kubectl, feature gates |
| `content` | External content management |
| `repo` | Upstream repository management |
| `export` | Parquet export and documentation |
| `util` | Utility commands |

### Common Commands

```bash
cd pipeline

# Release processing
uv run k8s-pipeline release process 1.35        # Full pipeline
uv run k8s-pipeline release process 1.35 --no-enrich  # Skip LLM
uv run k8s-pipeline release stage 1.35          # Stage upstream data
uv run k8s-pipeline release build 1.35          # Build release JSON
uv run k8s-pipeline release enrich-changes 1.35 # Enrich changelog

# OpenAPI
uv run k8s-pipeline openapi fetch --all         # Fetch all versions
uv run k8s-pipeline openapi fetch 1.35          # Single version
uv run k8s-pipeline openapi diff --all          # Generate diffs

# KEP
uv run k8s-pipeline kep build 1.35              # Extract KEP features
uv run k8s-pipeline kep enrich 1.35             # Enrich with LLM
uv run k8s-pipeline kep link 1.35               # Link fields to KEPs

# Components
uv run k8s-pipeline component flags 1.35        # Extract CLI flags
uv run k8s-pipeline component kubectl 1.35      # Extract kubectl commands
uv run k8s-pipeline component gates 1.35        # Extract feature gates

# Content
uv run k8s-pipeline content fetch-sched --list  # List conferences
uv run k8s-pipeline content fetch-sched kubecon-na-2024  # Import sessions
uv run k8s-pipeline content list                # List all content

# Export
uv run k8s-pipeline export parquet              # Export to Parquet
uv run k8s-pipeline export docs                 # Generate schema docs

# Repos
uv run k8s-pipeline repo sync kubernetes enhancements website
uv run k8s-pipeline repo list

# Utilities
uv run k8s-pipeline release versions           # List K8s versions
uv run k8s-pipeline util clear-cache           # Clear cache

# Run tests
uv run pytest                                   # Run all tests
uv run pytest -v                                # Verbose output

# Linting and formatting (ruff)
uv run --extra dev ruff check src/ tests/       # Check for lint errors
uv run --extra dev ruff check --fix src/ tests/ # Auto-fix errors
uv run --extra dev ruff format src/ tests/      # Format code
```

## LLM Configuration

LLM enrichment commands read configuration from `pipeline/llm_config.yaml`:

```yaml
# Active provider (change this to switch)
provider: bedrock

# Amazon Bedrock (default)
bedrock:
  model_id: us.amazon.nova-2-lite-v1:0
  max_tokens: 4096

# Anthropic API (requires ANTHROPIC_API_KEY)
anthropic:
  model_id: claude-sonnet-4-20250514
  max_tokens: 4096

# Ollama (local models)
ollama:
  host: http://localhost:11434
  model_id: llama3.2
```

## Files

| File | Purpose |
|------|---------|
| `cli/__init__.py` | CLI entry point with subcommand registration |
| `cli/release.py` | Release commands (process, stage, build, enrich) |
| `cli/kep.py` | KEP commands (build, enrich, link) |
| `cli/openapi.py` | OpenAPI commands (fetch, diff, info) |
| `cli/component.py` | Component commands (flags, kubectl, gates) |
| `cli/content.py` | Content commands (add, list, fetch-sched) |
| `cli/repo.py` | Repository commands (sync, list, checkout) |
| `cli/export.py` | Export commands (parquet, docs, benchmark) |
| `cli/util.py` | Utility commands (versions, clear-cache) |
| `tui/app.py` | Interactive TUI application |
| `core/config.py` | Versions, colors, URLs, constants |
| `core/models.py` | Pydantic data models |
| `input/upstream_stager.py` | Stage release-notes + CHANGELOG from upstream |
| `input/repo_manager.py` | Manage kubernetes repo checkout |
| `input/github_fetcher.py` | GitHub API for PR/Issue fetching |
| `transform/openapi/tree_parser.py` | OpenAPI → APITree (groups, kinds, relationships) |
| `transform/openapi/field_parser.py` | OpenAPI → detailed field schemas |
| `transform/openapi/schema_differ.py` | Compute version diffs and field history |
| `transform/openapi/go_enum_extractor.py` | Go source → enum values and defaults |
| `transform/release/changelog_parser.py` | Parse CHANGELOG markdown files |
| `transform/release/builder.py` | Build release JSON from staged data |
| `transform/release/change_enricher.py` | LLM enrichment of changelog entries |
| `transform/release/release_notes_enricher.py` | LLM enrichment of release notes |
| `transform/kep/parser.py` | Extract KEP features from enhancements repo |
| `transform/kep/field_linker.py` | Link new fields to KEPs |
| `transform/kep/enricher.py` | LLM enrichment of KEP features |
| `transform/kep/metadata_extractor.py` | Extract metadata from all KEPs |
| `transform/kep/label_normalizer.py` | Normalize KEP labels |
| `transform/components/component_extractor.py` | Extract component CLI flags |
| `transform/components/kubectl_extractor.py` | Extract kubectl commands |
| `transform/components/feature_gate_extractor.py` | Extract feature gates |
| `transform/content/content_links.py` | Manage external content links |
| `transform/content/conference_ingest.py` | Conference talk ingestion |
| `transform/content/sched_fetcher.py` | Fetch sessions from Sched.com |
| `transform/content/youtube_fetcher.py` | Fetch videos from YouTube |
| `transform/providers/provider_versions.py` | Cloud provider version tracking |
| `output/json_writer.py` | Write JSON output files |
| `output/parquet/schemas.py` | PyArrow schema definitions |
| `output/parquet/pyarrow.py` | PyArrow-based Parquet export (default) |
| `output/parquet/duckdb.py` | DuckDB-based Parquet export (alternative) |

## Enum Values and Defaults Extraction

The pipeline extracts enum values and default values from multiple sources:

### Enum Values

1. **OpenAPI spec** - Some fields have explicit `enum` arrays
2. **Go source code** - For fields without OpenAPI enums, we parse the kubernetes repo:
   - Uses tree-sitter for proper Go AST parsing
   - Finds types marked with `// +enum` comment
   - Extracts const values for those types
   - Maps struct fields to their enum types via JSON tags
   - Handles disambiguation when same field name exists in different structs (e.g., `DeploymentStrategy.type` vs `DaemonSetUpdateStrategy.type`)

### Default Values

1. **OpenAPI spec** - Some fields have explicit `default` values
2. **Description parsing** - Extracts defaults from description text patterns:
   - "Default is X"
   - "Defaults to X"
   - "The default value is X"
   - "If not specified, defaults to X"

### Example

For `Deployment.spec.strategy.type`:
- **Enum values**: `['Recreate', 'RollingUpdate']` (from Go source `DeploymentStrategyType`)
- **Default**: `RollingUpdate` (from description "Default is RollingUpdate")

## Output

JSON files → `packages/web/public/data/k8s/`  
Parquet files → `packages/web/public/data/parquet/`
