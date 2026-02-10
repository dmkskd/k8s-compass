"""Compute diffs between K8s API versions and track field history."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from rich.console import Console

from ...core.config import OUTPUT_DIR

console = Console()


@dataclass
class FieldChange:
    """A change to a single field."""

    path: str
    kind: str
    group: str
    change_type: Literal["added", "removed", "modified", "deprecated"]
    details: dict = field(default_factory=dict)


@dataclass
class KindChange:
    """A change to a Kind (added/removed)."""

    kind: str
    group: str
    change_type: Literal["added", "removed"]


@dataclass
class VersionDiff:
    """Diff between two consecutive versions."""

    from_version: str
    to_version: str
    kinds_added: list[KindChange] = field(default_factory=list)
    kinds_removed: list[KindChange] = field(default_factory=list)
    fields_added: list[FieldChange] = field(default_factory=list)
    fields_removed: list[FieldChange] = field(default_factory=list)
    fields_modified: list[FieldChange] = field(default_factory=list)
    fields_deprecated: list[FieldChange] = field(default_factory=list)


@dataclass
class FieldHistory:
    """Version history for a single field."""

    path: str
    kind: str
    group: str
    introduced_in: str
    deprecated_in: str | None = None
    removed_in: str | None = None


def load_schemas(version: str) -> dict:
    """Load schemas for a version."""
    path = OUTPUT_DIR / "schemas" / f"{version}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return data.get("schemas", {})


def extract_all_fields(schema: dict, prefix: str = "") -> dict[str, dict]:
    """Extract all fields from a schema as a flat dict of path -> field info."""
    fields = {}

    for prop in schema.get("properties", []):
        path = f"{prefix}.{prop['name']}" if prefix else prop["name"]
        fields[path] = {
            "type": prop.get("type"),
            "description": prop.get("description", ""),
            "required": prop.get("required", False),
            "deprecated": prop.get("deprecated", False),
            "enum": prop.get("enum"),
        }

        if prop.get("properties"):
            nested = extract_all_fields({"properties": prop["properties"]}, path)
            fields.update(nested)

        if prop.get("items") and prop["items"].get("properties"):
            nested = extract_all_fields({"properties": prop["items"]["properties"]}, f"{path}[]")
            fields.update(nested)

    return fields


def compute_diff(from_version: str, to_version: str) -> VersionDiff:
    """Compute diff between two versions."""
    from_schemas = load_schemas(from_version)
    to_schemas = load_schemas(to_version)

    diff = VersionDiff(from_version=from_version, to_version=to_version)

    from_kinds = set(from_schemas.keys())
    to_kinds = set(to_schemas.keys())

    for kind_key in to_kinds - from_kinds:
        schema = to_schemas[kind_key]
        diff.kinds_added.append(
            KindChange(kind=schema["kind"], group=schema["group"], change_type="added")
        )

    for kind_key in from_kinds - to_kinds:
        schema = from_schemas[kind_key]
        diff.kinds_removed.append(
            KindChange(kind=schema["kind"], group=schema["group"], change_type="removed")
        )

    for kind_key in from_kinds & to_kinds:
        from_schema = from_schemas[kind_key]
        to_schema = to_schemas[kind_key]

        from_fields = extract_all_fields(from_schema)
        to_fields = extract_all_fields(to_schema)

        from_paths = set(from_fields.keys())
        to_paths = set(to_fields.keys())

        kind = to_schema["kind"]
        group = to_schema["group"]

        for path in to_paths - from_paths:
            diff.fields_added.append(
                FieldChange(
                    path=path,
                    kind=kind,
                    group=group,
                    change_type="added",
                    details={"type": to_fields[path]["type"]},
                )
            )

        for path in from_paths - to_paths:
            diff.fields_removed.append(
                FieldChange(
                    path=path,
                    kind=kind,
                    group=group,
                    change_type="removed",
                    details={"type": from_fields[path]["type"]},
                )
            )

        for path in from_paths & to_paths:
            from_field = from_fields[path]
            to_field = to_fields[path]

            if not from_field.get("deprecated") and to_field.get("deprecated"):
                diff.fields_deprecated.append(
                    FieldChange(path=path, kind=kind, group=group, change_type="deprecated")
                )

            if from_field.get("type") != to_field.get("type"):
                diff.fields_modified.append(
                    FieldChange(
                        path=path,
                        kind=kind,
                        group=group,
                        change_type="modified",
                        details={
                            "change": "type",
                            "from": from_field.get("type"),
                            "to": to_field.get("type"),
                        },
                    )
                )

            from_enum = set(from_field.get("enum") or [])
            to_enum = set(to_field.get("enum") or [])
            if from_enum != to_enum:
                added_values = to_enum - from_enum
                removed_values = from_enum - to_enum
                if added_values or removed_values:
                    diff.fields_modified.append(
                        FieldChange(
                            path=path,
                            kind=kind,
                            group=group,
                            change_type="modified",
                            details={
                                "change": "enum",
                                "added": list(added_values),
                                "removed": list(removed_values),
                            },
                        )
                    )

    return diff


def compute_field_history(versions: list[str]) -> dict[str, FieldHistory]:
    """Compute introducedIn/deprecatedIn/removedIn for all fields across versions."""
    history: dict[str, FieldHistory] = {}
    all_fields_by_version: dict[str, set[str]] = {}
    field_info: dict[str, dict] = {}
    deprecated_fields: dict[str, str] = {}

    for version in versions:
        schemas = load_schemas(version)
        version_fields = set()

        for _kind_key, schema in schemas.items():
            kind = schema["kind"]
            group = schema["group"]
            fields = extract_all_fields(schema)

            for path, info in fields.items():
                field_key = f"{group}/{kind}/{path}"
                version_fields.add(field_key)

                if field_key not in field_info:
                    field_info[field_key] = {"kind": kind, "group": group, "path": path}

                if info.get("deprecated") and field_key not in deprecated_fields:
                    deprecated_fields[field_key] = version

        all_fields_by_version[version] = version_fields

    all_field_keys = set()
    for fields in all_fields_by_version.values():
        all_field_keys.update(fields)

    first_version = versions[0] if versions else None

    for field_key in all_field_keys:
        info = field_info[field_key]

        introduced_in = None
        for version in versions:
            if field_key in all_fields_by_version[version]:
                introduced_in = version
                break

        if introduced_in == first_version:
            introduced_in = None

        removed_in = None
        found = False
        for version in versions:
            if field_key in all_fields_by_version[version]:
                found = True
            elif found:
                removed_in = version
                break

        deprecated_in = deprecated_fields.get(field_key)
        if introduced_in or deprecated_in or removed_in:
            history[field_key] = FieldHistory(
                path=info["path"],
                kind=info["kind"],
                group=info["group"],
                introduced_in=introduced_in or "",
                deprecated_in=deprecated_in,
                removed_in=removed_in,
            )

    return history


def compute_kind_history(versions: list[str]) -> dict[str, dict]:
    """Compute introducedIn/removedIn for all Kinds across versions."""
    history: dict[str, dict] = {}
    kinds_by_version: dict[str, set[str]] = {}

    for version in versions:
        schemas = load_schemas(version)
        kinds_by_version[version] = set(schemas.keys())

    all_kind_keys = set()
    for kinds in kinds_by_version.values():
        all_kind_keys.update(kinds)

    first_version = versions[0] if versions else None

    for kind_key in all_kind_keys:
        introduced_in = None
        for version in versions:
            if kind_key in kinds_by_version[version]:
                introduced_in = version
                break

        if introduced_in == first_version:
            introduced_in = None

        removed_in = None
        found = False
        for version in versions:
            if kind_key in kinds_by_version[version]:
                found = True
            elif found:
                removed_in = version
                break

        if introduced_in or removed_in:
            history[kind_key] = {}
            if introduced_in:
                history[kind_key]["introducedIn"] = introduced_in
            if removed_in:
                history[kind_key]["removedIn"] = removed_in

    return history


def write_diff(diff: VersionDiff) -> Path:
    """Write a version diff to JSON."""
    output_dir = OUTPUT_DIR / "diffs"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / f"{diff.from_version}-{diff.to_version}.json"

    data = {
        "fromVersion": diff.from_version,
        "toVersion": diff.to_version,
        "summary": {
            "kindsAdded": len(diff.kinds_added),
            "kindsRemoved": len(diff.kinds_removed),
            "fieldsAdded": len(diff.fields_added),
            "fieldsRemoved": len(diff.fields_removed),
            "fieldsModified": len(diff.fields_modified),
            "fieldsDeprecated": len(diff.fields_deprecated),
        },
        "kindsAdded": [{"kind": k.kind, "group": k.group} for k in diff.kinds_added],
        "kindsRemoved": [{"kind": k.kind, "group": k.group} for k in diff.kinds_removed],
        "fieldsAdded": [
            {"path": f.path, "kind": f.kind, "group": f.group, **f.details}
            for f in diff.fields_added
        ],
        "fieldsRemoved": [
            {"path": f.path, "kind": f.kind, "group": f.group, **f.details}
            for f in diff.fields_removed
        ],
        "fieldsModified": [
            {"path": f.path, "kind": f.kind, "group": f.group, **f.details}
            for f in diff.fields_modified
        ],
        "fieldsDeprecated": [
            {"path": f.path, "kind": f.kind, "group": f.group} for f in diff.fields_deprecated
        ],
    }

    output_path.write_text(json.dumps(data, indent=2))
    return output_path


def write_field_history(history: dict[str, FieldHistory]) -> Path:
    """Write field history to JSON."""
    output_path = OUTPUT_DIR / "field-history.json"

    by_kind: dict[str, list[dict]] = {}

    for _field_key, fh in history.items():
        kind_key = f"{fh.group}/{fh.kind}"
        if kind_key not in by_kind:
            by_kind[kind_key] = []

        entry = {"path": fh.path, "introducedIn": fh.introduced_in}
        if fh.deprecated_in:
            entry["deprecatedIn"] = fh.deprecated_in
        if fh.removed_in:
            entry["removedIn"] = fh.removed_in

        by_kind[kind_key].append(entry)

    output_path.write_text(json.dumps(by_kind, indent=2))
    return output_path


def write_kind_history(history: dict[str, dict]) -> Path:
    """Write kind history to JSON."""
    output_path = OUTPUT_DIR / "kind-history.json"
    output_path.write_text(json.dumps(history, indent=2))
    return output_path
