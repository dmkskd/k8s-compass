# Pipeline Guide

## Overview

Python pipeline using `uv` for package management. Fetches Kubernetes data from upstream sources and generates Parquet files for DuckDB WASM.

**IMPORTANT**: DuckDB/Parquet is the single source of truth. JSON files are intermediate build artifacts.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UPSTREAM SOURCES                                  │
├─────────────────────┬─────────────────────┬─────────────────┬───────────────┤
│ cdn.dl.k8s.io       │ kubernetes/CHANGELOG│ kubernetes/     │ kubernetes/   │
│ release-notes.json  │ CHANGELOG-X.YY.md   │ enhancements    │ api/openapi   │
└─────────┬───────────┴──────────┬──────────┴────────┬────────┴───────┬───────┘
          │                      │                   │                │
          ▼                      ▼                   │                │
┌─────────────────────────────────────────┐         │                │
│              STAGE                       │         │                │
│  upstream_stager.py                      │         │                │
│  → pipeline/data/upstream/k8s/releases/  │         │                │
│    ├── release-notes/{version}.json      │         │                │
│    └── changelogs/CHANGELOG-{version}.md │         │                │
└─────────┬───────────────────────┬────────┘         │                │
          │                       │                  │                │
          ▼                       ▼                  ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TRANSFORM                                       │
│  + pipeline/data/curated/ (manual enrichments, content links)               │
├─────────────────────┬─────────────────────┬─────────────────────────────────┤
│ release_builder.py  │ changelog_parser.py │ kep_parser.py                   │
│ Build release JSON  │ Parse CHANGELOG     │ Extract KEP features            │
├─────────────────────┴─────────────────────┴─────────────────────────────────┤
│ openapi_tree_parser │ openapi_field_parser│ schema_differ│ kep_field_linker │
│ OpenAPI → APITree   │ Field schemas       │ Version diffs│ Link fields→KEPs │
└─────────┬───────────┴──────────┬──────────┴───────┬──────┴────────┬─────────┘
          │                      │                  │               │
          ▼                      ▼                  ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         JSON OUTPUT (intermediate)                           │
