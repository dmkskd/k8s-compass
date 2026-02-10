# Data Model

Parquet tables for DuckDB WASM. All tables use snake_case column names.

**IMPORTANT**: DuckDB/Parquet is the single source of truth for all application data. The UI queries DuckDB directly - JSON files are intermediate build artifacts only.

**Auto-generated**: This documentation is generated from PyArrow schema definitions using `uv run k8s-pipeline schema-docs`.

## ER Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API SCHEMA TABLES                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐       ┌─────────────────────────────────────────┐              │
│  │  releases   │       │                 kinds                   │              │
│  ├─────────────┤       ├─────────────────────────────────────────┤              │
│  │ PK version  │◄──────│ FK version                              │              │
│  │ release_date│       │ PK group_name                           │              │
│  │ is_latest   │       │ PK api_version                          │              │
│  │ codename    │       │ PK name                                 │              │
│  │ ...         │       │ ...                                     │              │
│  └──────┬──────┘       └───────────────┬─────────────────────────┘              │
│         │                              │                                        │
│  ┌──────▼──────┐       ┌───────────────▼─────────────────────────┐              │
│  │ api_groups  │       │         kinds_relationships             │              │
│  ├─────────────┤       ├─────────────────────────────────────────┤              │
│  │ FK version  │       │ FK version, source_kind, source_group   │              │
│  │ PK name     │       │ type, target_kind, target_group         │              │
│  │ ...         │       └─────────────────────────────────────────┘              │
│  └─────────────┘                                                                │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐                │
│  │                       api_diffs                             │                │
│  ├─────────────────────────────────────────────────────────────┤                │
│  │ FK from_version, to_version → releases                      │                │
│  │ change_type, group_name, kind, field_path                   │                │
│  └─────────────────────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                              RELEASE TABLES                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐       ┌─────────────────────────────────────────┐              │
│  │  releases   │       │               features                  │              │
│  ├─────────────┤       ├─────────────────────────────────────────┤              │
│  │ PK version  │◄──────│ PK,FK version                           │              │
│  │ codename    │       │ PK,FK kep ────────────────────────────┐ │              │
│  │ is_latest   │       │ stage                                 │ │              │
│  │ ...         │       └───────────────────────────────────────┼─┘              │
│  └──────┬──────┘                                               │                │
│         │              ┌───────────────────────────────────────▼─┐              │
│         │              │                 keps                    │              │
│         │              ├─────────────────────────────────────────┤              │
│         │              │ PK kep                                  │              │
│         │              │ title, sig, feature_gate, labels        │              │
│         │              │ description, impact, affected_*         │              │
│         │              │ history_alpha, history_beta, history_*  │              │
│         │              └─────────────────────────────────────────┘              │
│         │                                                                       │
│         ├──────────────┬──────────────┬──────────────┬──────────────┐           │
│         ▼              ▼              ▼              ▼              ▼           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     │
│  │deprecations│ │release_    │ │action_     │ │security_   │ │patch_      │     │
│  │            │ │changes     │ │required    │ │cves        │ │releases    │     │
│  │ FK version │ │ FK version │ │ FK version │ │ FK version │ │ FK version │     │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └──────┬─────┘     │
│                                                                     │           │
│                                                        ┌────────────┴─────┐     │
│                                              ┌─────────▼────┐  ┌──────────▼───┐ │
│                                              │patch_release_│  │patch_security│ │
│                                              │changes       │  │_fixes        │ │
│                                              │FK patch_ver  │  │FK patch_ver  │ │
│                                              └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                              LINKING TABLES                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐                │
│  │                    field_kep_links                          │                │
│  ├─────────────────────────────────────────────────────────────┤                │
│  │ FK version → releases, FK kep → keps                        │                │
│  │ field_path, kind, group_name, confidence, match_reason      │                │
│  └─────────────────────────────────────────────────────────────┘                │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐                │
│  │                    content_links                            │                │
│  ├─────────────────────────────────────────────────────────────┤                │
│  │ url, title, content_type, source, labels                    │                │
│  │ target_type (release/kep/kind/field), target_id             │                │
│  └─────────────────────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────┘
```


## Key Relationships

| From Table | To Table | Join Condition | Description |
|------------|----------|----------------|-------------|
| api_groups | releases | api_groups.version = releases.version | version references releases |
| kinds | releases | kinds.version = releases.version | version references releases |
| kinds | api_groups | kinds.group_name = api_groups.name | group_name references api_groups |
| kinds_relationships | releases | kinds_relationships.version = releases.version | version references releases |
| kinds_relationships | kinds | kinds_relationships.source_kind = kinds.name | source_kind references kinds |
| kinds_relationships | kinds | kinds_relationships.source_group = kinds.group_name | source_group references kinds |
| api_diffs | releases | api_diffs.from_version = releases.version | from_version references releases |
| api_diffs | releases | api_diffs.to_version = releases.version | to_version references releases |
| features | releases | features.version = releases.version | version references releases |
| features | keps | features.kep = keps.kep | kep references keps |
| deprecations | releases | deprecations.version = releases.version | version references releases |
| release_changes | releases | release_changes.version = releases.version | version references releases |
| action_required | releases | action_required.version = releases.version | version references releases |
| security_cves | releases | security_cves.version = releases.version | version references releases |
| patch_releases | releases | patch_releases.version = releases.version | version references releases |
| patch_release_changes | releases | patch_release_changes.version = releases.version | version references releases |
| patch_release_changes | patch_releases | patch_release_changes.patch_version = patch_releases.patch_version | patch_version references patch_releases |
| patch_security_fixes | releases | patch_security_fixes.version = releases.version | version references releases |
| patch_security_fixes | patch_releases | patch_security_fixes.patch_version = patch_releases.patch_version | patch_version references patch_releases |
| field_kep_links | releases | field_kep_links.version = releases.version | version references releases |
| field_kep_links | keps | field_kep_links.kep = keps.kep | kep references keps |
| component_flags | components | component_flags.component_id = components.id | component_id references components |
| provider_versions | providers | provider_versions.provider_id = providers.provider_id | provider_id references providers |
| provider_versions | releases | provider_versions.k8s_version = releases.version | k8s_version references releases |
| kubectl_commands | releases | kubectl_commands.version = releases.version | version references releases |
| kubectl_options | releases | kubectl_options.version = releases.version | version references releases |
| kubectl_options | kubectl_commands | kubectl_options.command = kubectl_commands.name | command references kubectl_commands |
| kubectl_examples | releases | kubectl_examples.version = releases.version | version references releases |
| kubectl_examples | kubectl_commands | kubectl_examples.command = kubectl_commands.name | command references kubectl_commands |
| feature_gates | releases | feature_gates.version = releases.version | version references releases |
| feature_gates | keps | feature_gates.kep = keps.kep | kep references keps |

## Tables

### API Schema Tables

### api_groups
API groups per version (core, apps, networking.k8s.io, etc).

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| name | VARCHAR | **PK** e.g. "apps", "core" |
| display_name | VARCHAR | e.g. "Apps", "Core" |
| description | VARCHAR | Group description |
| color | VARCHAR | Hex color for UI |

### kinds
Kubernetes resource types (Pod, Deployment, etc).

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| group_name | VARCHAR | API group (FK → api_groups.name) |
| api_version | VARCHAR | e.g. "v1", "v1beta1" |
| name | VARCHAR | **PK** e.g. "Pod", "Deployment" |
| singular_name | VARCHAR | Lowercase singular |
| plural_name | VARCHAR | Lowercase plural |
| scope | VARCHAR | "Namespaced" or "Cluster" |
| short_names | VARCHAR[] | kubectl shortcuts ["po", "deploy"] |
| categories | VARCHAR[] | ["all"] |
| schema_ref | VARCHAR | Path to schema (legacy) |
| field_count | INTEGER | Total fields in schema |
| description | VARCHAR | Kind description |
| docs_url | VARCHAR | kubernetes.io docs link |
| schema_json | VARCHAR | Full OpenAPI schema as JSON |

### kinds_relationships
Kind-to-Kind relationships in the K8s API (owns, selects, references, mounts, configures).

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| source_kind | VARCHAR | Source Kind (FK → kinds.name) |
| source_group | VARCHAR | Source group (FK → kinds.group_name) |
| type | VARCHAR | owns/selects/references/mounts/configures |
| target_kind | VARCHAR | Target Kind name |
| target_group | VARCHAR | Target group name |
| description | VARCHAR | Relationship description |
| field_path | VARCHAR | e.g. "spec.template" |

### api_diffs
API schema changes between consecutive K8s versions.

| Column | Type | Description |
|--------|------|-------------|
| from_version | VARCHAR | Starting version (FK → releases.version) |
| to_version | VARCHAR | Ending version (FK → releases.version) |
| change_type | VARCHAR | kind_added/kind_removed/field_added/field_removed |
| group_name | VARCHAR | Affected group |
| kind | VARCHAR | Affected Kind |
| field_path | VARCHAR | Affected field path (for field changes) |
| old_value | VARCHAR | Previous value (if applicable) |
| new_value | VARCHAR | New value (if applicable) |

### Release Tables

### releases
K8s release metadata including version info, codename, and feature counts.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | **PK** e.g. "1.35" |
| release_date | VARCHAR | ISO date |
| is_latest | BOOLEAN | True for newest version |
| codename | VARCHAR | e.g. "Octarine" |
| description | VARCHAR | Release description |
| total_features | INTEGER | Total feature count |
| stable_features | INTEGER | Stable feature count |
| beta_features | INTEGER | Beta feature count |
| alpha_features | INTEGER | Alpha feature count |
| themes | VARCHAR[] | ["DRA", "Security"] |

### keps
Master KEP table - one row per KEP (Kubernetes Enhancement Proposal).

| Column | Type | Description |
|--------|------|-------------|
| kep | VARCHAR | **PK** e.g. "KEP-1287" |
| kep_path | VARCHAR | GitHub path (e.g. "sig-node/1287-in-place-update-pod-resources") |
| title | VARCHAR | KEP title |
| sig | VARCHAR | Owning SIG (e.g. "Node", "Apps") |
| feature_gate | VARCHAR | Feature gate name (if any) |
| labels | VARCHAR[] | Topic labels (e.g., ["storage", "csi", "security"]) |
| description | VARCHAR | KEP description/summary |
| impact | VARCHAR | How this feature affects users/operators |
| affected_kinds | VARCHAR[] | Affected K8s Kinds |
| affected_fields | VARCHAR[] | Affected API fields |
| history_alpha | VARCHAR | Version when alpha |
| history_beta | VARCHAR | Version when beta |
| history_stable | VARCHAR | Version when stable |

### features
KEP graduations per release (join table between releases and keps).

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | **PK** K8s version (e.g. "1.35") (FK → releases.version) |
| kep | VARCHAR | **PK** KEP identifier (e.g. "KEP-1287") (FK → keps.kep) |
| stage | VARCHAR | alpha/beta/stable |

### deprecations
Deprecation notices per release.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| item | VARCHAR | Deprecated item |
| reason | VARCHAR | Deprecation reason |
| replacement | VARCHAR | Suggested replacement |
| removal_target | VARCHAR | Target removal version |

### release_changes
Raw changes from release-notes.json, grouped by kind.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| kind | VARCHAR | Change category (api-change, feature, bug, etc.) |
| description | VARCHAR | Change description |
| pr_number | INTEGER | Pull request number |
| pr_url | VARCHAR | Pull request URL |
| author | VARCHAR | PR author |
| sigs | VARCHAR[] | Related SIGs |
| kep_links | VARCHAR[] | Related KEP links |
| enrichment_problem | VARCHAR | LLM: What was the problem |
| enrichment_affected | VARCHAR | LLM: Who was affected |
| enrichment_fix | VARCHAR | LLM: What the fix does |
| enrichment_impact | VARCHAR | LLM: Why it matters |
| enrichment_category | VARCHAR | LLM: bug-fix, performance, etc. |
| enrichment_severity | VARCHAR | LLM: low/medium/high/critical |
| enrichment_components | VARCHAR[] | LLM: Affected K8s components |
| enrichment_labels | VARCHAR[] | LLM: Topic labels |

### action_required
Critical upgrade notes from CHANGELOG that require immediate attention.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| description | VARCHAR | Upgrade note content |
| pr_number | INTEGER | Pull request number |
| pr_url | VARCHAR | Pull request URL |
| author | VARCHAR | PR author |
| sigs | VARCHAR[] | Related SIGs |

### security_cves
Security vulnerabilities (CVEs) from CHANGELOG.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (FK → releases.version) |
| cve | VARCHAR | CVE identifier (e.g. CVE-2024-1234) |
| title | VARCHAR | CVE title |
| description | VARCHAR | CVE description |
| affected_versions | VARCHAR[] | Affected K8s versions |
| fixed_versions | VARCHAR[] | Fixed K8s versions |
| affected_components | VARCHAR[] | Affected components |
| patch_version | VARCHAR | Patch version that fixed it |

### patch_releases
Patch releases within a minor version from CHANGELOG.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version (e.g. 1.35) (FK → releases.version) |
| patch_version | VARCHAR | **PK** Full patch version (e.g. 1.35.1) |
| changelog_since | VARCHAR | Previous version |
| security_fixes_count | INTEGER | Number of security fixes |
| changes_count | INTEGER | Total number of changes |

### patch_release_changes
Individual changes within patch releases.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s minor version (e.g. 1.35) (FK → releases.version) |
| patch_version | VARCHAR | Full patch version (e.g. v1.35.1) (FK → patch_releases.patch_version) |
| kind | VARCHAR | Change category (feature, bugOrRegression, etc.) |
| description | VARCHAR | Change description |
| pr_number | INTEGER | Pull request number |
| pr_url | VARCHAR | Pull request URL |
| author | VARCHAR | PR author |
| sigs | VARCHAR[] | Related SIGs |
| enrichment_problem | VARCHAR | LLM: What was the problem |
| enrichment_affected | VARCHAR | LLM: Who was affected |
| enrichment_fix | VARCHAR | LLM: What the fix does |
| enrichment_impact | VARCHAR | LLM: Why it matters |
| enrichment_category | VARCHAR | LLM: bug-fix, performance, etc. |
| enrichment_severity | VARCHAR | LLM: low/medium/high/critical |
| enrichment_components | VARCHAR[] | LLM: Affected K8s components |
| enrichment_labels | VARCHAR[] | LLM: Topic labels |

### patch_security_fixes
Security fixes within patch releases.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s minor version (e.g. 1.35) (FK → releases.version) |
| patch_version | VARCHAR | Full patch version (e.g. v1.35.1) (FK → patch_releases.patch_version) |
| cve | VARCHAR | CVE identifier |
| title | VARCHAR | CVE title |
| description | VARCHAR | CVE description |

### Linking Tables

### field_kep_links
Automatically inferred links between new fields and their originating KEPs.

| Column | Type | Description |
|--------|------|-------------|
| version | VARCHAR | K8s version where field was added (FK → releases.version) |
| field_path | VARCHAR | Field path (e.g. "spec.workloadRef") |
| kind | VARCHAR | Kind the field belongs to |
| group_name | VARCHAR | API group |
| kep | VARCHAR | KEP identifier (e.g. "KEP-4671") (FK → keps.kep) |
| kep_title | VARCHAR | KEP title |
| kep_path | VARCHAR | GitHub path to KEP |
| confidence | DOUBLE | Match confidence (0.0-1.0) |
| match_reason | VARCHAR | Why this match was made |
| is_canonical | BOOLEAN | True if original definition, false if inherited |

### content_links
External content (blog posts, documentation, videos, etc.) linked to releases, KEPs, Kinds, and fields.

| Column | Type | Description |
|--------|------|-------------|
| url | VARCHAR | Content URL |
| title | VARCHAR | Content title |
| content_type | VARCHAR | blog, documentation, video, tutorial, announcement, reference, deep-dive |
| source | VARCHAR | Source domain (kubernetes.io, medium.com, youtube.com) |
| is_official | BOOLEAN | True if from official K8s sources |
| published_date | VARCHAR | ISO date when published (optional) |
| author | VARCHAR | Author name (optional) |
| summary | VARCHAR | 1-liner description of the content |
| description | VARCHAR | 2-3 sentence deeper explanation |
| labels | VARCHAR[] | Topic labels for cross-referencing |
| attrs | VARCHAR | JSON blob for source-specific extras |
| target_type | VARCHAR | release, kep, kind, or field |
| target_id | VARCHAR | Version, KEP ID, Kind name, or field path |
| target_group | VARCHAR | For kind: API group. For field: "Kind@group" format |
| target_version | VARCHAR | K8s version context (optional) |
| link_confidence | DOUBLE | LLM confidence score for KEP links (0.0-1.0) |
| link_reason | VARCHAR | LLM explanation for why KEP was linked |

### Provider Support Tables

### providers
Cloud provider metadata for Kubernetes distributions.

| Column | Type | Description |
|--------|------|-------------|
| provider_id | VARCHAR | **PK** e.g. "eks", "gke", "aks", "openshift" |
| display_name | VARCHAR | e.g. "Amazon EKS" |
| color | VARCHAR | Hex color for UI |
| docs_url | VARCHAR | Provider main documentation URL |
| version_docs_url | VARCHAR | URL explaining version lifecycle/support model |
| versioning_scheme | VARCHAR | "k8s" (direct) or "custom" (e.g., OpenShift 4.x) |
| support_model | VARCHAR | e.g. "standard+extended", "standard-only", "lts" |
| standard_support_months | INTEGER | Months of standard support (e.g., 14 for EKS) |
| extended_support_months | INTEGER | Months of extended support (0 if none) |

### provider_versions
K8s version support per cloud provider with release dates and support periods.

| Column | Type | Description |
|--------|------|-------------|
| provider_id | VARCHAR | Provider identifier (FK → providers.provider_id) |
| k8s_version | VARCHAR | Normalized K8s version (e.g. "1.34") (FK → releases.version) |
| provider_version | VARCHAR | Provider-specific version (e.g. "1.34" or "4.20" for OpenShift) |
| upstream_release_date | VARCHAR | When upstream K8s released this version |
| provider_release_date | VARCHAR | When provider made this version available |
| eol_standard_date | VARCHAR | End of standard support |
| eol_extended_date | VARCHAR | End of extended support (if applicable) |
| days_to_availability | INTEGER | Days from upstream release to provider availability |
| standard_support_days | INTEGER | Days of standard support |
| extended_support_days | INTEGER | Days of extended support (0 if none) |
| total_support_days | INTEGER | Total days of support (standard + extended) |
| status | VARCHAR | "supported", "extended", or "eol" |
| has_extended_support | BOOLEAN | True if extended support is available for this version |
| latest_patch | VARCHAR | Latest patch version (e.g. "1.34-eks-9") |
| latest_patch_date | VARCHAR | Date of latest patch release |

## Notes

- Parquet doesn't enforce FKs - relationships are logical
- Arrays stored as VARCHAR[] (list type in Parquet)
- JSON stored as string (parsed by DuckDB WASM)
- PK/FK annotations are for documentation only
