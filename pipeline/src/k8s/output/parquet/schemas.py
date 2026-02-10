"""PyArrow schema definitions with metadata for all Parquet tables.

This module defines schemas with embedded metadata (descriptions, foreign keys, etc.)
that serve as the single source of truth for:
1. Parquet file generation (enforces types)
2. Documentation generation (extracts metadata)

Usage:
    from .schemas import SCHEMAS, get_schema

    # Get a schema
    schema = get_schema("keps")

    # Create table with schema
    table = pa.Table.from_pydict(data, schema=schema)
"""

import pyarrow as pa


def _field(
    name: str,
    pa_type: pa.DataType,
    description: str = "",
    pk: bool = False,
    fk: str | None = None,
) -> pa.Field:
    """Create a PyArrow field with metadata.

    Args:
        name: Column name
        pa_type: PyArrow data type
        description: Human-readable description
        pk: True if this is a primary key
        fk: Foreign key reference (e.g., "versions.version")
    """
    metadata = {}
    if description:
        metadata["description"] = description
    if pk:
        metadata["pk"] = "true"
    if fk:
        metadata["fk"] = fk

    return pa.field(name, pa_type, metadata=metadata if metadata else None)


# =============================================================================
# API Schema Tables
# =============================================================================

API_GROUPS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("name", pa.string(), 'e.g. "apps", "core"', pk=True),
    _field("display_name", pa.string(), 'e.g. "Apps", "Core"'),
    _field("description", pa.string(), "Group description"),
    _field("color", pa.string(), "Hex color for UI"),
], metadata={"description": "API groups per version (core, apps, networking.k8s.io, etc)."})

KINDS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("group_name", pa.string(), "API group", fk="api_groups.name"),
    _field("api_version", pa.string(), 'e.g. "v1", "v1beta1"'),
    _field("name", pa.string(), 'e.g. "Pod", "Deployment"', pk=True),
    _field("singular_name", pa.string(), "Lowercase singular"),
    _field("plural_name", pa.string(), "Lowercase plural"),
    _field("scope", pa.string(), '"Namespaced" or "Cluster"'),
    _field("short_names", pa.list_(pa.string()), 'kubectl shortcuts ["po", "deploy"]'),
    _field("categories", pa.list_(pa.string()), '["all"]'),
    _field("schema_ref", pa.string(), "Path to schema (legacy)"),
    _field("field_count", pa.int64(), "Total fields in schema"),
    _field("description", pa.string(), "Kind description"),
    _field("docs_url", pa.string(), "kubernetes.io docs link"),
    _field("schema_json", pa.string(), "Full OpenAPI schema as JSON"),
], metadata={"description": "Kubernetes resource types (Pod, Deployment, etc)."})

RELATIONSHIPS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("source_kind", pa.string(), "Source Kind", fk="kinds.name"),
    _field("source_group", pa.string(), "Source group", fk="kinds.group_name"),
    _field("type", pa.string(), "owns/selects/references/mounts/configures"),
    _field("target_kind", pa.string(), "Target Kind name"),
    _field("target_group", pa.string(), "Target group name"),
    _field("description", pa.string(), "Relationship description"),
    _field("field_path", pa.string(), 'e.g. "spec.template"'),
], metadata={"description": "Kind-to-Kind relationships in the K8s API (owns, selects, references, mounts, configures)."})
# Alias for the new name
KINDS_RELATIONSHIPS_SCHEMA = RELATIONSHIPS_SCHEMA

API_DIFFS_SCHEMA = pa.schema([
    _field("from_version", pa.string(), "Starting version", fk="releases.version"),
    _field("to_version", pa.string(), "Ending version", fk="releases.version"),
    _field("change_type", pa.string(), "kind_added/kind_removed/field_added/field_removed"),
    _field("group_name", pa.string(), "Affected group"),
    _field("kind", pa.string(), "Affected Kind"),
    _field("field_path", pa.string(), "Affected field path (for field changes)"),
    _field("old_value", pa.string(), "Previous value (if applicable)"),
    _field("new_value", pa.string(), "New value (if applicable)"),
], metadata={"description": "API schema changes between consecutive K8s versions."})

# =============================================================================
# Release Tables
# =============================================================================