│  packages/web/public/data/k8s/                                              │
│  ├── releases/{version}.json      ├── api-trees/{version}.json              │
│  ├── schemas/{version}.json       ├── diffs/{from}-{to}.json                │
│  └── field-kep-links/{version}.json                                         │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PARQUET EXPORT                                       │
│  parquet/pyarrow.py → packages/web/public/data/parquet/*.parquet            │
│  (versions, kinds, features, kinds_relationships, diffs, content_links, etc.)│
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                             │
│  DuckDB WASM  →  React UI                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```


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

## Running the Pipeline

### Quick Start: `release process`

For most use cases, use the all-in-one command:

```bash
cd pipeline

# Full processing with LLM enrichment (default)
# This automatically pulls the latest from upstream repos
uv run k8s-pipeline release process 1.35

# Skip LLM enrichment (faster, no API costs)
uv run k8s-pipeline release process 1.35 --no-enrich

# Re-process without re-staging or syncing repos
uv run k8s-pipeline release process 1.35 --skip-stage --skip-sync --force

# Quick rebuild (skip all network operations)
uv run k8s-pipeline release process 1.35 --skip-stage --skip-fetch --skip-sync --force
```

This runs all steps: sync-repos → stage → build (with PRs) → enrich-features → enrich-changes → enrich-release-notes → fetch → diff → link-keps → extract-components → extract-kubectl → extract-feature-gates → export-parquet

**Note:** The `release process` command automatically pulls the latest from upstream repos (kubernetes, enhancements, website) before processing. Use `--skip-sync` to skip this if you know the repos are already up to date.

### Individual Commands

For more control, run steps individually:

```bash
cd pipeline

# 1. Stage upstream data (release-notes.json + CHANGELOGs)
uv run k8s-pipeline release stage 1.35
uv run k8s-pipeline release stage --all
uv run k8s-pipeline release status

# 2. Build release JSON from staged data (auto-extracts KEP features)
uv run k8s-pipeline release build 1.35
uv run k8s-pipeline release build 1.35 --with-prs  # For production builds
uv run k8s-pipeline release build --all

# 3. Enrich KEP features with LLM (optional)
uv run k8s-pipeline kep enrich 1.35

# 4. Enrich changelog entries with LLM (optional, requires --with-prs)
uv run k8s-pipeline release enrich-changes 1.35

# 5. Enrich release notes with LLM (optional)
uv run k8s-pipeline release enrich-notes 1.35

# 6. Fetch/parse OpenAPI specs
uv run k8s-pipeline openapi fetch 1.35
uv run k8s-pipeline openapi fetch --all

# 7. Generate diffs between versions
uv run k8s-pipeline openapi diff --all

# 8. Link fields to KEPs (optional, for field-KEP associations)
uv run k8s-pipeline kep link 1.35
uv run k8s-pipeline kep link --all

# 9. Extract component flags (kube-apiserver, kubelet, etc.)
uv run k8s-pipeline component flags 1.35

# 10. Extract kubectl commands
uv run k8s-pipeline component kubectl 1.35
uv run k8s-pipeline component kubectl --all

# 11. Extract feature gates
uv run k8s-pipeline component gates 1.35
uv run k8s-pipeline component gates --all

# 12. Export to Parquet (REQUIRED for UI)
uv run k8s-pipeline export parquet

# 13. Generate schema documentation (optional)
uv run k8s-pipeline export docs

# 14. Generate TypeScript types (optional, for frontend type safety)
uv run k8s-pipeline export types

# 15. Export all (parquet + docs + types)
uv run k8s-pipeline export all

# 16. Benchmark different formats (optional, for experimentation)
uv run k8s-pipeline export benchmark
uv run k8s-pipeline export benchmark --lance --vortex  # Include experimental formats

# Clear cache
uv run k8s-pipeline util clear-cache
```


### The `--all` Flag

Most commands accept either a specific version or `--all`:

| Command | Single Version | All Versions |
|---------|---------------|--------------|
| `release stage` | `release stage 1.35` | `release stage --all` |
| `release build` | `release build 1.35` | `release build --all` |
| `openapi fetch` | `openapi fetch 1.35` | `openapi fetch --all` |
| `openapi diff` | N/A (always needs pairs) | `openapi diff --all` |
| `kep link` | `kep link 1.35` | `kep link --all` |

`--all` processes all versions defined in `core/config.py` (currently 1.25 through 1.35).

For `openapi diff` and `kep link`, `--all` processes consecutive version pairs (1.25→1.26, 1.26→1.27, etc.).

## Step-by-Step: What Each Command Produces

### 1. `release stage VERSION`

**Input:** Upstream K8s CDN + kubernetes repo
**Output:** `pipeline/data/upstream/k8s/releases/`

Downloads raw data from upstream sources:
- `release-notes/{version}.0.json` - Raw PR/change data from cdn.dl.k8s.io
- `changelogs/CHANGELOG-{version}.md` - From kubernetes/CHANGELOG repo

This is a pure download step - no transformation.

### 2. `release build VERSION [--with-prs]`

**Input:** Staged data + enhancements repo + curated data
**Output:** `packages/web/public/data/k8s/releases/{version}.json`

Combines multiple sources into a single release JSON:
- Parses `release-notes.json` → `changesByKind` (features, bugs, api-changes, etc.)
- Parses `CHANGELOG.md` → `actionRequired`, `securityInformation`, `patchReleases`
- Scans `enhancements/keps/sig-*/*/kep.yaml` → `features` (KEPs with milestone matching this version)
- Merges with `curated/kep_enrichments_{version}.json` if exists

**With `--with-prs` flag (recommended for production):**
- Fetches PR details from GitHub API (~1000+ calls per release)
- Adds `userFacingChange` (release note from PR body)
- Adds `relatedIssues` (issues referenced via "Fixes #xxx")
- Adds `issueContext` (full issue title/body for LLM enrichment)
- Required if you plan to run `release enrich-changes` afterward

**Without `--with-prs`:** Faster build, but missing PR/issue context for enrichment.

### 3. `kep enrich VERSION` (optional, LLM)

**Input:** Release JSON + KEP README.md files
**Output:** Updates `releases/{version}.json` features in-place

For each KEP feature, reads the README.md and uses LLM to generate:
- `description` - 1-2 sentence summary
- `impact` - How this affects users/operators
- `affectedKinds` - Which K8s resources are affected
- `affectedFields` - Which API fields are added/modified

### 4. `release enrich-changes VERSION` (optional, LLM)

**Input:** Release JSON (must have `--with-prs` data)
**Output:** Updates `releases/{version}.json` changesByKind in-place

For each changelog entry, uses LLM + issue context to generate:
- `enrichedTitle` - Clear, concise title
- `enrichedDescription` - What/why/who explanation
- `userImpact` - How users are affected
- `actionRequired` - What users need to do
- `severity` - low/medium/high/critical

### 5. `openapi fetch VERSION`

**Input:** K8s OpenAPI specs from GitHub
**Output:** 
- `packages/web/public/data/k8s/api-trees/{version}.json` - API group/kind hierarchy
- `packages/web/public/data/k8s/schemas/{version}.json` - Full field schemas
- `packages/web/public/data/k8s/versions.json` - Version list

Parses OpenAPI specs to extract:
- API groups (core, apps, networking.k8s.io, etc.)
- Kinds (Pod, Deployment, Service, etc.) with metadata
- Full field schemas for each Kind
- Inferred relationships (Deployment→Pod, Service→Pod, etc.)

### 6. `openapi diff --all`

**Input:** API trees for consecutive versions
**Output:** `packages/web/public/data/k8s/diffs/{from}-{to}.json`

Compares schemas between versions to find:
- `kind_added` / `kind_removed` - New or removed Kinds
- `field_added` / `field_removed` - New or removed fields
- Field type changes, description changes

### 7. `kep link --all`

**Input:** Diffs (new fields) + Release features (KEPs)
**Output:** `packages/web/public/data/k8s/field-kep-links/{version}.json`

Uses heuristics to match new fields to their originating KEPs:
- Feature gate matching (field description mentions gate)
- Affected fields matching (KEP lists the field)
- Kind + text similarity matching
- Outputs confidence scores and match reasons

### 8. `export parquet`

**Input:** All JSON files in `packages/web/public/data/k8s/`
**Output:** `packages/web/public/data/parquet/*.parquet`

Converts JSON to Parquet tables for DuckDB WASM:
- `releases.parquet` (includes version info, is_latest), `api_groups.parquet`, `kinds.parquet`
- `kinds_relationships.parquet`, `api_diffs.parquet`
- `releases.parquet`, `features.parquet`, `deprecations.parquet`
- `release_changes.parquet`, `action_required.parquet`
- `security_cves.parquet`, `patch_releases.parquet`
- `field_kep_links.parquet`, `content_links.parquet`

**This is the critical step** - the UI reads ONLY from Parquet files.

Supports two backends:
- `--backend pyarrow` (default) - Better compression, especially for JSON columns
- `--backend duckdb` - Alternative, uses DuckDB's native Parquet writer

Also generates `schema_metadata.json` with table/column descriptions and FK relationships for the Analytics view.

### 9. `export docs` (optional)

**Input:** Schema definitions in `schemas.py`
**Output:** `docs/data-model.md`

Generates markdown documentation from PyArrow schema definitions. This ensures documentation stays in sync with the actual data schema.

The schemas in `schemas.py` are the single source of truth for:
1. Parquet file generation (type enforcement)
2. Documentation (this command)
3. TypeScript types (`export types`)
4. UI relationships (`schema_metadata.json` generated by `export parquet`)

```bash
# Generate docs (default location)
uv run k8s-pipeline export docs

# Generate to specific file
uv run k8s-pipeline export docs -o docs/schema.md
```

### 10. `export types` (optional)

**Input:** Schema definitions in `schemas.py`
**Output:** `packages/web/src/shared/types/db-types.ts`

Generates TypeScript interfaces from PyArrow schema definitions. This ensures frontend types stay in sync with the database schema.

For each DuckDB table, generates:
- A TypeScript interface (e.g., `ReleasesRow`, `KepsRow`)
- JSDoc comments with table/field descriptions
- `TableName` union type of all table names
- `TableRowMap` interface mapping table names to row types

Field names use snake_case to match DuckDB column names exactly, allowing direct use with query results.

```bash
# Generate types (default location)
uv run k8s-pipeline export types

# Generate to specific file
uv run k8s-pipeline export types -o src/types/db.ts
```

### 11. `export all`

**Input:** All JSON files + schema definitions
**Output:** Parquet files + docs + TypeScript types

Convenience command that runs all export steps:
1. `export parquet` - Generate Parquet files for DuckDB WASM
2. `export docs` - Generate schema documentation
3. `export types` - Generate TypeScript types

```bash
uv run k8s-pipeline export all
```

### 12. `export benchmark` (optional)

**Input:** Existing Parquet files
**Output:** Benchmark results comparing different formats

Compares disk size and export time for different columnar formats:
- Parquet (PyArrow) - default, best compression (~1.6 MB)
- Parquet (DuckDB) - alternative writer (~4.0 MB)
- DuckDB Native - single database file (~71 MB uncompressed)
- DuckDB Native + zstd - externally compressed (~1.4 MB)
- Lance - ML-optimized format (optional, requires `pylance`)
- Vortex - state-of-the-art format (optional, requires `vortex-data`)

**Note:** Lance and Vortex are NOT supported in DuckDB WASM, so they cannot be used by the frontend. This command is for experimentation only.

```bash
# Basic benchmark
uv run k8s-pipeline export benchmark

# Include experimental formats
uv run k8s-pipeline export benchmark --lance --vortex

# Show per-table breakdown
uv run k8s-pipeline export benchmark --per-table
```

### 13. `bun run build:single` (in packages/web)

**Input:** Parquet files + React app
**Output:** `k8s-api-explorer.html` (~2.85 MB)

Bundles everything into a single portable HTML file with embedded Parquet data.


## Module Structure

The pipeline uses a **domain-driven architecture** organized by feature area:

```
pipeline/src/k8s/
├── cli/                      # CLI entry point (modular)
│   ├── __init__.py           # Main app with subcommand registration
│   ├── release.py            # Release commands (process, stage, build, enrich)
│   ├── kep.py                # KEP commands (build, enrich, link)
│   ├── openapi.py            # OpenAPI commands (fetch, diff, info)
│   ├── component.py          # Component commands (flags, kubectl, gates)
│   ├── content.py            # Content commands (add, list, fetch-sched)
│   ├── repo.py               # Repository commands (sync, list, checkout)
│   ├── export.py             # Export commands (parquet, docs, types, all, benchmark)
│   └── util.py               # Utility commands (versions, clear-cache)
├── tui/app.py                # Interactive TUI application
│
├── core/                     # Layer 0: Cross-cutting concerns
│   ├── config.py             # Versions, colors, URLs, paths, constants
│   └── models.py             # Pydantic data models (Kind, APITree, etc.)
│
├── input/                    # Layer 1: Data input/fetching
│   ├── repo_manager.py       # Clone/update kubernetes repos
│   ├── github_fetcher.py     # GitHub API for PR/Issue fetching
│   └── upstream_stager.py    # Stage release-notes + CHANGELOG from upstream
│
├── transform/                # Layer 2-3: Data transformation (domain-driven subfolders)
│   ├── __init__.py           # Re-exports all submodule exports
│   ├── llm_utils.py          # LLM utilities (create_agent, etc.)
│   │
│   ├── openapi/              # OpenAPI schema parsing
│   │   ├── tree_parser.py    # OpenAPI → APITree (groups, kinds, relationships)
│   │   ├── field_parser.py   # OpenAPI → detailed field schemas
│   │   ├── schema_differ.py  # Compute version diffs and field history
│   │   └── go_enum_extractor.py  # Extract enum values from Go source
│   │
│   ├── release/              # Release data processing
│   │   ├── builder.py        # Build release JSON from staged data
│   │   ├── changelog_parser.py   # Parse CHANGELOG markdown files
│   │   ├── change_enricher.py    # LLM enrichment of changelog entries
│   │   └── release_notes_enricher.py # LLM enrichment of release notes
│   │
│   ├── kep/                  # KEP (Enhancement Proposal) processing
│   │   ├── parser.py         # Extract KEP features from enhancements repo
│   │   ├── field_linker.py   # Link new fields to KEPs
│   │   ├── enricher.py       # LLM enrichment of KEP features
│   │   ├── metadata_extractor.py # Extract metadata from all KEPs
│   │   └── label_normalizer.py   # Normalize KEP labels
│   │
│   ├── components/           # K8s component extraction
│   │   ├── component_extractor.py    # Extract component CLI flags
│   │   ├── kubectl_extractor.py      # Extract kubectl commands
│   │   └── feature_gate_extractor.py # Extract feature gates
│   │
│   ├── content/              # External content management
│   │   ├── content_links.py      # Manage external content links
│   │   ├── conference_ingest.py  # Conference talk ingestion
│   │   ├── sched_fetcher.py      # Fetch sessions from Sched.com
│   │   ├── youtube_fetcher.py    # Fetch videos from YouTube
│   │   ├── taxonomy_builder.py   # Build label taxonomy
│   │   └── label_suggester.py    # Suggest labels for content
│   │
│   └── providers/            # Cloud provider data
│       └── provider_versions.py  # Cloud provider version tracking
│
└── output/                   # Export layer
    ├── schema_docs.py        # Generate markdown docs from schemas
    ├── typescript_types.py   # Generate TypeScript types from schemas
    └── parquet/
        ├── schemas.py        # PyArrow schema definitions (source of truth)
        ├── pyarrow.py        # PyArrow-based Parquet export (default)
        ├── duckdb.py         # DuckDB-based Parquet export (alternative)
        └── benchmark.py      # Format benchmarking
```

### Layer Dependencies

- **Layer 0 (core)**: No imports from other domains
- **Layer 1 (input)**: Only imports from core
- **Layer 2-3 (transform/*)**: Imports from core and input; subfolders can import from sibling subfolders via `..subfolder.module`

### Import Patterns

All transform submodules are re-exported from `transform/__init__.py`:
```python
# Preferred: import from transform package
from k8s.transform import enrich_changes, parse_openapi_spec, Feature

# Also works: import from subfolder directly
from k8s.transform.enrichment import enrich_changes
from k8s.transform.openapi import parse_openapi_spec
from k8s.transform.kep import Feature
```

## Upstream Data Sources

### Release Notes JSON
- URL: `cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json`
- Contains: Raw changes by kind, KEP links, PR info
- Staged to: `pipeline/data/upstream/k8s/releases/release-notes/`

### CHANGELOG Markdown
- Source: `kubernetes/CHANGELOG/CHANGELOG-X.YY.md`
- Contains: Urgent upgrade notes, CVEs, patch releases
- Staged to: `pipeline/data/upstream/k8s/releases/changelogs/`

### KEP (Kubernetes Enhancement Proposals)
- Source: `kubernetes/enhancements` repo (cloned to `pipeline/repos/enhancements`)
- Contains: `kep.yaml` files with milestone info (alpha/beta/stable versions)
- Used by: `kep_parser.py` to extract features for each release

### Component CLI Flags
- Source: `kubernetes/website` repo (cloned to `pipeline/data/repos/website`)
- Contains: Command-line reference docs for kube-apiserver, kubelet, etc.
- Tags: `snapshot-final-v1.XX` (preferred) or `snapshot-initial-v1.XX` (fallback)
- Used by: `component_extractor.py` to extract CLI flags per version

## Component Flag Extraction

Extract CLI flags for Kubernetes components from the official documentation.

```bash
# Clone the website repo first
uv run k8s-pipeline repo sync website

# Extract flags for a specific version
uv run k8s-pipeline component flags 1.32

# Compare flags between versions
uv run k8s-pipeline component compare-flags 1.31 1.32

# List available website tags
uv run k8s-pipeline component list-tags
uv run k8s-pipeline component list-tags 1.32
```

Components extracted:
- kube-apiserver
- kube-controller-manager
- kube-scheduler
- kubelet
- kube-proxy

Output: `pipeline/data/curated/components.json`

## Adding New Data

### New K8s Version
1. Edit `core/config.py`:
```python
K8S_VERSIONS = ["1.36", "1.35", ...]  # Add new version
```

2. Stage and build:
```bash
uv run k8s-pipeline release stage 1.36
uv run k8s-pipeline release build 1.36
uv run k8s-pipeline openapi fetch 1.36
uv run k8s-pipeline openapi diff --all
uv run k8s-pipeline kep link --all
uv run k8s-pipeline export parquet
```

### New Kind Documentation URL
Edit `core/config.py`:
```python
KIND_DOCS_URLS = {
    "Pod": "https://kubernetes.io/docs/concepts/workloads/pods/",
    "NewKind": "https://kubernetes.io/docs/...",
}
```

### New Relationship Pattern
Edit `openapi/tree_parser.py` in `infer_relationships()`:
```python
relationship_patterns = {
    ("NewKind", "spec.someRef"): ("references", "TargetKind", "group", "Description"),
}
```


## Output Structure

```
pipeline/data/
├── curated/                        # Manual/human-edited data (organized by category)
│   ├── releases/                   # Version-specific curated data
│   │   └── {version}-curated.json  # Manual release enrichments
│   ├── content/                    # External content links
│   │   ├── content_links.json      # Base content (blogs, docs, videos)
│   │   └── content_links_kubecon_*.json  # Conference-specific content
│   ├── feature-gates/              # Feature gate data per version
│   │   └── feature_gates_{version}.json
│   ├── kubectl/                    # kubectl commands per version
│   │   └── kubectl_commands_{version}.json
│   ├── keps/                       # KEP metadata and labels
│   │   ├── kep_metadata.json       # All KEP metadata (LLM-extracted)
│   │   └── label_taxonomy*.json    # Label normalization data
│   └── components/                 # Component data
│       └── components.json         # Control plane component flags
└── upstream/k8s/releases/          # Staged upstream data
    ├── release-notes/
    │   └── {version}.0.json        # CDN release-notes.json
    └── changelogs/
        └── CHANGELOG-{version}.md  # CHANGELOG markdown

packages/web/public/data/
├── k8s/                            # JSON (intermediate)
│   ├── versions.json
│   ├── api-trees/{version}.json
│   ├── schemas/{version}.json
│   ├── diffs/{from}-{to}.json
│   ├── releases/{version}.json     # Combined release data
│   ├── field-kep-links/{version}.json  # Field-to-KEP mappings
│   ├── field-history.json
│   └── kind-history.json
└── parquet/                        # DuckDB data (source of truth)
    ├── releases.parquet            # Includes version info (is_latest)
    ├── api_groups.parquet
    ├── kinds.parquet
    ├── kinds_relationships.parquet
    ├── api_diffs.parquet
    ├── releases.parquet
    ├── features.parquet
    ├── deprecations.parquet
    ├── release_changes.parquet
    ├── action_required.parquet
    ├── security_cves.parquet
    ├── patch_releases.parquet
    ├── field_kep_links.parquet
    └── content_links.parquet
```

## KEP Feature Extraction

The pipeline automatically extracts KEP (Kubernetes Enhancement Proposal) features from the enhancements repo when building releases.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INPUT                                           │
├────────────────────────────────────┬────────────────────────────────────────┤
│ kep.yaml files                     │ Curated -v2.json                       │
│ (enhancements repo)                │ (manual overrides)                     │
└──────────────────┬─────────────────┴───────────────────┬────────────────────┘
                   │                                     │
                   ▼                                     │
┌──────────────────────────────────────────────────────┐ │
│ 1. Scan sig-*/*/kep.yaml                             │ │
│ 2. Parse milestone info (alpha/beta/stable versions) │ │
│ 3. Match to target version                           │ │
└──────────────────────────────────────────────────────┘ │
                   │                                     │
                   ▼                                     │
