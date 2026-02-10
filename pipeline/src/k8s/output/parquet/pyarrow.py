"""Export JSON data to Parquet files using PyArrow."""

import json
import shutil
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from rich.console import Console

from ...core.config import OUTPUT_DIR, PARQUET_DIR, PIPELINE_DATA_DIR, WEB_PARQUET_DIR
from .schemas import SCHEMAS

console = Console()


def _export_schema_metadata(parquet_dir: Path) -> int:
    """Export schema metadata as JSON for the frontend Analytics view.

    This allows the UI to display field descriptions, PK/FK relationships,
    and table descriptions without needing to read Parquet file metadata.
    """
    schema_info = {
        "tables": {},
        "relationships": [],
    }

    for table_name, schema in SCHEMAS.items():
        # Get table description
        table_desc = ""
        if schema.metadata:
            table_desc = schema.metadata.get(b"description", b"").decode("utf-8")

        columns = []
        for field in schema:
            col_info = {
                "name": field.name,
                "type": str(field.type),
            }

            if field.metadata:
                desc = field.metadata.get(b"description", b"").decode("utf-8")
                if desc:
                    col_info["description"] = desc

                if field.metadata.get(b"pk") == b"true":
                    col_info["pk"] = True

                fk = field.metadata.get(b"fk", b"").decode("utf-8")
                if fk:
                    col_info["fk"] = fk
                    # Add to relationships list
                    target_table, target_col = fk.split(".")
                    schema_info["relationships"].append({
                        "from": table_name,
                        "fromColumn": field.name,
                        "to": target_table,
                        "toColumn": target_col,
                    })

            columns.append(col_info)

        schema_info["tables"][table_name] = {
            "description": table_desc,
            "columns": columns,
        }

    # Write to JSON file
    schema_file = parquet_dir / "schema_metadata.json"
    with open(schema_file, "w") as f:
        json.dump(schema_info, f, indent=2)

    size = schema_file.stat().st_size
    console.print(f"  [green]✓[/green] schema_metadata.json: {size / 1024:.1f} KB")
    return size

# Path to pre-computed KEP metadata
KEP_METADATA_PATH = PIPELINE_DATA_DIR / "curated" / "kep_metadata.json"


def export_to_parquet(output_dir: Path | None = None) -> None:
    """Export all JSON data to Parquet files using PyArrow.

    Writes to pipeline/data/output/parquet/ and copies to packages/web/public/data/parquet/
    for the dev server.
    """
    parquet_dir = output_dir or PARQUET_DIR
    parquet_dir.mkdir(parents=True, exist_ok=True)

    k8s_dir = OUTPUT_DIR
    releases_dir = OUTPUT_DIR / "releases"

    console.print(f"\n[bold]Exporting to Parquet (PyArrow): {parquet_dir}[/bold]\n")

    total_size = 0
    total_size += _export_schema_metadata(parquet_dir)  # Export schema metadata first
    total_size += _export_api_trees(k8s_dir, parquet_dir)
    total_size += _export_diffs(k8s_dir, parquet_dir)
    total_size += _export_releases(releases_dir, parquet_dir)
    total_size += _export_field_kep_links(k8s_dir, parquet_dir)
    total_size += _export_blog_posts(parquet_dir)
    total_size += _export_providers(parquet_dir)
    total_size += _export_components(parquet_dir)
    total_size += _export_kubectl(parquet_dir)
    total_size += _export_feature_gates(parquet_dir)

    console.print(
        f"\n[bold green]✓ Total Parquet size: {total_size / 1024 / 1024:.2f} MB[/bold green]"
    )

    # Copy to web app public folder for dev server
    if output_dir is None:  # Only copy if using default output
        _copy_to_web(parquet_dir)


def _copy_to_web(parquet_dir: Path) -> None:
    """Copy parquet files and schema metadata to web app public folder for dev server."""
    WEB_PARQUET_DIR.mkdir(parents=True, exist_ok=True)

    console.print(f"\n[bold]Copying to web app: {WEB_PARQUET_DIR}[/bold]")

    # Copy parquet files
    for parquet_file in parquet_dir.glob("*.parquet"):
        dest = WEB_PARQUET_DIR / parquet_file.name
        shutil.copy2(parquet_file, dest)

    # Copy schema metadata JSON
    schema_file = parquet_dir / "schema_metadata.json"
    if schema_file.exists():
        shutil.copy2(schema_file, WEB_PARQUET_DIR / "schema_metadata.json")

    file_count = len(list(parquet_dir.glob("*.parquet")))
    console.print(f"  [green]✓[/green] Copied {file_count} parquet files + schema_metadata.json")


def _write_parquet(path: Path, table: pa.Table, name: str, schema: pa.Schema | None = None) -> int:
    """Write a PyArrow table to parquet and return file size.

    If schema is provided, the table will be cast to match the schema types.
    """
    if schema is not None:
        # Cast table to match schema (handles type coercion)
        table = table.cast(schema)

    pq.write_table(table, path, compression="zstd", compression_level=19)
    size = path.stat().st_size
    console.print(f"  [green]✓[/green] {name}: {size / 1024:.1f} KB")
    return size



