# K8s API Explorer - Data Sources

This document describes all data sources used (and planned) for enriching the K8s API Explorer.
It also documents the **provenance** of each piece of data - how it was created and how to maintain it.

---

## Data Provenance Overview

Our data falls into three categories based on how it's generated:

| Category | Description | Examples |
|----------|-------------|----------|
| **Deterministic** | Automatically computed from source data, always reproducible | OpenAPI parsing, schema diffs |
| **Curated Mappings** | Hardcoded in `config.py`, manually maintained | Docs URLs, short names, colors |
| **LLM-Assisted** | Generated with LLM help, stored as JSON files | Release notes, feature descriptions |

---

## Current Sources

### 1. OpenAPI Specifications
**Source:** `https://raw.githubusercontent.com/kubernetes/kubernetes/release-{version}/api/openapi-spec/swagger.json`

**What we extract:**
- API groups, versions, and kinds
- Field schemas (name, type, description, required, enum, constraints)
- Type references (`$ref` to other K8s types like `PodTemplateSpec`, `ObjectMeta`)
- Kind descriptions
- Field counts
- Deprecation flags (`deprecated: true` in OpenAPI)

**Output files:** 
- `api-trees/{version}.json` - API structure (groups, versions, kinds, relationships)
- `schemas/{version}.json` - Full field schemas for all kinds

**Type References:**
When a field references another K8s type (via `$ref` in OpenAPI), we extract the type name and store it as `refKind`. This enables:
- Showing what type a field contains (e.g., `spec.template` → `PodTemplateSpec`)
- Future navigation between related types
- Understanding the structure of complex nested objects

Note: Referenced types are internal K8s types (like `PodTemplateSpec`, `ObjectMeta`, `LabelSelector`), not top-level API Kinds. They don't have their own API endpoints but are embedded within other resources.

---

### 2. Object Relationships (Inferred)
**Source:** Hardcoded patterns in `openapi_tree_parser.py` based on K8s conventions

**Category:** Curated Mappings

**Current relationships:**
- `owns` - Parent creates/manages child (Deployment → ReplicaSet → Pod)
- `selects` - Uses label selector (Service → Pod, NetworkPolicy → Pod)
- `references` - Points to another resource (Pod → ServiceAccount, Pod → ConfigMap)
- `mounts` - Mounts as volume (Pod → Secret, Pod → PVC)

**How it works:** Pattern matching on known field paths (e.g., `spec.template` implies ownership)

**How it was created:**
1. Developer manually identified common K8s relationship patterns
2. Patterns were encoded in `openapi_tree_parser.py` → `infer_relationships()` function
3. Each pattern maps (Kind, field_path) → (relationship_type, target_kind, target_group, description)

**Location:** `pipeline/src/k8s/transform/openapi_tree_parser.py` → `relationship_patterns` dict (~30 patterns)

**How to add new relationships:**
```python
# In openapi_tree_parser.py, add to relationship_patterns dict:
relationship_patterns = {
    # ...existing patterns...
    ("NewKind", "spec.someRef"): ("references", "TargetKind", "target.group", "Description"),
}
```

**Limitations:** 
- Not exhaustive - only covers common patterns
- Doesn't detect CRD relationships
- Could be improved with LLM inference

---

### 3. Curated Metadata (config.py)

**Source:** `pipeline/src/k8s_pipeline/config.py`

**Category:** Curated Mappings (manually maintained)

This file contains several hardcoded mappings that enrich the parsed data:

#### 3.1 Documentation URLs (`KIND_DOCS_URLS`)

**What:** Maps Kind names to their official kubernetes.io documentation pages.

**How it was created:**
1. LLM was asked to find official docs URLs for common K8s kinds
2. URLs were manually verified to ensure they point to correct pages
3. Added to `KIND_DOCS_URLS` dict in `config.py`

**Current coverage:** ~50 kinds have docs URLs (out of ~100+ total kinds)

**How to add new docs URLs:**
```python
# In config.py, add to KIND_DOCS_URLS dict:
KIND_DOCS_URLS = {
    # ...existing URLs...
    "NewKind": "https://kubernetes.io/docs/concepts/.../",
}
```

**Kinds without docs URLs:** Show `docsUrl: null` in output JSON. These include:
- Internal API types (APIGroup, APIVersions, Status, WatchEvent)
- Less common resources (Binding, ComponentStatus)
- Newer resources not yet documented

#### 3.2 API Group Colors (`GROUP_COLORS`)

**What:** Hex colors for visualizing API groups in the UI.