┌──────────────────────────────────────────────────────┐ │
│ 4. Merge with curated data  ◀────────────────────────┼─┘
└──────────────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│ OUTPUT: features in release JSON                     │
└──────────────────────────────────────────────────────┘
```

### Commands

```bash
# Extract features for a specific version (standalone)
uv run k8s-pipeline kep build 1.35

# Extract for all versions
uv run k8s-pipeline kep build --all

# Build release (auto-extracts features)
uv run k8s-pipeline release build 1.35 --force
```

### Data Extracted

For each KEP:
- `kep`: KEP number (e.g., "KEP-1287")
- `kepPath`: Path in enhancements repo (e.g., "sig-node/1287-in-place-update-pod-resources")
- `title`: KEP title
- `stage`: Current stage in this release (alpha/beta/stable)
- `sig`: Owning SIG
- `featureGate`: Feature gate name (if any)
- `history`: Version history (`{alpha: "1.27", beta: "1.33", stable: "1.35"}`)

### Updating the Enhancements Repo

```bash
# Sync the enhancements repo to get latest KEPs
uv run k8s-pipeline repo sync enhancements --pull
```

## KEP Field Linking

The pipeline can automatically link new API fields to their originating KEPs using heuristic matching.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INPUT                                           │
├────────────────────────────────────┬────────────────────────────────────────┤
│ Version diffs (new fields)         │ KEP features (from release)            │
└──────────────────┬─────────────────┴───────────────────┬────────────────────┘
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MATCHING STRATEGIES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Feature gate (0.95)      - Extract feature gate from field description   │
│ 2. Affected fields (0.99)   - Field explicitly listed in KEP's list         │
│ 3. Kind mention (0.85-0.95) - Field description mentions KEP's target kinds │
│ 4. Kind + text (0.3-0.8)    - Field on affected kind + text similarity      │
│ 5. Text match (0.28-0.7)    - Pure text similarity                          │
│ 6. Token match (0.3-0.8)    - Field name contains KEP title tokens          │
│ 7. Key terms (0.5-0.9)      - KEP terms appear in field description         │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ field-kep-links/{version}.json                                              │
│ + is_canonical flag (original definition vs inherited via PodSpec)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

```bash
# Link fields to KEPs for all versions
uv run k8s-pipeline kep link --all

