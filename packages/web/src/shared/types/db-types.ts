/**
 * Auto-generated TypeScript types from PyArrow schemas.
 * 
 * DO NOT EDIT MANUALLY - regenerate with:
 *   uv run k8s-pipeline export types
 * 
 * Generated: 2026-02-03T11:28:32.058715
 * Source: pipeline/src/k8s/output/parquet/schemas.py
 */

// =============================================================================
// Row Types (one interface per DuckDB table)
// =============================================================================

/**
 * Critical upgrade notes from CHANGELOG that require immediate attention.
 * @table action_required
 */
export interface ActionRequiredRow {
  /** K8s version */
  version?: string;
  /** Upgrade note content */
  description?: string;
  /** Pull request number */
  pr_number?: number;
  /** Pull request URL */
  pr_url?: string;
  /** PR author */
  author?: string;
  /** Related SIGs */
  sigs?: string[];
}

/**
 * API schema changes between consecutive K8s versions.
 * @table api_diffs
 */
export interface ApiDiffsRow {
  /** Starting version */
  from_version?: string;
  /** Ending version */
  to_version?: string;
  /** kind_added/kind_removed/field_added/field_removed */
  change_type?: string;
  /** Affected group */
  group_name?: string;
  /** Affected Kind */
  kind?: string;
  /** Affected field path (for field changes) */
  field_path?: string;
  /** Previous value (if applicable) */
  old_value?: string;
  /** New value (if applicable) */
  new_value?: string;
}

/**
 * API groups per version (core, apps, networking.k8s.io, etc).
 * @table api_groups
 */
export interface ApiGroupsRow {
  /** K8s version */
  version?: string;
  /** e.g. "apps", "core" */
  name?: string;
  /** e.g. "Apps", "Core" */
  display_name?: string;
  /** Group description */
  description?: string;
  /** Hex color for UI */
  color?: string;
}

/**
 * CLI flags and configuration options for K8s components.
 * @table component_flags
 */
export interface ComponentFlagsRow {
  /** Component identifier */
  component_id?: string;
  /** Flag name (e.g. "--cpu-manager-policy") */
  name?: string;
  /** string, bool, int, duration */
  type?: string;
  /** Default value */
  default_value?: string;
  /** Flag description */
  description?: string;
  /** K8s version when introduced */
  introduced_in?: string;
  /** K8s version when deprecated */
  deprecated_in?: string;
  /** K8s version when removed */
  removed_in?: string;
  /** Allowed values (for enums) */
  values?: string[];
  /** Related KEP identifiers */
  related_keps?: string[];
  /** Related feature gate names */
  related_feature_gates?: string[];
}

/**
 * Kubernetes control plane and node components.
 * @table components
 */
export interface ComponentsRow {
  /** e.g. "kube-apiserver", "kubelet" */
  id?: string;
  /** control-plane, node, addon, runtime */
  type?: string;
  /** e.g. "API Server", "Kubelet" */
  display_name?: string;
  /** Component description */
  description?: string;
  /** Official documentation URL */
  docs_url?: string;
  /** Related KEP identifiers */
  related_keps?: string[];
  /** Sub-controllers (for controller-manager) */
  controllers?: string[];
}

/**
 * External content (blog posts, documentation, videos, etc.) linked to releases, KEPs, Kinds, and fields.
 * @table content_links
 */
export interface ContentLinksRow {
  /** Content URL */
  url?: string;
  /** Content title */
  title?: string;
  /** blog, documentation, video, tutorial, announcement, reference, deep-dive */
  content_type?: string;
  /** Source domain (kubernetes.io, medium.com, youtube.com) */
  source?: string;
  /** True if from official K8s sources */
  is_official?: boolean;
  /** ISO date when published (optional) */
  published_date?: string;
  /** Author name (optional) */
  author?: string;
  /** 1-liner description of the content */
  summary?: string;
  /** 2-3 sentence deeper explanation */
  description?: string;
  /** Topic labels for cross-referencing */
  labels?: string[];
  /** JSON blob for source-specific extras */
  attrs?: string;
  /** release, kep, kind, or field */
  target_type?: string;
  /** Version, KEP ID, Kind name, or field path */
  target_id?: string;
  /** For kind: API group. For field: "Kind@group" format */
  target_group?: string;
  /** K8s version context (optional) */
  target_version?: string;
  /** LLM confidence score for KEP links (0.0-1.0) */
  link_confidence?: number;
  /** LLM explanation for why KEP was linked */
  link_reason?: string;
}

/**
 * Deprecation notices per release.
 * @table deprecations
 */