**How it was created:**
1. Colors were manually selected to be visually distinct
2. Core group uses blue (#3B82F6), apps uses green (#10B981), etc.
3. Default fallback color is slate (#64748B)

**Location:** `GROUP_COLORS` dict in `config.py`

#### 3.3 API Group Display Names (`GROUP_DISPLAY_NAMES`)

**What:** Human-friendly names for API groups (e.g., "networking.k8s.io" → "Networking")

**How it was created:** Manually curated based on K8s conventions.

**Location:** `GROUP_DISPLAY_NAMES` dict in `config.py`

#### 3.4 Cluster-Scoped Kinds (`CLUSTER_SCOPED_KINDS`)

**What:** Set of Kind names that are cluster-scoped (not namespaced).

**How it was created:**
1. Identified from K8s documentation and API discovery
2. Manually verified against `kubectl api-resources --namespaced=false`

**Location:** `CLUSTER_SCOPED_KINDS` set in `config.py`

#### 3.5 Short Names and Categories

**What:** kubectl short names (e.g., "po" for Pod) and categories (e.g., "all").

**How it was created:**
1. Extracted from `kubectl api-resources` output
2. Hardcoded in `openapi_tree_parser.py` → `get_short_names()` and `get_categories()`

**Location:** `openapi_tree_parser.py` (not in config.py)

#### 3.6 Release Dates

**What:** Maps K8s versions to their release dates.

**How it was created:**
1. Looked up from official K8s release announcements
2. Hardcoded in `openapi_tree_parser.py` → `get_release_date()`

**Location:** `openapi_tree_parser.py` → `release_dates` dict

---

### 4. Version Diffs (Computed)
**Source:** Comparison of `schemas/{version}.json` files between consecutive versions

**Category:** Deterministic

**What we compute:**
- Kinds added/removed between versions
- Fields added/removed/modified between versions
- Fields newly marked as deprecated

**Output files:**
- `diffs/{from}-{to}.json` - Changes between two consecutive versions
- `field-history.json` - Aggregated history for all fields

**Version Tracking Fields:**
| Field | How Computed | Description |
|-------|--------------|-------------|
| `introducedIn` | First version where field exists | e.g., "1.25" |
| `deprecatedIn` | First version where `deprecated: true` | e.g., "1.28" |
| `removedIn` | First version where field is gone | e.g., "1.31" |

**Diff JSON Structure:**
```json
{
  "fromVersion": "1.34",
  "toVersion": "1.35",
  "summary": {
    "kindsAdded": 1,
    "kindsRemoved": 0,
    "fieldsAdded": 66,
    "fieldsRemoved": 7,
    "fieldsModified": 0,
    "fieldsDeprecated": 0
  },
  "kindsAdded": [{"kind": "Workload", "group": "scheduling.k8s.io"}],
  "kindsRemoved": [],
  "fieldsAdded": [{"path": "spec.newField", "kind": "Pod", "group": "core", "type": "string"}],
  "fieldsRemoved": [...],
  "fieldsModified": [...],
  "fieldsDeprecated": [...]
}
```

**Field History JSON Structure:**
```json
{
  "apps/Deployment": [
    {"path": "spec.revisionHistoryLimit", "introducedIn": "1.25"},
    {"path": "spec.paused", "introducedIn": "1.25", "deprecatedIn": "1.30"},
    {"path": "spec.oldField", "introducedIn": "1.25", "removedIn": "1.28"}
  ]
}
```

**Use Cases:**
1. "What changed from 1.29 to 1.30?" → Load `diffs/1.29-1.30.json`
2. "What changed from 1.29 to 1.32?" → Accumulate diffs: 1.29→1.30, 1.30→1.31, 1.31→1.32
3. "When was this field introduced?" → Look up in `field-history.json`
4. "Show new fields in this Kind" → Filter fields where `introducedIn` > selected version

**Limitations:**
- `introducedIn` is only recorded for fields that appeared AFTER our first tracked version (1.25)
- Fields that exist in 1.25 have unknown introduction dates (could be 1.0, 1.10, etc.)
- Cannot detect *why* something was removed (needs release notes/KEPs)
- Cannot detect what replaced a removed field (needs manual curation)

---

## LLM-Assisted Sources

### 5. Release Notes
**Source:** `packages/web/public/data/releases/{version}.json`

**Category:** LLM-Assisted (manually triggered, stored as JSON)

**Status:** ✅ Implemented (manual curation with LLM, agent automation planned)

**Schema Version:** v2 (see `releases/schema-v2.json` and `releases/DESIGN.md`)

#### Data Source Hierarchy

```
CHANGELOG (Primary Source - Raw Truth)
    ↓
Official Release Blog (Enrichment - Highlights, Themes)
    ↓
KEP Repository (Enrichment - History, Feature Gates)
    ↓
External Blogs (References)
```

**CHANGELOG is the starting point** - it contains the complete list of all changes, bug fixes, and patch releases. The official blog provides curated highlights and human-readable summaries on top.

#### Schema v2 Key Features

| Field | Purpose |
|-------|---------|
| `urgentUpgradeNotes` | Breaking changes requiring action |
| `knownIssues` | Post-release discovered bugs |
| `features[].isHighlight` | Featured in official blog spotlight |
| `bugFixes` | Bug fixes organized by SIG/component |
| `apiChanges` | API-level changes (new kinds, fields) |
| `patchReleases` | Nested patch releases (1.35.1, 1.35.2) |
| `projectVelocity` | Release statistics |

#### Current Coverage

- **v2 schema:** 1.35 (example at `1.35-v2.json`)
- **v1 schema:** 1.33, 1.34, 1.35 (to be migrated)
- **Backfill needed:** 1.25-1.32

#### Extraction Process

1. **Parse CHANGELOG** (deterministic)
   - Fetch `CHANGELOG-X.YY.md` from GitHub
   - Extract sections: Urgent Upgrade Notes, Known Issues, Bug Fixes, Patch Releases
   - Parse PR numbers for traceability

2. **Enrich from Blog** (LLM-assisted)
   - Fetch official release blog
   - Extract: codename, themes, spotlight features (mark `isHighlight: true`)
   - Extract project velocity stats

3. **Enrich from KEPs** (API + LLM)
   - Fetch `kep.yaml` for each feature
   - Extract: history, feature gates, affected components
   - Infer affected Kinds from KEP content

4. **Add References**
   - Official blog URL
   - CHANGELOG URL
   - External blog posts

#### Structure (v2)

```json
{
  "version": "1.35",
  "codename": "Timbernetes",
  "releaseDate": "2025-12-17",
  "summary": { "total": 60, "stable": 17, "beta": 19, "alpha": 22 },
  "themes": ["Resource Management", "Security"],
  "urgentUpgradeNotes": [
    { "title": "cgroup v1 removed", "action": "Upgrade to cgroup v2" }
  ],
  "features": [
    {
      "kep": "KEP-1287",
      "title": "In-place Update of Pod Resources",
      "stage": "stable",
      "isHighlight": true,
      "sig": "Node",
      "affectedKinds": ["Pod"],
      "history": { "alpha": "1.27", "beta": "1.33", "stable": "1.35" }
    }
  ],
  "bugFixes": [
    { "title": "Fixed scheduler crash", "sig": "Scheduling", "component": "kube-scheduler" }
  ],
  "patchReleases": [
    { "version": "1.35.1", "releaseDate": "2026-01-08", "bugFixes": [...] }
  ]
}
```

#### Use Cases

1. **Release Overview** → Show themes, highlights, summary stats
2. **Upgrade Planning** → Show urgent notes, deprecations, known issues
3. **Feature Tracking** → Query features across releases by KEP/title
4. **Bug Investigation** → Filter bug fixes by SIG/component
5. **Patch Details** → Expand patch releases for security fixes

**Documentation:** See `packages/web/public/data/releases/DESIGN.md` for full schema design

---

## Planned Sources

### 6. KEPs (Kubernetes Enhancement Proposals)
**Source:** `https://github.com/kubernetes/enhancements/tree/master/keps`

**What we could extract:**
- Feature motivation and design rationale
- Which fields/kinds a KEP affects
- Feature gate names
- Graduation timeline (alpha/beta/stable versions)
- SIG ownership

**Structure:**
```
keps/
  sig-node/
    123-feature-name/
      README.md      # Main KEP document
      kep.yaml       # Structured metadata
```

**kep.yaml contains:**
- Title, status, SIG
- Affected components (kubelet, scheduler, etc.)
- Feature gates
- Milestone versions

---

### 7. GitHub Issues & PRs
**Source:** GitHub API for `kubernetes/kubernetes` repo

**What we could extract:**
- Bug reports linked to specific fields/kinds
- Fix PRs with version tags
- Known issues and workarounds
- Community discussions

**Useful queries:**
- Issues labeled `kind/bug` + `area/api`
- PRs with `release-note` labels
- Issues mentioning specific field paths

**Challenges:**
- Rate limiting on GitHub API
- Need to parse issue/PR bodies for field references
- Large volume of data

---

### 8. Official Documentation
**Source:** `https://kubernetes.io/docs/reference/kubernetes-api/`

**What we could extract:**
- Curated descriptions (often better than OpenAPI)
- Usage examples
- Best practices
- Common pitfalls

**Challenges:**
- HTML scraping required
- Mapping docs to specific fields
- Docs may lag behind API changes

---

### 9. Migration Paths (Future - Manual/LLM)
**What we want:**
- `replacedBy` field linking removed fields to their replacements
- Migration examples (old YAML → new YAML)
- Breaking change warnings

**How to populate:**
- Manual curation for common cases
- LLM inference from release notes
- Community contributions

---

### 10. Curated Blog Posts (Future - LLM-Assisted)

**Source:** Various Kubernetes-focused blogs and publications

**Category:** LLM-Assisted (curated, linked to Kinds/fields)

**What we want:**
Beyond release notes, there are many high-quality blog posts that explain specific features, troubleshoot common issues, or document bug discoveries. These could be linked to specific Kinds or fields.

**Types of content:**
- Deep-dive feature explanations (e.g., "Understanding Pod Security Standards")
- Troubleshooting guides (e.g., "Why your PVC is stuck in Pending")
- Bug discovery posts (e.g., "The curious case of disappearing endpoints")
- Best practices (e.g., "Resource limits you should always set")
- Migration guides (e.g., "Moving from PodSecurityPolicy to Pod Security Admission")

**Potential sources:**
- kubernetes.io/blog (official)
- learnk8s.io
- iximiuz.com
- Medium K8s publications
- Company engineering blogs (Datadog, Grafana, etc.)

**Proposed schema:**
```json
{
  "blogs": [
    {
      "url": "https://example.com/understanding-pod-resources",
      "title": "Understanding Pod Resource Management",
      "source": "learnk8s.io",
      "publishedDate": "2024-06-15",
      "type": "deep-dive",
      "affectedKinds": ["Pod"],
      "affectedFields": ["spec.containers[].resources"],
      "tags": ["resources", "limits", "requests", "QoS"],
      "summary": "Explains how resource requests and limits work..."
    }
  ]
}
```

**How to populate:**
1. LLM searches for high-quality K8s blog posts
2. LLM extracts metadata and links to Kinds/fields
3. Human reviews and approves additions
4. Stored in `blogs/curated.json` or similar

**Use cases:**
- "Show me articles about Pod networking" → Filter by affectedKinds + tags
- "Learn more about this field" → Link from field detail view
- "Troubleshooting guides for Service" → Filter by type + Kind

---

### 11. Kubernetes Slack Archive (Future - Requires Access)

**Source:** Kubernetes Slack workspace (kubernetes.slack.com)

**Category:** Community knowledge (requires special access)

**Status:** 🔒 Requires admin cooperation or workspace membership

**What we could extract:**
- Common questions and answers about specific Kinds/fields
- Troubleshooting discussions
- Best practices shared by community experts
- Links to issues/PRs mentioned in discussions

**Relevant channels:**
- `#kubernetes-users` - General user questions
- `#kubernetes-novice` - Beginner questions
- `#sig-*` channels - SIG-specific discussions
- `#kube-*` channels - Component-specific (kubelet, scheduler, etc.)

**Access options:**

1. **Official Archive** (Limited)
   - K8s admins periodically archive the workspace
   - Available at: https://kubernetes.slack.com (requires membership)
   - No public download link currently available
   - Would need to request from Slack admins

2. **Slack API** (Requires App)
   - Create a Slack app with `channels:history` and `channels:read` scopes
   - Use Conversations API to fetch messages
   - Rate limited, requires workspace admin approval
   - Can only access channels the app is added to

3. **Third-party Tools** (Personal use)
   - Tools like `slackdump` (github.com/rusq/slackdump) can export messages
   - Requires personal Slack token
   - Only exports channels you have access to
   - Not suitable for bulk community data

**Challenges:**
- No public archive currently available
- Slack's free tier limits history to 90 days
- K8s workspace is very large (150k+ members)
- Privacy concerns with exporting conversations
- Would need admin cooperation

**Proposed approach:**
1. Contact K8s Slack admins about archive availability
2. If available, download periodic archives
3. Use LLM to extract Q&A pairs relevant to specific Kinds
4. Store as structured data with Kind/field linkage

**Alternative: Curated Q&A**
Instead of bulk export, manually curate high-value Q&A:
```json
{
  "qa": [
    {
      "question": "Why is my Pod stuck in Pending?",
      "answer": "Common causes: insufficient resources, node selector mismatch...",
      "source": "slack:#kubernetes-users",
      "date": "2024-01-15",
      "affectedKinds": ["Pod"],
      "affectedFields": ["status.phase", "spec.nodeSelector"],
      "tags": ["troubleshooting", "scheduling"]
    }
  ]
}
```

**Note:** The Kubernetes community is considering moving to Discord due to Slack's enterprise tier changes. This may affect future data availability.

---

## Data Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DETERMINISTIC PIPELINE                       │
│  (Always produces same output for same input)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OpenAPI Specs ──────► Parser ──────► api-trees/*.json          │
│       │                   │                                     │
│       │                   └──────────► schemas/*.json           │
│       │                                                         │
│  Relationship ───────► Inference ────► (embedded in api-trees)  │
│  Patterns                                                       │
│                                                                 │
│  Schema Diffs ───────► Differ ───────► diffs/*.json             │
│                           │                                     │
│                           └──────────► field-history.json       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ENRICHMENT PIPELINE (Future)                  │
│  (May use LLMs, results should be cached/versioned)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Release Notes ──────► LLM ──────────► field_changes/*.json     │
│                                                                 │
│  KEPs ───────────────► Parser ───────► keps/*.json              │
│                                                                 │
│  GitHub Issues ──────► LLM ──────────► known_issues/*.json      │
│                                                                 │
│  Docs ───────────────► Scraper ──────► curated_docs/*.json      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Output Files Summary

| File | Source | Content |
|------|--------|---------|
| `api-trees/{version}.json` | OpenAPI | Groups, versions, kinds, relationships |
| `schemas/{version}.json` | OpenAPI | Full field schemas with types, descriptions |
| `diffs/{from}-{to}.json` | Schema comparison | Changes between consecutive versions |
| `field-history.json` | Schema comparison | introducedIn/deprecatedIn/removedIn for all fields |
| `versions.json` | Config | Available versions list |

---

## Running the Pipeline

```bash
cd pipeline
uv sync

# Fetch all versions (generates api-trees and schemas)
uv run k8s-pipeline fetch --all

# Fetch single version
uv run k8s-pipeline fetch -v 1.35

# Generate all diffs and field history
uv run k8s-pipeline diff --all

# Generate single diff
uv run k8s-pipeline diff --from 1.29 --to 1.30

# Skip schema generation (faster, api-trees only)
uv run k8s-pipeline fetch --all --no-schemas

# Clear cache and refetch
uv run k8s-pipeline fetch --all --no-cache

# List configured versions
uv run k8s-pipeline list-versions

# Show info about a version
uv run k8s-pipeline info 1.35
```

---

## Contributing New Sources

To add a new data source:

1. Create a new module in `src/k8s_pipeline/` (e.g., `kep_parser.py`)
2. Add models in `src/k8s_pipeline/models.py`
3. Add CLI command in `src/k8s_pipeline/cli.py`
4. Update output in `src/k8s_pipeline/writer.py`
5. **Document the source in this file** (DATA_SOURCES.md)

---

## Version History

- **v1**: Initial pipeline with OpenAPI parsing, relationships
- **v2**: Added full schema generation with field details
- **v3**: Added type references (`refKind`)
- **v4**: Added version diffs and field history tracking
- **v5**: Documented data provenance and LLM-assisted curation process

---

## Summary: Data Provenance by File

| Output File | Category | Source | How to Update |
|-------------|----------|--------|---------------|
| `api-trees/{version}.json` | Deterministic | OpenAPI spec | Run `k8s-pipeline fetch` |
| `schemas/{version}.json` | Deterministic | OpenAPI spec | Run `k8s-pipeline fetch` |
| `diffs/{from}-{to}.json` | Deterministic | Schema comparison | Run `k8s-pipeline diff` |
| `field-history.json` | Deterministic | Schema comparison | Run `k8s-pipeline diff --all` |
| `versions.json` | Deterministic | Config | Run `k8s-pipeline fetch` |
| `releases/{version}.json` | Deterministic + LLM | release-notes.json + CHANGELOG + Blog | `fetch-release-notes` + manual enrichment |
| `releases/schema-v2.json` | Manual | - | Edit schema definition |
| `releases/DESIGN.md` | Manual | - | Edit design documentation |
| `releases/index.json` | Manual | - | Edit manually |
| `blogs/curated.json` | LLM-Assisted | Various blogs | Manual LLM curation (planned) |
| `qa/curated.json` | LLM-Assisted | Slack/forums | Manual curation (planned) |
| Kind `docsUrl` | Curated | kubernetes.io | Edit `config.py` → `KIND_DOCS_URLS` |
| Kind `relationships` | Curated | K8s conventions | Edit `openapi_tree_parser.py` → `relationship_patterns` |
| Kind `shortNames` | Curated | kubectl | Edit `openapi_tree_parser.py` → `get_short_names()` |
| Group `color` | Curated | Design choice | Edit `config.py` → `GROUP_COLORS` |
| Group `displayName` | Curated | K8s conventions | Edit `config.py` → `GROUP_DISPLAY_NAMES` |
| Version `releaseDate` | Curated | K8s announcements | Edit `openapi_tree_parser.py` → `get_release_date()` |

### Primary Data Sources Summary

| Source | URL Pattern | Data Type | Best For |
|--------|-------------|-----------|----------|
| **release-notes.json** ⭐ | `cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json` | JSON | Per-PR changes with SIG/kind metadata |
| **CHANGELOG.md** | `github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-X.YY.md` | Markdown | Patch releases, CVEs, urgent notes |
| **Release Blog** | `kubernetes.io/blog/YYYY/MM/DD/kubernetes-X-YY-release-announcement/` | HTML | Codename, themes, highlights, velocity |
| **KEPs** | `github.com/kubernetes/enhancements/tree/master/keps/sig-*/XXXX-*` | YAML+MD | Feature history, gates, design |
| **OpenAPI Spec** | `github.com/kubernetes/kubernetes/blob/release-X.YY/api/openapi-spec/swagger.json` | JSON | API structure, schemas |
| **GitHub PRs/Issues** | `api.github.com/repos/kubernetes/kubernetes/pulls/{id}` | JSON | PR context, linked issues, root cause |
| **CVE Feed** 🔴 | `kubernetes.io/docs/reference/issues-security/official-cve-feed/feed.json` | JSON | Real-time CVE announcements (runtime) |

---

## 12. Local Cloned Repositories

**Location:** `pipeline/repos/` (git-ignored, not committed to source control)

**Category:** Primary Source Data (local access to upstream repos)

**Status:** ✅ Recommended for CHANGELOG analysis

### Why Clone Locally?

Some data sources are difficult to fetch via HTTP due to:
- Raw file content-type restrictions (GitHub raw URLs return `text/plain`)
- Large file sizes (CHANGELOGs can be 100KB+)
- Need to analyze multiple files across versions
- Faster iteration during development

### Recommended Repositories

| Repository | Purpose | Clone Command |
|------------|---------|---------------|
| `kubernetes/kubernetes` | CHANGELOGs, API specs | `git clone --depth 1 https://github.com/kubernetes/kubernetes.git` |
| `kubernetes/enhancements` | KEPs (feature proposals) | `git clone --depth 1 https://github.com/kubernetes/enhancements.git` |
| `kubernetes/sig-release` | Release schedules, notes | `git clone --depth 1 https://github.com/kubernetes/sig-release.git` |
| `kubernetes/website` | Official documentation | `git clone --depth 1 https://github.com/kubernetes/website.git` |

### Setup Instructions

```bash
cd pipeline

# Create repos directory (already in .gitignore)
mkdir -p repos
cd repos

# Clone kubernetes/kubernetes (for CHANGELOGs)
git clone --depth 1 https://github.com/kubernetes/kubernetes.git

# Clone kubernetes/enhancements (for KEPs)
git clone --depth 1 https://github.com/kubernetes/enhancements.git

# Optional: Clone specific branches for older versions
cd kubernetes
git fetch --depth 1 origin release-1.30:release-1.30
git fetch --depth 1 origin release-1.31:release-1.31
# etc.
```

### Key Files in kubernetes/kubernetes

```
kubernetes/
├── CHANGELOG/
│   ├── CHANGELOG-1.30.md    # Release notes for 1.30.x
│   ├── CHANGELOG-1.31.md    # Release notes for 1.31.x
│   ├── CHANGELOG-1.32.md    # etc.
│   ├── CHANGELOG-1.33.md
│   ├── CHANGELOG-1.34.md
│   └── CHANGELOG-1.35.md
├── api/
│   └── openapi-spec/
│       └── swagger.json     # OpenAPI spec (current branch)
└── staging/
    └── src/
        └── k8s.io/
            └── api/         # API type definitions
```

### Key Files in kubernetes/enhancements

```
enhancements/
└── keps/
    ├── sig-node/
    │   └── 1287-in-place-update-pod-resources/
    │       ├── README.md    # KEP document
    │       └── kep.yaml     # Structured metadata
    ├── sig-apps/
    │   └── ...
    └── sig-network/
        └── ...
```

### CHANGELOG Structure (from local analysis)

Each `CHANGELOG-X.YY.md` file follows this structure:

```markdown
# vX.YY.0

## Urgent Upgrade Notes
### (No, K8s API changes are not urgent)
- Breaking change 1 (#PR)
- Breaking change 2 (#PR)

## Changes by Kind

### Deprecation
- Deprecated item 1 (#PR)

### API Change
- API change 1 (#PR)

### Feature
- Feature 1 (#PR)

### Bug or Regression
- Bug fix 1 (#PR)

### Other (Cleanup or Flake)
- Cleanup item 1 (#PR)

## Dependencies

### Added
- dependency v1.2.3

### Changed
- dependency v1.2.3 → v1.2.4

### Removed
- old-dependency

---

# vX.YY.1 (patch release)

## Changes by Kind
...
```

### Mapping CHANGELOG to Schema v2

| CHANGELOG Section | Schema v2 Field | Notes |
|-------------------|-----------------|-------|
| `## Urgent Upgrade Notes` | `urgentUpgradeNotes[]` | Breaking changes |
| `### Deprecation` | `deprecations[]` | Items being deprecated |
| `### API Change` | `apiChanges[]` | New/modified APIs |
| `### Feature` | `features[]` | New features (need KEP enrichment) |
| `### Bug or Regression` | `bugFixes[]` | Bug fixes |
| `### Other` | (skip or minimal) | Cleanup, not user-facing |
| `## Dependencies` | (skip) | Internal dependencies |
| `# vX.YY.Z` sections | `patchReleases[]` | Patch releases |

### Usage in Pipeline

```python
# In a future changelog_parser.py module:
from pathlib import Path

REPOS_DIR = Path(__file__).parent.parent.parent / "repos"
K8S_REPO = REPOS_DIR / "kubernetes"

def parse_changelog(version: str) -> dict:
    """Parse CHANGELOG from local clone."""
    changelog_path = K8S_REPO / "CHANGELOG" / f"CHANGELOG-{version}.md"
    
    if not changelog_path.exists():
        raise FileNotFoundError(f"CHANGELOG not found: {changelog_path}")
    
    content = changelog_path.read_text()
    # Parse sections...
    return parsed_data
```

### Keeping Repos Updated

```bash
cd pipeline/repos/kubernetes
git pull origin master

# Or fetch specific release branches
git fetch origin release-1.36:release-1.36
```

### Note on .gitignore

The `repos/` directory is excluded from version control:
```gitignore
# In pipeline/.gitignore
repos/
```

This keeps the main repository small while allowing local access to large upstream repos.

---

## 13. Official Release Notes JSON (cdn.dl.k8s.io) ⭐ PRIMARY SOURCE

**Source:** `https://cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json`

**Category:** Primary Source (machine-readable, official)

**Status:** ✅ Best data source for release notes!

**Reference:** [kubernetes/sig-release/release-engineering/release-notes.md](https://github.com/kubernetes/sig-release/blob/master/release-engineering/release-notes.md)

### Kubernetes Release Notes Toolchain

The creation of release notes is managed by SIG Release using the `krel` toolbox:

```
Pull Request                    Kubernetes Release Toolbox              Consumers
┌─────────────┐                ┌─────────────────────────┐
│```release-  │                │                         │
│note         │───────────────►│ krel release-notes ─────┼──► JSON ──► relnotes.k8s.io
│User facing  │                │         │               │
│change       │                │         └───────────────┼──► Markdown
│```          │                │                         │
│             │                │ krel changelog ─────────┼──► Markdown ──► CHANGELOG-X.YY.md
│Labels:      │                │                         │
│- kind/*     │                │ krel docs ──────────────┼──► Markdown ──► kubernetes.io
│- sig/*      │                │                         │
│- area/*     │                └─────────────────────────┘
└─────────────┘
```

**Key insight:** The JSON at `cdn.dl.k8s.io` and the CHANGELOG markdown are generated from the **same source data** (PR release-note blocks + labels). The JSON is the structured version; the CHANGELOG is the human-readable version.

### URL Pattern

```
https://cdn.dl.k8s.io/release/v{major}.{minor}.{patch}/release-notes.json
```

**Examples:**
- `https://cdn.dl.k8s.io/release/v1.35.0/release-notes.json`
- `https://cdn.dl.k8s.io/release/v1.34.0/release-notes.json`

### JSON Structure

The JSON is keyed by PR number (not an array):

```json
{
  "123456": {
    "commit": "abc123...",
    "text": "Plain text description of the change",
    "markdown": "Markdown formatted description with links",
    "author": "github-username",
    "author_url": "https://github.com/username",
    "pr_url": "https://github.com/kubernetes/kubernetes/pull/123456",
    "pr_number": 123456,
    "areas": ["kubelet", "test"],
    "kinds": ["feature"],
    "sigs": ["node", "api-machinery"],
    "duplicate": false,
    "is_mapped": true,
    "documentation": [
      {
        "description": "[KEP]",
        "url": "https://github.com/kubernetes/enhancements/tree/master/keps/sig-auth/3331-...",
        "type": "KEP"
      }
    ]
  },
  "123457": { ... }
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Plain text description |
| `markdown` | string | Markdown with links (same as CHANGELOG entry) |
| `commit` | string | Git commit SHA |
| `author` | string | GitHub username |
| `author_url` | string | GitHub profile URL |
| `pr_number` | integer | Pull request number |
| `pr_url` | string | Full PR URL |
| `kinds` | string[] | Change types: `feature`, `bug`, `api-change`, `deprecation`, `cleanup`, `documentation`, `failing-test` |
| `sigs` | string[] | SIG labels (lowercase): `node`, `apps`, `network`, `storage`, `auth`, `scheduling`, `api-machinery` |
| `areas` | string[] | Component areas: `kubelet`, `scheduler`, `apiserver`, `kubectl`, `test` |
| `duplicate` | boolean | True if this PR appears in multiple release notes |
| `is_mapped` | boolean | True if PR was mapped to release notes |
| `documentation` | object[] | Doc links (KEPs, design docs) with `description`, `url`, `type` |

### Advantages Over CHANGELOG Parsing

| Aspect | CHANGELOG.md | release-notes.json |
|--------|--------------|-------------------|
| Format | Markdown (needs parsing) | Structured JSON |
| Granularity | Grouped by section | Per-PR objects |
| SIG info | Parsed from `[SIG ...]` suffix | `sigs` array |
| PR numbers | Parsed from markdown links | `pr_number` field |
| Author | Parsed from `[@user](url)` | `author` field |
| KEP links | Not included | `documentation` array |
| Filtering | Manual text search | Query by `kinds`, `sigs`, `areas` |

### Mapping to Schema v2

| release-notes.json `kinds` | Schema v2 `changesByKind` |
|---------------------------|---------------------------|
| `feature` | `feature[]` |
| `bug` | `bugOrRegression[]` |
| `api-change` | `apiChange[]` |
| `deprecation` | `deprecation[]` |
| `cleanup` | `other[]` |
| `documentation` | `documentation[]` |
| `failing-test` | `failingTest[]` |

### Version Availability

| Version | Status | URL |
|---------|--------|-----|
| v1.35.0 | ✅ Available | `cdn.dl.k8s.io/release/v1.35.0/release-notes.json` |
| v1.34.0 | ✅ Available | `cdn.dl.k8s.io/release/v1.34.0/release-notes.json` |
| v1.33.0 | ✅ Available | `cdn.dl.k8s.io/release/v1.33.0/release-notes.json` |
| v1.30.0 | ✅ Available | `cdn.dl.k8s.io/release/v1.30.0/release-notes.json` |
| v1.25.0 | ✅ Available | `cdn.dl.k8s.io/release/v1.25.0/release-notes.json` |
| v1.20.0 | ✅ Available | `cdn.dl.k8s.io/release/v1.20.0/release-notes.json` |
| v1.19.0 | ❌ Not available | 404 |
| v1.18.0 | ❌ Not available | 404 |
| v1.15.0 | ❌ Not available | 404 |

**Summary:** Available for v1.20.0+ (released Dec 2020). Earlier versions don't have this JSON.

### How It's Generated

The `krel release-notes` tool from `kubernetes/release` repo:
1. Scans merged PRs between release tags
2. Extracts `release-note` block from PR description
3. Parses labels (`kind/*`, `sig/*`, `area/*`)
4. Generates both JSON and markdown outputs

**PR Description Template:**
```markdown
```release-note
Description of the change that will appear in release notes.
```
```

### Pipeline Integration

```python
import requests

def fetch_release_notes_json(version: str) -> dict:
    """Fetch official release-notes.json from cdn.dl.k8s.io"""
    # Ensure version format is X.YY.Z (add .0 if needed)
    if version.count('.') == 1:
        version = f"{version}.0"
    
    url = f"https://cdn.dl.k8s.io/release/v{version}/release-notes.json"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def transform_to_changes_by_kind(release_notes: dict) -> dict:
    """Transform release-notes.json to changesByKind structure"""
    kind_mapping = {
        "feature": "feature",
        "bug": "bugOrRegression",
        "api-change": "apiChange",
        "deprecation": "deprecation",
        "cleanup": "other",
        "documentation": "documentation",
        "failing-test": "failingTest",
    }
    
    changes_by_kind = {v: [] for v in kind_mapping.values()}
    
    for note in release_notes.get("release-notes", []):
        if note.get("do_not_publish"):
            continue
        
        entry = {
            "description": note["text"],
            "prNumber": note.get("pr_number"),
            "prUrl": note.get("pr_url"),
            "author": note.get("author"),
            "sigs": [sig.replace("-", " ").title() for sig in note.get("sigs", [])],
        }
        
        for kind in note.get("kinds", []):
            target = kind_mapping.get(kind, "other")
            changes_by_kind[target].append(entry)
    
    return changes_by_kind
```

### CLI Command (Planned)

```bash
# Fetch release notes JSON for a version
uv run k8s-pipeline fetch-release-notes --version 1.35

# Fetch for all versions
uv run k8s-pipeline fetch-release-notes --all
```

### What This Doesn't Include

The release-notes.json covers the **main release** (X.YY.0) but:
- **Patch releases** (X.YY.1, X.YY.2) have separate JSON files
- **Security information** (CVEs) is in CHANGELOG only
- **Urgent upgrade notes** are in CHANGELOG only
- **Codename/themes** are in release blog only
- **Project velocity stats** are in release blog only

So the complete pipeline is:
1. **release-notes.json** → `changesByKind` (primary structured data)
2. **CHANGELOG.md** → `urgentUpgradeNotes`, `securityInformation`, `patchReleases`
3. **Release blog** → `codename`, `themes`, `isHighlight`, `projectVelocity`
4. **KEPs** → `features[].history`, `features[].featureGate`

---

---

## 14. Last Week in Kubernetes Development (LWKD)

**Source:** `https://lwkd.info` / `https://github.com/kubernetes-sigs/lwkd`

**Category:** Curated Community Content (weekly summaries)

**Status:** 🔜 Planned - repo added to `repo_manager.py`

### What is LWKD?

LWKD (Last Week in Kubernetes Development) is a curated weekly newsletter summarizing what happened in Kubernetes development. It's maintained by community volunteers and published every week.

**Website:** https://lwkd.info  
**Repository:** https://github.com/kubernetes-sigs/lwkd

### Repository Structure

```
lwkd/
├── _posts/                    # Weekly posts as markdown
│   ├── 2024-01-07-update.md
│   ├── 2024-01-14-update.md
│   ├── 2024-01-21-update.md
│   └── ...
├── _config.yml               # Jekyll config
└── index.html                # Site template
```

### Post Format

Each post is a Jekyll markdown file with YAML frontmatter:

```markdown
---
layout: post
title: Week Ending January 14, 2024
date: 2024-01-16 22:00:00 -0000
slug: 2024-01-14-update
---

## Developer News

Summary of important announcements...

## Release Schedule

**Next Deadline:** Feature Freeze, January 30th

## KEP of the Week

[KEP-1234: Feature Name](link) is now in beta...

## Featured PRs

### [#12345](link): PR Title

Description of what this PR does and why it matters...

## Other Merges

* [#12346](link): Brief description
* [#12347](link): Brief description
```

### What We Can Extract

| Section | Use Case |
|---------|----------|
| **Developer News** | Track announcements, policy changes, deprecation notices |
| **Release Schedule** | Timeline context for features |
| **KEP of the Week** | Highlighted KEPs with context/narrative |
| **Featured PRs** | Important changes with human-written explanations |
| **Other Merges** | Comprehensive list of merged PRs |

### Aggregation Ideas

LWKD provides **narrative context** that raw release notes lack:

1. **Enrich Release Notes**
   - Link weekly posts to release versions
   - Add "why this matters" context from LWKD summaries
   - Surface community discussions around features

2. **Feature Timeline**
   - Track KEP mentions across weeks
   - Show progression: "discussed in week X, merged in week Y, released in Z"
   - Build a story around feature development

3. **PR Context**
   - Featured PRs have human-written explanations
   - Better than auto-generated release note text
   - Can link to specific Kinds/fields affected

4. **Community Pulse**
   - Track what the community is excited about
   - Identify trending topics before they hit releases
   - Surface discussions that didn't make it to release notes

### Proposed Schema

```json
{
  "lwkd_posts": [
    {
      "date": "2024-01-14",
      "title": "Week Ending January 14, 2024",
      "url": "https://lwkd.info/2024/01/14/update.html",
      "releaseContext": "1.30 development cycle",
      "kepsMentioned": ["KEP-1234", "KEP-5678"],
      "featuredPRs": [
        {
          "number": 12345,
          "title": "PR Title",
          "summary": "Human-written explanation...",
          "affectedKinds": ["Pod", "Deployment"]
        }
      ],
      "themes": ["scheduling", "security", "DRA"]
    }
  ]
}
```

### Pipeline Integration

```bash
# Clone LWKD repo (added to repo_manager.py)
uv run k8s-pipeline sync-repos lwkd

# Future: Parse posts
uv run k8s-pipeline parse-lwkd --since 2024-01-01
```

### Sync Command

```bash
# Clone the LWKD repository
uv run k8s-pipeline sync-repos lwkd

# Check status
uv run k8s-pipeline list-repos
```

### Future Parser (Planned)

```python
# In a future lwkd_parser.py module:
from pathlib import Path
import re
from datetime import datetime

REPOS_DIR = Path(__file__).parent.parent.parent / "repos"
LWKD_REPO = REPOS_DIR / "lwkd"
POSTS_DIR = LWKD_REPO / "_posts"

def parse_lwkd_posts(since: datetime = None) -> list[dict]:
    """Parse LWKD posts from local clone."""
    posts = []
    
    for post_file in sorted(POSTS_DIR.glob("*.md")):
        # Parse filename: YYYY-MM-DD-update.md
        match = re.match(r"(\d{4}-\d{2}-\d{2})-update\.md", post_file.name)
        if not match:
            continue
        
        date_str = match.group(1)
        post_date = datetime.strptime(date_str, "%Y-%m-%d")
        
        if since and post_date < since:
            continue
        
        content = post_file.read_text()
        post = parse_post_content(content, date_str)
        posts.append(post)
    
    return posts

def parse_post_content(content: str, date: str) -> dict:
    """Extract structured data from post markdown."""
    # Parse frontmatter
    # Extract sections: Developer News, KEP of the Week, Featured PRs, etc.
    # Extract PR numbers and KEP references
    # Return structured dict
    pass
```

### Value Proposition

| Data Source | Provides | Missing |
|-------------|----------|---------|
| release-notes.json | Structured PR data | Context, narrative |
| CHANGELOG.md | Urgent notes, CVEs | Weekly progression |
| Release Blog | Highlights, themes | Development journey |
| **LWKD** | **Weekly narrative, PR context, community pulse** | Structured metadata |

LWKD fills the gap between raw PR data and polished release announcements by providing **weekly snapshots of development activity with human-written context**.

---

## 15. GitHub PRs and Issues

**Source:** GitHub API for `kubernetes/kubernetes` repository

**Category:** Enrichment Data (fetched on-demand, cached locally)

**Status:** ✅ Implemented

### Why GitHub Data?

The release-notes.json provides structured change data, but lacks context:
- **Release note** is terse (1-2 sentences)
- **PR body** has detailed "What this PR does / why we need it"
- **Linked issues** have real-world bug reports, reproduction steps, user impact

### What We Extract

**From PRs:**
| Field | Source | Description |
|-------|--------|-------------|
| `userFacingChange` | PR body `release-note` block | The release note text |
| `prKind` | PR body `/kind` command | feature, bug, cleanup, etc. |
| `relatedIssues` | PR body `Fixes #xxx` | Issue numbers this PR fixes |
| `relatedKeps` | PR body KEP links | KEP references |
| `milestone` | GitHub API | Target release (e.g., "v1.35") |
| `labels` | GitHub API | All PR labels |

**From Issues:**
| Field | Source | Description |
|-------|--------|-------------|
| `title` | GitHub API | Issue title |
| `body` | GitHub API | Full issue description |
| `labels` | GitHub API | Issue labels (kind/bug, sig/*, etc.) |

### Cache Structure

```
pipeline/.cache/github/
├── prs/
│   ├── 123456.json    # Cached PR data
│   ├── 123457.json
│   └── ...
└── issues/
    ├── 119267.json    # Cached issue data
    ├── 126892.json
    └── ...
```

Each cached file contains:
```json
{
  "fetched_at": "2026-01-17T10:30:00Z",
  "data": { /* raw GitHub API response */ },
  "parsed": { /* extracted fields */ }
}
```

### TTL-Based Caching

- Default TTL: 24 hours
- PRs/issues rarely change after merge
- Force refresh with `--force` flag
- Clear cache with `--clear-cache` flag

### Rate Limiting

| Auth Status | Rate Limit | Notes |
|-------------|------------|-------|
| Unauthenticated | 60/hour | Very limited |
| With `GITHUB_TOKEN` | 5000/hour | Recommended |

Set token in `pipeline/.env`:
```
GITHUB_TOKEN=ghp_your_token_here
```

### CLI Commands

```bash
# Fetch specific PRs
uv run k8s-pipeline fetch-github-prs 133779 134744

# Fetch all PRs from a release
uv run k8s-pipeline fetch-github-prs --from-release 1.35

# Force refresh cached PRs
uv run k8s-pipeline fetch-github-prs 133779 --force

# Check rate limit status
uv run k8s-pipeline fetch-github-prs --rate-limit

# Clear PR cache
uv run k8s-pipeline fetch-github-prs --clear-cache
```

### Integration with Release Builder

When building releases with `--with-prs`, the pipeline:
1. Fetches all PRs referenced in release-notes.json
2. Extracts linked issue numbers from PR bodies
3. Fetches those issues
4. Adds `issueContext` to each change

```bash
# Build release with PR + issue enrichment
uv run k8s-pipeline build-release 1.35 --force --with-prs
```

### Enriched Change Structure

```json
{
  "description": "Fixed replicaCount calculation exceeding max int32.",
  "prNumber": 126979,
  "prUrl": "https://github.com/kubernetes/kubernetes/pull/126979",
  "author": "omerap12",
  "sigs": ["Autoscaling", "Apps"],
  "relatedIssues": [126892],
  "issueContext": [
    {
      "number": 126892,
      "title": "Int overflow in hpa causing incorrect replica count",
      "body": "### What happened?\n\nThe setup: I am using keda with the prometheus scaler...",
      "labels": ["kind/bug", "sig/autoscaling"]
    }
  ]
}
```

### Value for Enrichment

The issue context provides:
- **Root cause** - Why the bug exists
- **Real-world impact** - How users hit it
- **Reproduction steps** - Specific conditions
- **Security context** - For security fixes, audit references and risk levels

This context is invaluable for LLM enrichment to generate better descriptions.

### Implementation

**Module:** `pipeline/src/k8s/input/github_fetcher.py`

Uses `githubkit` (modern Python GitHub SDK inspired by octokit):
- Proper pagination support
- Rate limit handling with `PrimaryRateLimitExceeded` exception
- Typed responses
- Async support (not currently used)

---

## 16. Official Kubernetes CVE Feed (Runtime)

**Source:** `https://kubernetes.io/docs/reference/issues-security/official-cve-feed/`

**Category:** Runtime Data Source (fetched at runtime, not build time)

**Status:** 🔜 Planned - ideal for real-time CVE assessment

### What is the CVE Feed?

The Kubernetes Security Response Committee maintains an official, programmatically accessible feed of published security issues. This is the authoritative source for Kubernetes CVEs.

**Feature State:** Kubernetes v1.27 [beta]

**Feed URLs:**
- **JSON Feed:** `https://kubernetes.io/docs/reference/issues-security/official-cve-feed/feed.json`
- **RSS Feed:** `https://kubernetes.io/docs/reference/issues-security/official-cve-feed/index.xml`

### Why Runtime Instead of Build Time?

Unlike other data sources that are processed during the pipeline build, the CVE feed should be fetched at **runtime** because:

1. **Real-time updates** - CVEs are announced continuously, not tied to K8s releases
2. **Security urgency** - Users need to know about new CVEs immediately
3. **Small payload** - The feed is lightweight, suitable for client-side fetching
4. **No processing needed** - Data is already structured and ready to display

### JSON Feed Structure

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Kubernetes CVE Feed",
  "home_page_url": "https://kubernetes.io/docs/reference/issues-security/official-cve-feed/",
  "feed_url": "https://kubernetes.io/docs/reference/issues-security/official-cve-feed/feed.json",
  "items": [
    {
      "id": "CVE-2025-1974",
      "url": "https://github.com/kubernetes/kubernetes/issues/131009",
      "title": "ingress-nginx admission controller RCE escalation",
      "date_published": "2025-03-24T00:00:00Z",
      "content_text": "Description of the vulnerability..."
    }
  ]
}
```

### Key CVE Fields

| Field | Description |
|-------|-------------|
| `id` | CVE identifier (e.g., `CVE-2025-1974`) |
| `url` | GitHub issue URL with full details |
| `title` | Brief description of the vulnerability |
| `date_published` | When the CVE was announced |
| `content_text` | Detailed description |

### Use Cases

1. **Release CVE Assessment**
   - When viewing a release (e.g., 1.30), fetch the CVE feed
   - Filter CVEs that affect that version
   - Show "X known CVEs affect this release" warning

2. **Security Dashboard**
   - Display recent CVEs in the Analytics tab
   - Allow filtering by component (ingress-nginx, kubelet, etc.)
   - Link to GitHub issues for remediation details

3. **Upgrade Recommendations**
   - Compare CVEs between current and target versions
   - Highlight security improvements from upgrading
   - Show which CVEs are fixed in newer versions

### Frontend Integration (Planned)

```typescript
// In packages/web/src/shared/hooks/useCVEFeed.ts

