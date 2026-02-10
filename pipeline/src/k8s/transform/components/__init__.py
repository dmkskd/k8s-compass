"""Component extraction modules (kube-apiserver, kubelet, kubectl, feature gates).

Public API:
- extract_all_components, save_component_data
- extract_and_save_kubectl, extract_and_save_feature_gates
- compare_versions, compare_kubectl_versions, compare_feature_gates
"""

from .component_extractor import (
    COMPONENTS,
    checkout_website_version,
    compare_versions,
    extract_all_components,
    extract_component_flags,
    extract_feature_gate_from_description,
    find_website_tag_for_version,
    link_flags_to_keps,
    load_keps_with_feature_gates,
    save_component_data,
    update_curated_components,
    update_curated_components_with_keps,
)
from .feature_gate_extractor import (
    build_version_history,
    compare_feature_gates,
    extract_and_save_feature_gates,
    extract_feature_gates_for_version,
    get_status_at_version,
    link_feature_gates_to_keps,
    parse_feature_gate_file,
    save_feature_gates_data,
)
from .feature_gate_extractor import extract_all_versions as extract_all_feature_gate_versions
from .kubectl_extractor import (
    compare_kubectl_versions,
    extract_all_kubectl_commands,
    extract_and_save_kubectl,
    get_command_summary,
    parse_kubectl_command,
    save_kubectl_data,
)
from .kubectl_extractor import extract_all_versions as extract_all_kubectl_versions

# Public API - minimal surface for CLI
__all__ = [
    # Core operations
    "extract_all_components",
    "save_component_data",
    "extract_and_save_kubectl",
    "extract_and_save_feature_gates",
    "compare_versions",
    "compare_kubectl_versions",
    "compare_feature_gates",
    # Constants
    "COMPONENTS",
]
