"""Export JSON data to Parquet files for DuckDB WASM (DuckDB backend).

This exporter uses DuckDB's native SQL capabilities to transform and export data.
It should produce identical output to the PyArrow exporter.

⚠️  MAINTENANCE NOTE (2026-01):
This DuckDB backend is NOT actively maintained. The PyArrow backend (../pyarrow.py)
is the default and recommended exporter. When adding new tables or columns:
1. Update ../pyarrow.py (the primary exporter)
2. Update ../schemas.py (schema definitions)
3. This file (duckdb.py) may be out of sync and is kept for reference/benchmarking only

Missing from this exporter (compared to pyarrow.py):
- providers table
- provider_versions table
- keps.impact column
- keps.labels column (may be missing)
- Various enrichment columns

If you need the DuckDB backend to work, you'll need to update _create_tables()
and the corresponding _import_* functions to match the PyArrow exporter.
"""

import json
import shutil
from pathlib import Path

import duckdb
from rich.console import Console

from ....core.config import OUTPUT_DIR, PARQUET_DIR, PIPELINE_DATA_DIR, WEB_PARQUET_DIR

console = Console()

# Path to pre-computed KEP metadata
KEP_METADATA_PATH = PIPELINE_DATA_DIR / "curated" / "kep_metadata.json"


def export_to_parquet(output_dir: Path | None = None) -> None:
    """Export all JSON data to Parquet files using DuckDB.

    Writes to pipeline/data/output/parquet/ and copies to packages/web/public/data/parquet/
    for the dev server.
    """
    parquet_dir = output_dir or PARQUET_DIR
    parquet_dir.mkdir(parents=True, exist_ok=True)

    k8s_dir = OUTPUT_DIR
    releases_dir = OUTPUT_DIR / "releases"

    console.print(f"  [dim]Source: {OUTPUT_DIR.parent}[/dim]")
    console.print(f"\n[bold]Exporting to Parquet (DuckDB): {parquet_dir}[/bold]\n")

    con = duckdb.connect()
    _create_tables(con)
    _import_versions(con, k8s_dir)
    schemas = _load_schemas(k8s_dir)
    _import_api_trees(con, k8s_dir, schemas)
    _import_diffs(con, k8s_dir)
    _import_releases(con, releases_dir)
    _import_field_kep_links(con, k8s_dir)
    _import_content_links(con)
    _write_parquet_files(con, parquet_dir)
    con.close()

    # Copy to web app public folder for dev server
    if output_dir is None:  # Only copy if using default output
        _copy_to_web(parquet_dir)


def _copy_to_web(parquet_dir: Path) -> None:
    """Copy parquet files to web app public folder for dev server."""
    WEB_PARQUET_DIR.mkdir(parents=True, exist_ok=True)

    console.print(f"\n[bold]Copying to web app: {WEB_PARQUET_DIR}[/bold]")

    for parquet_file in parquet_dir.glob("*.parquet"):
        dest = WEB_PARQUET_DIR / parquet_file.name
        shutil.copy2(parquet_file, dest)

    console.print(f"  [green]✓[/green] Copied {len(list(parquet_dir.glob('*.parquet')))} files")