interface CVEItem {
  id: string;
  url: string;
  title: string;
  datePublished: string;
  contentText: string;
}

interface CVEFeed {
  items: CVEItem[];
  lastUpdated: string;
}

export function useCVEFeed() {
  const [feed, setFeed] = useState<CVEFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetch('https://kubernetes.io/docs/reference/issues-security/official-cve-feed/feed.json')
      .then(res => res.json())
      .then(data => {
        setFeed({
          items: data.items.map((item: any) => ({
            id: item.id,
            url: item.url,
            title: item.title,
            datePublished: item.date_published,
            contentText: item.content_text,
          })),
          lastUpdated: new Date().toISOString(),
        });
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { feed, loading, error };
}

// Filter CVEs by affected component
export function filterCVEsByComponent(items: CVEItem[], component: string): CVEItem[] {
  return items.filter(item => 
    item.title.toLowerCase().includes(component.toLowerCase())
  );
}
```

### Caching Strategy

Since the feed updates infrequently (new CVEs are rare), implement client-side caching:

```typescript
const CACHE_KEY = 'k8s-cve-feed';
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function fetchCVEFeedWithCache(): Promise<CVEFeed> {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
  }

  const response = await fetch(CVE_FEED_URL);
  const data = await response.json();
  
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now(),
  }));
  
  return data;
}
```

### Relationship to Build-Time CVE Data

The pipeline already extracts CVEs from CHANGELOGs into `security_cves` parquet table. The runtime feed complements this:

| Source | When Updated | Contains |
|--------|--------------|----------|
| `security_cves` (Parquet) | Build time | CVEs mentioned in CHANGELOGs, with affected/fixed versions |
| **CVE Feed** (Runtime) | Real-time | All announced CVEs, may include ones not yet in CHANGELOGs |

**Recommended approach:**
1. Use Parquet data for historical CVE context (which releases fixed what)
2. Use runtime feed for "breaking news" CVEs that may not be in Parquet yet
3. Cross-reference to show complete picture

### Data Source Details

- **Maintainer:** Kubernetes Security Response Committee
- **Update frequency:** As CVEs are announced (irregular)
- **Lag time:** Minutes to hours from announcement to feed update
- **Source of truth:** GitHub Issues with `official-cve-feed` label
- **Storage:** Google Cloud Bucket (read-only public access)

### Sample CVEs from Feed

| CVE | Title | Component |
|-----|-------|-----------|
| CVE-2025-1974 | ingress-nginx admission controller RCE escalation | ingress-nginx |
| CVE-2025-1767 | GitRepo Volume Inadvertent Local Repository Access | kubelet |
| CVE-2024-9042 | Command Injection affecting Windows nodes | kubelet |
| CVE-2024-10220 | Arbitrary command execution through gitRepo volume | kubelet |
| CVE-2023-5528 | Insufficient input sanitization leads to privilege escalation on Windows | in-tree storage |

---

## Gaps and Future Work

### Missing Data

1. **Release notes for older versions** - Only 1.33-1.35 have release notes
   - Need to backfill 1.25-1.32 using v2 schema
   - Priority: Start with most recent (1.32) and work backwards

2. **Patch release data** - v2 schema supports it, but not yet populated
   - Parse patch release sections from CHANGELOG
   - Track security fixes with CVE numbers

3. **Highlight detection** - Need to match blog spotlights to features
   - Parse "Spotlight on key updates" section from release blogs
   - Mark matching features with `isHighlight: true`

4. **Docs URLs for ~50+ Kinds** - Many kinds have `docsUrl: null`
   - Could be automated by scraping kubernetes.io/docs/reference/kubernetes-api/
   - Or by asking LLM to find URLs for each missing kind

5. **Relationships for newer Kinds** - Only ~30 relationship patterns defined
   - Could use LLM to analyze schemas and infer relationships
   - Or parse KEPs to understand which Kinds are related

6. **Field-level documentation** - OpenAPI descriptions are often terse
   - Could scrape kubernetes.io for better descriptions
   - Or use LLM to generate explanations

7. **Curated blog posts** - No blog linkage beyond release notes
   - High-value content exists but not indexed
   - Would greatly improve learning experience

8. **Community Q&A** - Slack/forum knowledge not captured
   - Common questions answered repeatedly
   - Could reduce support burden if indexed

### Automation Opportunities

1. **Release notes extraction** - Currently manual LLM prompting
   - Design exists in `releases/README.md` for Strands-based agent
   - Would fetch blog, parse KEPs, search external blogs

2. **Docs URL discovery** - Currently manual lookup
   - Could scrape kubernetes.io sitemap
   - Or use LLM with web search to find URLs

3. **Relationship inference** - Currently hardcoded patterns
   - Could analyze schema structure with LLM
   - Look for `*Ref`, `*Name`, `selector` patterns

4. **Blog curation pipeline** - New opportunity
   - Agent searches for K8s blog posts
   - Extracts metadata and Kind/field linkage
   - Human reviews before adding to index

5. **Q&A extraction** - If Slack access obtained
   - Parse conversations for Q&A patterns
   - Link to relevant Kinds/fields
   - Build searchable knowledge base

---

## 17. Conference Content (KubeCon Talks)

**Source:** Sched.com iCal exports + YouTube CNCF playlists

**Category:** Curated Community Content (LLM-enriched)

**Status:** ✅ Implemented

### What is Conference Content?

KubeCon and CloudNativeCon talks are a rich source of knowledge about Kubernetes features, best practices, and real-world usage. The pipeline ingests session metadata from conference schedules and enriches it with LLM-generated labels and summaries.

### Supported Conferences

| Conference | Location | Sched URL |
|------------|----------|-----------|
| `kubecon-eu-2023` | Amsterdam | `kccnceu2023.sched.com` |
| `kubecon-na-2023` | Chicago | `kccncna2023.sched.com` |
| `kubecon-eu-2024` | Paris | `kccnceu2024.sched.com` |
| `kubecon-na-2024` | Salt Lake City | `kccncna2024.sched.com` |
| `kubecon-eu-2025` | London | `kccnceu2025.sched.com` |
| `kubecon-na-2025` | Atlanta | `kccncna2025.sched.com` |
| `kubecon-china-2025` | Hong Kong | `kccncchn2025.sched.com` |

### Data Flow

```
Sched.com iCal Export
        ↓
    Parse sessions (title, description, speakers)
        ↓
    Scrape session pages (video URL, slides PDF, experience level)
        ↓
    LLM enrichment (labels, summary, KEP links)
        ↓
    content_links_kubecon_*.json
        ↓
    export-parquet → content_links.parquet