# Link for specific version
uv run k8s-pipeline kep link 1.35
```

For full algorithm details, see the module docstring in `pipeline/src/k8s/transform/kep/field_linker.py`.


## Conference Content Ingestion

The pipeline supports ingesting conference content (KubeCon talks, presentations) into the content_links system, enabling discovery of relevant talks by topic.

### Supported Conferences

- `kubecon-eu-2022` - KubeCon + CloudNativeCon Europe 2022 (Valencia)
- `kubecon-na-2022` - KubeCon + CloudNativeCon North America 2022 (Detroit)
- `kubecon-eu-2023` - KubeCon + CloudNativeCon Europe 2023 (Amsterdam)
- `kubecon-na-2023` - KubeCon + CloudNativeCon North America 2023 (Chicago)
- `kubecon-eu-2024` - KubeCon + CloudNativeCon Europe 2024 (Paris)
- `kubecon-na-2024` - KubeCon + CloudNativeCon North America 2024 (Salt Lake City)
- `kubecon-eu-2025` - KubeCon + CloudNativeCon Europe 2025 (London)
- `kubecon-na-2025` - KubeCon + CloudNativeCon North America 2025 (Atlanta)
- `kubecon-china-2025` - KubeCon + CloudNativeCon China 2025 (Hong Kong)

### Bulk Import from Sched.com

The easiest way to import conference sessions is via the Sched.com iCal export:

```bash
# List available conferences
uv run k8s-pipeline content fetch-sched --list

