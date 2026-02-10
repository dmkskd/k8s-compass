"""Generate schema documentation from PyArrow schema definitions.

This module generates markdown documentation from the schema definitions
in schemas.py, ensuring documentation always matches the actual schema.

Usage:
    uv run k8s-pipeline schema-docs
    uv run k8s-pipeline schema-docs --output docs/data-model.md
"""

from pathlib import Path

import pyarrow as pa
from rich.console import Console

from ..core.config import PIPELINE_ROOT
from .parquet.schemas import SCHEMAS

console = Console()


def pyarrow_type_to_string(pa_type: pa.DataType) -> str:
    """Convert PyArrow type to a readable string."""
    type_str = str(pa_type)

    if isinstance(pa_type, pa.ListType):
        value_type = pa_type.value_type
        if pa.types.is_string(value_type):
            return "VARCHAR[]"
        return f"{pyarrow_type_to_string(value_type)}[]"
    elif pa.types.is_string(pa_type) or pa.types.is_large_string(pa_type):
        return "VARCHAR"
    elif pa.types.is_int64(pa_type) or pa.types.is_int32(pa_type):
        return "INTEGER"
    elif pa.types.is_float64(pa_type):
        return "DOUBLE"
    elif pa.types.is_float32(pa_type):
        return "FLOAT"
    elif pa.types.is_boolean(pa_type):
        return "BOOLEAN"
    else:
        return type_str.upper()


def generate_table_markdown(table_name: str, schema: pa.Schema) -> str:
    """Generate markdown table for a single schema."""
    lines = []

    # Table header with description
    description = ""
    if schema.metadata:
        description = schema.metadata.get(b"description", b"").decode("utf-8")

    lines.append(f"### {table_name}")
    if description:
        lines.append(description)
    lines.append("")

    # Column table header
    lines.append("| Column | Type | Description |")
    lines.append("|--------|------|-------------|")

    for field in schema:
        col_name = field.name
        col_type = pyarrow_type_to_string(field.type)

        # Get description from field metadata
        desc = ""
        if field.metadata:
            desc = field.metadata.get(b"description", b"").decode("utf-8")
            # Add FK/PK indicators
            if field.metadata.get(b"pk") == b"true":
                desc = f"**PK** {desc}"
            fk = field.metadata.get(b"fk")
            if fk:
                desc = f"{desc} (FK → {fk.decode()})"

        lines.append(f"| {col_name} | {col_type} | {desc} |")

    lines.append("")
    return "\n".join(lines)


def generate_er_diagram() -> str:
    """Generate ASCII ER diagram showing table relationships."""
    return '''## ER Diagram

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

'''


def generate_key_relationships() -> str:
    """Generate the key relationships table from schema FK metadata."""
    lines = []
    lines.append("## Key Relationships")
    lines.append("")
    lines.append("| From Table | To Table | Join Condition | Description |")
    lines.append("|------------|----------|----------------|-------------|")

    # Extract FK relationships from schemas
    relationships = []
    for table_name, schema in SCHEMAS.items():
        for field in schema:
            if field.metadata and field.metadata.get(b"fk"):
                fk = field.metadata[b"fk"].decode()
                target_table, _target_col = fk.split(".")
                relationships.append({
                    "from": table_name,
                    "to": target_table,
                    "join": f"{table_name}.{field.name} = {fk}",
                    "desc": f"{field.name} references {target_table}",
                })

    for rel in relationships:
        lines.append(f"| {rel['from']} | {rel['to']} | {rel['join']} | {rel['desc']} |")

    lines.append("")
    return "\n".join(lines)


def generate_schema_docs() -> str:
    """Generate complete schema documentation from schema definitions."""
    lines = []
    lines.append("# Data Model")
    lines.append("")
    lines.append("Parquet tables for DuckDB WASM. All tables use snake_case column names.")
    lines.append("")
    lines.append("**IMPORTANT**: DuckDB/Parquet is the single source of truth for all application data. The UI queries DuckDB directly - JSON files are intermediate build artifacts only.")
    lines.append("")
    lines.append("**Auto-generated**: This documentation is generated from PyArrow schema definitions using `uv run k8s-pipeline schema-docs`.")
    lines.append("")

    # Add ER diagram
    lines.append(generate_er_diagram())

    # Add key relationships
    lines.append(generate_key_relationships())

    lines.append("## Tables")
    lines.append("")

    # Group tables by category
    api_tables = ["api_groups", "kinds", "kinds_relationships", "api_diffs"]
    release_tables = ["releases", "keps", "features", "deprecations", "release_changes",
                      "action_required", "security_cves", "patch_releases",
                      "patch_release_changes", "patch_security_fixes"]
    linking_tables = ["field_kep_links", "content_links"]
    provider_tables = ["providers", "provider_versions"]

    lines.append("### API Schema Tables")
    lines.append("")
    for table_name in api_tables:
        if table_name in SCHEMAS:
            lines.append(generate_table_markdown(table_name, SCHEMAS[table_name]))

    lines.append("### Release Tables")
    lines.append("")
    for table_name in release_tables:
        if table_name in SCHEMAS:
            lines.append(generate_table_markdown(table_name, SCHEMAS[table_name]))

    lines.append("### Linking Tables")
    lines.append("")
    for table_name in linking_tables:
        if table_name in SCHEMAS:
            lines.append(generate_table_markdown(table_name, SCHEMAS[table_name]))

    lines.append("### Provider Support Tables")
    lines.append("")
    for table_name in provider_tables:
        if table_name in SCHEMAS:
            lines.append(generate_table_markdown(table_name, SCHEMAS[table_name]))

    lines.append("## Notes")
    lines.append("")
    lines.append("- Parquet doesn't enforce FKs - relationships are logical")
    lines.append("- Arrays stored as VARCHAR[] (list type in Parquet)")
    lines.append("- JSON stored as string (parsed by DuckDB WASM)")
    lines.append("- PK/FK annotations are for documentation only")
    lines.append("")

    return "\n".join(lines)


def write_schema_docs(output_path: Path | None = None) -> Path:
    """Generate and write schema documentation."""
    docs = generate_schema_docs()

    if output_path is None:
        # Default to workspace root docs/data-model.md
        output_path = PIPELINE_ROOT.parent / "docs" / "data-model.md"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(docs)

    return output_path
