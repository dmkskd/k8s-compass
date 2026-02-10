"""Generate TypeScript types from PyArrow schemas.

This module generates TypeScript interfaces from the PyArrow schema definitions,
ensuring the frontend types stay in sync with the database schema.

Usage:
    uv run k8s-pipeline export types
    uv run k8s-pipeline export types -o packages/web/src/shared/types/db-types.ts
"""

from pathlib import Path
from datetime import datetime

import pyarrow as pa

from .parquet.schemas import SCHEMAS


def pyarrow_to_typescript(pa_type: pa.DataType) -> str:
    """Convert a PyArrow type to TypeScript type."""
    if pa.types.is_string(pa_type) or pa.types.is_large_string(pa_type):
        return "string"
    elif pa.types.is_int64(pa_type) or pa.types.is_int32(pa_type):
        return "number"
    elif pa.types.is_float64(pa_type) or pa.types.is_float32(pa_type):
        return "number"
    elif pa.types.is_boolean(pa_type):
        return "boolean"
    elif pa.types.is_list(pa_type):
        inner_type = pyarrow_to_typescript(pa_type.value_type)
        return f"{inner_type}[]"
    elif pa.types.is_struct(pa_type):
        return "Record<string, unknown>"
    elif pa.types.is_map(pa_type):
        key_type = pyarrow_to_typescript(pa_type.key_type)
        value_type = pyarrow_to_typescript(pa_type.item_type)
        return f"Record<{key_type}, {value_type}>"
    else:
        return "unknown"


def snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    components = name.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


def snake_to_pascal(name: str) -> str:
    """Convert snake_case to PascalCase."""
    return "".join(x.title() for x in name.split("_"))


def generate_interface(table_name: str, schema: pa.Schema) -> str:
    """Generate a TypeScript interface from a PyArrow schema.
    
    Field names use snake_case to match DuckDB column names exactly.
    This allows direct use with query results without transformation.
    """
    interface_name = snake_to_pascal(table_name) + "Row"
    
    # Get table description from metadata
    table_desc = ""
    if schema.metadata:
        desc_bytes = schema.metadata.get(b"description")
        if desc_bytes:
            table_desc = desc_bytes.decode("utf-8")
    
    lines = []
    
    # Add JSDoc comment
    if table_desc:
        lines.append(f"/**")
        lines.append(f" * {table_desc}")
        lines.append(f" * @table {table_name}")
        lines.append(f" */")
    
    lines.append(f"export interface {interface_name} {{")
    
    for field in schema:
        ts_type = pyarrow_to_typescript(field.type)
        # Use snake_case to match DuckDB column names exactly
        field_name = field.name
        
        # Get field description from metadata
        field_desc = ""
        if field.metadata:
            desc_bytes = field.metadata.get(b"description")
            if desc_bytes:
                field_desc = desc_bytes.decode("utf-8")
        
        # Add field comment if there's a description
        if field_desc:
            lines.append(f"  /** {field_desc} */")
        
        # All fields are optional since DuckDB can return null
        lines.append(f"  {field_name}?: {ts_type};")
    
    lines.append("}")
    
    return "\n".join(lines)


def generate_table_names_type() -> str:
    """Generate a union type of all table names."""
    table_names = sorted(SCHEMAS.keys())
    union = " | ".join(f'"{name}"' for name in table_names)
    return f"export type TableName = {union};"


def generate_table_map_type() -> str:
    """Generate a type that maps table names to their row types."""
    lines = ["export interface TableRowMap {"]
    for table_name in sorted(SCHEMAS.keys()):
        interface_name = snake_to_pascal(table_name) + "Row"
        lines.append(f'  "{table_name}": {interface_name};')
    lines.append("}")
    return "\n".join(lines)


def generate_all_types() -> str:
    """Generate all TypeScript types from PyArrow schemas."""
    sections = []
    
    # Header
    sections.append(f"""/**
 * Auto-generated TypeScript types from PyArrow schemas.
 * 
 * DO NOT EDIT MANUALLY - regenerate with:
 *   uv run k8s-pipeline export types
 * 
 * Generated: {datetime.now().isoformat()}
 * Source: pipeline/src/k8s/output/parquet/schemas.py
 */

// =============================================================================
// Row Types (one interface per DuckDB table)
// =============================================================================
""")
    
    # Generate interfaces for each table
    for table_name in sorted(SCHEMAS.keys()):
        schema = SCHEMAS[table_name]
        sections.append(generate_interface(table_name, schema))
        sections.append("")  # Blank line between interfaces
    
    # Table name union type
    sections.append("""
// =============================================================================
// Utility Types
// =============================================================================
""")
    sections.append(generate_table_names_type())
    sections.append("")
    sections.append(generate_table_map_type())
    
    return "\n".join(sections)


def write_types(output_path: Path | None = None) -> Path:
    """Generate and write TypeScript types to a file.
    
    Args:
        output_path: Path to write the types file. Defaults to 
                     packages/web/src/shared/types/db-types.ts
    
    Returns:
        Path to the written file
    """
    if output_path is None:
        # Default to the web package types directory
        # Find the repo root by looking for packages/web from this file's location
        this_file = Path(__file__).resolve()
        # Go up from pipeline/src/k8s/output/typescript_types.py to repo root
        repo_root = this_file.parent.parent.parent.parent.parent
        output_path = repo_root / "packages/web/src/shared/types/db-types.ts"
    
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    content = generate_all_types()
    output_path.write_text(content)
    
    return output_path
