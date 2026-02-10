"""Extract enum values from Kubernetes Go source code using tree-sitter AST parsing."""

from pathlib import Path

import tree_sitter_go as ts_go
from rich.console import Console
from tree_sitter import Language, Parser

from ...input.repo_manager import get_current_checkout, get_repo_path

console = Console()

# Initialize tree-sitter Go parser
GO_LANGUAGE = Language(ts_go.language())
_parser = Parser(GO_LANGUAGE)

# Cache: version -> {"enums": {TypeName: [values]}, "field_map": {json_field: TypeName}}
_enum_cache: dict[str, dict] = {}


def get_enums_for_version(version: str) -> dict:
    """Get enum data for a version. Assumes repo is already checked out to correct version.

    Returns dict with:
        - enums: {TypeName: [value1, value2, ...]}
        - field_map: {json_field_name: TypeName}
    """
    if version in _enum_cache:
        return _enum_cache[version]

    data = parse_enums_from_go_source(version)
    _enum_cache[version] = data
    return data


def parse_enums_from_go_source(version: str) -> dict:
    """Parse enums and field mappings from Go source using tree-sitter."""
    from ...input.repo_manager import get_current_ref

    repo_path = get_repo_path("kubernetes")
    if not repo_path.exists():
        console.print("  [yellow]K8s repo not found - skipping enum extraction[/yellow]")
        return {"enums": {}, "field_map": {}}

    current = get_current_checkout("kubernetes")
    if current != version:
        console.print(
            f"  [yellow]Warning: kubernetes repo on {current}, expected {version}[/yellow]"
        )

    # Log the current git ref for traceability
    current_ref = get_current_ref("kubernetes")
    console.print(f"  [dim]kubernetes repo at: {current_ref}[/dim]")

    api_dir = repo_path / "staging" / "src" / "k8s.io" / "api"
    if not api_dir.exists():
        return {"enums": {}, "field_map": {}}

    enums = {}  # TypeName -> [values]
    field_map = {}  # json_field_name -> TypeName

    for f in api_dir.rglob("types.go"):
        file_enums, file_fields = _parse_types_file(f)
        enums.update(file_enums)
        field_map.update(file_fields)

    if enums:
        console.print(
            f"  [green]✓ Parsed {len(enums)} enum types, {len(field_map)} field mappings[/green]"
        )

    return {"enums": enums, "field_map": field_map}


def _parse_types_file(file_path: Path) -> tuple[dict, dict]:
    """Parse a types.go file using tree-sitter AST.

    Returns (enums, field_map) where:
        - enums: {TypeName: [value1, value2, ...]}
        - field_map: {json_field_name: TypeName}
    """
    enums = {}
    field_map = {}

    try:
        content = file_path.read_bytes()
    except OSError:
        return enums, field_map

    tree = _parser.parse(content)
    root = tree.root_node

    # First pass: find enum types (type declarations preceded by // +enum comment)
    enum_types = _find_enum_types(root, content)

    if not enum_types:
        return enums, field_map

    # Second pass: find const values for enum types
    enums = _find_enum_values(root, content, enum_types)

    # Third pass: find struct fields that use enum types
    field_map = _find_struct_fields(root, content, enum_types)

    return enums, field_map


def _find_enum_types(root, content: bytes) -> set[str]:
    """Find type declarations marked with // +enum comment."""
    enum_types = set()

    # Track comments and their positions
    comments = {}
    for node in _walk(root):
        if node.type == "comment":
            text = content[node.start_byte : node.end_byte].decode()
            if "+enum" in text:
                # Store the line number of the +enum comment
                comments[node.end_point[0]] = True

    # Find type declarations that follow +enum comments
    for node in _walk(root):
        if node.type == "type_declaration":
            # Check if there's a +enum comment on the line(s) before this declaration
            decl_line = node.start_point[0]
            for comment_line in comments:
                if (
                    comment_line < decl_line <= comment_line + 3
                ):  # Allow up to 2 lines between comment and type
                    # Extract the type name from type_spec
                    for child in node.children:
                        if child.type == "type_spec":
                            for spec_child in child.children:
                                if spec_child.type == "type_identifier":
                                    type_name = content[
                                        spec_child.start_byte : spec_child.end_byte
                                    ].decode()
                                    enum_types.add(type_name)
                                    break
                            break
                    break

    return enum_types


def _find_enum_values(root, content: bytes, enum_types: set[str]) -> dict[str, list[str]]:
    """Find const declarations that define enum values."""
    enums = {t: [] for t in enum_types}

    for node in _walk(root):
        if node.type == "const_spec":
            # const_spec has: identifier, type_identifier (optional), expression_list
            type_name = None
            value = None

            for child in node.children:
                if child.type == "type_identifier":
                    type_name = content[child.start_byte : child.end_byte].decode()
                elif child.type == "expression_list":
                    # Get the string literal value
                    for expr_child in child.children:
                        if expr_child.type == "interpreted_string_literal":
                            # Remove quotes
                            value = content[
                                expr_child.start_byte + 1 : expr_child.end_byte - 1
                            ].decode()
                            break

            if type_name in enum_types and value:
                if value not in enums[type_name]:
                    enums[type_name].append(value)

    # Remove empty enum types
    return {k: v for k, v in enums.items() if v}