```

### What Gets Extracted

| Field | Source | Description |
|-------|--------|-------------|
| `title` | Sched iCal | Session title |
| `speakers` | Parsed from title | Speaker names |
| `description` | Sched iCal | Session description |
| `videoUrl` | Session page scrape | YouTube video URL |
| `slidesUrl` | Session page scrape | PDF slides URL |
| `experienceLevel` | Session page scrape | Beginner/Intermediate/Advanced |
| `sessionType` | LLM inference | keynote, deep-dive, tutorial, etc. |
| `labels` | LLM inference | Topic labels (dra, scheduling, security, etc.) |
| `summary` | LLM inference | 1-2 sentence summary |
| `kepLinks` | LLM inference | Related KEP references |

### CLI Commands

```bash
# List available conferences
uv run k8s-pipeline fetch-sched --list

# Import all sessions from a conference
uv run k8s-pipeline fetch-sched kubecon-na-2024

# Preview without saving
uv run k8s-pipeline fetch-sched kubecon-na-2024 --dry-run

# Limit number of sessions
uv run k8s-pipeline fetch-sched kubecon-na-2024 --max 50

# Skip LLM enrichment (faster)
uv run k8s-pipeline fetch-sched kubecon-na-2024 --no-enrich
```

### Output Files

- `pipeline/data/curated/content_links_kubecon_*.json` - Per-conference content
- `packages/web/public/data/parquet/content_links.parquet` - Combined for UI

### Rate Limiting

The pipeline is gentle with external APIs:
- **Sched.com scraping:** 1 request/second with delays
- **LLM enrichment:** Bedrock calls can be parallelized (concurrency 5-10)

### Label Guidelines

Labels are lowercase topic identifiers. The LLM is instructed to:
- Use SIG labels (`sig-node`, `sig-scheduling`) only for sessions about K8s development
- Use feature labels (`dra`, `in-place-resize`) for sessions about specific features
- Use concept labels (`gpu`, `ai`, `ml`) for broader topics

### Implementation

**Modules:**
- `pipeline/src/k8s/transform/sched_fetcher.py` - Sched.com iCal parsing and scraping
- `pipeline/src/k8s/transform/youtube_fetcher.py` - YouTube playlist import
- `pipeline/src/k8s/transform/content_links.py` - Content link management

---

## 18. Future: Enhanced Conference Content Enrichment

**Status:** 🔜 Planned

The current conference ingestion extracts metadata from Sched.com and uses LLM on title + description. Future enhancements could dramatically improve label accuracy and summary quality.

### 1. YouTube Transcript Extraction

YouTube auto-generates captions for most videos. The full spoken content is much richer than title/description alone.

```python
from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id: str) -> str:
    transcript = YouTubeTranscriptApi.get_transcript(video_id)
    return " ".join([t["text"] for t in transcript])