def _load_schemas(k8s_dir: Path) -> dict[str, dict[str, str]]:
    """Load all schemas indexed by version and group/kind key."""
    schemas_dir = k8s_dir / "schemas"
    if not schemas_dir.exists():
        return {}

    schemas: dict[str, dict[str, str]] = {}

    for schema_file in schemas_dir.glob("*.json"):
        with open(schema_file) as f:
            file_data = json.load(f)

        version = file_data["version"]
        schemas[version] = {}

        for key, schema in file_data.get("schemas", {}).items():
            schemas[version][key] = json.dumps(schema)

    return schemas


def _export_api_trees(k8s_dir: Path, parquet_dir: Path) -> int:
    """Export API trees to api_groups, kinds (with schemas), relationships tables."""
    api_trees_dir = k8s_dir / "api-trees"
    if not api_trees_dir.exists():
        return 0

    schemas = _load_schemas(k8s_dir)

    groups_data = {"version": [], "name": [], "display_name": [], "description": [], "color": []}
    kinds_data = {
        "version": [],
        "group_name": [],
        "api_version": [],
        "name": [],
        "singular_name": [],
        "plural_name": [],
        "scope": [],
        "short_names": [],
        "categories": [],
        "schema_ref": [],
        "field_count": [],
        "description": [],
        "docs_url": [],
        "schema_json": [],
    }
    rels_data = {
        "version": [],
        "source_kind": [],
        "source_group": [],
        "type": [],
        "target_kind": [],
        "target_group": [],
        "description": [],
        "field_path": [],
    }

    for tree_file in api_trees_dir.glob("*.json"):
        with open(tree_file) as f:
            tree = json.load(f)

        version = tree["version"]
        version_schemas = schemas.get(version, {})

        for group in tree["groups"]:
            groups_data["version"].append(version)
            groups_data["name"].append(group["name"])
            groups_data["display_name"].append(group["displayName"])
            groups_data["description"].append(group["description"])
            groups_data["color"].append(group["color"])

            for api_ver in group["versions"]:
                for kind in api_ver["kinds"]:
                    kinds_data["version"].append(version)
                    kinds_data["group_name"].append(group["name"])
                    kinds_data["api_version"].append(api_ver["name"])
                    kinds_data["name"].append(kind["name"])
                    kinds_data["singular_name"].append(kind["singularName"])
                    kinds_data["plural_name"].append(kind["pluralName"])
                    kinds_data["scope"].append(kind["scope"])
                    kinds_data["short_names"].append(kind.get("shortNames", []))
                    kinds_data["categories"].append(kind.get("categories", []))
                    kinds_data["schema_ref"].append(kind["schemaRef"])
                    kinds_data["field_count"].append(kind["fieldCount"])
                    kinds_data["description"].append(kind.get("description", ""))
                    kinds_data["docs_url"].append(kind.get("docsUrl"))

                    schema_key = f"{group['name']}/{kind['name']}"
                    kinds_data["schema_json"].append(version_schemas.get(schema_key))

                    for rel in kind.get("relationships", []):
                        rels_data["version"].append(version)
                        rels_data["source_kind"].append(kind["name"])
                        rels_data["source_group"].append(group["name"])
                        rels_data["type"].append(rel["type"])
                        rels_data["target_kind"].append(rel["targetKind"])
                        rels_data["target_group"].append(rel["targetGroup"])
                        rels_data["description"].append(rel["description"])
                        rels_data["field_path"].append(rel.get("fieldPath"))

    total = 0
    total += _write_parquet(
        parquet_dir / "api_groups.parquet",
        pa.Table.from_pydict(groups_data),
        "api_groups.parquet",
        SCHEMAS["api_groups"],
    )
    total += _write_parquet(
        parquet_dir / "kinds.parquet",
        pa.Table.from_pydict(kinds_data),
        "kinds.parquet",
        SCHEMAS["kinds"],
    )
    total += _write_parquet(
        parquet_dir / "kinds_relationships.parquet",
        pa.Table.from_pydict(rels_data),
        "kinds_relationships.parquet",
        SCHEMAS["kinds_relationships"],
    )

    console.print(
        f"  [dim]({len(kinds_data['name'])} kinds, {len(rels_data['version'])} kinds_relationships)[/dim]"
    )
    return total


def _export_diffs(k8s_dir: Path, parquet_dir: Path) -> int:
    """Export diffs."""
    diffs_dir = k8s_dir / "diffs"
    if not diffs_dir.exists():
        return 0

    data = {
        "from_version": [],
        "to_version": [],
        "change_type": [],
        "group_name": [],
        "kind": [],
        "field_path": [],
        "old_value": [],
        "new_value": [],
    }

    for diff_file in diffs_dir.glob("*.json"):
        with open(diff_file) as f:
            diff = json.load(f)

        from_ver, to_ver = diff["fromVersion"], diff["toVersion"]

        for kind in diff.get("kindsAdded", []):
            data["from_version"].append(from_ver)
            data["to_version"].append(to_ver)
            data["change_type"].append("kind_added")
            data["group_name"].append(kind["group"])
            data["kind"].append(kind["kind"])
            data["field_path"].append(None)
            data["old_value"].append(None)
            data["new_value"].append(None)

        for kind in diff.get("kindsRemoved", []):
            data["from_version"].append(from_ver)
            data["to_version"].append(to_ver)
            data["change_type"].append("kind_removed")
            data["group_name"].append(kind["group"])
            data["kind"].append(kind["kind"])
            data["field_path"].append(None)
            data["old_value"].append(None)
            data["new_value"].append(None)

        for field in diff.get("fieldsAdded", []):
            data["from_version"].append(from_ver)
            data["to_version"].append(to_ver)
            data["change_type"].append("field_added")
            data["group_name"].append(field["group"])
            data["kind"].append(field["kind"])
            data["field_path"].append(field["path"])
            data["old_value"].append(None)
            data["new_value"].append(None)

        for field in diff.get("fieldsRemoved", []):
            data["from_version"].append(from_ver)
            data["to_version"].append(to_ver)
            data["change_type"].append("field_removed")
            data["group_name"].append(field["group"])
            data["kind"].append(field["kind"])
            data["field_path"].append(field["path"])
            data["old_value"].append(None)
            data["new_value"].append(None)

    return _write_parquet(
        parquet_dir / "api_diffs.parquet",
        pa.Table.from_pydict(data),
        "api_diffs.parquet",
        SCHEMAS["api_diffs"],
    )