def _create_tables(con: duckdb.DuckDBPyConnection) -> None:
    """Create DuckDB tables with schema definitions."""
    # Core API tables
    con.execute(
        "CREATE TABLE versions (version VARCHAR PRIMARY KEY, release_date VARCHAR, is_latest BOOLEAN)"
    )
    con.execute(
        "CREATE TABLE api_groups (version VARCHAR, name VARCHAR, display_name VARCHAR, description VARCHAR, color VARCHAR, PRIMARY KEY (version, name))"
    )
    con.execute(
        "CREATE TABLE kinds (version VARCHAR, group_name VARCHAR, api_version VARCHAR, name VARCHAR, singular_name VARCHAR, plural_name VARCHAR, scope VARCHAR, short_names VARCHAR[], categories VARCHAR[], schema_ref VARCHAR, field_count INTEGER, description VARCHAR, docs_url VARCHAR, schema_json JSON, PRIMARY KEY (version, group_name, api_version, name))"
    )
    con.execute(
        "CREATE TABLE kinds_relationships (version VARCHAR, source_kind VARCHAR, source_group VARCHAR, type VARCHAR, target_kind VARCHAR, target_group VARCHAR, description VARCHAR, field_path VARCHAR)"
    )
    con.execute(
        "CREATE TABLE diffs (from_version VARCHAR, to_version VARCHAR, change_type VARCHAR, group_name VARCHAR, kind VARCHAR, field_path VARCHAR, old_value VARCHAR, new_value VARCHAR)"
    )

    # Release tables
    con.execute(
        "CREATE TABLE releases (version VARCHAR PRIMARY KEY, codename VARCHAR, description VARCHAR, release_date VARCHAR, total_features INTEGER, stable_features INTEGER, beta_features INTEGER, alpha_features INTEGER, themes VARCHAR[])"
    )
    # Master KEP table - one row per KEP
    con.execute("""
        CREATE TABLE keps (
            kep VARCHAR PRIMARY KEY, kep_path VARCHAR, title VARCHAR, sig VARCHAR,
            feature_gate VARCHAR, labels VARCHAR[], description VARCHAR,
            affected_kinds VARCHAR[], affected_fields VARCHAR[],
            history_alpha VARCHAR, history_beta VARCHAR, history_stable VARCHAR
        )
    """)
    # Features = KEP graduations per release (join table)
    con.execute("""
        CREATE TABLE features (
            version VARCHAR, kep VARCHAR, stage VARCHAR,
            PRIMARY KEY (version, kep)
        )
    """)
    con.execute(
        "CREATE TABLE deprecations (version VARCHAR, item VARCHAR, reason VARCHAR, replacement VARCHAR, removal_target VARCHAR)"
    )
    con.execute("""
        CREATE TABLE release_changes (
            version VARCHAR, kind VARCHAR, description VARCHAR, pr_number INTEGER,
            pr_url VARCHAR, author VARCHAR, sigs VARCHAR[], kep_links VARCHAR[],
            enrichment_problem VARCHAR, enrichment_affected VARCHAR, enrichment_fix VARCHAR,
            enrichment_impact VARCHAR, enrichment_category VARCHAR, enrichment_severity VARCHAR,
            enrichment_components VARCHAR[], enrichment_labels VARCHAR[]
        )
    """)
    con.execute("""
        CREATE TABLE action_required (
            version VARCHAR, description VARCHAR, pr_number INTEGER, pr_url VARCHAR,
            author VARCHAR, sigs VARCHAR[]
        )
    """)
    con.execute("""
        CREATE TABLE security_cves (
            version VARCHAR, cve VARCHAR, title VARCHAR, description VARCHAR,
            affected_versions VARCHAR[], fixed_versions VARCHAR[],
            affected_components VARCHAR[], patch_version VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE patch_releases (
            version VARCHAR, patch_version VARCHAR, changelog_since VARCHAR,
            security_fixes_count INTEGER, changes_count INTEGER
        )
    """)
    con.execute("""
        CREATE TABLE patch_release_changes (
            version VARCHAR, patch_version VARCHAR, kind VARCHAR, description VARCHAR,
            pr_number INTEGER, pr_url VARCHAR, author VARCHAR, sigs VARCHAR[],
            enrichment_problem VARCHAR, enrichment_affected VARCHAR, enrichment_fix VARCHAR,
            enrichment_impact VARCHAR, enrichment_category VARCHAR, enrichment_severity VARCHAR,
            enrichment_components VARCHAR[]
        )
    """)
    con.execute("""
        CREATE TABLE patch_security_fixes (
            version VARCHAR, patch_version VARCHAR, cve VARCHAR, title VARCHAR, description VARCHAR
        )
    """)

    # Field-KEP links
    con.execute("""
        CREATE TABLE field_kep_links (
            version VARCHAR, field_path VARCHAR, kind VARCHAR, group_name VARCHAR,
            kep VARCHAR, kep_title VARCHAR, kep_path VARCHAR, confidence FLOAT,
            match_reason VARCHAR, is_canonical BOOLEAN
        )
    """)

    # Content links
    con.execute("""
        CREATE TABLE content_links (
            url VARCHAR, title VARCHAR, content_type VARCHAR, source VARCHAR,
            is_official BOOLEAN, published_date VARCHAR, author VARCHAR,
            summary VARCHAR, description VARCHAR, labels VARCHAR[],
            attrs VARCHAR,
            target_type VARCHAR, target_id VARCHAR, target_group VARCHAR, target_version VARCHAR
        )
    """)


