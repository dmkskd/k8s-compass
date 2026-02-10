"""KEP (Kubernetes Enhancement Proposal) processing.

Public API:
- extract_features_for_version, extract_features_all_versions
- link_fields_to_keps, link_all_versions, write_field_kep_links
- enrich_features, save_enriched_features
- extract_all_keps, normalize_labels
"""

from .enricher import enrich_features, save_enriched_features
from .field_linker import (
    FieldKepLink,
    LinkingResult,
    link_all_versions,
    link_fields_to_keps,
    write_field_kep_links,
)
from .label_normalizer import (
    apply_normalization,
    build_normalization_map,
    normalize_labels,
    show_label_stats,
)
from .metadata_extractor import (
    OUTPUT_PATH as KEP_METADATA_OUTPUT_PATH,
    extract_all_keps,
)
from .parser import (
    Feature,
    KepMetadata,
    build_features_summary,
    extract_features_all_versions,
    extract_features_for_version,
    features_to_dict,
    scan_all_keps,
)

# Public API - minimal surface for CLI
__all__ = [
    # Core operations
    "extract_features_for_version",
    "extract_features_all_versions",
    "link_fields_to_keps",
    "link_all_versions",
    "write_field_kep_links",
    "enrich_features",
    "save_enriched_features",
    "extract_all_keps",
    "normalize_labels",
    # Types
    "Feature",
]