RELEASES_SCHEMA = pa.schema([
    _field("version", pa.string(), 'e.g. "1.35"', pk=True),
    _field("release_date", pa.string(), "ISO date"),
    _field("is_latest", pa.bool_(), "True for newest version"),
    _field("codename", pa.string(), 'e.g. "Octarine"'),
    _field("description", pa.string(), "Release description"),
    _field("total_features", pa.int64(), "Total feature count"),
    _field("stable_features", pa.int64(), "Stable feature count"),
    _field("beta_features", pa.int64(), "Beta feature count"),
    _field("alpha_features", pa.int64(), "Alpha feature count"),
    _field("themes", pa.list_(pa.string()), '["DRA", "Security"]'),
], metadata={"description": "K8s release metadata including version info, codename, and feature counts."})

KEPS_SCHEMA = pa.schema([
    _field("kep", pa.string(), 'e.g. "KEP-1287"', pk=True),
    _field("kep_path", pa.string(), 'GitHub path (e.g. "sig-node/1287-in-place-update-pod-resources")'),
    _field("title", pa.string(), "KEP title"),
    _field("sig", pa.string(), 'Owning SIG (e.g. "Node", "Apps")'),
    _field("feature_gate", pa.string(), "Feature gate name (if any)"),
    _field("labels", pa.list_(pa.string()), 'Topic labels (e.g., ["storage", "csi", "security"])'),
    _field("description", pa.string(), "KEP description/summary"),
    _field("impact", pa.string(), "How this feature affects users/operators"),
    _field("affected_kinds", pa.list_(pa.string()), "Affected K8s Kinds"),
    _field("affected_fields", pa.list_(pa.string()), "Affected API fields"),
    _field("history_alpha", pa.string(), "Version when alpha"),
    _field("history_beta", pa.string(), "Version when beta"),
    _field("history_stable", pa.string(), "Version when stable"),
], metadata={"description": "Master KEP table - one row per KEP (Kubernetes Enhancement Proposal)."})

FEATURES_SCHEMA = pa.schema([
    _field("version", pa.string(), 'K8s version (e.g. "1.35")', pk=True, fk="releases.version"),
    _field("kep", pa.string(), 'KEP identifier (e.g. "KEP-1287")', pk=True, fk="keps.kep"),
    _field("stage", pa.string(), "alpha/beta/stable"),
], metadata={"description": "KEP graduations per release (join table between releases and keps)."})

DEPRECATIONS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("item", pa.string(), "Deprecated item"),
    _field("reason", pa.string(), "Deprecation reason"),
    _field("replacement", pa.string(), "Suggested replacement"),
    _field("removal_target", pa.string(), "Target removal version"),
], metadata={"description": "Deprecation notices per release."})

RELEASE_CHANGES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("kind", pa.string(), "Change category (api-change, feature, bug, etc.)"),
    _field("description", pa.string(), "Change description"),
    _field("pr_number", pa.int64(), "Pull request number"),
    _field("pr_url", pa.string(), "Pull request URL"),
    _field("author", pa.string(), "PR author"),
    _field("sigs", pa.list_(pa.string()), "Related SIGs"),
    _field("kep_links", pa.list_(pa.string()), "Related KEP links"),
    # Enrichment fields (from LLM - change_enricher)
    _field("enrichment_problem", pa.string(), "LLM: What was the problem"),
    _field("enrichment_affected", pa.string(), "LLM: Who was affected"),
    _field("enrichment_fix", pa.string(), "LLM: What the fix does"),
    _field("enrichment_impact", pa.string(), "LLM: Why it matters"),
    _field("enrichment_category", pa.string(), "LLM: bug-fix, performance, etc."),
    _field("enrichment_severity", pa.string(), "LLM: low/medium/high/critical"),
    _field("enrichment_components", pa.list_(pa.string()), "LLM: Affected K8s components"),
    _field("enrichment_labels", pa.list_(pa.string()), "LLM: Topic labels"),
], metadata={"description": "Raw changes from release-notes.json, grouped by kind."})

ACTION_REQUIRED_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("description", pa.string(), "Upgrade note content"),
    _field("pr_number", pa.int64(), "Pull request number"),
    _field("pr_url", pa.string(), "Pull request URL"),
    _field("author", pa.string(), "PR author"),
    _field("sigs", pa.list_(pa.string()), "Related SIGs"),
], metadata={"description": "Critical upgrade notes from CHANGELOG that require immediate attention."})

SECURITY_CVES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("cve", pa.string(), "CVE identifier (e.g. CVE-2024-1234)"),
    _field("title", pa.string(), "CVE title"),
    _field("description", pa.string(), "CVE description"),
    _field("affected_versions", pa.list_(pa.string()), "Affected K8s versions"),
    _field("fixed_versions", pa.list_(pa.string()), "Fixed K8s versions"),
    _field("affected_components", pa.list_(pa.string()), "Affected components"),
    _field("patch_version", pa.string(), "Patch version that fixed it"),
], metadata={"description": "Security vulnerabilities (CVEs) from CHANGELOG."})

