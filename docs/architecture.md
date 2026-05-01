# K8s Compass Architecture

**IMPORTANT**: DuckDB/Parquet is the single source of truth for all application data. The UI queries DuckDB directly via WASM. JSON files are intermediate build artifacts only.

## Project Structure

```
k8s-compass/
├── packages/web/          # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── features/
│   │   │   ├── api-explorer/  # API Explorer tab
│   │   │   │   ├── ApiGroupSidebar.tsx
│   │   │   │   ├── ConstellationView.tsx
│   │   │   │   ├── SunburstView.tsx
│   │   │   │   └── SpecStructure.tsx
│   │   │   ├── releases/      # Releases tab
│   │   │   │   └── ReleasesView.tsx
│   │   │   └── analytics/     # Analytics tab (SQL Analytics)
│   │   │       └── AnalyticsView.tsx
│   │   ├── shared/            # Shared across features
│   │   │   ├── components/    # Header
│   │   │   ├── hooks/         # useDB, useAPIDataDB, useReleaseDataDB
│   │   │   ├── data/          # schemas, schemaLoader, historyLoader
│   │   │   ├── store/         # Zustand state
│   │   │   └── types/         # TypeScript interfaces
│   │   └── App.tsx
│   ├── public/data/parquet/   # Copied from pipeline output (gitignored)
│   └── scripts/               # Build scripts (build-single-html.js)
│
├── pipeline/              # Python data pipeline (uv)
│   ├── .cache/            # OpenAPI cache, GitHub cache (gitignored)
│   ├── data/
│   │   ├── curated/       # Manual data (organized by category)
│   │   │   ├── releases/      # {version}-curated.json
│   │   │   ├── content/       # content_links*.json
│   │   │   ├── feature-gates/ # feature_gates_{version}.json
│   │   │   ├── kubectl/       # kubectl_commands_{version}.json
│   │   │   ├── keps/          # kep_metadata.json, label_*.json
│   │   │   └── components/    # components.json
│   │   ├── repos/         # Git clones (kubernetes, enhancements)
│   │   ├── upstream/      # Staged upstream data
│   │   │   └── k8s/releases/
│   │   │       ├── release-notes/   # CDN JSON files
│   │   │       └── changelogs/      # CHANGELOG markdown files
│   │   └── output/        # Pipeline output (version controlled except benchmark)
│   │       ├── json/      # Intermediate JSON files
│   │       ├── parquet/   # Final parquet files (source of truth)
│   │       └── benchmark/ # Benchmark experiments (gitignored)
│   └── src/k8s/
│       ├── cli.py              # CLI entry point
│       ├── tui/app.py          # Interactive TUI application
│       │
│       ├── core/               # Layer 0: Cross-cutting concerns
│       │   ├── config.py       # Versions, colors, constants, paths
│       │   └── models.py       # Pydantic data models
│       │
│       ├── input/              # Layer 1: Data input/fetching
│       │   ├── repo_manager.py     # Clone/manage kubernetes repos
│       │   ├── github_fetcher.py   # GitHub API for PR/Issue fetching
│       │   └── upstream_stager.py  # Stage release-notes + CHANGELOG
│       │
│       ├── transform/          # Layer 2-3: Data transformation (domain-driven)
│       │   ├── __init__.py         # Re-exports all submodule exports
│       │   ├── llm_utils.py        # LLM utilities
│       │   ├── openapi/            # OpenAPI schema parsing
│       │   │   ├── tree_parser.py      # OpenAPI → APITree
│       │   │   ├── field_parser.py     # OpenAPI → field schemas
│       │   │   ├── schema_differ.py    # Version diffs
│       │   │   └── go_enum_extractor.py # Extract enums from Go
│       │   ├── release/            # Release data processing
│       │   │   ├── builder.py          # Build release JSON
│       │   │   ├── changelog_parser.py # Parse CHANGELOG markdown
│       │   │   ├── change_enricher.py  # LLM enrichment of changes
│       │   │   └── release_notes_enricher.py # LLM enrichment of notes
│       │   ├── kep/                # KEP processing
│       │   │   ├── parser.py           # Extract KEP features
│       │   │   ├── field_linker.py     # Link fields to KEPs
│       │   │   ├── enricher.py         # LLM enrichment
│       │   │   ├── metadata_extractor.py # Extract all KEP metadata
│       │   │   └── label_normalizer.py # Normalize labels
│       │   ├── components/         # K8s component extraction
│       │   │   ├── component_extractor.py    # CLI flags
│       │   │   ├── kubectl_extractor.py      # kubectl commands
│       │   │   └── feature_gate_extractor.py # Feature gates
│       │   ├── content/            # External content management
│       │   │   ├── content_links.py      # Manage content links
│       │   │   ├── conference_ingest.py  # Conference talks
│       │   │   ├── sched_fetcher.py      # Sched.com sessions
│       │   │   ├── youtube_fetcher.py    # YouTube videos
│       │   │   ├── taxonomy_builder.py   # Label taxonomy
│       │   │   └── label_suggester.py    # Label suggestions
│       │   └── providers/          # Cloud provider data
│       │       └── provider_versions.py  # Provider version tracking
│       │
│       └── output/             # Export layer
│           ├── schema_docs.py      # Generate markdown docs
│           ├── typescript_types.py # Generate TypeScript types
│           └── parquet/            # Parquet exporters
```