def _load_enriched_features(releases_dir: Path, version: str) -> dict[str, dict]:
    """Load enriched features from {version}-enriched.json if it exists.

    Returns a dict mapping KEP ID to enriched feature data.
    """
    enriched_file = releases_dir / f"{version}-enriched.json"
    if not enriched_file.exists():
        return {}

    try:
        with open(enriched_file) as f:
            enriched_list = json.load(f)
        # Index by KEP for easy lookup
        return {f["kep"]: f for f in enriched_list}
    except Exception as e:
        console.print(f"  [yellow]Warning: Failed to load {enriched_file}: {e}[/yellow]")
        return {}


def _load_kep_metadata() -> dict[str, dict]:
    """Load all KEP metadata from kep_metadata.json.

    Returns a dict mapping KEP ID to metadata.
    """
    if not KEP_METADATA_PATH.exists():
        return {}

    try:
        with open(KEP_METADATA_PATH) as f:
            data = json.load(f)
        return data.get("keps", {})
    except Exception as e:
        console.print(f"  [yellow]Warning: Failed to load {KEP_METADATA_PATH}: {e}[/yellow]")
        return {}


def _export_releases(releases_dir: Path, parquet_dir: Path) -> int:
    """Export releases, keps, features, deprecations, raw changes, and CHANGELOG data.

    Creates two KEP-related tables:
    - keps.parquet: Master KEP table (one row per KEP)
    - features.parquet: KEP graduations per release (version, kep, stage)

    Merges enriched features from {version}-enriched.json files if they exist.
    """
    if not releases_dir.exists():
        return 0

    releases_data = {
        "version": [],
        "release_date": [],
        "is_latest": [],
        "codename": [],
        "description": [],
        "total_features": [],
        "stable_features": [],
        "beta_features": [],
        "alpha_features": [],
        "themes": [],
    }
    # Master KEP table - one row per KEP
    keps_data = {
        "kep": [],
        "kep_path": [],
        "title": [],
        "sig": [],
        "feature_gate": [],
        "labels": [],
        "description": [],
        "impact": [],
        "affected_kinds": [],
        "affected_fields": [],
        "history_alpha": [],
        "history_beta": [],
        "history_stable": [],
    }
    # Features = KEP graduations per release (join table)
    features_data = {
        "version": [],
        "kep": [],
        "stage": [],
    }
    # Track which KEPs we've seen (to avoid duplicates in keps table)
    seen_keps: dict[str, dict] = {}

    deprecations_data = {
        "version": [],
        "item": [],
        "reason": [],
        "replacement": [],
        "removal_target": [],
    }
    changes_data = {
        "version": [],
        "kind": [],
        "description": [],
        "pr_number": [],
        "pr_url": [],
        "author": [],
        "sigs": [],
        "kep_links": [],
        # Enrichment fields (from LLM - change_enricher)
        "enrichment_problem": [],
        "enrichment_affected": [],
        "enrichment_fix": [],
        "enrichment_impact": [],
        "enrichment_category": [],
        "enrichment_severity": [],
        "enrichment_components": [],
        "enrichment_labels": [],
    }
    urgent_notes_data = {
        "version": [],
        "description": [],
        "pr_number": [],
        "pr_url": [],
        "author": [],
        "sigs": [],
    }
    security_data = {
        "version": [],
        "cve": [],
        "title": [],
        "description": [],
        "affected_versions": [],
        "fixed_versions": [],
        "affected_components": [],
        "patch_version": [],
    }
    patch_releases_data = {
        "version": [],
        "patch_version": [],
        "changelog_since": [],
        "security_fixes_count": [],
        "changes_count": [],
    }
    patch_changes_data = {
        "version": [],
        "patch_version": [],
        "kind": [],
        "description": [],
        "pr_number": [],
        "pr_url": [],
        "author": [],
        "sigs": [],
        # Enrichment fields (from LLM)
        "enrichment_problem": [],
        "enrichment_affected": [],
        "enrichment_fix": [],
        "enrichment_impact": [],
        "enrichment_category": [],
        "enrichment_severity": [],
        "enrichment_components": [],
        "enrichment_labels": [],
    }
    patch_security_data = {
        "version": [],
        "patch_version": [],
        "cve": [],
        "title": [],
        "description": [],
    }

    # First pass: collect all release files and their versions to determine latest
    release_files_data: list[tuple[Path, dict]] = []
    all_versions: list[str] = []

    for release_file in releases_dir.glob("*.json"):
        if release_file.name in ("index.json", "schema.json", "schema-v2.json", "DESIGN.md"):
            continue
        # Skip curated/enriched/raw files (they're merged into main release JSON during build)
        if "-" in release_file.stem:
            continue

        with open(release_file) as f:
            release = json.load(f)
        release_files_data.append((release_file, release))
        all_versions.append(release["version"])

    # Determine latest version (highest version number)
    def version_key(v: str) -> tuple[int, ...]:
        return tuple(int(x) for x in v.split("."))

    latest_version = max(all_versions, key=version_key) if all_versions else None

    # Second pass: process all releases
    for _release_file, release in release_files_data:

        version = release["version"]
        summary = release.get("summary", {})

        releases_data["version"].append(version)
        releases_data["release_date"].append(release.get("releaseDate"))
        releases_data["is_latest"].append(version == latest_version)
        releases_data["codename"].append(release.get("codename"))
        releases_data["description"].append(release.get("description"))
        releases_data["total_features"].append(summary.get("total", 0))
        releases_data["stable_features"].append(summary.get("stable", 0))
        releases_data["beta_features"].append(summary.get("beta", 0))
        releases_data["alpha_features"].append(summary.get("alpha", 0))
        releases_data["themes"].append(release.get("themes", []))

        # Load enriched features if available
        enriched_features = _load_enriched_features(releases_dir, version)
        if enriched_features:
            console.print(f"  [dim]Merging {len(enriched_features)} enriched features for {version}[/dim]")

        for feature in release.get("features", []):
            history = feature.get("history", {})
            kep = feature["kep"]

            # Merge enriched data if available
            enriched = enriched_features.get(kep, {})

            # Add to features table (version, kep, stage)
            features_data["version"].append(version)
            features_data["kep"].append(kep)
            features_data["stage"].append(feature["stage"])

            # Track KEP data (keep latest/best version)
            if kep not in seen_keps:
                seen_keps[kep] = {
                    "kep": kep,
                    "kep_path": feature.get("kepPath"),
                    "title": feature["title"],
                    "sig": feature["sig"],
                    "feature_gate": feature.get("featureGate"),
                    "labels": enriched.get("labels") or feature.get("labels", []),
                    "description": enriched.get("description") or feature.get("description"),
                    "impact": enriched.get("impact") or feature.get("impact"),
                    "affected_kinds": enriched.get("affectedKinds") or feature.get("affectedKinds", []),
                    "affected_fields": enriched.get("affectedFields") or feature.get("affectedFields", []),
                    "history_alpha": history.get("alpha"),
                    "history_beta": history.get("beta"),
                    "history_stable": history.get("stable"),
                }
            else:
                # Update with enriched data if available
                if enriched.get("labels"):
                    seen_keps[kep]["labels"] = enriched["labels"]
                if enriched.get("description"):
                    seen_keps[kep]["description"] = enriched["description"]
                if enriched.get("impact"):
                    seen_keps[kep]["impact"] = enriched["impact"]
                if enriched.get("affectedKinds"):
                    seen_keps[kep]["affected_kinds"] = enriched["affectedKinds"]
                if enriched.get("affectedFields"):
                    seen_keps[kep]["affected_fields"] = enriched["affectedFields"]
                # Update history
                if history.get("alpha"):
                    seen_keps[kep]["history_alpha"] = history["alpha"]
                if history.get("beta"):
                    seen_keps[kep]["history_beta"] = history["beta"]
                if history.get("stable"):
                    seen_keps[kep]["history_stable"] = history["stable"]

        for dep in release.get("deprecations", []):
            deprecations_data["version"].append(version)
            deprecations_data["item"].append(dep["item"])
            deprecations_data["reason"].append(dep["reason"])
            deprecations_data["replacement"].append(dep.get("replacement"))
            deprecations_data["removal_target"].append(dep.get("removalTarget"))

        for kind, entries in release.get("changesByKind", {}).items():
            if not entries:
                continue
            for entry in entries:
                changes_data["version"].append(version)
                changes_data["kind"].append(kind)
                changes_data["description"].append(entry.get("description", ""))
                changes_data["pr_number"].append(entry.get("prNumber"))
                changes_data["pr_url"].append(entry.get("prUrl"))
                changes_data["author"].append(entry.get("author"))
                changes_data["sigs"].append(entry.get("sigs", []))
                changes_data["kep_links"].append(entry.get("kepLinks", []))
                # Enrichment fields (from change_enricher)
                enrichment = entry.get("enrichment", {})
                changes_data["enrichment_problem"].append(enrichment.get("problem"))
                changes_data["enrichment_affected"].append(enrichment.get("affected"))
                changes_data["enrichment_fix"].append(enrichment.get("fix"))
                changes_data["enrichment_impact"].append(enrichment.get("impact"))
                changes_data["enrichment_category"].append(enrichment.get("category"))
                changes_data["enrichment_severity"].append(enrichment.get("severity"))
                changes_data["enrichment_components"].append(enrichment.get("affectedComponents", []))
                changes_data["enrichment_labels"].append(enrichment.get("labels", []))

        for note in release.get("actionRequired", []):
            urgent_notes_data["version"].append(version)
            urgent_notes_data["description"].append(note.get("description", ""))
            urgent_notes_data["pr_number"].append(note.get("prNumber"))
            urgent_notes_data["pr_url"].append(note.get("prUrl"))
            urgent_notes_data["author"].append(note.get("author"))
            urgent_notes_data["sigs"].append(note.get("sigs", []))

        for cve in release.get("securityInformation", []):
            security_data["version"].append(version)
            security_data["cve"].append(cve.get("cve", ""))
            security_data["title"].append(cve.get("title", ""))
            security_data["description"].append(cve.get("description", ""))
            security_data["affected_versions"].append(cve.get("affectedVersions", []))
            security_data["fixed_versions"].append(cve.get("fixedVersions", []))
            security_data["affected_components"].append(cve.get("affectedComponents", []))
            security_data["patch_version"].append(cve.get("patchVersion"))

        for patch in release.get("patchReleases", []):
            patch_version = patch.get("version", "")
            patch_releases_data["version"].append(version)
            patch_releases_data["patch_version"].append(patch_version)
            patch_releases_data["changelog_since"].append(patch.get("changelogSince"))
            patch_releases_data["security_fixes_count"].append(len(patch.get("securityFixes", [])))
            changes_count = sum(len(v) for v in patch.get("changesByKind", {}).values())
            patch_releases_data["changes_count"].append(changes_count)

            # Export patch release changes
            for kind, entries in patch.get("changesByKind", {}).items():
                if not entries:
                    continue
                for entry in entries:
                    patch_changes_data["version"].append(version)
                    patch_changes_data["patch_version"].append(patch_version)
                    patch_changes_data["kind"].append(kind)
                    patch_changes_data["description"].append(entry.get("description", ""))
                    patch_changes_data["pr_number"].append(entry.get("prNumber"))
                    patch_changes_data["pr_url"].append(entry.get("prUrl"))
                    patch_changes_data["author"].append(entry.get("author"))
                    patch_changes_data["sigs"].append(entry.get("sigs", []))
                    # Enrichment fields
                    enrichment = entry.get("enrichment", {})
                    patch_changes_data["enrichment_problem"].append(enrichment.get("problem"))
                    patch_changes_data["enrichment_affected"].append(enrichment.get("affected"))
                    patch_changes_data["enrichment_fix"].append(enrichment.get("fix"))
                    patch_changes_data["enrichment_impact"].append(enrichment.get("impact"))
                    patch_changes_data["enrichment_category"].append(enrichment.get("category"))
                    patch_changes_data["enrichment_severity"].append(enrichment.get("severity"))
                    patch_changes_data["enrichment_components"].append(enrichment.get("affectedComponents", []))
                    patch_changes_data["enrichment_labels"].append(enrichment.get("labels", []))

            # Export patch security fixes
            for fix in patch.get("securityFixes", []):
                patch_security_data["version"].append(version)
                patch_security_data["patch_version"].append(patch_version)
                patch_security_data["cve"].append(fix.get("cve", ""))
                patch_security_data["title"].append(fix.get("title", ""))
                patch_security_data["description"].append(fix.get("description", ""))

    # Add KEPs from kep_metadata.json that aren't in any release
    kep_metadata = _load_kep_metadata()
    for kep_id, metadata in kep_metadata.items():
        if kep_id not in seen_keps:
            seen_keps[kep_id] = {
                "kep": kep_id,
                "kep_path": metadata.get("kepPath"),
                "title": metadata.get("title", ""),
                "sig": metadata.get("sig", ""),
                "feature_gate": metadata.get("featureGate"),
                "labels": metadata.get("labels", []),
                "description": metadata.get("summary"),
                "impact": metadata.get("impact"),
                "affected_kinds": metadata.get("affectedKinds", []),
                "affected_fields": metadata.get("affectedFields", []),
                "history_alpha": None,
                "history_beta": None,
                "history_stable": None,
            }

    # Build keps_data from seen_keps
    for kep_info in seen_keps.values():
        keps_data["kep"].append(kep_info["kep"])
        keps_data["kep_path"].append(kep_info["kep_path"])
        keps_data["title"].append(kep_info["title"])
        keps_data["sig"].append(kep_info["sig"])
        keps_data["feature_gate"].append(kep_info["feature_gate"])
        keps_data["labels"].append(kep_info["labels"])
        keps_data["description"].append(kep_info["description"])
        keps_data["impact"].append(kep_info.get("impact"))
        keps_data["affected_kinds"].append(kep_info["affected_kinds"])
        keps_data["affected_fields"].append(kep_info["affected_fields"])
        keps_data["history_alpha"].append(kep_info["history_alpha"])
        keps_data["history_beta"].append(kep_info["history_beta"])
        keps_data["history_stable"].append(kep_info["history_stable"])

    console.print(f"  [dim]({len(keps_data['kep'])} KEPs, {len(features_data['version'])} feature graduations)[/dim]")

    total = 0
    total += _write_parquet(
        parquet_dir / "releases.parquet",
        pa.Table.from_pydict(releases_data),
        "releases.parquet",
        SCHEMAS["releases"],
    )
    total += _write_parquet(
        parquet_dir / "keps.parquet",
        pa.Table.from_pydict(keps_data),
        "keps.parquet",
        SCHEMAS["keps"],
    )
    total += _write_parquet(
        parquet_dir / "features.parquet",
        pa.Table.from_pydict(features_data),
        "features.parquet",
        SCHEMAS["features"],
    )
    total += _write_parquet(
        parquet_dir / "deprecations.parquet",
        pa.Table.from_pydict(deprecations_data),
        "deprecations.parquet",
        SCHEMAS["deprecations"],
    )
    total += _write_parquet(
        parquet_dir / "release_changes.parquet",
        pa.Table.from_pydict(changes_data),
        "release_changes.parquet",
        SCHEMAS["release_changes"],
    )
    total += _write_parquet(
        parquet_dir / "action_required.parquet",
        pa.Table.from_pydict(urgent_notes_data),
        "action_required.parquet",
        SCHEMAS["action_required"],
    )
    total += _write_parquet(
        parquet_dir / "security_cves.parquet",
        pa.Table.from_pydict(security_data),
        "security_cves.parquet",
        SCHEMAS["security_cves"],
    )
    total += _write_parquet(
        parquet_dir / "patch_releases.parquet",
        pa.Table.from_pydict(patch_releases_data),
        "patch_releases.parquet",
        SCHEMAS["patch_releases"],
    )
    if patch_changes_data["version"]:
        total += _write_parquet(
            parquet_dir / "patch_release_changes.parquet",
            pa.Table.from_pydict(patch_changes_data),
            "patch_release_changes.parquet",
            SCHEMAS["patch_release_changes"],
        )
    if patch_security_data["version"]:
        total += _write_parquet(
            parquet_dir / "patch_security_fixes.parquet",
            pa.Table.from_pydict(patch_security_data),
            "patch_security_fixes.parquet",
            SCHEMAS["patch_security_fixes"],
        )

    console.print(
        f"  [dim]({len(changes_data['version'])} raw changes, {len(urgent_notes_data['version'])} urgent notes, {len(security_data['version'])} CVEs)[/dim]"
    )

    return total


