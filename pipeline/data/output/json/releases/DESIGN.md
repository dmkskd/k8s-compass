# Release Notes Data Model Design

## Overview

This document describes the enhanced data model for Kubernetes release notes, designed to capture both major releases (1.35) and patch releases (1.35.1), with consistent structure across all versions.

## CHANGELOG Structure Analysis (1.30-1.34)

We analyzed the actual CHANGELOG files from the kubernetes/kubernetes repository to understand the exact structure.

### Top-Level Sections

| Section | 1.30 | 1.31 | 1.32 | 1.33 | 1.34 | Notes |
|---------|:----:|:----:|:----:|:----:|:----:|-------|
| `## Important Security Information` | ✅* | ✅* | ✅* | ✅* | ❌ | CVE details in **patch releases only** |
| `## Urgent Upgrade Notes` | ❌ | ✅ | ✅ | ✅ | ✅ | Breaking changes (added in 1.31) |
| `## Changes by Kind` | ✅ | ✅ | ✅ | ✅ | ✅ | Main changes section |
| `## Dependencies` | ✅ | ✅ | ✅ | ✅ | ✅ | Added/Changed/Removed deps |
| `## Downloads for vX.YY.Z` | ✅ | ✅ | ✅ | ✅ | ✅ | Binary download links |
| `## Changelog since vX.YY.Z` | ✅ | ✅ | ✅ | ✅ | ✅ | Patch release markers |

*Note: `## Important Security Information` appears in patch releases (e.g., v1.30.3, v1.30.9, v1.30.10), not in the main X.YY.0 release.

### Changes by Kind Subsections

| Subsection | 1.30 | 1.31 | 1.32 | 1.33 | 1.34 | Notes |
|------------|:----:|:----:|:----:|:----:|:----:|-------|
| `### Deprecation` | ✅ | ✅ | ✅ | ✅ | ✅ | Items being deprecated |
| `### API Change` | ✅ | ✅ | ✅ | ✅ | ✅ | API-level changes |
| `### Feature` | ✅ | ✅ | ✅ | ✅ | ✅ | New features |
| `### Bug or Regression` | ✅ | ✅ | ✅ | ✅ | ✅ | Bug fixes |
| `### Documentation` | ✅ | ❌ | ✅ | ✅ | ✅ | Doc changes |
| `### Failing Test` | ✅ | ✅ | ✅ | ❌ | ✅ | Test fixes |
| `### Other (Cleanup or Flake)` | ✅ | ✅ | ✅ | ✅ | ✅ | Cleanup work |
| `### Uncategorized` | ✅ | ✅ | ❌ | ❌ | ❌ | Removed after 1.31 |

### CVE Entry Structure (from `## Important Security Information`)

```markdown
### CVE-2024-5321: Incorrect permissions on Windows containers logs

A security issue was discovered in Kubernetes clusters with Windows nodes
where BUILTIN\Users may be able to read container logs...

**Affected Versions**:
  - kubelet <= 1.27.15
  - kubelet <= 1.28.11
  - kubelet <= 1.29.6
  - kubelet <= 1.30.2

**Fixed Versions**:
  - kubelet 1.27.16
  - kubelet 1.28.12
  - kubelet 1.29.7
  - kubelet 1.30.3

This vulnerability was reported and fixed by [Reporter Name] from [Company].
```

### Change Entry Format

Each change entry follows this pattern:
```markdown
- Description of the change ([#123456](https://github.com/kubernetes/kubernetes/pull/123456), [@username](https://github.com/username)) [SIG API Machinery, Node]
```

### Key Findings from CHANGELOG Analysis

1. **`## Important Security Information` contains CVEs** - Appears in **patch releases only** (e.g., v1.30.3, v1.30.9), NOT in main X.YY.0 releases
2. **`## Urgent Upgrade Notes` started in 1.31** - Not present in 1.30
3. **`### Uncategorized` was removed after 1.31** - Cleanup of categorization
4. **Each patch release has its own section** - `# vX.YY.Z` with full structure
5. **SIG tags are in brackets** - `[SIG Node, Storage]` at end of each entry
6. **PR numbers are always linked** - `[#123456](url)`
7. **`## Downloads for vX.YY.Z`** - Contains download links with SHA512 hashes for:
   - Source Code
   - Client Binaries (darwin, linux, windows × amd64, arm64, etc.)
   - Server Binaries
   - Node Binaries
   - Container Images (with architecture variants)