## Data Flow

```
Upstream Sources:
├── dl.k8s.io/release/vX.YY.Z/release-notes.json
└── kubernetes/CHANGELOG/CHANGELOG-X.YY.md
        ↓
    Stage (release/stager.py)
        ↓
    pipeline/data/upstream/k8s/releases/
        ↓
    Build (release/builder.py, openapi/tree_parser.py)
        ↓
    pipeline/data/output/json/ (intermediate)
        ↓
    Export (output/parquet/pyarrow.py)
        ↓
    pipeline/data/output/parquet/ (source of truth)
        ↓
    Copy to packages/web/public/data/parquet/ (for dev server)
        ↓
    Parquet files (source of truth)
        ↓
    DuckDB WASM (browser)
        ↓
    React hooks (useDB, useAPIDataDB, useReleaseDataDB)
        ↓
    Zustand store
        ↓
    Visualizations
```

## Key Commands

```bash
# Frontend development (uses Bun)
bun install             # Install dependencies
bun run dev             # Start dev server (port 5173)
bun run build           # Production build
bun run build:single    # Create portable HTML

# Pipeline - Stage upstream data (uses uv)
cd pipeline
uv run k8s-pipeline stage-release 1.35
uv run k8s-pipeline staging-status

# Pipeline - Build releases
uv run k8s-pipeline build-release --all
uv run k8s-pipeline build-release 1.35 --with-prs  # Production builds

# Pipeline - Enrich with LLM (optional)
uv run k8s-pipeline enrich-features 1.35
uv run k8s-pipeline enrich-changes 1.35

# Pipeline - Fetch/parse OpenAPI specs
uv run k8s-pipeline fetch --all
uv run k8s-pipeline fetch 1.35

# Pipeline - Generate diffs
uv run k8s-pipeline diff --all

# Pipeline - Link fields to KEPs
uv run k8s-pipeline link-keps --all

# Pipeline - Export to Parquet (REQUIRED for UI)
uv run k8s-pipeline export parquet

# Pipeline - Export all (parquet + docs + types)
uv run k8s-pipeline export all
```

## Navigation Structure

- **Main tabs**: API Explorer | Releases | Analytics (fixed in header)
- **Sub-nav**: View modes, search, version selector (context-dependent)
- **API Explorer views**: Constellation, Sunburst, Blueprint (disabled), Timeline (disabled)
- **Releases view**: Timeline of releases with feature list
- **Analytics view**: SQL Analytics for querying DuckDB directly