def _export_field_kep_links(k8s_dir: Path, parquet_dir: Path) -> int:
    """Export field-KEP links."""
    links_dir = k8s_dir / "field-kep-links"
    if not links_dir.exists():
        return 0

    data = {
        "version": [],
        "field_path": [],
        "kind": [],
        "group_name": [],
        "kep": [],
        "kep_title": [],
        "kep_path": [],
        "confidence": [],
        "match_reason": [],
        "is_canonical": [],
    }

    for links_file in links_dir.glob("*.json"):
        with open(links_file) as f:
            links_data = json.load(f)

        version = links_data["version"]

        for link in links_data.get("links", []):
            data["version"].append(version)
            data["field_path"].append(link["fieldPath"])
            data["kind"].append(link["kind"])
            data["group_name"].append(link["group"])
            data["kep"].append(link["kep"])
            data["kep_title"].append(link["kepTitle"])
            data["kep_path"].append(link.get("kepPath"))
            data["confidence"].append(link["confidence"])
            data["match_reason"].append(link["matchReason"])
            data["is_canonical"].append(link.get("isCanonical", True))

    if not data["version"]:
        return 0

    total = _write_parquet(
        parquet_dir / "field_kep_links.parquet",
        pa.Table.from_pydict(data),
        "field_kep_links.parquet",
        SCHEMAS["field_kep_links"],
    )

    canonical_count = sum(1 for c in data["is_canonical"] if c)
    console.print(f"  [dim]({len(data['version'])} field-KEP links, {canonical_count} canonical)[/dim]")

    return total