export interface DeprecationsRow {
  /** K8s version */
  version?: string;
  /** Deprecated item */
  item?: string;
  /** Deprecation reason */
  reason?: string;
  /** Suggested replacement */
  replacement?: string;
  /** Target removal version */
  removal_target?: string;
}

/**
 * Feature gates per K8s version with stage and default value.
 * @table feature_gates
 */
export interface FeatureGatesRow {
  /** K8s version */
  version?: string;
  /** Feature gate name (e.g. DynamicResourceAllocation) */
  name?: string;
  /** alpha, beta, stable, or deprecated */
  stage?: string;
  /** Default enabled/disabled at this version */
  default_value?: boolean;
  /** True if locked to default (cannot be changed) */
  lock_to_default?: boolean;
  /** Feature gate description from docs */
  description?: string;
  /** Linked KEP identifier (e.g. KEP-4381) */
  kep?: string;
  /** Linked KEP title */
  kep_title?: string;
  /** Linked KEP path in enhancements repo */
  kep_path?: string;
  /** JSON array of version history entries */
  version_history_json?: string;
}

/**
 * KEP graduations per release (join table between releases and keps).
 * @table features
 */
export interface FeaturesRow {
  /** K8s version (e.g. "1.35") */
  version?: string;
  /** KEP identifier (e.g. "KEP-1287") */
  kep?: string;
  /** alpha/beta/stable */
  stage?: string;
}

/**
 * Automatically inferred links between new fields and their originating KEPs.
 * @table field_kep_links
 */
export interface FieldKepLinksRow {
  /** K8s version where field was added */
  version?: string;
  /** Field path (e.g. "spec.workloadRef") */
  field_path?: string;
  /** Kind the field belongs to */
  kind?: string;
  /** API group */
  group_name?: string;
  /** KEP identifier (e.g. "KEP-4671") */
  kep?: string;
  /** KEP title */
  kep_title?: string;
  /** GitHub path to KEP */
  kep_path?: string;
  /** Match confidence (0.0-1.0) */
  confidence?: number;
  /** Why this match was made */
  match_reason?: string;
  /** True if original definition, false if inherited */
  is_canonical?: boolean;
}

/**
 * Master KEP table - one row per KEP (Kubernetes Enhancement Proposal).
 * @table keps
 */
export interface KepsRow {
  /** e.g. "KEP-1287" */
  kep?: string;
  /** GitHub path (e.g. "sig-node/1287-in-place-update-pod-resources") */
  kep_path?: string;
  /** KEP title */
  title?: string;
  /** Owning SIG (e.g. "Node", "Apps") */
  sig?: string;
  /** Feature gate name (if any) */
  feature_gate?: string;
  /** Topic labels (e.g., ["storage", "csi", "security"]) */
  labels?: string[];
  /** KEP description/summary */
  description?: string;
  /** How this feature affects users/operators */
  impact?: string;
  /** Affected K8s Kinds */
  affected_kinds?: string[];
  /** Affected API fields */
  affected_fields?: string[];
  /** Version when alpha */
  history_alpha?: string;
  /** Version when beta */
  history_beta?: string;
  /** Version when stable */
  history_stable?: string;
}

/**
 * Kubernetes resource types (Pod, Deployment, etc).
 * @table kinds
 */
export interface KindsRow {
  /** K8s version */
  version?: string;
  /** API group */
  group_name?: string;
  /** e.g. "v1", "v1beta1" */
  api_version?: string;
  /** e.g. "Pod", "Deployment" */
  name?: string;
  /** Lowercase singular */
  singular_name?: string;
  /** Lowercase plural */
  plural_name?: string;
  /** "Namespaced" or "Cluster" */
  scope?: string;
  /** kubectl shortcuts ["po", "deploy"] */
  short_names?: string[];
  /** ["all"] */
  categories?: string[];
  /** Path to schema (legacy) */
  schema_ref?: string;
  /** Total fields in schema */
  field_count?: number;
  /** Kind description */
  description?: string;
  /** kubernetes.io docs link */
  docs_url?: string;
  /** Full OpenAPI schema as JSON */
  schema_json?: string;
}

/**
 * Kind-to-Kind relationships in the K8s API (owns, selects, references, mounts, configures).
 * @table kinds_relationships
 */
export interface KindsRelationshipsRow {
  /** K8s version */
  version?: string;
  /** Source Kind */
  source_kind?: string;
  /** Source group */
  source_group?: string;
  /** owns/selects/references/mounts/configures */
  type?: string;
  /** Target Kind name */
  target_kind?: string;
  /** Target group name */
  target_group?: string;
  /** Relationship description */
  description?: string;
  /** e.g. "spec.template" */
  field_path?: string;
}