## State Management

Zustand store (`explorerStore.ts`) manages:
- `activeSection`: 'api-explorer' | 'releases' | 'analytics'
- `viewMode`: 'constellation' | 'sunburst' | 'blueprint' | 'timeline'
- `selectedVersion`: K8s version string
- `selectedKind`: Currently selected Kind name
- `detailPanelOpen`: Whether detail panel is visible

## Bundle Composition

### What's Bundled vs External

| Dependency | Bundled | External (CDN) | Size | Notes |
|------------|:-------:|:--------------:|------|-------|
| Three.js | ✓ | | ~600 KB | 3D rendering for Constellation view |
| @react-three/fiber | ✓ | | ~150 KB | React bindings for Three.js |
| @react-three/drei | ✓ | | ~200 KB | Three.js helpers |
| DuckDB JS bindings | ✓ | | ~200 KB | Query interface only |
| DuckDB WASM | | ✓ jsDelivr | ~4 MB | Loaded at runtime from CDN |
| D3 | ✓ | | ~100 KB | Sunburst visualization |
| Framer Motion | ✓ | | ~100 KB | Animations |
| React + ReactDOM | ✓ | | ~150 KB | UI framework |
| Strudel | ✓ | | ~50 KB | Audio (easter egg) |
| Google Fonts | | ✓ Google | ~50 KB | JetBrains Mono, Space Grotesk |

### Single-File Build Breakdown

```
bun run build:single → k8s-api-explorer.html (~2.85 MB)

├── JS bundle:        ~1.82 MB  (Three.js, React, D3, DuckDB bindings)
├── CSS:              ~70 KB
├── Parquet data:     ~710 KB   (raw binary)
├── Base64 overhead:  ~240 KB   (+33% for binary→text encoding)
└── HTML boilerplate: ~40 KB
```

### Runtime Dependencies

The single HTML file requires internet access for:
- DuckDB WASM binary (~4 MB from jsDelivr CDN)
- Google Fonts (~50 KB)

For fully offline use, these would need to be embedded (significantly increasing file size).

### Bundle Analysis

Run `bun run build` to generate `dist/bundle-stats.html` with interactive treemap visualization.

## DuckDB WASM Data Layer

**DuckDB is the primary data backend.** All UI data comes from Parquet files queried via DuckDB WASM.

### Parquet Files (~0.65MB total)

| File | Contents |
|------|----------|
| `releases.parquet` | K8s releases with version info, codename, feature counts |
| `api_groups.parquet` | API groups per version |
| `kinds.parquet` | All Kinds with metadata + schemas |
| `kinds_relationships.parquet` | Kind-to-Kind relationships |
| `api_diffs.parquet` | API schema changes between versions |
| `releases.parquet` | Release metadata |
| `features.parquet` | KEP features per release |
| `deprecations.parquet` | Deprecation notices |
| `release_changes.parquet` | Raw changes from release-notes |
| `action_required.parquet` | Action required notes |
| `security_cves.parquet` | CVE information |
| `patch_releases.parquet` | Patch release info |

### Hooks

```typescript
// DuckDB hooks (primary)
import { useAPITree, useConstellationData } from './hooks'  // Re-exports DB versions
import { useReleaseNotes, useAllReleases } from './hooks'

// Direct queries via Analytics tab
import { useDB, executeQuery, parquet } from './hooks/useDB'

const kinds = await executeQuery(`
  SELECT name, field_count 
  FROM ${parquet('kinds')} 
  WHERE version = '1.35'
`)

// Query security CVEs
const cves = await executeQuery(`
  SELECT cve, title, affected_components
  FROM ${parquet('security_cves')}
  WHERE version = '1.35'
`)
```

### Regenerating Parquet Files