PATCH_RELEASES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version (e.g. 1.35)", fk="releases.version"),
    _field("patch_version", pa.string(), "Full patch version (e.g. 1.35.1)", pk=True),
    _field("changelog_since", pa.string(), "Previous version"),
    _field("security_fixes_count", pa.int64(), "Number of security fixes"),
    _field("changes_count", pa.int64(), "Total number of changes"),
], metadata={"description": "Patch releases within a minor version from CHANGELOG."})

PATCH_RELEASE_CHANGES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s minor version (e.g. 1.35)", fk="releases.version"),
    _field("patch_version", pa.string(), "Full patch version (e.g. v1.35.1)", fk="patch_releases.patch_version"),
    _field("kind", pa.string(), "Change category (feature, bugOrRegression, etc.)"),
    _field("description", pa.string(), "Change description"),
    _field("pr_number", pa.int64(), "Pull request number"),
    _field("pr_url", pa.string(), "Pull request URL"),
    _field("author", pa.string(), "PR author"),
    _field("sigs", pa.list_(pa.string()), "Related SIGs"),
    # Enrichment fields (from LLM)
    _field("enrichment_problem", pa.string(), "LLM: What was the problem"),
    _field("enrichment_affected", pa.string(), "LLM: Who was affected"),
    _field("enrichment_fix", pa.string(), "LLM: What the fix does"),
    _field("enrichment_impact", pa.string(), "LLM: Why it matters"),
    _field("enrichment_category", pa.string(), "LLM: bug-fix, performance, etc."),
    _field("enrichment_severity", pa.string(), "LLM: low/medium/high/critical"),
    _field("enrichment_components", pa.list_(pa.string()), "LLM: Affected K8s components"),
    _field("enrichment_labels", pa.list_(pa.string()), "LLM: Topic labels"),
], metadata={"description": "Individual changes within patch releases."})

PATCH_SECURITY_FIXES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s minor version (e.g. 1.35)", fk="releases.version"),
    _field("patch_version", pa.string(), "Full patch version (e.g. v1.35.1)", fk="patch_releases.patch_version"),
    _field("cve", pa.string(), "CVE identifier"),
    _field("title", pa.string(), "CVE title"),
    _field("description", pa.string(), "CVE description"),
], metadata={"description": "Security fixes within patch releases."})

# =============================================================================
# Linking Tables
# =============================================================================

FIELD_KEP_LINKS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version where field was added", fk="releases.version"),
    _field("field_path", pa.string(), 'Field path (e.g. "spec.workloadRef")'),
    _field("kind", pa.string(), "Kind the field belongs to"),
    _field("group_name", pa.string(), "API group"),
    _field("kep", pa.string(), 'KEP identifier (e.g. "KEP-4671")', fk="keps.kep"),
    _field("kep_title", pa.string(), "KEP title"),
    _field("kep_path", pa.string(), "GitHub path to KEP"),
    _field("confidence", pa.float64(), "Match confidence (0.0-1.0)"),
    _field("match_reason", pa.string(), "Why this match was made"),
    _field("is_canonical", pa.bool_(), "True if original definition, false if inherited"),
], metadata={"description": "Automatically inferred links between new fields and their originating KEPs."})

CONTENT_LINKS_SCHEMA = pa.schema([
    _field("url", pa.string(), "Content URL"),
    _field("title", pa.string(), "Content title"),
    _field("content_type", pa.string(), "blog, documentation, video, tutorial, announcement, reference, deep-dive"),
    _field("source", pa.string(), "Source domain (kubernetes.io, medium.com, youtube.com)"),
    _field("is_official", pa.bool_(), "True if from official K8s sources"),
    _field("published_date", pa.string(), "ISO date when published (optional)"),
    _field("author", pa.string(), "Author name (optional)"),
    _field("summary", pa.string(), "1-liner description of the content"),
    _field("description", pa.string(), "2-3 sentence deeper explanation"),
    _field("labels", pa.list_(pa.string()), "Topic labels for cross-referencing"),
    _field("attrs", pa.string(), "JSON blob for source-specific extras"),
    _field("target_type", pa.string(), "release, kep, kind, or field"),
    _field("target_id", pa.string(), "Version, KEP ID, Kind name, or field path"),
    _field("target_group", pa.string(), 'For kind: API group. For field: "Kind@group" format'),
    _field("target_version", pa.string(), "K8s version context (optional)"),
    _field("link_confidence", pa.float64(), "LLM confidence score for KEP links (0.0-1.0)"),
    _field("link_reason", pa.string(), "LLM explanation for why KEP was linked"),
], metadata={"description": "External content (blog posts, documentation, videos, etc.) linked to releases, KEPs, Kinds, and fields."})