```

**Benefits:**
- Full spoken content for LLM analysis
- Better label accuracy
- Extract specific timestamps for topics
- No API key needed (public videos)

**Dependencies:** `youtube-transcript-api`

### 2. PDF Slides Processing

Many sessions have slides PDFs. Two approaches:

**Option A: Text extraction (simpler)**
```python
import pypdf

def extract_pdf_text(pdf_path: str) -> str:
    reader = pypdf.PdfReader(pdf_path)
    return "\n".join(page.extract_text() for page in reader.pages)
```

Works well for bullet points, code snippets, text labels. Won't capture visual-only content.

**Option B: Multimodal LLM (more powerful)**
- Claude 3.5 Sonnet, GPT-4V, Gemini Pro Vision can process images
- Convert PDF pages to images, send to multimodal LLM
- Can understand diagrams, architecture drawings, screenshots
- More expensive but captures everything

**Dependencies:** `pypdf` (text), `pillow` + `pdf2image` (multimodal)

### 3. Enhanced Pipeline

```
Session
  ├── Sched description (basic metadata)
  ├── YouTube transcript (if video exists)
  ├── PDF text extraction (if slides exist)
  ├── [Optional] Multimodal for diagram-heavy slides
  └── LLM combines all sources
        → Rich labels
        → Better summary
        → KEP references
        → Affected Kinds
        → Timestamp markers