/**
 * kubectl commands per K8s version.
 * @table kubectl_commands
 */
export interface KubectlCommandsRow {
  /** K8s version */
  version?: string;
  /** Command name (e.g. "kubectl apply") */
  name?: string;
  /** Brief description of the command */
  synopsis?: string;
  /** Usage pattern */
  usage?: string;
  /** List of subcommand names */
  subcommands?: string[];
}

/**
 * kubectl command examples per K8s version.
 * @table kubectl_examples
 */
export interface KubectlExamplesRow {
  /** K8s version */
  version?: string;
  /** Parent command name */
  command?: string;
  /** Example description */
  description?: string;
  /** Example command */
  example?: string;
}

/**
 * kubectl command options/flags per K8s version.
 * @table kubectl_options
 */
export interface KubectlOptionsRow {
  /** K8s version */
  version?: string;
  /** Parent command name */
  command?: string;
  /** Option name (e.g. "--filename") */
  name?: string;
  /** Short flag (e.g. "-f") */
  short?: string;
  /** Option type (string, bool, int, etc.) */
  type?: string;
  /** Default value */
  default_value?: string;
  /** Option description */
  description?: string;
}

/**
 * Individual changes within patch releases.
 * @table patch_release_changes
 */
export interface PatchReleaseChangesRow {
  /** K8s minor version (e.g. 1.35) */
  version?: string;
  /** Full patch version (e.g. v1.35.1) */
  patch_version?: string;
  /** Change category (feature, bugOrRegression, etc.) */
  kind?: string;
  /** Change description */
  description?: string;
  /** Pull request number */
  pr_number?: number;
  /** Pull request URL */
  pr_url?: string;
  /** PR author */
  author?: string;
  /** Related SIGs */
  sigs?: string[];
  /** LLM: What was the problem */
  enrichment_problem?: string;
  /** LLM: Who was affected */
  enrichment_affected?: string;
  /** LLM: What the fix does */
  enrichment_fix?: string;
  /** LLM: Why it matters */
  enrichment_impact?: string;
  /** LLM: bug-fix, performance, etc. */
  enrichment_category?: string;
  /** LLM: low/medium/high/critical */
  enrichment_severity?: string;
  /** LLM: Affected K8s components */
  enrichment_components?: string[];
  /** LLM: Topic labels */
  enrichment_labels?: string[];
}

/**
 * Patch releases within a minor version from CHANGELOG.
 * @table patch_releases
 */
export interface PatchReleasesRow {
  /** K8s version (e.g. 1.35) */
  version?: string;
  /** Full patch version (e.g. 1.35.1) */
  patch_version?: string;
  /** Previous version */
  changelog_since?: string;
  /** Number of security fixes */
  security_fixes_count?: number;
  /** Total number of changes */
  changes_count?: number;
}

/**
 * Security fixes within patch releases.
 * @table patch_security_fixes
 */
export interface PatchSecurityFixesRow {
  /** K8s minor version (e.g. 1.35) */
  version?: string;
  /** Full patch version (e.g. v1.35.1) */
  patch_version?: string;
  /** CVE identifier */
  cve?: string;
  /** CVE title */
  title?: string;
  /** CVE description */
  description?: string;
}

/**
 * K8s version support per cloud provider with release dates and support periods.
 * @table provider_versions
 */
export interface ProviderVersionsRow {
  /** Provider identifier */
  provider_id?: string;
  /** Normalized K8s version (e.g. "1.34") */
  k8s_version?: string;
  /** Provider-specific version (e.g. "1.34" or "4.20" for OpenShift) */
  provider_version?: string;
  /** When upstream K8s released this version */
  upstream_release_date?: string;
  /** When provider made this version available */
  provider_release_date?: string;
  /** End of standard support */
  eol_standard_date?: string;
  /** End of extended support (if applicable) */
  eol_extended_date?: string;
  /** Days from upstream release to provider availability */
  days_to_availability?: number;
  /** Days of standard support */
  standard_support_days?: number;
  /** Days of extended support (0 if none) */
  extended_support_days?: number;
  /** Total days of support (standard + extended) */
  total_support_days?: number;
  /** "supported", "extended", or "eol" */
  status?: string;
  /** True if extended support is available for this version */
  has_extended_support?: boolean;
  /** Latest patch version (e.g. "1.34-eks-9") */
  latest_patch?: string;
  /** Date of latest patch release */
  latest_patch_date?: string;
}

/**
 * Cloud provider metadata for Kubernetes distributions.
 * @table providers
 */
