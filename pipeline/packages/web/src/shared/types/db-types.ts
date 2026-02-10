/**
 * Auto-generated TypeScript types from PyArrow schemas.
 * 
 * DO NOT EDIT MANUALLY - regenerate with:
 *   uv run k8s-pipeline export types
 * 
 * Generated: 2026-02-03T11:08:24.185703
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
  prNumber?: number;
  /** Pull request URL */
  prUrl?: string;
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
  fromVersion?: string;
  /** Ending version */
  toVersion?: string;
  /** kind_added/kind_removed/field_added/field_removed */
  changeType?: string;
  /** Affected group */
  groupName?: string;
  /** Affected Kind */
  kind?: string;
  /** Affected field path (for field changes) */
  fieldPath?: string;
  /** Previous value (if applicable) */
  oldValue?: string;
  /** New value (if applicable) */
  newValue?: string;
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
  displayName?: string;
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
  componentId?: string;
  /** Flag name (e.g. "--cpu-manager-policy") */
  name?: string;
  /** string, bool, int, duration */
  type?: string;
  /** Default value */
  defaultValue?: string;
  /** Flag description */
  description?: string;
  /** K8s version when introduced */
  introducedIn?: string;
  /** K8s version when deprecated */
  deprecatedIn?: string;
  /** K8s version when removed */
  removedIn?: string;
  /** Allowed values (for enums) */
  values?: string[];
  /** Related KEP identifiers */
  relatedKeps?: string[];
  /** Related feature gate names */
  relatedFeatureGates?: string[];
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
  displayName?: string;
  /** Component description */
  description?: string;
  /** Official documentation URL */
  docsUrl?: string;
  /** Related KEP identifiers */
  relatedKeps?: string[];
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
  contentType?: string;
  /** Source domain (kubernetes.io, medium.com, youtube.com) */
  source?: string;
  /** True if from official K8s sources */
  isOfficial?: boolean;
  /** ISO date when published (optional) */
  publishedDate?: string;
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
  targetType?: string;
  /** Version, KEP ID, Kind name, or field path */
  targetId?: string;
  /** For kind: API group. For field: "Kind@group" format */
  targetGroup?: string;
  /** K8s version context (optional) */
  targetVersion?: string;
  /** LLM confidence score for KEP links (0.0-1.0) */
  linkConfidence?: number;
  /** LLM explanation for why KEP was linked */
  linkReason?: string;
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
  removalTarget?: string;
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
  defaultValue?: boolean;
  /** True if locked to default (cannot be changed) */
  lockToDefault?: boolean;
  /** Feature gate description from docs */
  description?: string;
  /** Linked KEP identifier (e.g. KEP-4381) */
  kep?: string;
  /** Linked KEP title */
  kepTitle?: string;
  /** Linked KEP path in enhancements repo */
  kepPath?: string;
  /** JSON array of version history entries */
  versionHistoryJson?: string;
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
  fieldPath?: string;
  /** Kind the field belongs to */
  kind?: string;
  /** API group */
  groupName?: string;
  /** KEP identifier (e.g. "KEP-4671") */
  kep?: string;
  /** KEP title */
  kepTitle?: string;
  /** GitHub path to KEP */
  kepPath?: string;
  /** Match confidence (0.0-1.0) */
  confidence?: number;
  /** Why this match was made */
  matchReason?: string;
  /** True if original definition, false if inherited */
  isCanonical?: boolean;
}

/**
 * Master KEP table - one row per KEP (Kubernetes Enhancement Proposal).
 * @table keps
 */
export interface KepsRow {
  /** e.g. "KEP-1287" */
  kep?: string;
  /** GitHub path (e.g. "sig-node/1287-in-place-update-pod-resources") */
  kepPath?: string;
  /** KEP title */
  title?: string;
  /** Owning SIG (e.g. "Node", "Apps") */
  sig?: string;
  /** Feature gate name (if any) */
  featureGate?: string;
  /** Topic labels (e.g., ["storage", "csi", "security"]) */
  labels?: string[];
  /** KEP description/summary */
  description?: string;
  /** How this feature affects users/operators */
  impact?: string;
  /** Affected K8s Kinds */
  affectedKinds?: string[];
  /** Affected API fields */
  affectedFields?: string[];
  /** Version when alpha */
  historyAlpha?: string;
  /** Version when beta */
  historyBeta?: string;
  /** Version when stable */
  historyStable?: string;
}

/**
 * Kubernetes resource types (Pod, Deployment, etc).
 * @table kinds
 */
export interface KindsRow {
  /** K8s version */
  version?: string;
  /** API group */
  groupName?: string;
  /** e.g. "v1", "v1beta1" */
  apiVersion?: string;
  /** e.g. "Pod", "Deployment" */
  name?: string;
  /** Lowercase singular */
  singularName?: string;
  /** Lowercase plural */
  pluralName?: string;
  /** "Namespaced" or "Cluster" */
  scope?: string;
  /** kubectl shortcuts ["po", "deploy"] */
  shortNames?: string[];
  /** ["all"] */
  categories?: string[];
  /** Path to schema (legacy) */
  schemaRef?: string;
  /** Total fields in schema */
  fieldCount?: number;
  /** Kind description */
  description?: string;
  /** kubernetes.io docs link */
  docsUrl?: string;
  /** Full OpenAPI schema as JSON */
  schemaJson?: string;
}

/**
 * Kind-to-Kind relationships in the K8s API (owns, selects, references, mounts, configures).
 * @table kinds_relationships
 */