# Import all sessions from a conference
uv run k8s-pipeline content fetch-sched kubecon-na-2024

# Preview without saving
uv run k8s-pipeline content fetch-sched kubecon-na-2024 --dry-run

# Limit number of sessions
uv run k8s-pipeline content fetch-sched kubecon-na-2024 --max 50
```

This extracts:
- Session titles and descriptions
- Speaker names (parsed from title)
- Session types (keynote, deep-dive, tutorial, etc.)
- Topic labels (auto-detected from content)
- KEP references (extracted from descriptions)

### KEP Linking: Two Approaches

There are **two different ways** KEPs get associated with conference sessions:

#### 1. During `fetch-sched` (Automatic, Lightweight)

When you run `fetch-sched` with LLM enrichment (the default), the LLM extracts KEP references that are **explicitly mentioned** in the session title or description.

```bash
uv run k8s-pipeline content fetch-sched kubecon-na-2024
```

**What it does:**
- LLM reads session title + description
- Extracts KEP numbers mentioned (e.g., "This talk covers KEP-1287")
- Adds them to `kep_references` field

**Limitation:** Only finds KEPs that are explicitly named in the session text.

#### 2. Using `link-keps` (Separate Step, Deep Matching)

The `link-keps` command does **semantic matching** against the full KEP database (~500+ KEPs), finding relevant KEPs even when they're not explicitly mentioned.

```bash
uv run k8s-pipeline content link-keps kubecon-na-2024
```

**What it does:**
- Loads all KEPs from `kep_metadata.json` (titles, labels, affected kinds)
- For each session, asks LLM: "Which KEPs is this session specifically about?"
- Uses strict matching (0.90+ confidence threshold)
- Only matches if session is about *developing/implementing* the K8s feature, not just *using* it
- Adds matches with confidence scores and reasoning

**Example:**
- Session: "In-Place Pod Resizing Deep Dive" (doesn't mention KEP number)
- `fetch-sched`: No KEP found (not mentioned)
- `link-keps`: Matches KEP-1287 (LLM understands the topic)

### Recommended Workflow

```bash
# 1. Import sessions with basic enrichment
uv run k8s-pipeline content fetch-sched kubecon-na-2024

