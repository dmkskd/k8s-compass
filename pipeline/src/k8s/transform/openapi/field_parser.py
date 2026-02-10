"""Parse full schemas from Kubernetes OpenAPI specs."""

from ...core.models import KindSchema, SchemaProperty
from .go_enum_extractor import (
    extract_default_from_description,
    extract_enum_from_description,
    get_enums_for_version,
    match_enum_to_field,
)


def parse_kind_schema(
    def_name: str,
    definition: dict,
    group: str,
    api_version: str,
    kind_name: str,
    all_definitions: dict,
    version: str | None = None,
) -> KindSchema:
    """Parse the full schema for a Kind from its OpenAPI definition."""

    # Load Go enum data for this version if available
    enum_data = get_enums_for_version(version) if version else {"enums": {}, "field_map": {}}

    description = definition.get("description", "")
    properties = parse_properties(
        definition,
        all_definitions,
        path_prefix="",
        required_fields=definition.get("required", []),
        enum_data=enum_data,
    )

    return KindSchema(
        group=group,
        version=api_version,
        kind=kind_name,
        description=description,
        properties=properties,
    )


def parse_properties(
    definition: dict,
    all_definitions: dict,
    path_prefix: str,
    required_fields: list[str],
    depth: int = 0,
    seen_refs: set | None = None,
    enum_data: dict | None = None,
    parent_struct: str | None = None,
) -> list[SchemaProperty]:
    """Parse properties from a definition recursively."""

    if depth > 10:
        return []

    if seen_refs is None:
        seen_refs = set()

    if enum_data is None:
        enum_data = {"enums": {}, "field_map": {}}

    properties = []
    props_dict = definition.get("properties", {})

    for prop_name, prop_def in props_dict.items():
        path = f"{path_prefix}.{prop_name}" if path_prefix else prop_name

        prop = parse_single_property(
            prop_name,
            prop_def,
            path,
            prop_name in required_fields,
            all_definitions,
            depth,
            seen_refs.copy(),
            enum_data,
            parent_struct,
        )
        if prop:
            properties.append(prop)

    return properties


def extract_ref_kind(ref: str) -> str | None:
    """Extract the kind name from a $ref string."""
    if not ref or not ref.startswith("#/definitions/"):
        return None
    def_name = ref[14:]
    parts = def_name.split(".")
    if parts:
        return parts[-1]
    return None


def parse_single_property(
    name: str,
    prop_def: dict,
    path: str,
    required: bool,
    all_definitions: dict,
    depth: int,
    seen_refs: set,
    enum_data: dict | None = None,
    parent_struct: str | None = None,
) -> SchemaProperty | None:
    """Parse a single property definition."""

    if enum_data is None:
        enum_data = {"enums": {}, "field_map": {}}

    ref = prop_def.get("$ref")
    ref_kind = None
    if ref:
        ref_kind = extract_ref_kind(ref)
        if ref in seen_refs:
            return SchemaProperty(
                name=name,
                path=path,
                type="object",
                description=prop_def.get("description", "(circular reference)"),
                required=required,
                ref_kind=ref_kind,
            )
        seen_refs.add(ref)
        resolved = resolve_ref(ref, all_definitions)
        if resolved:
            prop_def = {**resolved, **{k: v for k, v in prop_def.items() if k != "$ref"}}

    prop_type = determine_type(prop_def)
    description = prop_def.get("description", "")

    nested_props = None
    if prop_type == "object" and "properties" in prop_def:
        nested_props = parse_properties(
            prop_def,
            all_definitions,
            path,
            prop_def.get("required", []),
            depth + 1,
            seen_refs,
            enum_data,
            parent_struct=ref_kind,  # Pass the resolved type as parent context
        )

    items = None
    if prop_type == "array" and "items" in prop_def:
        items_def = prop_def["items"]
        items = parse_single_property(
            "items",
            items_def,
            f"{path}[]",
            False,
            all_definitions,
            depth + 1,
            seen_refs,
            enum_data,
        )

    # Get enum values - try multiple sources
    enum_values = prop_def.get("enum")

    if not enum_values and prop_type == "string":
        # Try to match from Go enums using auto-discovered field mapping
        # Use parent_struct for context (e.g., "DeploymentStrategy" when parsing its "type" field)
        enum_values = match_enum_to_field(name, enum_data, parent_struct=parent_struct)

        # Fall back to description parsing
        if not enum_values:
            enum_values = extract_enum_from_description(description)

    # Get default value - from OpenAPI spec or description
    default_value = prop_def.get("default")
    if default_value is None and description:
        default_value = extract_default_from_description(description)

    return SchemaProperty(
        name=name,
        path=path,
        type=prop_type,
        description=description if description else "",
        required=required,
        default=default_value,
        enum=enum_values,
        minimum=prop_def.get("minimum"),
        maximum=prop_def.get("maximum"),
        pattern=prop_def.get("pattern"),
        properties=nested_props if nested_props else None,
        items=items,
        ref_kind=ref_kind,
    )


def determine_type(prop_def: dict) -> str:
    """Determine the schema type from a property definition."""
    if prop_def.get("x-kubernetes-int-or-string"):
        return "intOrString"
    if "additionalProperties" in prop_def and prop_def.get("type") == "object":
        return "map"
    type_val = prop_def.get("type", "object")
    type_mapping = {
        "string": "string",
        "integer": "integer",
        "number": "number",
        "boolean": "boolean",
        "object": "object",
        "array": "array",
    }
    return type_mapping.get(type_val, "object")


def resolve_ref(ref: str, all_definitions: dict) -> dict | None:
    """Resolve a $ref to its definition."""
    if not ref.startswith("#/definitions/"):
        return None
    def_name = ref[14:]
    return all_definitions.get(def_name)