def _export_blog_posts(parquet_dir: Path) -> int:
    """Export content links from content_links.json."""
    from ...transform.content.content_links import flatten_content_for_export, load_all_content

    rows = flatten_content_for_export()

    if not rows:
        console.print("  [dim]content_links.parquet: 0 items (skipped)[/dim]")
        return 0

    data = {
        "url": [r["url"] for r in rows],
        "title": [r["title"] for r in rows],
        "content_type": [r["content_type"] for r in rows],
        "source": [r["source"] for r in rows],
        "is_official": [r["is_official"] for r in rows],
        "published_date": [r["published_date"] for r in rows],
        "author": [r["author"] for r in rows],
        "summary": [r["summary"] for r in rows],
        "description": [r["description"] for r in rows],
        "labels": [r["labels"] for r in rows],
        "attrs": [r.get("attrs") for r in rows],
        "target_type": [r["target_type"] for r in rows],
        "target_id": [r["target_id"] for r in rows],
        "target_group": [r["target_group"] for r in rows],
        "target_version": [r["target_version"] for r in rows],
        "link_confidence": [r.get("link_confidence") for r in rows],
        "link_reason": [r.get("link_reason") for r in rows],
    }

    total = _write_parquet(
        parquet_dir / "content_links.parquet",
        pa.Table.from_pydict(data),
        "content_links.parquet",
        SCHEMAS["content_links"],
    )

    # Count unique content items and link types (from all files)
    content_data = load_all_content()
    unique_count = len(content_data.get("content", []))
    release_links = sum(1 for r in rows if r["target_type"] == "release")
    kep_links = sum(1 for r in rows if r["target_type"] == "kep")
    kind_links = sum(1 for r in rows if r["target_type"] == "kind")
    field_links = sum(1 for r in rows if r["target_type"] == "field")

    console.print(f"  [dim]({unique_count} content items → {release_links} release, {kep_links} KEP, {kind_links} kind, {field_links} field links)[/dim]")

    return total