8. **Pre-release versions included** - Alpha, beta, RC versions have their own sections (e.g., v1.30.0-alpha.1, v1.30.0-beta.0, v1.30.0-rc.0)

## Analysis of Official Release Blogs (1.30-1.34)

We analyzed 5 consecutive Kubernetes release blogs to identify consistent patterns:

### Consistent Sections Across All Releases

| Section | Present | Source |
|---------|---------|--------|
| Release theme/logo/codename | ✅ All | Blog |
| Summary stats (X stable, Y beta, Z alpha) | ✅ All | Blog |
| **Spotlight on key updates** | ✅ 1.33+ | Blog (NEW) |
| Features graduating to Stable | ✅ All | Blog + CHANGELOG |
| Features graduating to Beta | ✅ All | Blog + CHANGELOG |
| New features in Alpha | ✅ All | Blog + CHANGELOG |
| Graduations, deprecations, removals | ✅ All | Blog + CHANGELOG |
| Project velocity stats | ✅ All | Blog |

### Key Findings

1. **"Spotlight on key updates" appeared in 1.33** - This is where `isHighlight: true` features come from
2. **Project Velocity is consistent** - Companies, contributors, cycle duration
3. **Urgent Upgrade Notes are CHANGELOG-only** - Not in release blogs
4. **Bug fixes are CHANGELOG-only** - Blogs focus on features
5. **Patch releases are separate** - Each patch has its own CHANGELOG section

## Kubernetes Release Notes Toolchain