def _find_struct_fields(root, content: bytes, enum_types: set[str]) -> dict[str, str]:
    """Find struct fields that use enum types and extract their JSON tag names.

    Returns a field_map with two types of keys:
    - "StructName.fieldName" -> TypeName (specific to struct)
    - "fieldName" -> TypeName (generic fallback, last one wins)
    """
    field_map = {}

    # Find all struct type definitions
    for node in _walk(root):
        if node.type == "type_spec":
            # type_spec has: type_identifier, struct_type
            struct_name = None
            struct_body = None

            for child in node.children:
                if child.type == "type_identifier":
                    struct_name = content[child.start_byte : child.end_byte].decode()
                elif child.type == "struct_type":
                    struct_body = child

            if struct_name and struct_body:
                # Parse fields in this struct
                for field_node in _walk(struct_body):
                    if field_node.type == "field_declaration":
                        field_type = None
                        json_name = None

                        for child in field_node.children:
                            if child.type == "type_identifier":
                                field_type = content[child.start_byte : child.end_byte].decode()
                            elif child.type == "pointer_type":
                                for ptr_child in child.children:
                                    if ptr_child.type == "type_identifier":
                                        field_type = content[
                                            ptr_child.start_byte : ptr_child.end_byte
                                        ].decode()
                                        break
                            elif child.type == "raw_string_literal":
                                tag = content[child.start_byte : child.end_byte].decode()
                                json_name = _extract_json_name(tag)

                        if field_type in enum_types and json_name:
                            # Add both specific and generic mappings
                            field_map[f"{struct_name}.{json_name}"] = field_type
                            field_map[json_name] = field_type

    return field_map


def _extract_json_name(tag: str) -> str | None:
    """Extract the JSON field name from a Go struct tag."""
    # Tag format: `json:"fieldName,omitempty" protobuf:"..."`
    import re

    match = re.search(r'json:"(\w+)', tag)
    if match:
        return match.group(1)
    return None


def _walk(node):
    """Walk all nodes in the AST."""
    yield node
    for child in node.children:
        yield from _walk(child)


def match_enum_to_field(
    field_name: str, enum_data: dict, parent_struct: str | None = None
) -> list[str] | None:
    """Match a JSON field name to its enum values using the parsed field map.

    Args:
        field_name: The JSON field name (e.g., "type")
        enum_data: The result from get_enums_for_version()
        parent_struct: Optional parent struct name for context (e.g., "DeploymentStrategy")

    Returns:
        List of enum values if found, None otherwise
    """
    # Skip standard K8s root-level meta fields - they don't have meaningful enums
    # and the generic lookup would incorrectly match unrelated enum types
    ROOT_META_FIELDS = {"apiVersion", "kind", "metadata", "status"}
    if field_name in ROOT_META_FIELDS and parent_struct is None:
        return None

    enums = enum_data.get("enums", {})
    field_map = enum_data.get("field_map", {})

    # Try struct-specific lookup first
    if parent_struct:
        specific_key = f"{parent_struct}.{field_name}"
        type_name = field_map.get(specific_key)
        if type_name and type_name in enums:
            return enums[type_name]

    # Fall back to generic field name lookup
    type_name = field_map.get(field_name)
    if type_name and type_name in enums:
        return enums[type_name]

    return None


def extract_enum_from_description(description: str) -> list[str] | None:
    """Fallback: extract enum values from OpenAPI description text."""
    if not description:
        return None

    import re

    values = []
    for pattern in [
        r"[Vv]alid values are[:\s]*[-\n]*(.*?)(?:\n\n|\Z)",
        r"[Ii]t can be\s+(.+?)(?:\.|$)",
        r"[Pp]ossible enum values[:\s]*(.*?)(?:\n\n|\Z)",
        r"(?:must be |)one of[:\s]*(.*?)(?:\.|$)",
    ]:
        m = re.search(pattern, description, re.DOTALL | re.IGNORECASE)
        if m and not values:
            values = re.findall(r'["`](\w+)["`]', m.group(1)) or re.findall(r"`(\w+)`", m.group(1))

    return list(dict.fromkeys(values)) if values else None


def extract_default_from_description(description: str) -> str | None:
    """Extract default value from OpenAPI description text.

    Looks for patterns like:
    - "Default is RollingUpdate"
    - "Defaults to Always"
    - "default value is 30"
    - "If not specified, defaults to ClusterFirst"
    - '"Allow" (default)'
    """
    if not description:
        return None

    import re

    patterns = [
        # "Allow" (default) - value in quotes followed by (default)
        r'["`](\w+)["`]\s*\(default\)',
        # "Default is X" or "Default is X."
        r'[Dd]efault(?:s)?\s+(?:is|to)\s+["`]?(\w+)["`]?',
        # "default value is X"
        r'[Dd]efault\s+value\s+(?:is|of)\s+["`]?(\w+)["`]?',
        # "If not specified, defaults to X"
        r'[Ii]f\s+not\s+(?:specified|set)[,\s]+defaults?\s+to\s+["`]?(\w+)["`]?',
        # "The default is X"
        r'[Tt]he\s+default\s+(?:is|value\s+is)\s+["`]?(\w+)["`]?',
    ]

    for pattern in patterns:
        m = re.search(pattern, description)
        if m:
            return m.group(1)

    return None
