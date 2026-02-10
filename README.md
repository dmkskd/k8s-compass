# K8s Compass

A visual documentation system for Kubernetes APIs with release notes, KEP integration, and curated learning content.

## Features

- **API Explorer**: Visualize K8s API structure
  - Constellation View: Force-directed graph of K8s objects and relationships
  - Sunburst View: Hierarchical view of API groups, versions, and kinds
  - Schema Browser: Explore full field schemas with search and filtering
- **Releases**: Browse features by Kubernetes release with KEP links and version comparison
- **Control Plane**: Interactive 3D visualization of K8s architecture with component flags and feature gates
- **Learn**: Curated content browser with KubeCon talks, deep dives, and documentation
- **Analytics**: SQL analytics powered by DuckDB WASM - query all data directly

## Architecture

**DuckDB is the single source of truth** for all application data. The UI queries Parquet files directly via DuckDB WASM in the browser.

```
Upstream Sources → Pipeline (Python) → Parquet → DuckDB WASM → React UI
```

## Prerequisites

- [just](https://github.com/casey/just) — command runner used for all project tasks
- [Bun](https://bun.sh) — JavaScript runtime for the web frontend
- [uv](https://docs.astral.sh/uv/) — Python package manager for the data pipeline

Run `just` to see all available commands.

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-org/k8s-compass.git
cd k8s-compass

# 2. Install frontend dependencies
bun install

# 3. Generate parquet data (converts pipeline JSON → parquet for the UI)
just k8s-pipeline export parquet

# 4. Start the dev server
just web dev
```

Open http://localhost:5173

## Building

### Development Build

```bash
just web build
```

Output goes to `packages/web/dist/`

### Single HTML File (Portable)

Build a self-contained HTML file with all data embedded (~2.85 MB):

```bash
just web build:single
```

Output: `k8s-api-explorer.html` in the repo root. Opens directly in a browser without a server.

## Data Pipeline

The pipeline fetches Kubernetes data from multiple upstream sources and generates Parquet files for DuckDB. See **[pipeline/README.md](pipeline/README.md)** for full documentation.

### Quick Start

```bash
# Launch the interactive TUI (recommended)
just k8s-pipeline tui

# Or process a release via CLI
just k8s-pipeline release process 1.35

# Export to Parquet (required for UI)
just k8s-pipeline export parquet
```

### Pipeline Documentation

| Document | Purpose |
|----------|---------|
| **[pipeline/README.md](pipeline/README.md)** | Pipeline setup, CLI commands, TUI usage |
| **[docs/pipeline.md](docs/pipeline.md)** | Detailed pipeline guide with data flow diagrams |

## Documentation

| Document | Purpose |
|----------|---------|
| **[docs/architecture.md](docs/architecture.md)** | Project structure, data flow, bundle composition |
| **[docs/data-model.md](docs/data-model.md)** | DuckDB/Parquet table schemas with ER diagram |
| **[docs/features/](docs/features/)** | Per-tab documentation (API Explorer, Releases, etc.) |
| **[docs/ui-patterns.md](docs/ui-patterns.md)** | Component organization, styling, state patterns |

## Project Structure

```
k8s-compass/
├── packages/web/               # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── features/           # API Explorer, Releases, Control Plane, Learn, Analytics
│   │   └── shared/             # Hooks, store, components, types
│   └── public/data/parquet/    # DuckDB data (source of truth)
│
├── pipeline/                   # Python data pipeline (uv)
│   ├── src/k8s/
│   │   ├── cli/                # CLI commands
│   │   ├── tui/                # Interactive TUI
│   │   ├── core/               # Config, models
│   │   ├── input/              # Upstream data fetching
│   │   ├── transform/          # Data transformation (openapi, release, kep, content, components)
│   │   └── output/             # Parquet export
│   └── data/
│       ├── curated/            # Manual enrichments, content links
│       ├── repos/              # Git clones (kubernetes, enhancements, website)
│       └── upstream/           # Staged upstream data
│
└── docs/                       # Project documentation
```

## Data Model

All data is stored in Parquet files and queryable via the Analytics tab using DuckDB SQL.

See [docs/data-model.md](docs/data-model.md) for the complete schema with ER diagram, table definitions, and column descriptions.

## License

This project is licensed under the [Apache License, Version 2.0](LICENSE).

Copyright 2025 K8s Compass Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