export interface ProvidersRow {
  /** e.g. "eks", "gke", "aks", "openshift" */
  provider_id?: string;
  /** e.g. "Amazon EKS" */
  display_name?: string;
  /** Hex color for UI */
  color?: string;
  /** Provider main documentation URL */
  docs_url?: string;
  /** URL explaining version lifecycle/support model */
  version_docs_url?: string;
  /** "k8s" (direct) or "custom" (e.g., OpenShift 4.x) */
  versioning_scheme?: string;
  /** e.g. "standard+extended", "standard-only", "lts" */
  support_model?: string;
  /** Months of standard support (e.g., 14 for EKS) */
  standard_support_months?: number;
  /** Months of extended support (0 if none) */
  extended_support_months?: number;
}

/**
 * Raw changes from release-notes.json, grouped by kind.
 * @table release_changes
 */
export interface ReleaseChangesRow {
  /** K8s version */
  version?: string;
  /** Change category (api-change, feature, bug, etc.) */
  kind?: string;
  /** Change description */
  description?: string;
  /** Pull request number */
  pr_number?: number;
  /** Pull request URL */
  pr_url?: string;
  /** PR author */
  author?: string;
  /** Related SIGs */
  sigs?: string[];
  /** Related KEP links */
  kep_links?: string[];
  /** LLM: What was the problem */
  enrichment_problem?: string;
  /** LLM: Who was affected */
  enrichment_affected?: string;
  /** LLM: What the fix does */
  enrichment_fix?: string;
  /** LLM: Why it matters */
  enrichment_impact?: string;
  /** LLM: bug-fix, performance, etc. */
  enrichment_category?: string;
  /** LLM: low/medium/high/critical */
  enrichment_severity?: string;
  /** LLM: Affected K8s components */
  enrichment_components?: string[];
  /** LLM: Topic labels */
  enrichment_labels?: string[];
}

/**
 * K8s release metadata including version info, codename, and feature counts.
 * @table releases
 */
export interface ReleasesRow {
  /** e.g. "1.35" */
  version?: string;
  /** ISO date */
  release_date?: string;
  /** True for newest version */
  is_latest?: boolean;
  /** e.g. "Octarine" */
  codename?: string;
  /** Release description */
  description?: string;
  /** Total feature count */
  total_features?: number;
  /** Stable feature count */
  stable_features?: number;
  /** Beta feature count */
  beta_features?: number;
  /** Alpha feature count */
  alpha_features?: number;
  /** ["DRA", "Security"] */
  themes?: string[];
}

/**
 * Security vulnerabilities (CVEs) from CHANGELOG.
 * @table security_cves
 */
export interface SecurityCvesRow {
  /** K8s version */
  version?: string;
  /** CVE identifier (e.g. CVE-2024-1234) */
  cve?: string;
  /** CVE title */
  title?: string;
  /** CVE description */
  description?: string;
  /** Affected K8s versions */
  affected_versions?: string[];
  /** Fixed K8s versions */
  fixed_versions?: string[];
  /** Affected components */
  affected_components?: string[];
  /** Patch version that fixed it */
  patch_version?: string;
}


// =============================================================================
// Utility Types
// =============================================================================

export type TableName = "action_required" | "api_diffs" | "api_groups" | "component_flags" | "components" | "content_links" | "deprecations" | "feature_gates" | "features" | "field_kep_links" | "keps" | "kinds" | "kinds_relationships" | "kubectl_commands" | "kubectl_examples" | "kubectl_options" | "patch_release_changes" | "patch_releases" | "patch_security_fixes" | "provider_versions" | "providers" | "release_changes" | "releases" | "security_cves";

export interface TableRowMap {
  "action_required": ActionRequiredRow;
  "api_diffs": ApiDiffsRow;
  "api_groups": ApiGroupsRow;
  "component_flags": ComponentFlagsRow;
  "components": ComponentsRow;
  "content_links": ContentLinksRow;
  "deprecations": DeprecationsRow;
  "feature_gates": FeatureGatesRow;
  "features": FeaturesRow;
  "field_kep_links": FieldKepLinksRow;
  "keps": KepsRow;
  "kinds": KindsRow;
  "kinds_relationships": KindsRelationshipsRow;
  "kubectl_commands": KubectlCommandsRow;
  "kubectl_examples": KubectlExamplesRow;
  "kubectl_options": KubectlOptionsRow;
  "patch_release_changes": PatchReleaseChangesRow;
  "patch_releases": PatchReleasesRow;
  "patch_security_fixes": PatchSecurityFixesRow;
  "provider_versions": ProviderVersionsRow;
  "providers": ProvidersRow;
  "release_changes": ReleaseChangesRow;
  "releases": ReleasesRow;
  "security_cves": SecurityCvesRow;
}