# =============================================================================
# Component Tables (Control Plane Architecture)
# =============================================================================

COMPONENTS_SCHEMA = pa.schema([
    _field("id", pa.string(), 'e.g. "kube-apiserver", "kubelet"', pk=True),
    _field("type", pa.string(), 'control-plane, node, addon, runtime'),
    _field("display_name", pa.string(), 'e.g. "API Server", "Kubelet"'),
    _field("description", pa.string(), "Component description"),
    _field("docs_url", pa.string(), "Official documentation URL"),
    _field("related_keps", pa.list_(pa.string()), "Related KEP identifiers"),
    _field("controllers", pa.list_(pa.string()), "Sub-controllers (for controller-manager)"),
], metadata={"description": "Kubernetes control plane and node components."})

COMPONENT_FLAGS_SCHEMA = pa.schema([
    _field("component_id", pa.string(), "Component identifier", fk="components.id"),
    _field("name", pa.string(), 'Flag name (e.g. "--cpu-manager-policy")', pk=True),
    _field("type", pa.string(), "string, bool, int, duration"),
    _field("default_value", pa.string(), "Default value"),
    _field("description", pa.string(), "Flag description"),
    _field("introduced_in", pa.string(), "K8s version when introduced"),
    _field("deprecated_in", pa.string(), "K8s version when deprecated"),
    _field("removed_in", pa.string(), "K8s version when removed"),
    _field("values", pa.list_(pa.string()), "Allowed values (for enums)"),
    _field("related_keps", pa.list_(pa.string()), "Related KEP identifiers"),
    _field("related_feature_gates", pa.list_(pa.string()), "Related feature gate names"),
], metadata={"description": "CLI flags and configuration options for K8s components."})

# =============================================================================
# Provider Support Tables
# =============================================================================

PROVIDERS_SCHEMA = pa.schema([
    _field("provider_id", pa.string(), 'e.g. "eks", "gke", "aks", "openshift"', pk=True),
    _field("display_name", pa.string(), 'e.g. "Amazon EKS"'),
    _field("color", pa.string(), "Hex color for UI"),
    _field("docs_url", pa.string(), "Provider main documentation URL"),
    _field("version_docs_url", pa.string(), "URL explaining version lifecycle/support model"),
    _field("versioning_scheme", pa.string(), '"k8s" (direct) or "custom" (e.g., OpenShift 4.x)'),
    _field("support_model", pa.string(), 'e.g. "standard+extended", "standard-only", "lts"'),
    _field("standard_support_months", pa.int64(), "Months of standard support (e.g., 14 for EKS)"),
    _field("extended_support_months", pa.int64(), "Months of extended support (0 if none)"),
], metadata={"description": "Cloud provider metadata for Kubernetes distributions."})

PROVIDER_VERSIONS_SCHEMA = pa.schema([
    _field("provider_id", pa.string(), "Provider identifier", fk="providers.provider_id"),
    _field("k8s_version", pa.string(), 'Normalized K8s version (e.g. "1.34")', fk="releases.version"),
    _field("provider_version", pa.string(), 'Provider-specific version (e.g. "1.34" or "4.20" for OpenShift)'),

    # Key dates
    _field("upstream_release_date", pa.string(), "When upstream K8s released this version"),
    _field("provider_release_date", pa.string(), "When provider made this version available"),
    _field("eol_standard_date", pa.string(), "End of standard support"),
    _field("eol_extended_date", pa.string(), "End of extended support (if applicable)"),

    # Computed metrics (for easy querying)
    _field("days_to_availability", pa.int64(), "Days from upstream release to provider availability"),
    _field("standard_support_days", pa.int64(), "Days of standard support"),
    _field("extended_support_days", pa.int64(), "Days of extended support (0 if none)"),
    _field("total_support_days", pa.int64(), "Total days of support (standard + extended)"),

    # Status and flags
    _field("status", pa.string(), '"supported", "extended", or "eol"'),
    _field("has_extended_support", pa.bool_(), "True if extended support is available for this version"),

    # Latest patch info
    _field("latest_patch", pa.string(), 'Latest patch version (e.g. "1.34-eks-9")'),
    _field("latest_patch_date", pa.string(), "Date of latest patch release"),
], metadata={"description": "K8s version support per cloud provider with release dates and support periods."})

# =============================================================================
# kubectl Tables
# =============================================================================