**Reference:** [kubernetes/sig-release/release-engineering/release-notes.md](https://github.com/kubernetes/sig-release/blob/master/release-engineering/release-notes.md)

The creation of Kubernetes release notes is managed by SIG Release using the `krel` toolbox from `kubernetes/release`. Understanding this toolchain is essential for knowing where our data comes from.

### Release Notes Flow

```
┌─────────────────┐     ┌─────────────────────────────────────────────────────┐
│  Pull Request   │     │           Kubernetes Release Toolbox                │
│  ```release-note│     │                                                     │
│  User facing    │────►│  krel release-notes ──► JSON ──► relnotes.k8s.io   │
│  change         │     │         │                                           │
│  ```            │     │         └──────────► Markdown                       │
│                 │     │                                                     │
│  Labels:        │     │  krel changelog ─────► Markdown ──► CHANGELOG-X.YY.md
│  - kind/*       │     │                                                     │
│  - sig/*        │     │  krel docs ──────────► Markdown ──► kubernetes.io   │
│  - area/*       │     │                                                     │
└─────────────────┘     └─────────────────────────────────────────────────────┘
```

### Participants by Release Phase

| Release Phase | Team | Output |
|---------------|------|--------|
| Pre-release (alpha/beta/RC) | Release Notes sub-team | Drafted JSON + Markdown |
| Release Candidate | SIG Release | Updated relnotes.k8s.io |
| Patch releases (v1.x.y) | Branch Managers | CHANGELOG updates |
| Final release (v1.x.0) | Docs sub-team | kubernetes.io updates |

### Data Outputs and Consumers

| Tool | Output Format | Consumer | URL Pattern |
|------|---------------|----------|-------------|
| `krel release-notes` | **JSON** | relnotes.k8s.io | `cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json` |
| `krel release-notes` | Markdown | SIG Release repo | `git.k8s.io/sig-release` |
| `krel changelog` | Markdown | kubernetes/kubernetes | `CHANGELOG/CHANGELOG-X.YY.md` |
| `krel docs` | Markdown | kubernetes.io | Official documentation |

### Key Insight

The **JSON at `cdn.dl.k8s.io`** and the **CHANGELOG markdown** are generated from the **same source data** (PR release-note blocks + labels). The JSON is the structured version; the CHANGELOG is the human-readable version.

## Data Sources Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRIMARY SOURCES (Deterministic)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  release-notes.json (cdn.dl.k8s.io) ⭐ PRIMARY          │   │
│  │  URL: cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json  │   │
│  │  Generated by: krel release-notes                        │   │
│  │  Consumer: relnotes.k8s.io                               │   │
│  │  Contains:                                               │   │
│  │  - Per-PR structured data (text, author, pr_number)      │   │
│  │  - Labels already parsed (kinds, sigs, areas)            │   │
│  │  - KEP links in documentation[] array                    │   │
│  │  Available: v1.20.0+ (all versions we track)             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ Same source data                 │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CHANGELOG-X.YY.md (kubernetes/kubernetes)              │   │
│  │  Generated by: krel changelog                            │   │
│  │  Contains (not in JSON):                                 │   │
│  │  - Patch release sections (v1.35.1, v1.35.2, ...)       │   │
│  │  - Security information (CVEs) in patch releases         │   │
│  │  - Urgent upgrade notes (1.31+)                          │   │
│  │  - Downloads section with SHA512 hashes                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ENRICHMENT SOURCES (LLM-Assisted)             │
├─────────────────────────────────────────────────────────────────┤
│  Official Release Blog (kubernetes.io/blog)                     │
│  - Curated highlights (isHighlight: true) - since 1.33         │
│  - Human-readable feature descriptions                          │
│  - Release themes and codename                                  │
│  - Project velocity stats                                       │
│                                                                 │
│  KEP Repository (kubernetes/enhancements)                       │
│  - Feature history (alpha/beta/stable versions)                 │
│  - Affected components                                          │
│  - Feature gate names                                           │
│  - SIG ownership                                                │
│                                                                 │
│  External Blogs                                                 │
│  - Deep-dive explanations                                       │
│  - Practical impact analysis                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Official release-notes.json

**URL Pattern:** `https://cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json`

**Example:** `https://cdn.dl.k8s.io/release/v1.35.0/release-notes.json`

This is the **official machine-readable release notes** generated by `krel release-notes`. It's the same data that powers [relnotes.k8s.io](https://relnotes.k8s.io).

### Actual JSON Structure (verified)

The JSON is keyed by PR number:

```json
{
  "123456": {
    "commit": "abc123def456...",
    "text": "Plain text description of the change",
    "markdown": "Markdown formatted description ([#123456](url), [@author](url)) [SIG Node]",
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
        "url": "https://github.com/kubernetes/enhancements/tree/master/keps/sig-node/1234-feature",
        "type": "KEP"
      }
    ]
  }
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Plain text description |
| `markdown` | string | Markdown with links (same as CHANGELOG entry) |
| `commit` | string | Git commit SHA |
| `author` | string | GitHub username |
| `pr_number` | integer | Pull request number |
| `kinds` | string[] | `feature`, `bug`, `api-change`, `deprecation`, `cleanup`, `documentation`, `failing-test` |
| `sigs` | string[] | SIG labels (lowercase): `node`, `apps`, `network`, `storage`, `auth`, etc. |
| `areas` | string[] | Component areas: `kubelet`, `scheduler`, `apiserver`, `kubectl`, `test` |
| `duplicate` | boolean | True if PR appears in multiple release notes |
| `is_mapped` | boolean | True if PR was mapped to release notes |
| `documentation` | object[] | KEP/design doc links with `description`, `url`, `type` |

### Why This is Better Than CHANGELOG Parsing

| Aspect | CHANGELOG.md | release-notes.json |
|--------|--------------|-------------------|
| Format | Markdown (needs parsing) | Structured JSON |
| Granularity | Grouped by section | Per-PR objects |
| SIG info | Parse from `[SIG ...]` suffix | `sigs` array |
| PR numbers | Parse from markdown links | `pr_number` field |
| Author | Parse from `[@user](url)` | `author` field |
| KEP links | Not included | `documentation` array |
| Filtering | Manual text search | Query by `kinds`, `sigs`, `areas` |

### Version Availability

**Verified:** Available for v1.20.0+ (Dec 2020 onwards)

| Version Range | Status |
|---------------|--------|
| v1.35.0 - v1.20.0 | ✅ Available |
| v1.19.0 and earlier | ❌ Not available (404) |

This covers all versions we track (1.25-1.35).

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

### What release-notes.json Does NOT Include

These must come from CHANGELOG or blog:

| Data | Source |
|------|--------|
| Patch releases (v1.35.1, v1.35.2) | CHANGELOG (separate JSON per patch) |
| CVE/security information | CHANGELOG `## Important Security Information` |
| Urgent upgrade notes | CHANGELOG `## Urgent Upgrade Notes` |
| Codename, themes | Release blog |
| Project velocity stats | Release blog |
| Feature highlights | Release blog "Spotlight" section |

### Pipeline Integration

```python
import requests

def fetch_release_notes_json(version: str) -> dict:
    """Fetch official release-notes.json from cdn.dl.k8s.io"""
    # Ensure version format is X.YY.Z
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
    
    changes_by_kind = {v: [] for v in set(kind_mapping.values())}
    
    for pr_number, note in release_notes.items():
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

## Schema v2 Key Changes (Based on CHANGELOG Analysis)

### 1. Security Information (CVEs)

Replaces the assumed "Known Issues" with actual CVE tracking from `## Important Security Information`:

```json
{
  "securityInformation": [
    {
      "cve": "CVE-2024-5321",
      "title": "Incorrect permissions on Windows containers logs",
      "description": "A security issue was discovered...",
      "severity": "high",
      "affectedVersions": ["kubelet <= 1.30.2", "kubelet <= 1.29.6"],
      "fixedVersions": ["1.30.3", "1.29.7"],
      "affectedComponents": ["kubelet"],
      "reporter": "Tim Allclair from Google",
      "patchVersion": "1.30.3"
    }
  ]
}
```

### 2. Changes by Kind (Raw CHANGELOG Data)

Direct mapping of CHANGELOG structure:

```json
{
  "changesByKind": {
    "deprecation": [
      {
        "description": "The xyz flag is deprecated...",
        "prNumber": 123456,
        "author": "username",
        "sigs": ["Node", "API Machinery"]
      }
    ],
    "apiChange": [...],
    "feature": [...],
    "bugOrRegression": [...],
    "documentation": [...],
    "failingTest": [...],
    "other": [...],
    "uncategorized": [...]
  }
}
```

### 3. Patch Release Support

Each patch release mirrors the main structure:

```json
{
  "patchReleases": [
    {
      "version": "1.35.1",
      "releaseDate": "2026-01-08",
      "changelogSince": "v1.35.0",
      "securityFixes": [
        {
          "cve": "CVE-2025-XXXX",
          "title": "...",
          "affectedVersions": [...],
          "fixedVersions": [...]
        }
      ],
      "changesByKind": {
        "bugOrRegression": [...],
        "feature": [...]
      },
      "dependencies": {
        "changed": ["golang.org/x/net v0.24.0 → v0.25.0"]
      }
    }
  ]
}
```

### 4. Urgent Upgrade Notes (1.31+)

```json
{
  "urgentUpgradeNotes": [
    {
      "title": "cgroup v1 support removed",
      "description": "Kubelet will fail to start on nodes without cgroup v2",
      "action": "Upgrade all nodes to cgroup v2 before upgrading",
      "affectedComponents": ["kubelet"],
      "sigs": ["Node"],
      "prNumber": 123456
    }
  ]
}
```

### 5. Highlight Flag for Features

Features spotlighted in official blog get `isHighlight: true`:

```json
{
  "kep": "KEP-1287",
  "title": "In-place Update of Pod Resources",
  "isHighlight": true,
  "stage": "stable",
  ...
}
```

### 6. Dependencies Section

```json
{
  "dependencies": {
    "added": ["new-package v1.0.0"],
    "changed": ["golang.org/x/net v0.24.0 → v0.25.0"],
    "removed": ["old-package"]
  }
}
```

## CHANGELOG Section Mapping to Schema v2

| CHANGELOG Section | Schema Field | Notes |
|-------------------|--------------|-------|
| `## Important Security Information` | `securityInformation[]` | CVE details (1.30-1.33) |
| `### CVE-*` | `securityInformation[].cve` | Individual CVE entries |
| `## Urgent Upgrade Notes` | `urgentUpgradeNotes[]` | Breaking changes (1.31+) |
| `## Changes by Kind` | `changesByKind` | Main changes object |
| `### Deprecation` | `changesByKind.deprecation[]` | + `deprecations[]` summary |
| `### API Change` | `changesByKind.apiChange[]` | + `apiChanges[]` summary |
| `### Feature` | `changesByKind.feature[]` | Raw feature entries |
| `### Bug or Regression` | `changesByKind.bugOrRegression[]` | Bug fixes |
| `### Documentation` | `changesByKind.documentation[]` | Doc changes |
| `### Failing Test` | `changesByKind.failingTest[]` | Test fixes |
| `### Other (Cleanup or Flake)` | `changesByKind.other[]` | Cleanup work |
| `### Uncategorized` | `changesByKind.uncategorized[]` | Legacy (1.30-1.31) |
| `## Dependencies` | `dependencies` | Added/Changed/Removed |
| `# vX.YY.Z` sections | `patchReleases[]` | Nested patch releases |

**Note**: The `features[]` array (with KEP info, stages, highlights) is enriched from the release blog and KEP repository, not directly from CHANGELOG.

## SIG Categories

Features and bugs are tagged by SIG for filtering:

| SIG | Focus Area | Example Kinds |
|-----|------------|---------------|
| Node | Kubelet, container runtime | Pod, Node |
| Apps | Workload controllers | Deployment, StatefulSet, Job |
| Network | Networking, Services | Service, Ingress, NetworkPolicy |
| Storage | Volumes, CSI | PVC, StorageClass, CSIDriver |
| Auth | Authentication, authorization | ServiceAccount, Role, ClusterRole |
| Scheduling | Scheduler | Pod (scheduling), PriorityClass |
| API Machinery | API server, CRDs | CustomResourceDefinition |
| Autoscaling | HPA, VPA | HorizontalPodAutoscaler |
| CLI | kubectl | - |
| Instrumentation | Metrics, logging | - |
| Cloud Provider | Cloud integrations | - |

## Extraction Strategy

### Updated Pipeline (Based on Toolchain Understanding)

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Fetch release-notes.json (Deterministic)              │
│  Source: cdn.dl.k8s.io/release/vX.YY.Z/release-notes.json       │
│  Output: changesByKind (feature, bug, api-change, etc.)         │
│  - No parsing needed, already structured                        │
│  - Per-PR granularity with SIG/area labels                      │
│  - KEP links in documentation[] array                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Parse CHANGELOG for extras (Deterministic)            │
│  Source: kubernetes/kubernetes/CHANGELOG/CHANGELOG-X.YY.md      │
│  Output: urgentUpgradeNotes, securityInformation, patchReleases │
│  - Only parse sections NOT in release-notes.json                │
│  - Urgent Upgrade Notes (1.31+)                                 │
│  - Security Information (CVEs in patch releases)                │
│  - Patch release sections (v1.35.1, v1.35.2, ...)              │
│  - Dependencies (Added/Changed/Removed)                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Enrich from Blog (LLM-Assisted)                       │
│  Source: kubernetes.io/blog/YYYY/MM/DD/kubernetes-X-YY-...      │
│  Output: codename, themes, isHighlight, projectVelocity         │
│  - Codename from title/theme section                            │
│  - Summary stats (X stable, Y beta, Z alpha)                    │
│  - Spotlight features (1.33+) → mark isHighlight: true          │
│  - Project velocity stats                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Phase 4: Enrich from KEPs (API + LLM)                          │
│  Source: kubernetes/enhancements/keps/sig-*/XXXX-*/kep.yaml     │
│  Output: features[].history, featureGate, affectedKinds         │
│  - Feature history (alpha/beta/stable versions)                 │
│  - Feature gate names                                           │
│  - Affected components → infer affectedKinds                    │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 1: Fetch release-notes.json (Primary)

```python
import requests

def fetch_release_notes(version: str) -> dict:
    """
    Fetch official release-notes.json from cdn.dl.k8s.io.
    This is the primary data source for changesByKind.
    """
    url = f"https://cdn.dl.k8s.io/release/v{version}.0/release-notes.json"
    response = requests.get(url)
    response.raise_for_status()
    
    raw_notes = response.json()
    
    # Transform to our schema
    changes_by_kind = {
        "feature": [],
        "bugOrRegression": [],
        "apiChange": [],
        "deprecation": [],
        "documentation": [],
        "failingTest": [],
        "other": [],
    }
    
    kind_mapping = {
        "feature": "feature",
        "bug": "bugOrRegression",
        "api-change": "apiChange",
        "deprecation": "deprecation",
        "cleanup": "other",
        "documentation": "documentation",
        "failing-test": "failingTest",
    }
    
    for pr_number, note in raw_notes.items():
        entry = {
            "description": note["text"],
            "prNumber": note.get("pr_number"),
            "prUrl": note.get("pr_url"),
            "author": note.get("author"),
            "sigs": [sig.replace("-", " ").title() for sig in note.get("sigs", [])],
            "areas": note.get("areas", []),
            "kepLinks": [
                doc["url"] for doc in note.get("documentation", [])
                if doc.get("type") == "KEP"
            ],
        }
        
        for kind in note.get("kinds", []):
            target = kind_mapping.get(kind, "other")
            changes_by_kind[target].append(entry)
    
    return {"changesByKind": changes_by_kind}
```

### Phase 2: Parse CHANGELOG Extras (Deterministic)

```python
def parse_changelog_extras(version: str) -> dict:
    """
    Parse CHANGELOG for data NOT in release-notes.json:
    - Urgent Upgrade Notes
    - Security Information (CVEs)
    - Patch releases
    - Dependencies
    """
    changelog_path = f"pipeline/repos/kubernetes/CHANGELOG/CHANGELOG-{version}.md"
    content = Path(changelog_path).read_text()
    
    result = {
        "urgentUpgradeNotes": [],
        "securityInformation": [],
        "patchReleases": [],
        "dependencies": {"added": [], "changed": [], "removed": []},
    }
    
    # Parse ## Urgent Upgrade Notes (1.31+)
    # Parse ## Important Security Information (CVEs)
    # Parse # vX.YY.Z sections (patch releases)
    # Parse ## Dependencies
    
    return result
```

### Phase 3: Blog Enrichment (LLM-Assisted)

```python
def enrich_from_blog(version: str, data: dict) -> dict:
    """
    Enrich with official blog content.
    """
    # 1. Fetch release blog from kubernetes.io
    # 2. Extract:
    #    - Codename from title/theme section
    #    - Summary stats (X stable, Y beta, Z alpha)
    #    - Themes from intro
    #    - Spotlight features (1.33+) → mark isHighlight: true
    #    - Project velocity stats
    # 3. Match spotlight features to changesByKind.feature by title/KEP
    
    return data
```

### Phase 4: KEP Enrichment (API + LLM)

```python
def enrich_from_keps(features: list) -> list:
    """
    Enrich features with KEP metadata.
    """
    # 1. For each feature with KEP link in kepLinks[]
    # 2. Fetch kep.yaml from kubernetes/enhancements
    # 3. Extract:
    #    - History (alpha/beta/stable versions)
    #    - Feature gate name
    #    - Affected components
    # 4. Infer affected Kinds from KEP content (LLM)
    
    return features
```

## UI Use Cases

### 1. Release Overview
- Show themes, summary stats, highlights
- Filter features by stage (stable/beta/alpha)

### 2. Upgrade Planning
- Show urgent upgrade notes prominently (with "No, really, you MUST read this" warning)
- List deprecations and removals
- Show CVE fixes in patch releases

### 3. Feature Tracking
- "Show DRA's journey" → Query features across releases by title/KEP
- "What's new for Pod?" → Filter by affectedKinds

### 4. Bug Investigation
- Filter bug fixes by SIG/component from `changesByKind.bugOrRegression`
- See which patch release fixed an issue

### 5. Security Tracking
- View CVEs fixed in each patch release
- Track affected/fixed versions
- Filter by severity

### 6. Patch Release Details
- Expand patch releases to see security fixes
- View changes by kind for each patch

## Migration from v1 to v2

Existing v1 files can be migrated:

```python
def migrate_v1_to_v2(v1_data: dict) -> dict:
    """
    Migrate v1 release notes to v2 schema.
    """
    v2_data = {
        **v1_data,
        # New fields with defaults
        "securityInformation": [],  # CVEs - populate from CHANGELOG
        "urgentUpgradeNotes": [],   # Breaking changes - populate from CHANGELOG
        "changesByKind": {},        # Raw CHANGELOG data
        "apiChanges": [],           # Derived from changesByKind.apiChange
        "dependencies": {},         # From CHANGELOG ## Dependencies
        "patchReleases": [],        # From CHANGELOG patch sections
        "projectVelocity": {},      # From blog
    }
    
    # Add isHighlight: false to all features
    for feature in v2_data["features"]:
        feature.setdefault("isHighlight", False)
    
    # Note: knownIssues removed - replaced by securityInformation (CVEs)
    
    return v2_data
```

## File Structure

```
packages/web/public/data/releases/
├── schema.json          # v1 schema (deprecated)
├── schema-v2.json       # v2 schema (current)
├── DESIGN.md            # This file
├── README.md            # Extraction process docs
├── 1.35.json            # v1 format (to be migrated)
├── 1.35-v2.json         # v2 format example
├── 1.34.json            # v1 format
├── 1.33.json            # v1 format
└── index.json           # Version index
```

## Next Steps

1. **Implement release-notes.json fetcher** - Fetch from cdn.dl.k8s.io (primary source)
2. **Build CHANGELOG extras parser** - Parse only urgent notes, CVEs, patch releases, dependencies
3. **Migrate existing files** - Convert 1.33-1.35 to v2 schema using new pipeline
4. **Backfill 1.25-1.32** - Extract release notes for older versions
5. **Add highlight detection** - Match blog spotlights to features (1.33+)
6. **KEP enrichment** - Fetch kep.yaml for feature history


## Release Codenames (1.30-1.35)

| Version | Codename | Release Date |
|---------|----------|--------------|
| 1.30 | Uwubernetes | 2024-04-17 |
| 1.31 | Elli | 2024-08-13 |
| 1.32 | Penelope | 2024-12-11 |
| 1.33 | Octarine: The Color of Magic | 2025-04-23 |
| 1.34 | Of Wind & Will (O' WaW) | 2025-08-27 |
| 1.35 | Timbernetes (The World Tree Release) | 2025-12-17 |

## Project Velocity Stats (from blogs)

| Version | Companies | Contributors | Cycle (weeks) |
|---------|-----------|--------------|---------------|
| 1.30 | 863 | 1391 | 14 |
| 1.31 | 113 | 528 | 14 |
| 1.32 | 125 | 559 | 14 |
| 1.33 | 121 | 570 | 15 |
| 1.34 | 106 | 491 | 15 |

## Enhancement Counts by Stage

| Version | Total | Stable | Beta | Alpha |
|---------|-------|--------|------|-------|
| 1.30 | 45 | 17 | 18 | 10 |
| 1.31 | 45 | 11 | 22 | 12 |
| 1.32 | 44 | 13 | 12 | 19 |
| 1.33 | 64 | 18 | 20 | 24 |
| 1.34 | 58 | 23 | 22 | 13 |
| 1.35 | 60 | 17 | 19 | 22 |

## Schema v2 Validation Results (Updated from CHANGELOG Analysis)

Our schema v2 design is **validated** against actual CHANGELOG structure:

### Confirmed Fields from CHANGELOG
- ✅ `securityInformation` - Maps to `## Important Security Information` (1.30-1.33)
- ✅ `urgentUpgradeNotes` - Maps to `## Urgent Upgrade Notes` (1.31+)
- ✅ `changesByKind` - Maps to `## Changes by Kind` with all subsections
- ✅ `dependencies` - Maps to `## Dependencies` (Added/Changed/Removed)
- ✅ `patchReleases` - Maps to `# vX.YY.Z` sections

### Confirmed Fields from Blog
- ✅ `version`, `codename`, `releaseDate` - All releases have these
- ✅ `summary` (total, stable, beta, alpha) - Consistent across all releases
- ✅ `themes` - Can be extracted from blog intro
- ✅ `features` with `stage`, `sig`, `kep` - Consistent structure
- ✅ `projectVelocity` - Consistent stats available
- ✅ `references` - Blog URLs, CHANGELOG links

### Version-Specific Availability
| Field | 1.30 | 1.31 | 1.32 | 1.33 | 1.34 |
|-------|:----:|:----:|:----:|:----:|:----:|
| `securityInformation` (in patches) | ✅ | ✅ | ✅ | ✅ | ❌* |
| `urgentUpgradeNotes` | ❌ | ✅ | ✅ | ✅ | ✅ |
| `changesByKind.uncategorized` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `changesByKind.documentation` | ✅ | ❌ | ✅ | ✅ | ✅ |
| `changesByKind.failingTest` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `isHighlight` (blog spotlight) | ❌ | ❌ | ❌ | ✅ | ✅ |

*1.34 is relatively new and may not have had security patches yet.

### Removed from Schema
- ❌ `knownIssues` - Does NOT exist in CHANGELOG; replaced by `securityInformation` for CVEs

## Migration Notes

### For versions 1.30-1.32 (no Spotlight section)
- Mark features that appear first in the blog's feature sections as potential highlights
- Or leave `isHighlight: false` for all features in these versions

### For versions 1.33+ (has Spotlight section)
- Features in "Spotlight on key updates" section get `isHighlight: true`
- All other features get `isHighlight: false`