```

### 4. Implementation Notes

- YouTube transcripts are free and don't require API keys
- PDF text extraction is fast and cheap
- Multimodal is expensive - use selectively for diagram-heavy slides
- Consider caching transcripts/extracted text to avoid re-processing
- Rate limit all external API calls

### 5. Dependencies to Add

```toml
# pyproject.toml
youtube-transcript-api = "^0.6.0"
pypdf = "^4.0.0"
# For multimodal (optional)
pillow = "^10.0.0"
pdf2image = "^1.16.0"
```


---

## 19. Cloud Provider K8s Version Support Data

**Source:** endoflife.date API + provider-specific documentation

**Category:** External API (deterministic) + Curated Metadata

**Status:** ✅ Implemented (Phase 1)

### Overview

Tracks Kubernetes version support across major cloud providers, enabling comparison queries like:
- Which provider offers the longest support period?
- Which provider releases new K8s versions fastest?
- How many versions does each provider currently support?

### Current Implementation (Phase 1)

**Data Source:** [endoflife.date](https://endoflife.date/) API

```
https://endoflife.date/api/{product}.json

Products:
- amazon-eks
- google-kubernetes-engine
- azure-kubernetes-service
- red-hat-openshift
```

**What we extract:**
- Version release dates (provider and upstream K8s)
- End-of-life dates (standard and extended support)
- Support duration metrics (days to availability, support days)
- Latest patch versions
- Support status (supported, extended, eol)

**Output tables:**
- `providers.parquet` - Provider metadata (name, color, docs URLs, support model)
- `provider_versions.parquet` - Version support data per provider

**CLI command:**
```bash
uv run k8s-pipeline fetch-providers
uv run k8s-pipeline export-parquet
```

### Provider Metadata

| Provider | Support Model | Standard | Extended | Version Docs |
|----------|---------------|----------|----------|--------------|
| Amazon EKS | standard+extended | 14 months | 12 months | [kubernetes-versions.html](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html) |
| Google GKE | standard+extended | 14 months | 12 months | [release-schedule](https://cloud.google.com/kubernetes-engine/docs/release-schedule) |
| Azure AKS | standard+extended | 12 months | 12 months | [supported-kubernetes-versions](https://learn.microsoft.com/en-us/azure/aks/supported-kubernetes-versions) |
| Red Hat OpenShift | standard+extended | 18 months | 6 months | [updates/openshift](https://access.redhat.com/support/policy/updates/openshift) |

### Schema

**providers table:**
| Column | Description |
|--------|-------------|
| provider_id | eks, gke, aks, openshift |
| display_name | Human-readable name |
| color | UI color (hex) |
| docs_url | Main documentation URL |
| version_docs_url | URL explaining version lifecycle/support model |
| versioning_scheme | "k8s" (direct) or "custom" (OpenShift 4.x → K8s 1.x) |
| support_model | "standard+extended", "standard-only", "lts" |
| standard_support_months | Months of standard support |
| extended_support_months | Months of extended support (0 if none) |

**provider_versions table:**
| Column | Description |
|--------|-------------|
| provider_id | FK to providers |
| k8s_version | Normalized K8s version (e.g., "1.34") |
| provider_version | Provider-specific version (e.g., "4.17" for OpenShift) |
| upstream_release_date | When upstream K8s released this version |
| provider_release_date | When provider made this version available |
| eol_standard_date | End of standard support |
| eol_extended_date | End of extended support (if applicable) |
| days_to_availability | Days from upstream release to provider availability |
| standard_support_days | Days of standard support |
| extended_support_days | Days of extended support (0 if none) |
| total_support_days | Total days of support |
| status | "supported", "extended", or "eol" |
| has_extended_support | True if extended support is available |
| latest_patch | Latest patch version |
| latest_patch_date | Date of latest patch release |

### Future Enhancements (Phase 2+)

#### 1. Change Detection via Atom Feeds

AWS EKS documentation has an Atom feed for tracking changes:
```
https://github.com/awsdocs/amazon-eks-user-guide/commits/mainline/latest/ug/versioning/kubernetes-versions.adoc.atom
```

**Potential use:**
- Subscribe to feed to detect documentation updates
- Trigger automatic re-fetch when version support info changes
- Track historical changes to support policies

**Similar feeds may exist for:**
- GKE: Google Cloud documentation repos
- AKS: Azure documentation repos
- OpenShift: Red Hat documentation repos

#### 2. Provider-Specific Release Notes

Each provider publishes detailed release notes beyond what endoflife.date captures:

**Amazon EKS:**
- Release notes: `https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html`
- What's new: `https://aws.amazon.com/about-aws/whats-new/`
- GitHub: `https://github.com/awsdocs/amazon-eks-user-guide`