# 2. (Optional) Deep KEP linking for better associations
uv run k8s-pipeline content link-keps kubecon-na-2024

# 3. Export to Parquet
uv run k8s-pipeline export parquet
```

**When to use `link-keps`:**
- For older conferences where sessions don't mention KEP numbers
- When you want richer KEP associations for the UI
- When session quality matters more than LLM cost

**When to skip `link-keps`:**
- Quick imports where basic KEP extraction is sufficient
- When minimizing LLM API costs
- For future conferences (sessions may not have detailed descriptions yet)

### YouTube Video Import

Import videos from CNCF YouTube playlists (requires `YOUTUBE_API_KEY`):

```bash
# List available playlists
uv run k8s-pipeline content fetch-youtube --list

# Import videos from a conference
uv run k8s-pipeline content fetch-youtube kubecon-na-2024
```

### Manual Commands

```bash
# List all conference content
uv run k8s-pipeline content list-conferences

# Filter by conference
uv run k8s-pipeline content list-conferences --conference kubecon-na-2024

# Filter by topic
uv run k8s-pipeline content list-conferences --topic dra
uv run k8s-pipeline content list-conferences --topic scheduling

# Add a single talk
uv run k8s-pipeline content add-talk kubecon-na-2024 \
    "DRA is GA!" "Kevin Klues, Patrick Ohly" \
    --video "https://youtube.com/watch?v=..." \
    --labels "dra,gpu,scheduling" \
    --keps "KEP-4381" \
    --type deep-dive