After updating JSON data or schemas, regenerate everything:
```bash
cd pipeline
uv run k8s-pipeline export all  # parquet + docs + types
```

Or individually:
```bash
uv run k8s-pipeline export parquet  # Parquet files only
uv run k8s-pipeline export docs     # Schema documentation
uv run k8s-pipeline export types    # TypeScript types
```

## Future Improvements

### Single DuckDB File vs Multiple Parquet Files

**Current state:** The frontend loads 12 individual Parquet files at startup. The table list is defined in:
- `packages/web/src/shared/hooks/useDB.ts` - `TABLES` constant (uses `TableName` type from generated types)
- `pipeline/src/k8s/output/parquet/pyarrow.py` - generates the files
- `packages/web/src/shared/types/db-types.ts` - generated TypeScript types (run `export types` to regenerate)

**Improvement made:** TypeScript types are now auto-generated from PyArrow schemas via `uv run k8s-pipeline export types`. This ensures frontend types stay in sync with the database schema.

**Investigated alternative:** Bundle all tables into a single `.duckdb` file, compress with zstd for transfer (~600KB), decompress in browser.

**Why we didn't do it:**
- DuckDB's native format doesn't compress large JSON blobs well (uses lightweight compression for query speed, not storage)
- The `kinds.parquet` file contains ~60MB of `schema_json` data that compresses to 400KB in Parquet (ZSTD) but stays uncompressed in DuckDB native format
- Result: 660KB Parquet files → 66MB DuckDB file → 600KB after external zstd
- The 60MB decompressed database would live in browser memory for the entire session
- DuckDB's `USING COMPRESSION zstd` syntax exists but doesn't actually apply ZSTD to VARCHAR columns in native storage

**Potential solutions (not implemented):**
1. **Manifest file:** Pipeline generates `manifest.json` listing all tables, frontend reads it dynamically
2. **Single DuckDB + OPFS:** Decompress once, persist to Origin Private File System (browser storage, not RAM)
3. **Hybrid:** Keep Parquet for large tables (`kinds`), bundle small tables into DuckDB
4. **Accept the RAM cost:** 60MB is acceptable for desktop users; mobile could lazy-load

**Decision:** Keep current Parquet approach. The duplication is minor, and the memory efficiency is worth it. Revisit if table count grows significantly or if DuckDB adds better compression for large strings.

### Format Benchmarking

The pipeline includes a benchmarking tool to compare different columnar file formats:

```bash
# Basic benchmark (Parquet + DuckDB native)
uv run k8s-pipeline benchmark-formats

# Include experimental formats (requires additional dependencies)
uv run k8s-pipeline benchmark-formats --lance --vortex

# Show per-table breakdown
uv run k8s-pipeline benchmark-formats --per-table
```

**Available formats:**

| Format | Size | Notes |
|--------|------|-------|
| Parquet (PyArrow) | ~1.6 MB | Default, used by frontend, best compression |
| Parquet (DuckDB) | ~4.0 MB | Larger due to less aggressive JSON compression |
| DuckDB Native | ~71 MB | Uncompressed, fast queries but huge |
| DuckDB Native + zstd | ~1.4 MB | Externally compressed, needs decompression |
| Lance | varies | ML-optimized, NOT supported in WASM |
| Vortex | varies | State-of-the-art, NOT supported in WASM |

**Key findings:**
- PyArrow Parquet with ZSTD level 19 provides the best compression
- DuckDB's native format doesn't compress VARCHAR/JSON columns well
- Lance and Vortex are interesting for experimentation but not usable in the browser
- External zstd compression of DuckDB files achieves similar size to Parquet but requires decompression

**Install optional dependencies for full benchmarking:**
```bash
uv pip install 'k8s-api-pipeline[all-formats]'
# Or individually:
uv pip install duckdb zstandard  # For DuckDB native
uv pip install pylance           # For Lance format
uv pip install vortex-data       # For Vortex format
```