**Google GKE:**
- Release notes: `https://cloud.google.com/kubernetes-engine/docs/release-notes`
- Version history: `https://cloud.google.com/kubernetes-engine/docs/release-schedule`

**Azure AKS:**
- Release notes: `https://github.com/Azure/AKS/releases`
- What's new: `https://learn.microsoft.com/en-us/azure/aks/release-notes`

**Red Hat OpenShift:**
- Release notes: `https://docs.openshift.com/container-platform/4.x/release_notes/`
- Errata: `https://access.redhat.com/errata/`

**What we could extract:**
- Detailed changelog per version
- Security fixes and CVEs
- Known issues and workarounds
- Feature additions/removals specific to the provider
- Provider-specific add-ons and integrations

#### 3. Provider Feature Comparison

Beyond version support, providers differ in:
- Default add-ons (CNI, CSI drivers, ingress controllers)
- Managed components (control plane, etcd, node management)
- Pricing models (per-cluster, per-node, extended support costs)
- Regional availability
- Compliance certifications

#### 4. Real-time Status

Some providers expose status APIs:
- AWS: `https://health.aws.amazon.com/health/status`
- GCP: `https://status.cloud.google.com/`
- Azure: `https://status.azure.com/`

Could track:
- Service incidents affecting K8s
- Maintenance windows
- Regional outages

