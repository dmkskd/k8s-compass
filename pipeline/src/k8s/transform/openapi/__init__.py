"""OpenAPI schema parsing and diffing.

Public API:
- load_openapi_spec, parse_openapi_spec, clear_openapi_cache
- compute_diff, write_diff
- compute_field_history, compute_kind_history
- parse_kind_schema
"""

from .field_parser import parse_kind_schema, parse_properties
from .go_enum_extractor import (
    extract_default_from_description,
    extract_enum_from_description,
    get_enums_for_version,
    match_enum_to_field,
)
from .schema_differ import (
    FieldChange,
    FieldHistory,
    KindChange,
    VersionDiff,
    compute_diff,
    compute_field_history,
    compute_kind_history,
    write_diff,
    write_field_history,
    write_kind_history,
)
from .tree_parser import (
    clear_openapi_cache,
    infer_relationships,
    load_openapi_spec,
    parse_kind,
    parse_openapi_spec,
)

# Public API - minimal surface for CLI
__all__ = [
    # Core operations
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
    # Types
    "VersionDiff",
]