def _import_versions(con: duckdb.DuckDBPyConnection, k8s_dir: Path) -> None:
    """Import versions.json."""
    versions_file = k8s_dir / "versions.json"
    if versions_file.exists():
        with open(versions_file) as f:
            versions = json.load(f)
        for v in versions:
            con.execute(
                "INSERT INTO versions VALUES (?, ?, ?)",
                [v["version"], v["releaseDate"], v["isLatest"]],
            )
        console.print(f"  [green]✓[/green] Versions: {len(versions)}")


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


def _import_api_trees(
    con: duckdb.DuckDBPyConnection, k8s_dir: Path, schemas: dict[str, dict[str, str]]
) -> None:
    """Import API tree JSON files with schemas joined."""
    api_trees_dir = k8s_dir / "api-trees"
    groups_count = kinds_count = rels_count = 0

    if api_trees_dir.exists():
        for tree_file in api_trees_dir.glob("*.json"):
            with open(tree_file) as f:
                tree = json.load(f)
            version = tree["version"]
            version_schemas = schemas.get(version, {})

            for group in tree["groups"]:
                con.execute(
                    "INSERT INTO api_groups VALUES (?, ?, ?, ?, ?)",
                    [
                        version,
                        group["name"],
                        group["displayName"],
                        group["description"],
                        group["color"],
                    ],
                )
                groups_count += 1

                for api_ver in group["versions"]:
                    for kind in api_ver["kinds"]:
                        schema_key = f"{group['name']}/{kind['name']}"
                        schema_json = version_schemas.get(schema_key)
                        con.execute(
                            "INSERT INTO kinds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::JSON)",
                            [
                                version,
                                group["name"],
                                api_ver["name"],
                                kind["name"],
                                kind["singularName"],
                                kind["pluralName"],
                                kind["scope"],
                                kind.get("shortNames", []),
                                kind.get("categories", []),
                                kind["schemaRef"],
                                kind["fieldCount"],
                                kind.get("description", ""),
                                kind.get("docsUrl"),
                                schema_json,
                            ],
                        )
                        kinds_count += 1

                        for rel in kind.get("relationships", []):
                            con.execute(
                                "INSERT INTO kinds_relationships VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                [
                                    version,
                                    kind["name"],
                                    group["name"],
                                    rel["type"],
                                    rel["targetKind"],
                                    rel["targetGroup"],
                                    rel["description"],
                                    rel.get("fieldPath"),
                                ],
                            )
                            rels_count += 1

    console.print(f"  [green]✓[/green] API Groups: {groups_count}")
    console.print(f"  [green]✓[/green] Kinds: {kinds_count}")
    console.print(f"  [green]✓[/green] Kinds Relationships: {rels_count}")