### Implementation Notes

**Configuration:** `pipeline/src/k8s/core/config.py` → `PROVIDERS` dict

**Fetcher module:** `pipeline/src/k8s/transform/provider_versions.py`

**OpenShift version mapping:** OpenShift 4.x uses custom versioning that maps to K8s 1.x:
```python
# In config.py
"k8s_mapping": {
    "4.20": "1.33",
    "4.19": "1.32",
    "4.18": "1.31",
    # ...
}
```

**Rate limiting:** endoflife.date API is public and doesn't require authentication, but be respectful with request frequency.

### Example Queries

```sql
-- Which provider releases versions fastest?
SELECT p.display_name, AVG(pv.days_to_availability) as avg_days
FROM provider_versions pv
JOIN providers p ON pv.provider_id = p.provider_id
WHERE pv.days_to_availability > 0
GROUP BY p.display_name
ORDER BY avg_days;

-- Which provider offers longest support?
SELECT p.display_name, AVG(pv.total_support_days) as avg_support
FROM provider_versions pv
JOIN providers p ON pv.provider_id = p.provider_id
WHERE pv.total_support_days IS NOT NULL
GROUP BY p.display_name
ORDER BY avg_support DESC;

-- Currently supported versions by provider
SELECT p.display_name, pv.k8s_version, pv.eol_standard_date
FROM provider_versions pv
JOIN providers p ON pv.provider_id = p.provider_id
WHERE pv.status = 'supported'
ORDER BY p.display_name, pv.k8s_version DESC;
```

### References

- endoflife.date API: https://endoflife.date/docs/api
- EKS version support: https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html
- GKE release schedule: https://cloud.google.com/kubernetes-engine/docs/release-schedule
- AKS supported versions: https://learn.microsoft.com/en-us/azure/aks/supported-kubernetes-versions
- OpenShift lifecycle: https://access.redhat.com/support/policy/updates/openshift