KUBECTL_COMMANDS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("name", pa.string(), 'Command name (e.g. "kubectl apply")', pk=True),
    _field("synopsis", pa.string(), "Brief description of the command"),
    _field("usage", pa.string(), "Usage pattern"),
    _field("subcommands", pa.list_(pa.string()), "List of subcommand names"),
], metadata={"description": "kubectl commands per K8s version."})

KUBECTL_OPTIONS_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("command", pa.string(), "Parent command name", fk="kubectl_commands.name"),
    _field("name", pa.string(), 'Option name (e.g. "--filename")', pk=True),
    _field("short", pa.string(), 'Short flag (e.g. "-f")'),
    _field("type", pa.string(), "Option type (string, bool, int, etc.)"),
    _field("default_value", pa.string(), "Default value"),
    _field("description", pa.string(), "Option description"),
], metadata={"description": "kubectl command options/flags per K8s version."})

KUBECTL_EXAMPLES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("command", pa.string(), "Parent command name", fk="kubectl_commands.name"),
    _field("description", pa.string(), "Example description"),
    _field("example", pa.string(), "Example command"),
], metadata={"description": "kubectl command examples per K8s version."})

# =============================================================================
# Feature Gate Tables
# =============================================================================

FEATURE_GATES_SCHEMA = pa.schema([
    _field("version", pa.string(), "K8s version", fk="releases.version"),
    _field("name", pa.string(), "Feature gate name (e.g. DynamicResourceAllocation)", pk=True),
    _field("stage", pa.string(), "alpha, beta, stable, or deprecated"),
    _field("default_value", pa.bool_(), "Default enabled/disabled at this version"),
    _field("lock_to_default", pa.bool_(), "True if locked to default (cannot be changed)"),
    _field("description", pa.string(), "Feature gate description from docs"),
    _field("kep", pa.string(), "Linked KEP identifier (e.g. KEP-4381)", fk="keps.kep"),
    _field("kep_title", pa.string(), "Linked KEP title"),
    _field("kep_path", pa.string(), "Linked KEP path in enhancements repo"),
    _field("version_history_json", pa.string(), "JSON array of version history entries"),
], metadata={"description": "Feature gates per K8s version with stage and default value."})

# =============================================================================
# Schema Registry
# =============================================================================

SCHEMAS: dict[str, pa.Schema] = {
    "api_groups": API_GROUPS_SCHEMA,
    "kinds": KINDS_SCHEMA,
    "kinds_relationships": KINDS_RELATIONSHIPS_SCHEMA,
    "api_diffs": API_DIFFS_SCHEMA,
    "releases": RELEASES_SCHEMA,
    "keps": KEPS_SCHEMA,
    "features": FEATURES_SCHEMA,
    "deprecations": DEPRECATIONS_SCHEMA,
    "release_changes": RELEASE_CHANGES_SCHEMA,
    "action_required": ACTION_REQUIRED_SCHEMA,
    "security_cves": SECURITY_CVES_SCHEMA,
    "patch_releases": PATCH_RELEASES_SCHEMA,
    "patch_release_changes": PATCH_RELEASE_CHANGES_SCHEMA,
    "patch_security_fixes": PATCH_SECURITY_FIXES_SCHEMA,
    "field_kep_links": FIELD_KEP_LINKS_SCHEMA,
    "content_links": CONTENT_LINKS_SCHEMA,
    "components": COMPONENTS_SCHEMA,
    "component_flags": COMPONENT_FLAGS_SCHEMA,
    "providers": PROVIDERS_SCHEMA,
    "provider_versions": PROVIDER_VERSIONS_SCHEMA,
    "kubectl_commands": KUBECTL_COMMANDS_SCHEMA,
    "kubectl_options": KUBECTL_OPTIONS_SCHEMA,
    "kubectl_examples": KUBECTL_EXAMPLES_SCHEMA,
    "feature_gates": FEATURE_GATES_SCHEMA,
}


def get_schema(table_name: str) -> pa.Schema:
    """Get the schema for a table by name."""
    if table_name not in SCHEMAS:
        raise ValueError(f"Unknown table: {table_name}. Available: {list(SCHEMAS.keys())}")
    return SCHEMAS[table_name]


def get_table_description(table_name: str) -> str:
    """Get the description for a table."""
    schema = get_schema(table_name)
    return (schema.metadata or {}).get(b"description", b"").decode("utf-8")


def get_field_metadata(schema: pa.Schema, field_name: str) -> dict[str, str]:
    """Get metadata for a specific field."""
    field = schema.field(field_name)
    if field.metadata is None:
        return {}
    return {k.decode(): v.decode() for k, v in field.metadata.items()}