def _import_diffs(con: duckdb.DuckDBPyConnection, k8s_dir: Path) -> None:
    """Import diff JSON files."""
    diffs_dir = k8s_dir / "diffs"
    diffs_count = 0

    if diffs_dir.exists():
        for diff_file in diffs_dir.glob("*.json"):
            with open(diff_file) as f:
                diff = json.load(f)
            from_ver, to_ver = diff["fromVersion"], diff["toVersion"]

            for kind in diff.get("kindsAdded", []):
                con.execute(
                    "INSERT INTO diffs VALUES (?, ?, 'kind_added', ?, ?, NULL, NULL, NULL)",
                    [from_ver, to_ver, kind["group"], kind["kind"]],
                )
                diffs_count += 1
            for kind in diff.get("kindsRemoved", []):
                con.execute(
                    "INSERT INTO diffs VALUES (?, ?, 'kind_removed', ?, ?, NULL, NULL, NULL)",
                    [from_ver, to_ver, kind["group"], kind["kind"]],
                )
                diffs_count += 1
            for field in diff.get("fieldsAdded", []):
                con.execute(
                    "INSERT INTO diffs VALUES (?, ?, 'field_added', ?, ?, ?, NULL, NULL)",
                    [from_ver, to_ver, field["group"], field["kind"], field["path"]],
                )
                diffs_count += 1
            for field in diff.get("fieldsRemoved", []):
                con.execute(
                    "INSERT INTO diffs VALUES (?, ?, 'field_removed', ?, ?, ?, NULL, NULL)",
                    [from_ver, to_ver, field["group"], field["kind"], field["path"]],
                )
                diffs_count += 1

    console.print(f"  [green]✓[/green] Diffs: {diffs_count}")


def _load_enriched_features(releases_dir: Path, version: str) -> dict[str, dict]:
    """Load enriched features from {version}-enriched.json if it exists."""
    enriched_file = releases_dir / f"{version}-enriched.json"
    if not enriched_file.exists():
        return {}
    try:
        with open(enriched_file) as f:
            enriched_list = json.load(f)
        return {f["kep"]: f for f in enriched_list}
    except Exception as e:
        console.print(f"  [yellow]Warning: Failed to load {enriched_file}: {e}[/yellow]")
        return {}


def _load_kep_metadata() -> dict[str, dict]:
    """Load all KEP metadata from kep_metadata.json."""
    if not KEP_METADATA_PATH.exists():
        return {}
    try:
        with open(KEP_METADATA_PATH) as f:
            data = json.load(f)
        return data.get("keps", {})
    except Exception as e:
        console.print(f"  [yellow]Warning: Failed to load {KEP_METADATA_PATH}: {e}[/yellow]")
        return {}


