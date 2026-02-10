"""Write parsed data to JSON files."""

import json
from pathlib import Path

from rich.console import Console

from ..core.config import OUTPUT_DIR
from ..core.models import APITree, KindSchema, SchemaProperty

console = Console()


def write_api_tree(tree: APITree) -> Path:
    """Write an API tree to the output directory."""
    output_dir = OUTPUT_DIR / "api-trees"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / f"{tree.version}.json"
    data = tree_to_frontend_format(tree)
    output_path.write_text(json.dumps(data, indent=2))
    console.print(f"  [green]✓ Wrote {output_path}[/green]")

    return output_path


def write_versions_file(trees: list[APITree]) -> Path:
    """Write the versions.json file."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "versions.json"

    versions = []
    for i, tree in enumerate(sorted(trees, key=lambda t: t.version, reverse=True)):
        versions.append(
            {
                "version": tree.version,
                "releaseDate": tree.release_date,
                "isLatest": i == 0,
            }
        )

    output_path.write_text(json.dumps(versions, indent=2))
    console.print(f"  [green]✓ Wrote {output_path}[/green]")

    return output_path


def write_schemas_file(version: str, schemas: dict[str, KindSchema]) -> Path:
    """Write all schemas for a version to a single file."""
    output_dir = OUTPUT_DIR / "schemas"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / f"{version}.json"

    data = {
        "version": version,
        "schemas": {key: schema_to_frontend_format(schema) for key, schema in schemas.items()},
    }

    output_path.write_text(json.dumps(data))
    console.print(f"  [green]✓ Wrote {output_path} ({len(schemas)} schemas)[/green]")

    return output_path


def schema_to_frontend_format(schema: KindSchema) -> dict:
    """Convert a KindSchema to frontend JSON format."""
    return {
        "group": schema.group,
        "version": schema.version,
        "kind": schema.kind,
        "description": schema.description,
        "properties": [prop_to_frontend_format(p) for p in schema.properties],
    }


def prop_to_frontend_format(prop: SchemaProperty) -> dict:
    """Convert a SchemaProperty to frontend JSON format."""
    result = {
        "name": prop.name,
        "path": prop.path,
        "type": prop.type,
        "description": prop.description,
        "required": prop.required,
    }

    if prop.default is not None:
        result["default"] = prop.default
    if prop.enum:
        result["enum"] = prop.enum
    if prop.minimum is not None:
        result["minimum"] = prop.minimum
    if prop.maximum is not None:
        result["maximum"] = prop.maximum
    if prop.pattern:
        result["pattern"] = prop.pattern
    if prop.properties:
        result["properties"] = [prop_to_frontend_format(p) for p in prop.properties]
    if prop.items:
        result["items"] = prop_to_frontend_format(prop.items)
    if prop.ref_kind:
        result["refKind"] = prop.ref_kind

    return result


def tree_to_frontend_format(tree: APITree) -> dict:
    """Convert an APITree to the frontend JSON format (camelCase)."""
    return {
        "version": tree.version,
        "releaseDate": tree.release_date,
        "groups": [
            {
                "name": group.name,
                "displayName": group.display_name,
                "description": group.description,
                "color": group.color,
                "versions": [
                    {
                        "name": ver.name,
                        "isPreferred": ver.is_preferred,
                        "kinds": [
                            {
                                "name": kind.name,
                                "singularName": kind.singular_name,
                                "pluralName": kind.plural_name,
                                "scope": kind.scope,
                                "shortNames": kind.short_names,
                                "categories": kind.categories,
                                "schemaRef": kind.schema_ref,
                                "fieldCount": kind.field_count,
                                "description": kind.description,
                                "docsUrl": kind.docs_url,
                                "relationships": [
                                    {
                                        "type": rel.type,
                                        "targetKind": rel.target_kind,
                                        "targetGroup": rel.target_group,
                                        "description": rel.description,
                                        "fieldPath": rel.field_path,
                                    }
                                    for rel in kind.relationships
                                ],
                            }
                            for kind in ver.kinds
                        ],
                    }
                    for ver in group.versions
                ],
            }
            for group in tree.groups
        ],
    }
