# Data Schema

## API Tree Structure

Located in `packages/web/public/data/k8s/api-trees/{version}.json`

```typescript
interface APITree {
  version: string           // "1.35"
  releaseDate: string       // "2025-12-17"
  groups: APIGroup[]
}

interface APIGroup {
  name: string              // "core", "apps", "networking.k8s.io"
  displayName: string       // "Core", "Apps", "Networking"
  description: string
  color: string             // Hex color for visualization
  versions: APIVersion[]
}

interface APIVersion {
  name: string              // "v1", "v1beta1"
  isPreferred: boolean
  kinds: Kind[]
}

interface Kind {
  name: string              // "Pod", "Deployment"
  singularName: string
  pluralName: string
  scope: "Namespaced" | "Cluster"
  shortNames: string[]      // ["po", "deploy"]
  categories: string[]
  schemaRef: string         // Path to full schema
  fieldCount: number
  description: string
  docsUrl?: string          // Link to kubernetes.io docs
  relationships: Relationship[]
}

interface Relationship {
  type: "owns" | "selects" | "references" | "mounts" | "configures"
  targetKind: string
  targetGroup: string
  description: string
  fieldPath?: string        // "spec.template" for Deployment→Pod
}
```

## Release Notes Structure

Located in `packages/web/public/data/k8s/releases/{version}.json`

```typescript
interface ReleaseNotes {
  version: string
  codename?: string         // "Octarine: The Color of Magic"
  releaseDate: string
  summary: {
    total: number
    stable: number
    beta: number
    alpha: number
  }
  themes: string[]          // ["DRA", "Security", "Scheduling"]
  features: Feature[]
  deprecations: Deprecation[]
  references: Reference[]
}

interface Feature {
  kep: string               // "KEP-1287"
  kepPath?: string          // "sig-node/1287-in-place-update-pod-resources"
  title: string
  stage: "alpha" | "beta" | "stable"
  sig: string               // "Node", "Apps", "Network"
  category: string
  description: string
  impact?: string
  featureGate?: string
  affectedKinds?: string[]  // ["Pod", "Deployment"]
  affectedFields?: string[]
  history: {
    alpha?: string          // "1.27"
    beta?: string           // "1.33"
    stable?: string
  }
}
```

## Naming Conventions

- **JSON (frontend)**: camelCase (`fieldCount`, `docsUrl`, `targetKind`)
- **Python (pipeline)**: snake_case (`field_count`, `docs_url`, `target_kind`)
- **json_writer.py converts**: Python models → JSON with camelCase

## Key Files

- `pipeline/src/k8s_pipeline/models.py` - Pydantic models (source of truth)
- `pipeline/src/k8s_pipeline/parquet_exporter.py` - DuckDB schema definitions
- `packages/web/src/types/index.ts` - TypeScript interfaces (must match JSON)
- `packages/web/public/data/k8s/releases/schema.json` - JSON Schema for releases