# Import talks from JSON file
uv run k8s-pipeline content import-talks talks.json
```

### JSON Import Format

```json
{
  "talks": [
    {
      "conference": "kubecon-na-2024",
      "title": "DRA is GA! Kubernetes WG Device Management",
      "speakers": ["Kevin Klues", "Patrick Ohly"],
      "video_url": "https://youtube.com/watch?v=...",
      "description": "Deep dive into Dynamic Resource Allocation...",
      "session_type": "deep-dive",
      "labels": ["dra", "gpu", "device-management"],
      "kep_links": ["KEP-4381"]
    }
  ]
}
```

### Standard Labels

**Conference identifiers:**
- `kubecon-eu-2025`, `kubecon-na-2024`, `kubecon-eu-2024`

**Session types:**
- `keynote`, `deep-dive`, `tutorial`, `lightning-talk`, `bof`, `workshop`, `maintainer-track`

**Topics:**
- Features: `dra`, `scheduling`, `networking`, `storage`, `security`, `observability`, `autoscaling`
- Resources: `pod`, `deployment`, `service`, `job`, `statefulset`
- Components: `kubelet`, `kube-apiserver`, `kube-scheduler`, `etcd`
- Concepts: `sidecar`, `in-place-resize`, `user-namespaces`, `gpu`, `ai`, `ml`

### Programmatic Usage

```python
from k8s.transform.content.conference_ingest import (
    add_conference_talk,
    list_conference_content,
    get_talks_by_topic,
)

# Add a talk
add_conference_talk(
    conference="kubecon-na-2024",
    title="DRA is GA!",
    speakers=["Kevin Klues", "Patrick Ohly"],
    video_url="https://youtube.com/watch?v=...",
    labels=["dra", "gpu", "scheduling"],
    kep_links=["KEP-4381"],
    kind_links=[("ResourceClaim", "resource.k8s.io")],
)

# Query by topic
dra_talks = get_talks_by_topic("dra")
scheduling_talks = get_talks_by_topic("scheduling")
```


## KEP Metadata Extraction (One-Off)

The pipeline can extract metadata from ALL KEPs in the enhancements repo using LLM. This is a one-off process that creates a central metadata store used by release builds.

### Two-Pass Process

1. **Pass 1: Extract** - LLM extracts metadata from each KEP's README.md
2. **Pass 2: Normalize** - LLM consolidates and normalizes labels for consistency

### Commands

```bash
# Pass 1: Extract metadata from all KEPs
uv run k8s-pipeline kep extract-metadata

# Test with 10 KEPs
uv run k8s-pipeline kep extract-metadata --max 10

# Re-process all KEPs (ignore existing)
uv run k8s-pipeline kep extract-metadata --force

# Pass 2: Normalize labels
uv run k8s-pipeline kep normalize-labels

# Preview normalization without saving
uv run k8s-pipeline kep normalize-labels --dry-run

# Show label statistics
uv run k8s-pipeline kep normalize-labels --stats
```

### Output Files

- `data/curated/keps/kep_metadata.json` - All KEP metadata (555+ KEPs)
- `data/curated/keps/label_normalization_map.json` - Label normalization rules

### What Gets Extracted

For each KEP:
- `summary`: 2-3 sentence description
- `labels`: Topic labels for categorization (e.g., scheduling, numa, csi)
- `affectedKinds`: K8s resources with API changes
- `affectedFields`: New API fields
- `keyConcepts`: Technical concepts (NUMA, cgroups, eBPF, etc.)

### Integration with Release Builds

The `kep enrich` command now uses `kep_metadata.json` as a cache:
- If KEP is in cache → uses cached metadata (instant, no LLM call)
- If KEP not in cache → falls back to LLM enrichment

```bash
# Uses cache by default
uv run k8s-pipeline kep enrich 1.35

# Force LLM enrichment (ignore cache)
uv run k8s-pipeline kep enrich 1.35 --no-cache
```

## KEP Feature Enrichment (LLM)

The pipeline can enrich extracted KEP features with LLM-generated descriptions using Strands Agents SDK.

### Installation

```bash
# Install strands-agents with Anthropic support
uv pip install 'strands-agents[anthropic]'
```

### Usage

```bash
# Enrich features using Amazon Bedrock (default)
# Requires AWS credentials configured
uv run k8s-pipeline kep enrich 1.32

# Enrich using Anthropic API directly
# Requires ANTHROPIC_API_KEY environment variable
export ANTHROPIC_API_KEY=sk-...
uv run k8s-pipeline kep enrich 1.32 --provider anthropic

# Test with limited features
uv run k8s-pipeline kep enrich 1.32 --max 5
```

### What Gets Enriched

For each KEP, the LLM reads the README.md and extracts:
- `description`: 1-2 sentence summary of what the feature does
- `impact`: How this affects users/operators
- `affectedKinds`: Which K8s resource types are affected
- `affectedFields`: Which API fields are added/modified

## Changelog Enrichment (LLM)

The pipeline can enrich release changelog entries with LLM-generated context from PR and Issue data.

### Prerequisites

Build the release with PR data first:
```bash
uv run k8s-pipeline release build 1.35 --with-prs
```

### Usage

```bash
# Enrich all changes for a version (includes patch releases by default)
uv run k8s-pipeline release enrich-changes 1.35

# Enrich only bug fixes
uv run k8s-pipeline release enrich-changes 1.35 --kind bugOrRegression

# Test with 5 changes
uv run k8s-pipeline release enrich-changes 1.35 --max 5

# Process in batches with progress saving
uv run k8s-pipeline release enrich-changes 1.35 --batch --batch-size 10

# Only enrich changes that have linked issues
uv run k8s-pipeline release enrich-changes 1.35 --with-issues