export interface KindsRelationshipsRow {
  /** K8s version */
  version?: string;
  /** Source Kind */
  sourceKind?: string;
  /** Source group */
  sourceGroup?: string;
  /** owns/selects/references/mounts/configures */
  type?: string;
  /** Target Kind name */
  targetKind?: string;
  /** Target group name */
  targetGroup?: string;
  /** Relationship description */
  description?: string;
  /** e.g. "spec.template" */
  fieldPath?: string;
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
  defaultValue?: string;
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
  patchVersion?: string;
  /** Change category (feature, bugOrRegression, etc.) */
  kind?: string;
  /** Change description */
  description?: string;
  /** Pull request number */
  prNumber?: number;
  /** Pull request URL */
  prUrl?: string;
  /** PR author */
  author?: string;
  /** Related SIGs */
  sigs?: string[];
  /** LLM: What was the problem */
  enrichmentProblem?: string;
  /** LLM: Who was affected */
  enrichmentAffected?: string;
  /** LLM: What the fix does */
  enrichmentFix?: string;
  /** LLM: Why it matters */
  enrichmentImpact?: string;
  /** LLM: bug-fix, performance, etc. */
  enrichmentCategory?: string;
  /** LLM: low/medium/high/critical */
  enrichmentSeverity?: string;
  /** LLM: Affected K8s components */
  enrichmentComponents?: string[];
  /** LLM: Topic labels */
  enrichmentLabels?: string[];
}

/**
 * Patch releases within a minor version from CHANGELOG.
 * @table patch_releases
 */
export interface PatchReleasesRow {
  /** K8s version (e.g. 1.35) */
  version?: string;
  /** Full patch version (e.g. 1.35.1) */
  patchVersion?: string;
  /** Previous version */
  changelogSince?: string;
  /** Number of security fixes */
  securityFixesCount?: number;
  /** Total number of changes */
  changesCount?: number;
}

/**
 * Security fixes within patch releases.
 * @table patch_security_fixes
 */
export interface PatchSecurityFixesRow {
  /** K8s minor version (e.g. 1.35) */
  version?: string;
  /** Full patch version (e.g. v1.35.1) */
  patchVersion?: string;
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
  providerId?: string;
  /** Normalized K8s version (e.g. "1.34") */
  k8sVersion?: string;
  /** Provider-specific version (e.g. "1.34" or "4.20" for OpenShift) */
  providerVersion?: string;
  /** When upstream K8s released this version */
  upstreamReleaseDate?: string;
  /** When provider made this version available */
  providerReleaseDate?: string;
  /** End of standard support */
  eolStandardDate?: string;
  /** End of extended support (if applicable) */
  eolExtendedDate?: string;
  /** Days from upstream release to provider availability */
  daysToAvailability?: number;
  /** Days of standard support */
  standardSupportDays?: number;
  /** Days of extended support (0 if none) */
  extendedSupportDays?: number;
  /** Total days of support (standard + extended) */
  totalSupportDays?: number;
  /** "supported", "extended", or "eol" */
  status?: string;
  /** True if extended support is available for this version */
  hasExtendedSupport?: boolean;
  /** Latest patch version (e.g. "1.34-eks-9") */
  latestPatch?: string;
  /** Date of latest patch release */
  latestPatchDate?: string;
}

/**
 * Cloud provider metadata for Kubernetes distributions.
 * @table providers
 */
export interface ProvidersRow {
  /** e.g. "eks", "gke", "aks", "openshift" */
  providerId?: string;
  /** e.g. "Amazon EKS" */
  displayName?: string;
  /** Hex color for UI */
  color?: string;
  /** Provider main documentation URL */
  docsUrl?: string;
  /** URL explaining version lifecycle/support model */
  versionDocsUrl?: string;
  /** "k8s" (direct) or "custom" (e.g., OpenShift 4.x) */
  versioningScheme?: string;
  /** e.g. "standard+extended", "standard-only", "lts" */
  supportModel?: string;
  /** Months of standard support (e.g., 14 for EKS) */
  standardSupportMonths?: number;
  /** Months of extended support (0 if none) */
  extendedSupportMonths?: number;
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
  prNumber?: number;
  /** Pull request URL */
  prUrl?: string;
  /** PR author */
  author?: string;
  /** Related SIGs */
  sigs?: string[];
  /** Related KEP links */
  kepLinks?: string[];
  /** LLM: What was the problem */
  enrichmentProblem?: string;
  /** LLM: Who was affected */
  enrichmentAffected?: string;
  /** LLM: What the fix does */
  enrichmentFix?: string;
  /** LLM: Why it matters */
  enrichmentImpact?: string;
  /** LLM: bug-fix, performance, etc. */
  enrichmentCategory?: string;
  /** LLM: low/medium/high/critical */
  enrichmentSeverity?: string;
  /** LLM: Affected K8s components */
  enrichmentComponents?: string[];
  /** LLM: Topic labels */
  enrichmentLabels?: string[];
}

/**
 * K8s release metadata including version info, codename, and feature counts.
 * @table releases
 */
export interface ReleasesRow {
  /** e.g. "1.35" */
  version?: string;
  /** ISO date */
  releaseDate?: string;
  /** True for newest version */
  isLatest?: boolean;
  /** e.g. "Octarine" */
  codename?: string;
  /** Release description */
  description?: string;
  /** Total feature count */
  totalFeatures?: number;
  /** Stable feature count */
  stableFeatures?: number;
  /** Beta feature count */
  betaFeatures?: number;
  /** Alpha feature count */
  alphaFeatures?: number;
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
  affectedVersions?: string[];
  /** Fixed K8s versions */
  fixedVersions?: string[];
  /** Affected components */
  affectedComponents?: string[];
  /** Patch version that fixed it */
  patchVersion?: string;
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