def _import_releases(con: duckdb.DuckDBPyConnection, releases_dir: Path) -> None:
    """Import release JSON files with all related data.

    Creates two KEP-related tables:
    - keps: Master KEP table (one row per KEP)
    - features: KEP graduations per release (version, kep, stage)
    """
    k8s_releases_dir = releases_dir.parent / "k8s" / "releases"
    if not k8s_releases_dir.exists():
        k8s_releases_dir = releases_dir
    releases_count = features_count = changes_count = 0
    urgent_count = security_count = patch_count = 0

    # Track KEPs we've seen (to build master keps table)
    seen_keps: dict[str, dict] = {}

    if k8s_releases_dir.exists():
        for release_file in k8s_releases_dir.glob("*.json"):
            if release_file.name in ("index.json", "schema.json", "schema-v2.json", "DESIGN.md"):
                continue
            if "-" in release_file.stem:
                continue

            with open(release_file) as f:
                release = json.load(f)
            version = release["version"]
            summary = release.get("summary", {})

            con.execute(
                "INSERT INTO releases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    version,
                    release.get("codename"),
                    release.get("description"),
                    release.get("releaseDate"),
                    summary.get("total", 0),
                    summary.get("stable", 0),
                    summary.get("beta", 0),
                    summary.get("alpha", 0),
                    release.get("themes", []),
                ],
            )
            releases_count += 1

            # Load enriched features
            enriched_features = _load_enriched_features(k8s_releases_dir, version)
            if enriched_features:
                console.print(f"  [dim]Merging {len(enriched_features)} enriched features for {version}[/dim]")

            for feature in release.get("features", []):
                history = feature.get("history", {})
                kep = feature["kep"]
                enriched = enriched_features.get(kep, {})

                # Insert into features table (version, kep, stage)
                con.execute(
                    "INSERT INTO features VALUES (?, ?, ?)",
                    [version, kep, feature["stage"]],
                )
                features_count += 1

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
                con.execute(
                    "INSERT INTO deprecations VALUES (?, ?, ?, ?, ?)",
                    [
                        version,
                        dep["item"],
                        dep["reason"],
                        dep.get("replacement"),
                        dep.get("removalTarget"),
                    ],
                )

            for kind, entries in release.get("changesByKind", {}).items():
                if not entries:
                    continue
                for entry in entries:
                    enrichment = entry.get("enrichment", {})
                    con.execute(
                        "INSERT INTO release_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [
                            version,
                            kind,
                            entry.get("description", ""),
                            entry.get("prNumber"),
                            entry.get("prUrl"),
                            entry.get("author"),
                            entry.get("sigs", []),
                            entry.get("kepLinks", []),
                            enrichment.get("problem"),
                            enrichment.get("affected"),
                            enrichment.get("fix"),
                            enrichment.get("impact"),
                            enrichment.get("category"),
                            enrichment.get("severity"),
                            enrichment.get("affectedComponents", []),
                            enrichment.get("labels", []),
                        ],
                    )
                    changes_count += 1

            for note in release.get("actionRequired", []):
                con.execute(
                    "INSERT INTO action_required VALUES (?, ?, ?, ?, ?, ?)",
                    [
                        version,
                        note.get("description", ""),
                        note.get("prNumber"),
                        note.get("prUrl"),
                        note.get("author"),
                        note.get("sigs", []),
                    ],
                )
                urgent_count += 1

            for cve in release.get("securityInformation", []):
                con.execute(
                    "INSERT INTO security_cves VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        version,
                        cve.get("cve", ""),
                        cve.get("title", ""),
                        cve.get("description", ""),
                        cve.get("affectedVersions", []),
                        cve.get("fixedVersions", []),
                        cve.get("affectedComponents", []),
                        cve.get("patchVersion"),
                    ],
                )
                security_count += 1

            for patch in release.get("patchReleases", []):
                patch_version = patch.get("version", "")
                changes_count_patch = sum(len(v) for v in patch.get("changesByKind", {}).values())
                con.execute(
                    "INSERT INTO patch_releases VALUES (?, ?, ?, ?, ?)",
                    [
                        version,
                        patch_version,
                        patch.get("changelogSince"),
                        len(patch.get("securityFixes", [])),
                        changes_count_patch,
                    ],
                )
                patch_count += 1

                for kind, entries in patch.get("changesByKind", {}).items():
                    if not entries:
                        continue
                    for entry in entries:
                        enrichment = entry.get("enrichment", {})
                        con.execute(
                            "INSERT INTO patch_release_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [
                                version,
                                patch_version,
                                kind,
                                entry.get("description", ""),
                                entry.get("prNumber"),
                                entry.get("prUrl"),
                                entry.get("author"),
                                entry.get("sigs", []),
                                enrichment.get("problem"),
                                enrichment.get("affected"),
                                enrichment.get("fix"),
                                enrichment.get("impact"),
                                enrichment.get("category"),
                                enrichment.get("severity"),
                                enrichment.get("affectedComponents", []),
                            ],
                        )

                for fix in patch.get("securityFixes", []):
                    con.execute(
                        "INSERT INTO patch_security_fixes VALUES (?, ?, ?, ?, ?)",
                        [
                            version,
                            patch_version,
                            fix.get("cve", ""),
                            fix.get("title", ""),
                            fix.get("description", ""),
                        ],
                    )

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
                "affected_kinds": metadata.get("affectedKinds", []),
                "affected_fields": metadata.get("affectedFields", []),
                "history_alpha": None,
                "history_beta": None,
                "history_stable": None,
            }

    # Insert all KEPs into keps table
    keps_count = 0
    for kep_info in seen_keps.values():
        con.execute(
            "INSERT INTO keps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                kep_info["kep"],
                kep_info["kep_path"],
                kep_info["title"],
                kep_info["sig"],
                kep_info["feature_gate"],
                kep_info["labels"],
                kep_info["description"],
                kep_info["affected_kinds"],
                kep_info["affected_fields"],
                kep_info["history_alpha"],
                kep_info["history_beta"],
                kep_info["history_stable"],
            ],
        )
        keps_count += 1

    console.print(f"  [green]✓[/green] Releases: {releases_count}")
    console.print(f"  [green]✓[/green] KEPs: {keps_count}")
    console.print(f"  [green]✓[/green] Features (graduations): {features_count}")
    console.print(f"  [green]✓[/green] Release Changes: {changes_count}")
    console.print(f"  [green]✓[/green] Urgent Upgrade Notes: {urgent_count}")
    console.print(f"  [green]✓[/green] Security CVEs: {security_count}")
    console.print(f"  [green]✓[/green] Patch Releases: {patch_count}")


