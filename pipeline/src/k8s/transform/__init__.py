"""Transform modules for parsing and building data.

Public API - import from here for common operations:

    from k8s.transform import build_release, parse_openapi_spec, Feature

For less common functions, import from submodules:

    from k8s.transform.openapi import infer_relationships
    from k8s.transform.kep import scan_all_keps
"""

# Re-export public API from submodules
from .openapi import (
    VersionDiff,
    clear_openapi_cache,
    compute_diff,
    compute_field_history,
    compute_kind_history,
    load_openapi_spec,
    parse_kind_schema,
    parse_openapi_spec,
    write_diff,
    write_field_history,
    write_kind_history,
)
from .release import (
    ParsedChangelog,
    build_all_releases,
    build_release,
    build_release_index,
    enrich_changes,
    enrich_release_notes,
    load_release,
    parse_changelog,
    save_release,
)
from .kep import (
    Feature,
    enrich_features,
    extract_all_keps,
    extract_features_all_versions,
    extract_features_for_version,
    link_all_versions,
    link_fields_to_keps,
    normalize_labels,
    save_enriched_features,
    write_field_kep_links,
)
from .components import (
    COMPONENTS,
    compare_feature_gates,
    compare_kubectl_versions,
    compare_versions,
    extract_all_components,
    extract_and_save_feature_gates,
    extract_and_save_kubectl,
    save_component_data,
)
from .content import (
    Content,
    ContentLink,
    ContentType,
    add_conference_talk,
    add_content,
    build_taxonomy,
    flatten_content_for_export,
    import_sched_sessions,
    import_youtube_videos,
    load_all_content,
    load_content,
    save_content,
    suggest_labels_embedding,
    suggest_labels_llm,
)
from .providers import (
    PROVIDERS_OUTPUT_DIR,
    fetch_all_providers,
    fetch_provider_versions,
    get_provider_summary,
    load_provider_data,
    save_provider_data,
)

__all__ = [
    # OpenAPI
    "load_openapi_spec",
    "parse_openapi_spec",
    "clear_openapi_cache",
    "compute_diff",
    "compute_field_history",
    "compute_kind_history",
    "write_diff",
    "write_field_history",
    "write_kind_history",
    "parse_kind_schema",
    "VersionDiff",
    # Release
    "build_release",
    "build_all_releases",
    "build_release_index",
    "parse_changelog",
    "enrich_changes",
    "enrich_release_notes",
    "load_release",
    "save_release",
    "ParsedChangelog",
    # KEP
    "extract_features_for_version",
    "extract_features_all_versions",
    "link_fields_to_keps",
    "link_all_versions",
    "write_field_kep_links",
    "enrich_features",
    "save_enriched_features",
    "extract_all_keps",
    "normalize_labels",
    "Feature",
    # Components
    "extract_all_components",
    "save_component_data",
    "extract_and_save_kubectl",
    "extract_and_save_feature_gates",
    "compare_versions",
    "compare_kubectl_versions",
    "compare_feature_gates",
    "COMPONENTS",
    # Content
    "add_content",
    "load_content",
    "load_all_content",
    "save_content",
    "flatten_content_for_export",
    "add_conference_talk",
    "import_sched_sessions",
    "import_youtube_videos",
    "suggest_labels_llm",
    "suggest_labels_embedding",
    "build_taxonomy",
    "Content",
    "ContentLink",
    "ContentType",
    # Providers
    "fetch_all_providers",
    "fetch_provider_versions",
    "get_provider_summary",
    "load_provider_data",
    "save_provider_data",
    "PROVIDERS_OUTPUT_DIR",
]