# Skip patch releases (only enrich main release)
uv run k8s-pipeline release enrich-changes 1.35 --skip-patches
```

### What Gets Enriched

For each changelog entry (main release and patch releases), the LLM generates:
- `problem`: What was the problem or missing capability
- `affected`: Who was affected and how
- `fix`: What the change does to address it
- `impact`: Why this matters to users
- `category`: bug-fix, performance, security, usability, cleanup, etc.
- `severity`: low/medium/high/critical (for bugs/security)
- `affectedComponents`: kubelet, kube-apiserver, etc.

## Release Notes Enrichment (LLM)

The pipeline can enrich release notes (urgent upgrade notes, deprecations) with LLM-generated structured content.

### Usage

```bash
# Enrich all categories for a version
uv run k8s-pipeline release enrich-notes 1.35

# Enrich only urgent upgrade notes
uv run k8s-pipeline release enrich-notes 1.35 -c urgent

# Enrich only deprecations
uv run k8s-pipeline release enrich-notes 1.35 -c deprecations

# Test with 2 items per category
uv run k8s-pipeline release enrich-notes 1.35 --max 2

# Use a specific provider
uv run k8s-pipeline release enrich-notes 1.35 --provider anthropic
```

### What Gets Enriched

**Action Required Notes** (`actionRequired`):
- `title`: Short title (max 10 words) summarizing the change
- `summary`: 1-2 sentence summary of what changed
- `action`: Specific action users must take
- `severity`: critical, high, medium, or low
- `affectedComponents`: kubelet, kube-apiserver, kube-proxy, etc.
- `affectedWorkloads`: pods, deployments, statefulsets, etc.
- `breakingChange`: true if this is a breaking change

**Deprecations** (`deprecations`):
- `summary`: 1-2 sentence explanation of what's being deprecated
- `impact`: Who is affected and how
- `migrationSteps`: Array of concrete steps to migrate
- `urgency`: immediate, plan-now, or future
- `affectedAPIs`: Affected API resources/fields


## Complete Pipeline for a New Release

Use the all-in-one command:

```bash
cd pipeline

# Full processing with LLM enrichment (default)
uv run k8s-pipeline release process 1.36

# Then build the UI
cd ../packages/web && bun run build:single
```

Or run steps individually for more control:

```bash
cd pipeline

# 1. Stage upstream data
uv run k8s-pipeline release stage 1.36

# 2. Build release JSON with PR data
uv run k8s-pipeline release build 1.36 --with-prs

# 3. Enrich KEP features (uses LLM)
uv run k8s-pipeline kep enrich 1.36

# 4. Enrich changelog entries (uses LLM)
uv run k8s-pipeline release enrich-changes 1.36

# 5. Enrich release notes (uses LLM)
uv run k8s-pipeline release enrich-notes 1.36

# 6. Fetch/parse OpenAPI specs
uv run k8s-pipeline openapi fetch 1.36

# 7. Generate diffs
uv run k8s-pipeline openapi diff --all

# 8. Link fields to KEPs
uv run k8s-pipeline kep link --all

# 9. Extract component flags
uv run k8s-pipeline component flags 1.36

# 10. Extract kubectl commands
uv run k8s-pipeline component kubectl 1.36

# 11. Extract feature gates
uv run k8s-pipeline component gates 1.36

# 12. Export all (parquet + docs + types)
uv run k8s-pipeline export all

# 13. Build UI
cd ../packages/web && bun run build:single
```

## Important Notes

- **Always run `export all` after updating JSON** - UI reads from Parquet only, and TypeScript types should stay in sync
- Alternatively, run `export parquet` alone if you don't need to regenerate docs/types
- Running `openapi fetch VERSION` overwrites `versions.json` with only that version
- Use `openapi fetch --all` to regenerate all versions and keep versions.json complete
- Pipeline uses cache in `pipeline/.cache/` - use `--no-cache` to force refresh
- Writer converts snake_case (Python) to camelCase (JSON) automatically
- Stage before process: copy data from source to `pipeline/data/upstream/` before processing

## Schema Synchronization

The PyArrow schemas in `schemas.py` are the single source of truth for:
1. **Parquet files** - `export parquet` generates tables with these schemas
2. **Documentation** - `export docs` generates `data-model.md`
3. **TypeScript types** - `export types` generates `db-types.ts`
4. **Schema metadata** - `export parquet` generates `schema_metadata.json` for Analytics view

When you modify the schema:
```bash
# Regenerate everything
uv run k8s-pipeline export all
```

## Command → Parquet Table Mapping

This table shows which CLI commands generate data for which Parquet tables:

| Command | Parquet Tables Generated |
|---------|-------------------------|
| `release build` | `releases`, `keps`, `features`, `deprecations`, `release_changes`, `action_required`, `security_cves`, `patch_releases`, `patch_release_changes`, `patch_security_fixes` |
| `openapi fetch` | `releases` (version info), `api_groups`, `kinds` |
| `openapi diff` | `api_diffs` |
| `kep link` | `field_kep_links` |
| `component flags` | `components`, `component_flags` |
| `component kubectl` | `kubectl_commands`, `kubectl_options`, `kubectl_examples` |
| `component gates` | `feature_gates` |
| `content add` / `content fetch-sched` | `content_links` |

**Note:** The `export parquet` command reads all JSON files and generates all Parquet tables. The mapping above shows which commands produce the source data for each table.