def _import_field_kep_links(con: duckdb.DuckDBPyConnection, k8s_dir: Path) -> None:
    """Import field-KEP links."""
    links_dir = k8s_dir / "field-kep-links"
    if not links_dir.exists():
        return

    links_count = 0
    for links_file in links_dir.glob("*.json"):
        with open(links_file) as f:
            links_data = json.load(f)

        version = links_data["version"]
        for link in links_data.get("links", []):
            con.execute(
                "INSERT INTO field_kep_links VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    version,
                    link["fieldPath"],
                    link["kind"],
                    link["group"],
                    link["kep"],
                    link["kepTitle"],
                    link.get("kepPath"),
                    link["confidence"],
                    link["matchReason"],
                    link.get("isCanonical", True),
                ],
            )
            links_count += 1

    console.print(f"  [green]✓[/green] Field-KEP Links: {links_count}")


def _import_content_links(con: duckdb.DuckDBPyConnection) -> None:
    """Import content links."""
    from ....transform.content.content_links import flatten_content_for_export

    rows = flatten_content_for_export()
    if not rows:
        console.print("  [dim]Content Links: 0 (skipped)[/dim]")
        return

    for r in rows:
        con.execute(
            "INSERT INTO content_links VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                r["url"],
                r["title"],
                r["content_type"],
                r["source"],
                r["is_official"],
                r["published_date"],
                r["author"],
                r["summary"],
                r["description"],
                r["labels"],
                r.get("attrs"),
                r["target_type"],
                r["target_id"],
                r["target_group"],
                r["target_version"],
            ],
        )

    console.print(f"  [green]✓[/green] Content Links: {len(rows)}")


def _write_parquet_files(con: duckdb.DuckDBPyConnection, parquet_dir: Path) -> None:
    """Export all tables to Parquet with ZSTD compression."""
    console.print("\n[bold]Writing Parquet files...[/bold]\n")

    tables = [
        "versions",
        "api_groups",
        "kinds",
        "kinds_relationships",
        "diffs",
        "releases",
        "keps",
        "features",
        "deprecations",
        "release_changes",
        "action_required",
        "security_cves",
        "patch_releases",
        "patch_release_changes",
        "patch_security_fixes",
        "field_kep_links",
        "content_links",
    ]
    total_size = 0

    for table in tables:
        # Check if table has data
        count = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if count == 0:
            console.print(f"  [dim]{table}.parquet: 0 rows (skipped)[/dim]")
            continue

        output_path = parquet_dir / f"{table}.parquet"

        # Rename 'diffs' table to 'api_diffs' for consistency
        output_name = "api_diffs" if table == "diffs" else table
        output_path = parquet_dir / f"{output_name}.parquet"

        con.execute(
            f"COPY {table} TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )

        size = output_path.stat().st_size
        total_size += size
        console.print(f"  [green]✓[/green] {output_name}.parquet: {count} rows, {size / 1024:.1f} KB")

    console.print(f"\n[bold green]✓ Total size: {total_size / 1024:.1f} KB[/bold green]")