def _export_providers(parquet_dir: Path) -> int:
    """Export cloud provider version support data."""
    from ...transform.providers.provider_versions import load_provider_data

    data = load_provider_data()
    if not data:
        console.print("  [dim]providers.parquet: no data (run fetch-providers first)[/dim]")
        return 0

    # Export providers table
    providers = data.get("providers", [])
    providers_data = {
        "provider_id": [p["provider_id"] for p in providers],
        "display_name": [p["display_name"] for p in providers],
        "color": [p["color"] for p in providers],
        "docs_url": [p["docs_url"] for p in providers],
        "version_docs_url": [p.get("version_docs_url") for p in providers],
        "versioning_scheme": [p["versioning_scheme"] for p in providers],
        "support_model": [p.get("support_model") for p in providers],
        "standard_support_months": [p.get("standard_support_months") for p in providers],
        "extended_support_months": [p.get("extended_support_months") for p in providers],
    }

    total = 0
    total += _write_parquet(
        parquet_dir / "providers.parquet",
        pa.Table.from_pydict(providers_data),
        "providers.parquet",
        SCHEMAS["providers"],
    )

    # Export provider_versions table
    versions = data.get("versions", [])
    if versions:
        versions_data = {
            "provider_id": [v["provider_id"] for v in versions],
            "k8s_version": [v["k8s_version"] for v in versions],
            "provider_version": [v["provider_version"] for v in versions],
            "upstream_release_date": [v["upstream_release_date"] for v in versions],
            "provider_release_date": [v["provider_release_date"] for v in versions],
            "eol_standard_date": [v["eol_standard_date"] for v in versions],
            "eol_extended_date": [v["eol_extended_date"] for v in versions],
            "days_to_availability": [v["days_to_availability"] for v in versions],
            "standard_support_days": [v["standard_support_days"] for v in versions],
            "extended_support_days": [v["extended_support_days"] for v in versions],
            "total_support_days": [v["total_support_days"] for v in versions],
            "status": [v["status"] for v in versions],
            "has_extended_support": [v.get("has_extended_support", False) for v in versions],
            "latest_patch": [v["latest_patch"] for v in versions],
            "latest_patch_date": [v["latest_patch_date"] for v in versions],
        }

        total += _write_parquet(
            parquet_dir / "provider_versions.parquet",
            pa.Table.from_pydict(versions_data),
            "provider_versions.parquet",
            SCHEMAS["provider_versions"],
        )

        # Count by provider
        by_provider = {}
        for v in versions:
            pid = v["provider_id"]
            by_provider[pid] = by_provider.get(pid, 0) + 1

        counts = ", ".join(f"{pid}:{c}" for pid, c in by_provider.items())
        console.print(f"  [dim]({len(providers)} providers, {len(versions)} versions: {counts})[/dim]")

    return total


def _export_components(parquet_dir: Path) -> int:
    """Export Kubernetes component data (control plane, node components, addons)."""
    from ...core.config import CURATED_COMPONENTS_DIR

    components_file = CURATED_COMPONENTS_DIR / "components.json"

    if not components_file.exists():
        console.print("  [dim]components.parquet: no data (components.json not found)[/dim]")
        return 0

    with open(components_file) as f:
        data = json.load(f)

    components = data.get("components", [])
    if not components:
        return 0

    # Export components table
    components_data = {
        "id": [],
        "type": [],
        "display_name": [],
        "description": [],
        "docs_url": [],
        "related_keps": [],
        "controllers": [],
    }

    # Export component_flags table
    flags_data = {
        "component_id": [],
        "name": [],
        "type": [],
        "default_value": [],
        "description": [],
        "introduced_in": [],
        "deprecated_in": [],
        "removed_in": [],
        "values": [],
        "related_keps": [],
        "related_feature_gates": [],
    }

    for comp in components:
        components_data["id"].append(comp["id"])
        components_data["type"].append(comp["type"])
        components_data["display_name"].append(comp["display_name"])
        components_data["description"].append(comp["description"])
        components_data["docs_url"].append(comp.get("docs_url"))
        components_data["related_keps"].append(comp.get("related_keps", []))
        components_data["controllers"].append(comp.get("controllers", []))

        # Export flags for this component
        for flag in comp.get("key_flags", []):
            flags_data["component_id"].append(comp["id"])
            flags_data["name"].append(flag["name"])
            flags_data["type"].append(flag.get("type", "string"))
            flags_data["default_value"].append(flag.get("default"))
            flags_data["description"].append(flag.get("description"))
            flags_data["introduced_in"].append(flag.get("introduced_in"))
            flags_data["deprecated_in"].append(flag.get("deprecated_in"))
            flags_data["removed_in"].append(flag.get("removed_in"))
            flags_data["values"].append(flag.get("values", []))
            flags_data["related_keps"].append(flag.get("related_keps", []))
            flags_data["related_feature_gates"].append(flag.get("related_feature_gates", []))

    total = 0
    total += _write_parquet(
        parquet_dir / "components.parquet",
        pa.Table.from_pydict(components_data),
        "components.parquet",
        SCHEMAS["components"],
    )

    if flags_data["name"]:
        total += _write_parquet(
            parquet_dir / "component_flags.parquet",
            pa.Table.from_pydict(flags_data),
            "component_flags.parquet",
            SCHEMAS["component_flags"],
        )
        console.print(f"  [dim]({len(components)} components, {len(flags_data['name'])} flags)[/dim]")
    else:
        console.print(f"  [dim]({len(components)} components, no flags)[/dim]")

    return total


def _export_kubectl(parquet_dir: Path) -> int:
    """Export kubectl commands, options, and examples from per-version JSON files."""
    from ...core.config import CURATED_KUBECTL_DIR

    # Find all kubectl_commands_{version}.json files
    kubectl_files = list(CURATED_KUBECTL_DIR.glob("kubectl_commands_*.json"))

    if not kubectl_files:
        console.print("  [dim]kubectl_commands.parquet: no data (run extract-kubectl first)[/dim]")
        return 0

    commands_data = {
        "version": [],
        "name": [],
        "synopsis": [],
        "usage": [],
        "subcommands": [],
    }

    options_data = {
        "version": [],
        "command": [],
        "name": [],
        "short": [],
        "type": [],
        "default_value": [],
        "description": [],
    }

    examples_data = {
        "version": [],
        "command": [],
        "description": [],
        "example": [],
    }

    for kubectl_file in sorted(kubectl_files):
        with open(kubectl_file) as f:
            data = json.load(f)

        version = data.get("version")
        if not version:
            continue

        for cmd in data.get("commands", []):
            cmd_name = cmd.get("name", "")

            # Add command
            commands_data["version"].append(version)
            commands_data["name"].append(cmd_name)
            commands_data["synopsis"].append(cmd.get("synopsis"))
            commands_data["usage"].append(cmd.get("usage"))
            commands_data["subcommands"].append(cmd.get("subcommands", []))

            # Add options
            for opt in cmd.get("options", []):
                options_data["version"].append(version)
                options_data["command"].append(cmd_name)
                options_data["name"].append(opt.get("name", ""))
                options_data["short"].append(opt.get("short"))
                options_data["type"].append(opt.get("type"))
                options_data["default_value"].append(opt.get("default"))
                options_data["description"].append(opt.get("description"))

            # Add examples
            for ex in cmd.get("examples", []):
                examples_data["version"].append(version)
                examples_data["command"].append(cmd_name)
                examples_data["description"].append(ex.get("description", ""))
                examples_data["example"].append(ex.get("command", ""))

    total = 0

    if commands_data["name"]:
        total += _write_parquet(
            parquet_dir / "kubectl_commands.parquet",
            pa.Table.from_pydict(commands_data),
            "kubectl_commands.parquet",
            SCHEMAS["kubectl_commands"],
        )

    if options_data["name"]:
        total += _write_parquet(
            parquet_dir / "kubectl_options.parquet",
            pa.Table.from_pydict(options_data),
            "kubectl_options.parquet",
            SCHEMAS["kubectl_options"],
        )

    if examples_data["example"]:
        total += _write_parquet(
            parquet_dir / "kubectl_examples.parquet",
            pa.Table.from_pydict(examples_data),
            "kubectl_examples.parquet",
            SCHEMAS["kubectl_examples"],
        )

    # Count versions
    versions = set(commands_data["version"])
    console.print(
        f"  [dim]({len(versions)} versions, {len(commands_data['name'])} commands, "
        f"{len(options_data['name'])} options, {len(examples_data['example'])} examples)[/dim]"
    )

    return total


def _export_feature_gates(parquet_dir: Path) -> int:
    """Export feature gates from per-version JSON files."""
    from ...core.config import CURATED_FEATURE_GATES_DIR

    # Find all feature_gates_{version}.json files
    feature_gate_files = list(CURATED_FEATURE_GATES_DIR.glob("feature_gates_*.json"))

    if not feature_gate_files:
        console.print("  [dim]feature_gates.parquet: no data (run extract-feature-gates first)[/dim]")
        return 0

    # Load KEPs for linking
    keps_by_gate: dict[str, dict] = {}
    parquet_path = PARQUET_DIR / "keps.parquet"
    if parquet_path.exists():
        try:
            table = pq.read_table(parquet_path)
            for i in range(table.num_rows):
                feature_gate = table.column("feature_gate")[i].as_py()
                if feature_gate:
                    keps_by_gate[feature_gate] = {
                        "kep": table.column("kep")[i].as_py(),
                        "title": table.column("title")[i].as_py(),
                        "kep_path": table.column("kep_path")[i].as_py(),
                    }
        except Exception:
            pass

    data = {
        "version": [],
        "name": [],
        "stage": [],
        "default_value": [],
        "lock_to_default": [],
        "description": [],
        "kep": [],
        "kep_title": [],
        "kep_path": [],
        "version_history_json": [],
    }

    for fg_file in sorted(feature_gate_files):
        with open(fg_file) as f:
            file_data = json.load(f)

        version = file_data.get("version")
        if not version:
            continue

        for gate in file_data.get("feature_gates", []):
            gate_name = gate.get("name", "")

            data["version"].append(version)
            data["name"].append(gate_name)
            data["stage"].append(gate.get("stage"))
            data["default_value"].append(gate.get("default", False))
            data["lock_to_default"].append(gate.get("lock_to_default", False))
            data["description"].append(gate.get("description"))

            # Link to KEP if available
            kep_info = keps_by_gate.get(gate_name, {})
            data["kep"].append(kep_info.get("kep"))
            data["kep_title"].append(kep_info.get("title"))
            data["kep_path"].append(kep_info.get("kep_path"))

            # Store version history as JSON
            history = gate.get("version_history", [])
            data["version_history_json"].append(json.dumps(history) if history else None)

    if not data["name"]:
        return 0

    total = _write_parquet(
        parquet_dir / "feature_gates.parquet",
        pa.Table.from_pydict(data),
        "feature_gates.parquet",
        SCHEMAS["feature_gates"],
    )

    # Count versions and gates
    versions = set(data["version"])
    console.print(f"  [dim]({len(versions)} versions, {len(data['name'])} feature gates)[/dim]")

    return total
