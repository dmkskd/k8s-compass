"""CLI for the K8s API pipeline."""

from pathlib import Path

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from .core.config import PIPELINE_ROOT

# Load .env file from pipeline directory (if exists)
_env_path = PIPELINE_ROOT / ".env"
load_dotenv(_env_path)

# ruff: noqa: E402 - imports after dotenv setup
from .core.config import K8S_VERSIONS, OUTPUT_DIR
from .input.repo_manager import (
    DEFAULT_REPOS,
    REPOS,
    checkout_version,
    get_repo_path,
    list_repos,
    reset_to_default_branch,
    run_git,
    sync_repos,
)
from .input.upstream_stager import get_staging_status, stage_all_releases, stage_release
from .output.json_writer import write_api_tree, write_schemas_file, write_versions_file
from .output.parquet import export_to_parquet
from .transform.changelog_parser import changelog_to_dict, parse_changelog
from .transform.kep_field_linker import (
    link_all_versions,
    link_fields_to_keps,
    write_field_kep_links,
)
from .transform.kep_parser import (
    build_features_summary,
    extract_features_all_versions,
    extract_features_for_version,
    features_to_dict,
)
from .transform.openapi_field_parser import parse_kind_schema
from .transform.openapi_schema_differ import (
    compute_diff,
    compute_field_history,
    compute_kind_history,
    write_diff,
    write_field_history,
    write_kind_history,
)
from .transform.openapi_tree_parser import (
    clear_openapi_cache,
    load_openapi_spec,
    parse_openapi_spec,
)
from .transform.release_builder import build_all_releases, build_release, build_release_index

app = typer.Typer(
    name="k8s-pipeline",
    help="Fetch and parse Kubernetes OpenAPI specs for the K8s API Explorer",
)
console = Console()


def parse_all_schemas(spec: dict, version: str) -> dict:
    """Parse all kind schemas from an OpenAPI spec."""
    definitions = spec.get("definitions", {})
    schemas = {}

    for def_name, definition in definitions.items():
        gvk_list = definition.get("x-kubernetes-group-version-kind", [])
        if not gvk_list:
            continue
        gvk = gvk_list[0]
        group = gvk.get("group", "") or "core"
        api_version = gvk.get("version", "")
        kind_name = gvk.get("kind", "")

        if not kind_name or not api_version:
            continue
        if "List" in kind_name and kind_name.endswith("List"):
            continue
        if "Options" in kind_name:
            continue

        key = f"{group}/{kind_name}"
        schema = parse_kind_schema(
            def_name, definition, group, api_version, kind_name, definitions, version
        )
        schemas[key] = schema

    return schemas


@app.command()
def fetch(
    version: str | None = typer.Option(
        None, "--version", "-v", help="Specific K8s version to fetch"
    ),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Fetch all configured versions"),
    no_cache: bool = typer.Option(False, "--no-cache", help="Ignore cached specs"),
    with_schemas: bool = typer.Option(
        True, "--schemas/--no-schemas", help="Generate full schema files"
    ),
):
    """Fetch OpenAPI specs and generate API tree JSON files."""
    if not version and not all_versions:
        console.print("[yellow]Specify --version or --all[/yellow]")
        raise typer.Exit(1)

    versions_to_fetch = K8S_VERSIONS if all_versions else [version]
    console.print(f"\n[bold]Fetching {len(versions_to_fetch)} version(s)...[/bold]\n")

    trees = []

    for ver in versions_to_fetch:
        try:
            # load_openapi_spec handles repo checkout internally
            spec = load_openapi_spec(ver, use_cache=not no_cache)
            tree = parse_openapi_spec(spec, ver)
            trees.append(tree)
            write_api_tree(tree)

            if with_schemas:
                schemas = parse_all_schemas(spec, ver)
                write_schemas_file(ver, schemas)
        except Exception as e:
            console.print(f"[red]Error processing {ver}: {e}[/red]")
            import traceback

            traceback.print_exc()
            continue

    # Reset repo to default branch when done
    if get_repo_path("kubernetes").exists():
        reset_to_default_branch("kubernetes")

    if trees:
        write_versions_file(trees)
        console.print(
            f"\n[bold green]✓ Successfully processed {len(trees)} version(s)[/bold green]\n"
        )

        table = Table(title="API Summary")
        table.add_column("Version", style="cyan")
        table.add_column("Groups", justify="right")
        table.add_column("Kinds", justify="right")
        table.add_column("Fields", justify="right")

        for tree in sorted(trees, key=lambda t: t.version, reverse=True):
            total_kinds = sum(len(ver.kinds) for group in tree.groups for ver in group.versions)
            total_fields = sum(
                kind.field_count
                for group in tree.groups
                for ver in group.versions
                for kind in ver.kinds
            )
            table.add_row(tree.version, str(len(tree.groups)), str(total_kinds), str(total_fields))

        console.print(table)


@app.command()
def list_versions():
    """List all configured Kubernetes versions."""
    console.print("\n[bold]Configured Kubernetes versions:[/bold]\n")
    for ver in K8S_VERSIONS:
        console.print(f"  • {ver}")
    console.print()


@app.command()
def clear():
    """Clear the OpenAPI spec cache."""
    clear_openapi_cache()


@app.command()
def info(version: str = typer.Argument(..., help="K8s version to inspect")):
    """Show detailed info about a fetched version."""
    try:
        spec = load_openapi_spec(version, use_cache=True)
        tree = parse_openapi_spec(spec, version)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)

    console.print(f"\n[bold]Kubernetes {version}[/bold]")
    console.print(f"Release Date: {tree.release_date}\n")

    table = Table(title="API Groups")
    table.add_column("Group", style="cyan")
    table.add_column("Versions")
    table.add_column("Kinds", justify="right")

    for group in tree.groups:
        versions = ", ".join(v.name for v in group.versions)
        total_kinds = sum(len(v.kinds) for v in group.versions)
        table.add_row(group.display_name, versions, str(total_kinds))

    console.print(table)


@app.command()
def diff(
    from_version: str | None = typer.Option(None, "--from", "-f", help="Starting version"),
    to_version: str | None = typer.Option(None, "--to", "-t", help="Ending version"),
    all_diffs: bool = typer.Option(False, "--all", "-a", help="Generate all consecutive diffs"),
    with_history: bool = typer.Option(
        True, "--history/--no-history", help="Also generate field history"
    ),
):
    """Compute diffs between K8s versions."""
    if not all_diffs and (not from_version or not to_version):
        console.print("[yellow]Specify --from and --to, or use --all[/yellow]")
        raise typer.Exit(1)

    if all_diffs:
        versions = sorted(K8S_VERSIONS, key=lambda v: [int(x) for x in v.split(".")])
        console.print(f"\n[bold]Computing diffs for {len(versions)} versions...[/bold]\n")

        diffs = []
        for i in range(len(versions) - 1):
            v_from, v_to = versions[i], versions[i + 1]
            d = compute_diff(v_from, v_to)
            diffs.append(d)
            write_diff(d)
            console.print(
                f"  [green]✓[/green] {v_from} → {v_to}: [green]+{len(d.fields_added)}[/green] [red]-{len(d.fields_removed)}[/red]"
            )

        if with_history:
            console.print("\n[bold]Computing field history...[/bold]")
            history = compute_field_history(versions)
            path = write_field_history(history)
            console.print(f"  [green]✓[/green] Wrote {path} ({len(history)} fields tracked)")

            console.print("\n[bold]Computing kind history...[/bold]")
            kind_history = compute_kind_history(versions)
            path = write_kind_history(kind_history)
            console.print(f"  [green]✓[/green] Wrote {path} ({len(kind_history)} kinds tracked)")
    else:
        console.print(f"\n[bold]Computing diff: {from_version} → {to_version}[/bold]\n")
        d = compute_diff(from_version, to_version)
        path = write_diff(d)
        console.print(f"[green]✓[/green] Wrote {path}\n")
        console.print(
            f"  Added: {len(d.fields_added)}, Removed: {len(d.fields_removed)}, Modified: {len(d.fields_modified)}"
        )


@app.command("export-parquet")
def export_parquet_cmd(
    output_dir: str | None = typer.Option(None, "--output", "-o", help="Output directory"),
    backend: str = typer.Option(
        "pyarrow", "--backend", "-b", help="Export backend: pyarrow or duckdb"
    ),
):
    """Export all data to Parquet files for DuckDB WASM."""
    export_to_parquet(Path(output_dir) if output_dir else None, backend=backend)


@app.command("schema-docs")
def schema_docs_cmd(
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output file path (default: docs/data-model.md)"
    ),
):
    """Generate schema documentation from PyArrow schema definitions.

    Reads the schema definitions in schemas.py and generates markdown
    documentation that accurately reflects the current schema. This ensures
    documentation stays in sync with the actual data.

    The schemas include:
    - Column names and types
    - Descriptions for each column
    - Primary key (PK) and foreign key (FK) annotations
    - Table descriptions

    Examples:
        # Generate docs (default location)
        uv run k8s-pipeline schema-docs

        # Generate to specific file
        uv run k8s-pipeline schema-docs -o docs/schema.md
    """
    from .output.schema_docs import write_schema_docs

    try:
        path = write_schema_docs(output)
        console.print(f"[green]✓[/green] Generated schema docs: {path}")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("benchmark-formats")
def benchmark_formats_cmd(
    include_lance: bool = typer.Option(False, "--lance", "-l", help="Include Lance format (requires pylance)"),
    include_vortex: bool = typer.Option(False, "--vortex", "-v", help="Include Vortex format (requires vortex-array)"),
    include_duckdb_native: bool = typer.Option(True, "--duckdb-native/--no-duckdb-native", help="Include DuckDB native format"),
    per_table: bool = typer.Option(False, "--per-table", "-t", help="Show per-table size comparison"),
):
    """Benchmark different columnar file formats.

    Compares disk size and export time for:
    - Parquet (PyArrow) - default, used by frontend
    - Parquet (DuckDB) - alternative Parquet writer
    - Lance - ML-optimized columnar format (optional)
    - Vortex - state-of-the-art columnar format (optional)
    - DuckDB native - single database file
    - DuckDB native + zstd - compressed database file

    NOTE: Lance and Vortex are NOT supported in DuckDB WASM, so they
    cannot be used by the frontend. This is for experimentation only.

    Examples:
        # Basic benchmark (Parquet + DuckDB native)
        uv run k8s-pipeline benchmark-formats

        # Include all formats
        uv run k8s-pipeline benchmark-formats --lance --vortex

        # Show per-table breakdown
        uv run k8s-pipeline benchmark-formats --per-table
    """
    from .output.parquet.benchmark import print_per_table_comparison, print_results, run_benchmark

    results = run_benchmark(
        include_lance=include_lance,
        include_vortex=include_vortex,
        include_duckdb_native=include_duckdb_native,
    )
    print_results(results)

    if per_table:
        print_per_table_comparison()


@app.command("sync-repos")
def sync_repos_cmd(
    repos: list[str] | None = typer.Argument(None, help="Repos to sync"),
    pull: bool = typer.Option(False, "--pull", "-p", help="Pull updates for existing repos"),
    all_repos: bool = typer.Option(False, "--all", "-a", help="Sync all configured repos"),
):
    """Clone or update upstream Kubernetes repositories."""
    target_repos = list(REPOS.keys()) if all_repos else (repos or DEFAULT_REPOS)
    console.print(f"\n[bold]Syncing {len(target_repos)} repo(s)...[/bold]")
    results = sync_repos(repos=target_repos, pull=pull)
    success_count = sum(1 for v in results.values() if v)
    console.print(f"\n[bold green]✓ {success_count}/{len(results)} repo(s) synced[/bold green]")


@app.command("checkout-version")
def checkout_version_cmd(
    version: str = typer.Argument(..., help="K8s version to checkout"),
    repo: str = typer.Option("kubernetes", "--repo", "-r", help="Repository"),
):
    """Checkout a specific K8s release version in a cloned repo."""
    if not checkout_version(repo, version):
        raise typer.Exit(1)


@app.command("list-repos")
def list_repos_cmd():
    """List all configured upstream repositories and their status."""
    statuses = list_repos()
    console.print("\n[bold]Configured Repositories:[/bold]\n")

    table = Table()
    table.add_column("Repo", style="cyan")
    table.add_column("Status")
    table.add_column("Branch")
    table.add_column("Size")

    for status in statuses:
        if status["exists"]:
            table.add_row(
                status["name"],
                "[green]✓ cloned[/green]",
                status.get("branch") or "[dim]detached[/dim]",
                f"{status.get('size_mb', '?')} MB",
            )
        else:
            table.add_row(status["name"], "[dim]not cloned[/dim]", "-", "-")

    console.print(table)


@app.command("stage-release")
def stage_release_cmd(
    version: str = typer.Argument(None, help="K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Stage all versions"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-fetch even if staged"),
):
    """Stage upstream release data for processing."""
    if all_versions or version is None:
        stage_all_releases(force=force)
    else:
        stage_release(version, force=force)


@app.command("staging-status")
def staging_status_cmd():
    """Show status of staged upstream data."""
    status = get_staging_status()

    table = Table(title="Upstream Staging Status")
    table.add_column("Version", style="cyan")
    table.add_column("Release Notes", style="green")
    table.add_column("CHANGELOG", style="green")

    for version in K8S_VERSIONS:
        v_status = status["versions"].get(version, {})
        notes = "✓" if v_status.get("release_notes") else "✗"
        changelog = "✓" if v_status.get("changelog") else "✗"
        table.add_row(version, notes, changelog)

    console.print(table)
    summary = status["summary"]
    console.print(
        f"\nTotal: {summary['release_notes']}/{len(K8S_VERSIONS)} release notes, {summary['changelogs']}/{len(K8S_VERSIONS)} changelogs"
    )


@app.command("parse-changelog")
def parse_changelog_cmd(
    version: str = typer.Argument(..., help="K8s version"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
):
    """Parse a staged CHANGELOG file and extract structured data."""
    import json

    try:
        parsed = parse_changelog(version)
        result = changelog_to_dict(parsed)

        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, indent=2))
            console.print(f"[green]✓[/green] Wrote {output}")
        else:
            console.print(f"\n[bold]CHANGELOG-{version}.md Summary[/bold]")
            console.print(f"  Action required notes: {len(result['actionRequired'])}")
            console.print(f"  Security CVEs: {len(result['securityInformation'])}")
            console.print(f"  Patch releases: {len(result['patchReleases'])}")
    except FileNotFoundError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("build-release")
def build_release_cmd(
    version: str = typer.Argument(None, help="K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Build all versions"),
    force: bool = typer.Option(False, "--force", "-f", help="Rebuild even if exists"),
    with_index: bool = typer.Option(True, "--index/--no-index", help="Also rebuild index.json"),
    with_prs: bool = typer.Option(False, "--with-prs", "-p", help="Enrich changes with GitHub PR details"),
):
    """Build release JSON from staged upstream data.

    Use --with-prs to fetch PR details from GitHub and enrich changes with:
    - userFacingChange: The release note from PR body
    - relatedIssues: Issues referenced via "Fixes #xxx"
    - relatedKeps: Additional KEPs mentioned in PR body

    Set GITHUB_TOKEN env var for higher rate limits (5000/hr vs 60/hr).
    """
    try:
        if all_versions or version is None:
            build_all_releases(force=force, with_prs=with_prs)
        else:
            build_release(version, force=force, with_prs=with_prs)

        if with_index:
            build_release_index()
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback

        traceback.print_exc()
        raise typer.Exit(1)


@app.command("link-keps")
def link_keps_cmd(
    version: str = typer.Argument(None, help="K8s version to link"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Link all versions"),
):
    """Link new fields to their associated KEPs using heuristic matching."""
    try:
        if all_versions or version is None:
            results = link_all_versions()

            # Summary
            total_linked = sum(len(r.links) for r in results.values())
            total_unlinked = sum(len(r.unlinked_fields) for r in results.values())
            total = total_linked + total_unlinked

            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Total fields: {total}")
            console.print(f"  Linked: {total_linked} ({total_linked/total*100:.0f}%)")
            console.print(f"  Unlinked: {total_unlinked}")
        else:
            result = link_fields_to_keps(version)
            if result.links:
                path = write_field_kep_links(result)
                console.print(f"\n[green]✓[/green] Wrote {path}")
                console.print(f"  Linked: {len(result.links)}")
                console.print(f"  Unlinked: {len(result.unlinked_fields)}")

                # Show top matches
                if result.links:
                    console.print("\n[bold]Top matches:[/bold]")
                    for link in sorted(result.links, key=lambda x: -x.confidence)[:10]:
                        console.print(
                            f"  {link.field_path} → {link.kep} "
                            f"[dim]({link.confidence:.0%} - {link.match_reason})[/dim]"
                        )
            else:
                console.print(f"[yellow]No links found for {version}[/yellow]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("build-features")
def build_features_cmd(
    version: str = typer.Argument(None, help="K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Build for all versions"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
):
    """Extract KEP features from the enhancements repo for a K8s version.

    Scans kep.yaml files in pipeline/repos/enhancements and finds KEPs
    that graduated (alpha/beta/stable) in the specified version.
    """
    import json

    try:
        if all_versions or version is None:
            results = extract_features_all_versions()

            # Summary table
            table = Table(title="KEP Features by Version")
            table.add_column("Version", style="cyan")
            table.add_column("Total", justify="right")
            table.add_column("Stable", justify="right", style="green")
            table.add_column("Beta", justify="right", style="yellow")
            table.add_column("Alpha", justify="right", style="dim")

            for ver in sorted(results.keys(), key=lambda v: [int(x) for x in v.split(".")]):
                features = results[ver]
                summary = build_features_summary(features)
                table.add_row(
                    ver,
                    str(summary["total"]),
                    str(summary["stable"]),
                    str(summary["beta"]),
                    str(summary["alpha"]),
                )

            console.print(table)
        else:
            features = extract_features_for_version(version)

            if output:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps(features_to_dict(features), indent=2))
                console.print(f"[green]✓[/green] Wrote {len(features)} features to {output}")
            else:
                # Show features
                table = Table(title=f"KEP Features for {version}")
                table.add_column("KEP", style="cyan")
                table.add_column("Title")
                table.add_column("Stage", style="green")
                table.add_column("SIG")
                table.add_column("Feature Gate", style="dim")

                for f in features:
                    table.add_row(
                        f.kep,
                        f.title[:50] + "..." if len(f.title) > 50 else f.title,
                        f.stage,
                        f.sig,
                        f.feature_gate or "-",
                    )

                console.print(table)

                summary = build_features_summary(features)
                console.print(f"\nTotal: {summary['total']} (Stable: {summary['stable']}, Beta: {summary['beta']}, Alpha: {summary['alpha']})")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("enrich-features")
def enrich_features_cmd(
    version: str = typer.Argument(..., help="K8s version to enrich"),
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider: ollama, bedrock, anthropic (uses llm_config.yaml if not specified)"),
    model: str | None = typer.Option(None, "--model", "-m", help="Specific model ID (overrides config)"),
    max_features: int | None = typer.Option(None, "--max", help="Max features to process (for testing)"),
    save: bool = typer.Option(True, "--save/--no-save", help="Save enriched features to JSON"),
    use_cache: bool = typer.Option(True, "--cache/--no-cache", help="Use pre-computed metadata from kep_metadata.json"),
):
    """Enrich KEP features with LLM-generated descriptions and metadata.

    By default, uses pre-computed metadata from data/curated/keps/kep_metadata.json
    (generated by extract-kep-metadata). Falls back to LLM for KEPs not in cache.

    Use --no-cache to force LLM enrichment for all KEPs.

    Uses Strands Agents SDK to read KEP README.md files and extract:
    - description: What the feature does
    - impact: How it affects users
    - affectedKinds: Which K8s resources are affected
    - affectedFields: Which API fields are added/modified
    - labels: Topic labels for categorization

    Configuration is read from pipeline/llm_config.yaml. Edit that file to
    change the default provider and model settings.

    Model providers:
    - ollama: Local models via Ollama (default in config)
    - bedrock: Amazon Bedrock (requires AWS credentials)
    - anthropic: Anthropic API (requires ANTHROPIC_API_KEY)

    Requires strands-agents: uv pip install 'strands-agents[ollama]'
    """
    try:
        from .transform.kep_enricher import enrich_features, save_enriched_features

        enriched = enrich_features(
            version,
            provider=provider,  # type: ignore
            model_id=model,
            max_features=max_features,
            use_cache=use_cache,
        )

        if save and enriched:
            path = save_enriched_features(version, enriched)
            console.print(f"\n[green]✓[/green] Saved {len(enriched)} enriched features to {path}")

        # Show sample
        if enriched:
            console.print("\n[bold]Sample enriched feature:[/bold]")
            sample = next((f for f in enriched if f.get("description")), enriched[0])
            console.print(f"  KEP: {sample['kep']}")
            console.print(f"  Title: {sample['title']}")
            console.print(f"  Description: {sample.get('description', '(none)')[:100]}...")
            console.print(f"  Impact: {sample.get('impact', '(none)')[:100] if sample.get('impact') else '(none)'}...")
            console.print(f"  Labels: {sample.get('labels', [])}")
            console.print(f"  Affected Kinds: {sample.get('affectedKinds', [])}")
            console.print(f"  Affected Fields: {sample.get('affectedFields', [])[:3]}...")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[ollama]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("extract-kep-metadata")
def extract_kep_metadata_cmd(
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="Model provider (uses llm_config.yaml if not specified)"
    ),
    model: str | None = typer.Option(
        None, "--model", "-m",
        help="Specific model ID (e.g., openai.gpt-oss-120b-1:0)"
    ),
    max_keps: int | None = typer.Option(
        None, "--max", "-n",
        help="Max KEPs to process (for testing)"
    ),
    force: bool = typer.Option(
        False, "--force", "-f",
        help="Re-process all KEPs (ignore existing metadata)"
    ),
    concurrency: int = typer.Option(
        10, "--concurrency", "-c",
        help="Number of concurrent requests (default 5)"
    ),
    skip_sync: bool = typer.Option(
        False, "--skip-sync",
        help="Skip syncing the enhancements repo"
    ),
):
    """Extract metadata from ALL KEPs in the enhancements repo.

    This is a one-off command to build the central KEP metadata store.
    Run occasionally to update metadata for new KEPs.

    Extracts for each KEP:
    - summary: 2-3 sentence description
    - labels: Topic labels for categorization
    - affectedKinds: K8s resources with API changes
    - affectedFields: New API fields
    - keyConcepts: Technical concepts (NUMA, cgroups, etc.)

    Output: data/curated/keps/kep_metadata.json

    Examples:
        # Extract all KEPs (skip already processed)
        uv run k8s-pipeline extract-kep-metadata

        # Use GPT-OSS-120B for better quality
        uv run k8s-pipeline extract-kep-metadata --model openai.gpt-oss-120b-1:0

        # Test with 10 KEPs
        uv run k8s-pipeline extract-kep-metadata --max 10

        # Re-process all KEPs
        uv run k8s-pipeline extract-kep-metadata --force

        # Skip repo sync (if already up to date)
        uv run k8s-pipeline extract-kep-metadata --skip-sync
    """
    try:
        # Sync enhancements repo first
        if not skip_sync:
            from .input.repo_manager import get_repo_path, pull_repo, sync_repos

            repo_path = get_repo_path("enhancements")
            if repo_path.exists():
                console.print("[bold]Updating enhancements repo...[/bold]")
                pull_repo("enhancements")
            else:
                console.print("[bold]Cloning enhancements repo...[/bold]")
                sync_repos(["enhancements"])
            console.print()

        from .transform.kep_metadata_extractor import OUTPUT_PATH, extract_all_keps

        metadata = extract_all_keps(
            provider=provider,  # type: ignore
            model_id=model,
            max_keps=max_keps,
            skip_existing=not force,
            concurrency=concurrency,
        )

        console.print(f"\n[green]✓[/green] Metadata saved to {OUTPUT_PATH}")
        console.print(f"  Total KEPs: {len(metadata.get('keps', {}))}")

        # Show label distribution
        all_labels: dict[str, int] = {}
        for kep_data in metadata.get("keps", {}).values():
            for label in kep_data.get("labels", []):
                all_labels[label] = all_labels.get(label, 0) + 1

        if all_labels:
            console.print("\n[bold]Top labels:[/bold]")
            for label, count in sorted(all_labels.items(), key=lambda x: -x[1])[:15]:
                console.print(f"  {label}: {count}")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[ollama]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("enrich-release-notes")
def enrich_release_notes_cmd(
    version: str = typer.Argument(..., help="K8s version to enrich"),
    categories: list[str] | None = typer.Option(
        None, "--category", "-c",
        help="Categories to enrich: urgent, deprecations, api-changes (default: all)"
    ),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="Model provider: bedrock, anthropic (uses llm_config.yaml if not specified)"
    ),
    max_items: int | None = typer.Option(
        None, "--max", "-n",
        help="Max items to process per category (for testing)"
    ),
    skip_enriched: bool = typer.Option(
        True, "--skip-enriched/--no-skip",
        help="Skip items that already have enrichment"
    ),
):
    """Enrich release notes with LLM-generated structured content.

    Enriches:
    - urgent: Urgent upgrade notes → title, summary, action, severity, affected components
    - deprecations: Deprecation notices → impact, migration steps, urgency

    Examples:
        # Enrich all categories
        uv run k8s-pipeline enrich-release-notes 1.35

        # Enrich only urgent notes
        uv run k8s-pipeline enrich-release-notes 1.35 -c urgent

        # Test with 2 items per category
        uv run k8s-pipeline enrich-release-notes 1.35 --max 2
    """
    try:
        from .transform.release_notes_enricher import enrich_release_notes

        results = enrich_release_notes(
            version,
            categories=categories,
            provider=provider,
            max_items=max_items,
            skip_enriched=skip_enriched,
        )

        console.print("\n[bold]Enrichment Summary:[/bold]")
        for category, count in results.items():
            console.print(f"  {category}: {count} items enriched")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[anthropic]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-models")
def compare_models_cmd(
    version: str = typer.Argument(..., help="K8s version to use for comparison"),
    models: list[str] = typer.Argument(..., help="Model IDs to compare (e.g., qwen3:20b qwen3:120b)"),
    max_features: int = typer.Option(3, "--max", "-n", help="Number of features to compare"),
    provider: str = typer.Option("ollama", "--provider", "-p", help="Model provider to use"),
):
    """Compare enrichment output across different models.

    Runs the same KEP features through multiple models and displays
    a side-by-side comparison to help evaluate model quality.

    Example:
        uv run k8s-pipeline compare-models 1.35 qwen3:8b qwen3:32b --max 3
    """
    try:
        from .transform.kep_enricher import (
            enrich_feature_with_llm,
            get_kep_readme,
            get_provider_config,
            load_config,
        )
        from .transform.kep_parser import extract_features_for_version

        config = load_config()
        _, provider_config = get_provider_config(config, provider)

        console.print(f"\n[bold]Comparing {len(models)} models on {max_features} features[/bold]")
        console.print(f"Provider: {provider}")
        console.print(f"Models: {', '.join(models)}\n")

        # Get features
        features = extract_features_for_version(version)[:max_features]

        for _i, feature in enumerate(features):
            console.print(f"\n{'='*80}")
            console.print(f"[bold cyan]KEP {feature.kep}: {feature.title}[/bold cyan]")
            console.print(f"{'='*80}")

            readme = get_kep_readme(feature.kep_path)
            if not readme:
                console.print("[yellow]  No README found, skipping[/yellow]")
                continue

            results = {}
            for model_id in models:
                console.print(f"\n[dim]Running {model_id}...[/dim]")
                result = enrich_feature_with_llm(
                    feature, readme, provider, provider_config, model_id  # type: ignore
                )
                results[model_id] = result

            # Display comparison
            console.print("\n[bold]Description:[/bold]")
            for model_id, result in results.items():
                desc = result.description[:150] + "..." if result and len(result.description) > 150 else (result.description if result else "(failed)")
                console.print(f"  [{model_id}] {desc}")

            console.print("\n[bold]Impact:[/bold]")
            for model_id, result in results.items():
                impact = result.impact[:150] + "..." if result and len(result.impact) > 150 else (result.impact if result else "(failed)")
                console.print(f"  [{model_id}] {impact}")

            console.print("\n[bold]Affected Kinds:[/bold]")
            for model_id, result in results.items():
                kinds = result.affected_kinds if result else []
                console.print(f"  [{model_id}] {kinds}")

            console.print("\n[bold]Affected Fields:[/bold]")
            for model_id, result in results.items():
                fields = result.affected_fields[:5] if result else []
                console.print(f"  [{model_id}] {fields}")

        console.print(f"\n{'='*80}")
        console.print("[green]✓ Comparison complete[/green]")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("fetch-github-prs")
def fetch_github_prs_cmd(
    pr_numbers: list[int] = typer.Argument(None, help="PR numbers to fetch (or use --from-release)"),
    from_release: str | None = typer.Option(None, "--from-release", "-r", help="Extract PR numbers from release JSON"),
    force: bool = typer.Option(False, "--force", "-f", help="Force refresh even if cache is valid"),
    ttl: int = typer.Option(24, "--ttl", help="Cache TTL in hours"),
    show_rate_limit: bool = typer.Option(False, "--rate-limit", help="Show GitHub API rate limit status"),
    clear_cache: bool = typer.Option(False, "--clear-cache", help="Clear PR cache"),
):
    """Fetch PR details from GitHub with caching.

    Fetches PR metadata including:
    - Title, author, state
    - User-facing change (release note)
    - Related issues (Fixes #xxx)
    - Related KEPs
    - SIG labels

    Examples:
        # Fetch specific PRs
        uv run k8s-pipeline fetch-github-prs 133779 134744

        # Fetch all PRs from a release
        uv run k8s-pipeline fetch-github-prs --from-release 1.35

        # Force refresh cached PRs
        uv run k8s-pipeline fetch-github-prs 133779 --force

        # Check rate limit
        uv run k8s-pipeline fetch-github-prs --rate-limit

    Set GITHUB_TOKEN env var for higher rate limits (5000/hr vs 60/hr).
    """
    from .input.github_fetcher import GitHubFetcher

    fetcher = GitHubFetcher(ttl_hours=ttl)

    if show_rate_limit:
        status = fetcher.get_rate_limit_status()
        console.print("\n[bold]GitHub API Rate Limit:[/bold]")
        console.print(f"  Limit: {status.get('limit', '?')}")
        console.print(f"  Remaining: {status.get('remaining', '?')}")
        console.print(f"  Resets: {status.get('reset', '?')}")
        return

    if clear_cache:
        count = fetcher.clear_cache("prs")
        console.print(f"[green]✓ Cleared {count} cached PRs[/green]")
        return

    # Get PR numbers
    prs_to_fetch = list(pr_numbers) if pr_numbers else []

    if from_release:
        # Load release JSON and extract PR numbers
        release_path = OUTPUT_DIR / "releases" / f"{from_release}.json"
        if not release_path.exists():
            console.print(f"[red]Release file not found: {release_path}[/red]")
            raise typer.Exit(1)

        import json
        with open(release_path) as f:
            release_data = json.load(f)

        # Extract PR numbers from changes
        for change in release_data.get("changes", []):
            if pr_num := change.get("prNumber"):
                if pr_num not in prs_to_fetch:
                    prs_to_fetch.append(pr_num)

        # Also from action required notes
        for note in release_data.get("actionRequired", []):
            if pr_num := note.get("prNumber"):
                if pr_num not in prs_to_fetch:
                    prs_to_fetch.append(pr_num)

        console.print(f"[dim]Found {len(prs_to_fetch)} PRs in release {from_release}[/dim]")

    if not prs_to_fetch:
        console.print("[yellow]No PR numbers specified. Use positional args or --from-release[/yellow]")
        raise typer.Exit(1)

    console.print(f"\n[bold]Fetching {len(prs_to_fetch)} PRs...[/bold]")

    results = fetcher.fetch_prs(prs_to_fetch, force=force)

    # Show results
    console.print("\n[bold]Results:[/bold]")
    for _pr_num, pr in sorted(results.items()):
        console.print(f"\n[cyan]PR #{pr.number}[/cyan]: {pr.title[:60]}...")
        console.print(f"  Author: @{pr.author}")
        console.print(f"  Kind: {pr.pr_kind or '(none)'}")
        if pr.related_issues:
            console.print(f"  Fixes: {', '.join(f'#{i}' for i in pr.related_issues)}")
        if pr.related_keps:
            console.print(f"  KEPs: {', '.join(pr.related_keps)}")
        if pr.user_facing_change:
            note = pr.user_facing_change[:100] + "..." if len(pr.user_facing_change) > 100 else pr.user_facing_change
            console.print(f"  Release note: {note}")

    console.print(f"\n[green]✓ Fetched {len(results)} PRs[/green]")


@app.command("enrich-changes")
def enrich_changes_cmd(
    version: str = typer.Argument(..., help="K8s version to enrich"),
    kind: str | None = typer.Option(None, "--kind", "-k", help="Specific change kind: bugOrRegression, feature, apiChange, etc."),
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider: ollama, bedrock, anthropic"),
    model: str | None = typer.Option(None, "--model", "-m", help="Specific model ID"),
    max_changes: int | None = typer.Option(None, "--max", "-n", help="Max changes to process (for testing)"),
    only_with_issues: bool = typer.Option(False, "--with-issues", "-i", help="Only enrich changes that have linked issues"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-enrich changes that already have enrichment"),
    skip_patches: bool = typer.Option(False, "--skip-patches", help="Skip patch release changes (only enrich main release)"),
    concurrency: int = typer.Option(1, "--concurrency", "-c", help="Number of concurrent requests (default: 1)"),
    batch: bool = typer.Option(False, "--batch", "-b", help="Process in batches with progress saving"),
    batch_size: int = typer.Option(5, "--batch-size", help="Batch size when using --batch"),
):
    """Enrich release changes with LLM-generated context from PR and Issue data.

    Transforms dry release notes into rich, useful descriptions that answer:
    - What was the problem?
    - Who was affected?
    - What's the fix?
    - Why does it matter?

    The enrichment uses PR bodies and linked GitHub issues to generate context.
    Run 'build-release --with-prs' first to fetch PR/issue data.

    By default, enriches both main release and patch release changes.

    Examples:
        # Enrich all bug fixes for 1.35
        uv run k8s-pipeline enrich-changes 1.35 --kind bugOrRegression

        # Test with 5 changes that have linked issues
        uv run k8s-pipeline enrich-changes 1.35 --max 5 --with-issues

        # Only enrich main release (skip patch releases)
        uv run k8s-pipeline enrich-changes 1.35 --skip-patches

        # Batch process with progress saving
        uv run k8s-pipeline enrich-changes 1.35 --batch --batch-size 10

    Configuration is read from pipeline/llm_config.yaml.
    Requires strands-agents: uv pip install 'strands-agents[anthropic]'
    """
    try:
        from .transform.change_enricher import enrich_changes, enrich_changes_batch

        if batch:
            results = enrich_changes_batch(
                version,
                kind=kind,
                provider=provider,  # type: ignore
                model_id=model,
                batch_size=batch_size,
                only_with_issues=only_with_issues,
            )
        else:
            results = enrich_changes(
                version,
                kind=kind,
                provider=provider,  # type: ignore
                model_id=model,
                max_changes=max_changes,
                only_with_issues=only_with_issues,
                skip_enriched=not force,
                include_patches=not skip_patches,
                concurrency=concurrency,
            )

        # Show sample enriched change
        if results:
            for _change_kind, changes in results.items():
                for change in changes:
                    if enrichment := change.get("enrichment"):
                        console.print("\n[bold]Sample enriched change:[/bold]")
                        console.print(f"  PR: #{change.get('prNumber', '?')}")
                        console.print(f"  Original: {change.get('description', '')[:80]}...")
                        console.print(f"\n  [cyan]Problem:[/cyan] {enrichment['problem'][:100]}...")
                        console.print(f"  [cyan]Affected:[/cyan] {enrichment['affected'][:100]}...")
                        console.print(f"  [cyan]Fix:[/cyan] {enrichment['fix'][:100]}...")
                        console.print(f"  [cyan]Impact:[/cyan] {enrichment['impact'][:100]}...")
                        console.print(f"  [cyan]Category:[/cyan] {enrichment['category']}")
                        console.print(f"  [cyan]Severity:[/cyan] {enrichment['severity']}")
                        console.print(f"  [cyan]Components:[/cyan] {enrichment['affectedComponents']}")
                        console.print(f"  [cyan]Labels:[/cyan] {enrichment.get('labels', [])}")
                        break
                else:
                    continue
                break

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  uv pip install 'strands-agents[anthropic]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("add-content")
def add_content_cmd(
    url: str = typer.Argument(..., help="Content URL"),
    title: str = typer.Argument(..., help="Content title"),
    content_type: str = typer.Argument(..., help="Type: blog, documentation, video, tutorial, announcement, reference, deep-dive"),
    source: str = typer.Argument(..., help="Source domain (e.g., kubernetes.io, medium.com)"),
    official: bool = typer.Option(False, "--official", "-o", help="Mark as official K8s content"),
    date: str | None = typer.Option(None, "--date", "-d", help="Published date (YYYY-MM-DD)"),
    author: str | None = typer.Option(None, "--author", "-a", help="Author name"),
    summary: str | None = typer.Option(None, "--summary", "-s", help="Brief summary"),
    tags: str | None = typer.Option(None, "--tags", "-t", help="Comma-separated tags"),
    release: str | None = typer.Option(None, "--release", "-r", help="Link to release (e.g., 1.35)"),
    kep: str | None = typer.Option(None, "--kep", "-k", help="Link to KEP (e.g., KEP-4017)"),
    kind: str | None = typer.Option(None, "--kind", help="Link to Kind (e.g., Pod)"),
    kind_group: str | None = typer.Option(None, "--kind-group", help="Kind's API group (e.g., core, apps)"),
):
    """
    Add external content (blog post, documentation, video, etc.) with links.

    Content can be linked to releases, KEPs, and/or Kinds.

    Examples:
        # Add official release announcement
        uv run k8s-pipeline add-content \\
            "https://kubernetes.io/blog/2025/12/17/kubernetes-v1-35-release/" \\
            "Kubernetes v1.35: Timbernetes" blog kubernetes.io \\
            --official --date 2025-12-17 --release 1.35

        # Add KEP blog post linked to KEP and release
        uv run k8s-pipeline add-content \\
            "https://kubernetes.io/blog/2025/12/18/job-managedby-goes-ga/" \\
            "Job ManagedBy Goes GA" blog kubernetes.io \\
            --official --date 2025-12-18 --kep KEP-4017 --release 1.35

        # Add Kind documentation
        uv run k8s-pipeline add-content \\
            "https://kubernetes.io/docs/concepts/workloads/pods/" \\
            "Pods" documentation kubernetes.io \\
            --official --kind Pod --kind-group core
    """
    from .transform.content_links import add_content

    # Build links list
    links = []
    if release:
        links.append({"targetType": "release", "targetId": release})
    if kep:
        links.append({"targetType": "kep", "targetId": kep})
    if kind:
        link = {"targetType": "kind", "targetId": kind}
        if kind_group:
            link["targetGroup"] = kind_group
        links.append(link)

    if not links:
        console.print("[yellow]Warning: No links specified. Content will be added without links.[/yellow]")

    tag_list = [t.strip() for t in tags.split(",")] if tags else None

    add_content(
        url=url,
        title=title,
        content_type=content_type,  # type: ignore
        source=source,
        links=links,
        is_official=official,
        published_date=date,
        author=author,
        summary=summary,
        tags=tag_list,
    )

    console.print(f"[green]✓ Added content: {title}[/green]")
    console.print(f"  Links: {len(links)} target(s)")
    console.print("\n[yellow]Run 'uv run k8s-pipeline export-parquet' to update the UI data[/yellow]")


@app.command("list-content")
def list_content_cmd(
    show_files: bool = typer.Option(False, "--files", "-f", help="Show content files breakdown"),
):
    """List all curated content links."""
    from .transform.content_links import list_content_files, load_all_content

    if show_files:
        list_content_files()
        return

    data = load_all_content()  # Load from all files
    content_list = data.get("content", [])

    if not content_list:
        console.print("[dim]No content found[/dim]")
        return

    table = Table(title=f"Content Links ({len(content_list)} items)")
    table.add_column("Type", style="cyan", width=12)
    table.add_column("Official", style="green", width=8)
    table.add_column("Title", width=40)
    table.add_column("Source", width=15)
    table.add_column("Links", width=30)

    for content in content_list:
        official = "✓" if content.get("isOfficial") else ""

        # Format links
        link_strs = []
        for link in content.get("links", []):
            target = f"{link['targetType']}:{link['targetId']}"
            if link.get("targetGroup"):
                target += f"@{link['targetGroup']}"
            link_strs.append(target)
        links_str = ", ".join(link_strs) if link_strs else "-"

        table.add_row(
            content.get("type", ""),
            official,
            content.get("title", "")[:40],
            content.get("source", ""),
            links_str,
        )

    console.print(table)


@app.command("split-content")
def split_content_cmd():
    """Split content_links.json into separate files by conference.

    Moves conference content (items with kubecon-* labels) to separate files:
    - content_links_kubecon_na_2024.json
    - content_links_kubecon_eu_2024.json
    - etc.

    Non-conference content stays in content_links.json.
    """
    from .transform.content_links import list_content_files, split_content_by_conference

    console.print("\n[bold]Splitting content by conference...[/bold]\n")
    results = split_content_by_conference()

    if results:
        console.print("\n[bold]Results:[/bold]")
        for conf_id, count in results.items():
            console.print(f"  {conf_id}: {count} items")
    else:
        console.print("[dim]No conference content found to split[/dim]")

    console.print("\n[bold]Content files:[/bold]")
    list_content_files()


@app.command("process-release")
def process_release_cmd(
    version: str = typer.Argument(..., help="K8s version to process (e.g., 1.35)"),
    enrich: bool = typer.Option(True, "--enrich/--no-enrich", "-e", help="Run LLM enrichment for features, changes, and release notes (default: yes)"),
    skip_stage: bool = typer.Option(False, "--skip-stage", help="Skip staging (use existing staged data)"),
    skip_fetch: bool = typer.Option(False, "--skip-fetch", help="Skip OpenAPI fetch (use existing)"),
    skip_parquet: bool = typer.Option(False, "--skip-parquet", help="Skip Parquet export"),
    skip_sync: bool = typer.Option(False, "--skip-sync", help="Skip syncing/pulling upstream repos"),
    force: bool = typer.Option(False, "--force", "-f", help="Force rebuild even if files exist"),
):
    """Run the complete pipeline for a single release.

    This command runs all pipeline steps in order:
    0. Sync upstream repos (kubernetes, enhancements, website) - pulls latest
    1. Stage upstream data (release-notes.json + CHANGELOG)
    2. Build release JSON with PR data
    3. Enrich KEP features with LLM
    4. Enrich changelog entries with LLM
    5. Enrich release notes with LLM - urgent notes, deprecations, API changes
    6. Fetch/parse OpenAPI specs
    7. Generate diffs between versions
    8. Link fields to KEPs
    9. Extract component flags (kube-apiserver, kubelet, etc.)
    10. Extract kubectl commands
    11. Extract feature gates
    12. Export to Parquet

    Use --no-enrich to skip LLM enrichment steps (faster, no API costs).
    Use --skip-sync to skip pulling upstream repos (if you know they're up to date).

    Examples:
        # Full processing with LLM enrichment (default)
        uv run k8s-pipeline process-release 1.35

        # Skip LLM enrichment (faster)
        uv run k8s-pipeline process-release 1.35 --no-enrich

        # Re-process without re-staging or syncing repos
        uv run k8s-pipeline process-release 1.35 --skip-stage --skip-sync --force

        # Quick rebuild (skip network operations)
        uv run k8s-pipeline process-release 1.35 --skip-stage --skip-fetch --skip-sync --force
    """
    import time

    start_time = time.time()

    console.print(f"\n[bold]{'=' * 60}[/bold]")
    console.print(f"[bold]Processing Kubernetes {version}[/bold]")
    console.print(f"[bold]{'=' * 60}[/bold]")
    console.print(f"  Enrich: {'Yes' if enrich else 'No'}")
    console.print(f"  Force: {'Yes' if force else 'No'}")
    console.print(f"  Sync repos: {'No (--skip-sync)' if skip_sync else 'Yes'}")

    if enrich:
        console.print()
        console.print("[yellow]⚠ LLM enrichment enabled - this will make API calls to your configured provider.[/yellow]")
        console.print("[dim]  Use --no-enrich to skip enrichment and avoid API costs.[/dim]")

    console.print()

    steps_completed = []

    try:
        # Step 0: Sync upstream repos
        if not skip_sync:
            console.print("\n[bold cyan][0/12] Syncing upstream repositories...[/bold cyan]")
            # Required repos for full pipeline
            required_repos = ["kubernetes", "enhancements", "website"]
            for repo_name in required_repos:
                repo_path = get_repo_path(repo_name)
                if repo_path.exists():
                    from .input.repo_manager import get_current_ref, pull_repo
                    console.print(f"  Pulling {repo_name}...")
                    pull_repo(repo_name)
                    ref = get_current_ref(repo_name)
                    console.print(f"    [dim]Current ref: {ref}[/dim]")
                else:
                    console.print(f"  Cloning {repo_name}...")
                    sync_repos([repo_name])
            steps_completed.append("sync-repos")
        else:
            console.print("\n[dim][0/12] Skipping repo sync (--skip-sync)[/dim]")

        # Step 1: Stage upstream data
        if not skip_stage:
            console.print("\n[bold cyan][1/12] Staging upstream data...[/bold cyan]")
            stage_release(version, force=force)
            steps_completed.append("stage")
        else:
            console.print("\n[dim][1/12] Skipping stage (--skip-stage)[/dim]")

        # Step 2: Build release JSON with PR data
        console.print("\n[bold cyan][2/12] Building release JSON with PR data...[/bold cyan]")
        build_release(version, force=force, with_prs=True)
        build_release_index()
        steps_completed.append("build")

        # Step 3: Enrich KEP features (optional)
        if enrich:
            console.print("\n[bold cyan][3/12] Enriching KEP features with LLM...[/bold cyan]")
            try:
                from .transform.kep_enricher import enrich_features, save_enriched_features
                enriched = enrich_features(version)
                if enriched:
                    save_enriched_features(version, enriched)
                    console.print(f"  [green]✓ Enriched {len(enriched)} features[/green]")
                steps_completed.append("enrich-features")
            except ImportError:
                console.print("  [yellow]⚠ strands-agents not installed, skipping[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Feature enrichment failed: {e}[/yellow]")
        else:
            console.print("\n[dim][3/12] Skipping feature enrichment (--no-enrich)[/dim]")

        # Step 4: Enrich changelog entries (optional)
        if enrich:
            console.print("\n[bold cyan][4/12] Enriching changelog entries with LLM...[/bold cyan]")
            try:
                from .transform.change_enricher import enrich_changes
                enrich_changes(version)
                steps_completed.append("enrich-changes")
            except ImportError:
                console.print("  [yellow]⚠ strands-agents not installed, skipping[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Change enrichment failed: {e}[/yellow]")
        else:
            console.print("\n[dim][4/12] Skipping change enrichment (--no-enrich)[/dim]")

        # Step 5: Enrich release notes (optional) - urgent notes, deprecations, API changes
        if enrich:
            console.print("\n[bold cyan][5/12] Enriching release notes with LLM...[/bold cyan]")
            try:
                from .transform.release_notes_enricher import enrich_release_notes
                results = enrich_release_notes(version)
                total = sum(results.values())
                console.print(f"  [green]✓ Enriched {total} release note items[/green]")
                steps_completed.append("enrich-release-notes")
            except ImportError:
                console.print("  [yellow]⚠ strands-agents not installed, skipping[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Release notes enrichment failed: {e}[/yellow]")
        else:
            console.print("\n[dim][5/12] Skipping release notes enrichment (--no-enrich)[/dim]")

        # Step 6: Fetch/parse OpenAPI specs
        if not skip_fetch:
            console.print("\n[bold cyan][6/12] Fetching/parsing OpenAPI specs...[/bold cyan]")
            spec = load_openapi_spec(version, use_cache=not force)
            tree = parse_openapi_spec(spec, version)
            write_api_tree(tree)
            schemas = parse_all_schemas(spec, version)
            write_schemas_file(version, schemas)
            if get_repo_path("kubernetes").exists():
                reset_to_default_branch("kubernetes")
            # Update versions.json with all trees
            all_trees = []
            for ver in K8S_VERSIONS:
                try:
                    s = load_openapi_spec(ver, use_cache=True)
                    t = parse_openapi_spec(s, ver)
                    all_trees.append(t)
                except Exception:
                    pass
            if all_trees:
                write_versions_file(all_trees)
            steps_completed.append("fetch")
        else:
            console.print("\n[dim][6/12] Skipping OpenAPI fetch (--skip-fetch)[/dim]")

        # Step 7: Generate diffs
        console.print("\n[bold cyan][7/12] Generating version diffs...[/bold cyan]")
        versions = sorted(K8S_VERSIONS, key=lambda v: [int(x) for x in v.split(".")])
        diffs_generated = 0
        for i in range(len(versions) - 1):
            v_from, v_to = versions[i], versions[i + 1]
            try:
                d = compute_diff(v_from, v_to)
                write_diff(d)
                diffs_generated += 1
            except Exception:
                pass
        console.print(f"  [green]✓ Generated {diffs_generated} diffs[/green]")
        # Also compute history
        history = compute_field_history(versions)
        write_field_history(history)
        kind_history = compute_kind_history(versions)
        write_kind_history(kind_history)
        steps_completed.append("diff")

        # Step 8: Link fields to KEPs
        console.print("\n[bold cyan][8/12] Linking fields to KEPs...[/bold cyan]")
        results = link_all_versions()
        total_linked = sum(len(r.links) for r in results.values())
        console.print(f"  [green]✓ Linked {total_linked} fields to KEPs[/green]")
        steps_completed.append("link-keps")

        # Step 9: Extract component flags
        console.print("\n[bold cyan][9/12] Extracting component flags...[/bold cyan]")
        try:
            from .transform.component_extractor import update_curated_components
            update_curated_components(version)
            console.print(f"  [green]✓ Extracted component flags for {version}[/green]")
            steps_completed.append("extract-components")
        except Exception as e:
            console.print(f"  [yellow]⚠ Component extraction failed: {e}[/yellow]")

        # Step 10: Extract kubectl commands
        console.print("\n[bold cyan][10/12] Extracting kubectl commands...[/bold cyan]")
        try:
            from .transform.kubectl_extractor import extract_and_save_kubectl
            extract_and_save_kubectl(version)
            console.print(f"  [green]✓ Extracted kubectl commands for {version}[/green]")
            steps_completed.append("extract-kubectl")
        except Exception as e:
            console.print(f"  [yellow]⚠ kubectl extraction failed: {e}[/yellow]")

        # Step 11: Extract feature gates
        console.print("\n[bold cyan][11/12] Extracting feature gates...[/bold cyan]")
        try:
            from .transform.feature_gate_extractor import extract_and_save_feature_gates
            extract_and_save_feature_gates(version)
            console.print(f"  [green]✓ Extracted feature gates for {version}[/green]")
            steps_completed.append("extract-feature-gates")
        except Exception as e:
            console.print(f"  [yellow]⚠ Feature gate extraction failed: {e}[/yellow]")

        # Step 12: Export to Parquet
        if not skip_parquet:
            console.print("\n[bold cyan][12/12] Exporting to Parquet...[/bold cyan]")
            export_to_parquet()
            steps_completed.append("parquet")
        else:
            console.print("\n[dim][12/12] Skipping Parquet export (--skip-parquet)[/dim]")

        # Summary
        elapsed = time.time() - start_time
        console.print(f"\n[bold]{'=' * 60}[/bold]")
        console.print(f"[bold green]✓ Successfully processed Kubernetes {version}[/bold green]")
        console.print(f"[bold]{'=' * 60}[/bold]")
        console.print(f"  Steps completed: {', '.join(steps_completed)}")
        console.print(f"  Time elapsed: {elapsed:.1f}s")
        console.print()
        console.print("[dim]To build the UI, run:[/dim]")
        console.print("  cd packages/web && bun run build:single")

    except Exception as e:
        console.print(f"\n[red]Error during processing: {e}[/red]")
        import traceback
        traceback.print_exc()
        console.print(f"\n[yellow]Steps completed before error: {', '.join(steps_completed)}[/yellow]")
        raise typer.Exit(1)


# ============================================================================
# Conference Content Commands
# ============================================================================


@app.command("list-conference-content")
def list_conference_content_cmd(
    conference: str | None = typer.Option(None, "--conference", "-c", help="Filter by conference ID"),
    topic: str | None = typer.Option(None, "--topic", "-t", help="Filter by topic label"),
):
    """List conference content (KubeCon talks, etc.)."""
    from .transform.conference_ingest import get_talks_by_topic, list_conference_content

    if topic:
        content = get_talks_by_topic(topic)
        console.print(f"\n[bold]Conference talks about '{topic}':[/bold]\n")
    else:
        content = list_conference_content(conference)
        title = "Conference content" + (f" for {conference}" if conference else "")
        console.print(f"\n[bold]{title}:[/bold]\n")

    if not content:
        console.print("[dim]No content found[/dim]")
        return

    table = Table()
    table.add_column("Title", style="cyan", max_width=50)
    table.add_column("Conference", style="green")
    table.add_column("Type")
    table.add_column("Labels", style="dim", max_width=30)

    for item in content:
        labels = item.get("labels", [])
        conf = next((lbl for lbl in labels if lbl.startswith("kubecon")), "-")
        session_type = next((lbl for lbl in labels if lbl in ["keynote", "deep-dive", "tutorial", "lightning-talk", "bof"]), "talk")
        other_labels = [lbl for lbl in labels if not lbl.startswith("kubecon") and lbl not in ["keynote", "deep-dive", "tutorial", "lightning-talk", "bof"]]

        table.add_row(
            item["title"][:50],
            conf,
            session_type,
            ", ".join(other_labels[:5]),
        )

    console.print(table)
    console.print(f"\n[dim]Total: {len(content)} items[/dim]")


@app.command("add-conference-talk")
def add_conference_talk_cmd(
    conference: str = typer.Argument(..., help="Conference ID (e.g., kubecon-na-2024)"),
    title: str = typer.Argument(..., help="Talk title"),
    speakers: str = typer.Argument(..., help="Speaker names (comma-separated)"),
    video_url: str | None = typer.Option(None, "--video", "-v", help="YouTube video URL"),
    labels: str | None = typer.Option(None, "--labels", "-l", help="Topic labels (comma-separated)"),
    keps: str | None = typer.Option(None, "--keps", "-k", help="Related KEPs (comma-separated, e.g., KEP-4381,KEP-1287)"),
    session_type: str | None = typer.Option(None, "--type", "-t", help="Session type: keynote, deep-dive, tutorial, lightning-talk, bof"),
):
    """Add a conference talk to content_links.

    Example:
        uv run k8s-pipeline add-conference-talk kubecon-na-2024 \\
            "DRA is GA!" "Kevin Klues, Patrick Ohly" \\
            --video "https://youtube.com/watch?v=..." \\
            --labels "dra,gpu,scheduling" \\
            --keps "KEP-4381"
    """
    from .transform.conference_ingest import CONFERENCES, add_conference_talk

    if conference not in CONFERENCES:
        console.print(f"[yellow]Warning: Unknown conference '{conference}'[/yellow]")
        console.print(f"[dim]Known conferences: {', '.join(CONFERENCES.keys())}[/dim]")

    speaker_list = [s.strip() for s in speakers.split(",")]
    label_list = [lbl.strip() for lbl in labels.split(",")] if labels else []
    kep_list = [k.strip() for k in keps.split(",")] if keps else []

    add_conference_talk(
        conference=conference,
        title=title,
        speakers=speaker_list,
        video_url=video_url,
        labels=label_list,
        kep_links=kep_list,
        session_type=session_type,  # type: ignore
    )

    console.print(f"[green]✓[/green] Added talk: {title}")


@app.command("import-conference-talks")
def import_conference_talks_cmd(
    json_file: str = typer.Argument(..., help="Path to JSON file with talks"),
):
    """Import conference talks from a JSON file.

    Expected format:
    {
      "talks": [
        {
          "conference": "kubecon-na-2024",
          "title": "...",
          "speakers": ["..."],
          "video_url": "...",
          "labels": ["..."],
          "kep_links": ["KEP-..."]
        }
      ]
    }
    """
    from .transform.conference_ingest import import_from_json

    try:
        count = import_from_json(json_file)
        console.print(f"[green]✓[/green] Imported {count} talks from {json_file}")
    except FileNotFoundError:
        console.print(f"[red]Error: File not found: {json_file}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("tui")
def tui_cmd():
    """Launch the interactive TUI for pipeline management.

    The TUI provides a visual interface for:
    - Viewing pipeline status
    - Selecting versions
    - Running commands with live output
    - Quick access to common workflows

    Keyboard shortcuts:
    - q: Quit
    - r: Refresh status
    - c: Clear log
    - 1-4: Switch tabs (Stage, Build, Enrich, Export)
    """
    from .tui import main
    main()


@app.command("suggest-labels")
def suggest_labels_cmd(
    kep: str = typer.Argument(..., help="KEP identifier (e.g., KEP-2837) or title text"),
    method: str = typer.Option(
        "both", "--method", "-m",
        help="Method: embedding, llm, or both"
    ),
    top_k: int = typer.Option(5, "--top", "-k", help="Number of labels to suggest"),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="LLM provider for 'llm' method (uses llm_config.yaml if not specified)"
    ),
):
    """Suggest labels for a KEP using embeddings and/or LLM.

    Uses a curated taxonomy of K8s-specific labels and suggests the most
    relevant ones based on the KEP title and summary.

    Methods:
    - embedding: Fast, local, uses sentence-transformers (requires: pip install sentence-transformers)
    - llm: More accurate, uses LLM with taxonomy context
    - both: Compare both methods side-by-side

    Examples:
        # Suggest labels for a KEP by ID
        uv run k8s-pipeline suggest-labels KEP-2837

        # Use only embeddings (fast, local)
        uv run k8s-pipeline suggest-labels KEP-2837 --method embedding

        # Use only LLM
        uv run k8s-pipeline suggest-labels KEP-2837 --method llm

        # Suggest labels for arbitrary text
        uv run k8s-pipeline suggest-labels "Pod Level Resource Specifications"
    """
    from .transform.kep_parser import scan_all_keps

    # Check if it's a KEP ID or raw text
    title = kep
    summary = None
    kep_id = kep

    if kep.upper().startswith("KEP-"):
        # Look up the KEP
        kep_num = kep.upper().replace("KEP-", "")
        all_keps = scan_all_keps()
        found = next((k for k in all_keps if str(k.kep_number) == kep_num), None)

        if found:
            title = found.title
            kep_id = f"KEP-{found.kep_number}"
            console.print(f"\n[bold]{kep_id}: {title}[/bold]\n")

            # Try to get summary from README
            from .transform.kep_enricher import get_kep_readme
            readme = get_kep_readme(found.kep_path)
            if readme:
                # Extract first paragraph after ## Summary
                import re
                match = re.search(r'## Summary\s*\n+(.+?)(?=\n##|\n\n\n|\Z)', readme, re.DOTALL)
                if match:
                    summary = match.group(1).strip()[:500]
        else:
            console.print(f"[yellow]KEP {kep} not found in enhancements repo, using as text[/yellow]\n")

    try:
        if method == "embedding":
            from .transform.label_suggester import suggest_labels_embedding

            text = f"{title}. {summary}" if summary else title
            labels = suggest_labels_embedding(text, top_k=top_k)

            console.print("[bold]Embedding Labels:[/bold]")
            for s in labels:
                console.print(f"  {s.label:25} {s.score:.3f}")

        elif method == "llm":
            from .transform.label_suggester import suggest_labels_llm

            labels = suggest_labels_llm(title, summary, top_k=top_k, provider=provider)

            console.print("[bold]LLM Labels:[/bold]")
            for s in labels:
                reason = f" - {s.reason}" if s.reason else ""
                console.print(f"  {s.label:25} {s.score:.3f}{reason}")

        else:  # both
            from .transform.label_suggester import compare_labelers, print_comparison

            comp = compare_labelers(kep_id, title, summary, top_k=top_k, provider=provider)
            print_comparison(comp)

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        if "sentence-transformers" in str(e):
            console.print("\n[yellow]Install sentence-transformers:[/yellow]")
            console.print("  pip install sentence-transformers")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("label-features")
def label_features_cmd(
    version: str = typer.Argument(..., help="K8s version (e.g., 1.35)"),
    method: str = typer.Option(
        "embedding", "--method", "-m",
        help="Method: embedding (fast, local) or llm (more accurate)"
    ),
    top_k: int = typer.Option(3, "--top", "-k", help="Number of labels per feature"),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="LLM provider for 'llm' method"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-n",
        help="Show labels without saving to release JSON"
    ),
):
    """Add labels to all features in a release.

    Uses the label suggester to automatically assign labels to each KEP feature
    in the release JSON. Labels are stored in the 'labels' field of each feature.

    Examples:
        # Label features using embeddings (fast)
        uv run k8s-pipeline label-features 1.35

        # Label features using LLM (more accurate)
        uv run k8s-pipeline label-features 1.35 --method llm

        # Preview labels without saving
        uv run k8s-pipeline label-features 1.35 --dry-run
    """
    import json
    import re

    from .transform.kep_enricher import get_kep_readme
    from .transform.label_suggester import suggest_labels_embedding, suggest_labels_llm

    release_path = OUTPUT_DIR / "releases" / f"{version}.json"
    if not release_path.exists():
        console.print(f"[red]Release file not found: {release_path}[/red]")
        console.print("[yellow]Run 'build-release' first[/yellow]")
        raise typer.Exit(1)

    with open(release_path) as f:
        release_data = json.load(f)

    features = release_data.get("features", [])
    if not features:
        console.print(f"[yellow]No features found in {version}[/yellow]")
        raise typer.Exit(0)

    console.print(f"\n[bold]Labeling {len(features)} features in {version}[/bold]")
    console.print(f"Method: {method}, Top-K: {top_k}\n")

    labeled_count = 0
    for i, feature in enumerate(features, 1):
        kep = feature.get("kep", "")
        title = feature.get("title", "")
        kep_path = feature.get("kepPath", "")

        # Get summary from README if available
        summary = None
        if kep_path:
            readme = get_kep_readme(kep_path)
            if readme:
                match = re.search(r'## Summary\s*\n+(.+?)(?=\n##|\n\n\n|\Z)', readme, re.DOTALL)
                if match:
                    summary = match.group(1).strip()[:500]

        # Get labels
        try:
            if method == "embedding":
                text = f"{title}. {summary}" if summary else title
                suggestions = suggest_labels_embedding(text, top_k=top_k, min_score=0.30)
            else:
                suggestions = suggest_labels_llm(title, summary, top_k=top_k, provider=provider)

            labels = [s.label for s in suggestions]
            feature["labels"] = labels
            labeled_count += 1

            # Show progress
            label_str = ", ".join(labels) if labels else "(none)"
            console.print(f"  [{i}/{len(features)}] {kep}: {label_str}")

        except Exception as e:
            console.print(f"  [{i}/{len(features)}] {kep}: [red]Error: {e}[/red]")

    console.print(f"\n[green]✓[/green] Labeled {labeled_count}/{len(features)} features")

    if dry_run:
        console.print("[yellow]Dry run - not saving changes[/yellow]")
    else:
        with open(release_path, "w") as f:
            json.dump(release_data, f, indent=2)
        console.print(f"[green]✓[/green] Saved to {release_path}")

        # Also update enriched file if it exists
        enriched_path = OUTPUT_DIR / "releases" / f"{version}-enriched.json"
        if enriched_path.exists():
            with open(enriched_path) as f:
                enriched_data = json.load(f)

            # Update labels in enriched data
            enriched_by_kep = {f["kep"]: f for f in enriched_data}
            for feature in features:
                kep = feature.get("kep", "")
                if kep in enriched_by_kep:
                    enriched_by_kep[kep]["labels"] = feature.get("labels", [])

            with open(enriched_path, "w") as f:
                json.dump(enriched_data, f, indent=2)
            console.print(f"[green]✓[/green] Updated enriched file: {enriched_path}")


@app.command("list-labels")
def list_labels_cmd():
    """List all labels in the curated taxonomy."""
    from .transform.label_suggester import load_taxonomy

    taxonomy = load_taxonomy()
    categories = taxonomy.get("categories", {})

    console.print(f"\n[bold]Label Taxonomy ({len(categories)} labels)[/bold]\n")

    table = Table()
    table.add_column("Label", style="cyan")
    table.add_column("Description")
    table.add_column("Related Terms", style="dim")

    for label, info in sorted(categories.items()):
        desc = info.get("description", "")[:50]
        terms = ", ".join(info.get("related_terms", [])[:4])
        table.add_row(label, desc, terms)

    console.print(table)


@app.command("build-taxonomy")
def build_taxonomy_cmd(
    method: str = typer.Option(
        "tfidf", "--method", "-m",
        help="Method: tfidf (show terms), llm (build with LLM), refine (clean up existing)"
    ),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="LLM provider for 'llm' method"
    ),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output file (default: label_taxonomy_v2.json)"
    ),
    top_n: int = typer.Option(100, "--top", "-n", help="Number of terms to extract"),
    input_file: Path | None = typer.Option(
        None, "--input", "-i",
        help="Input taxonomy file for 'refine' method"
    ),
):
    """Build a data-driven label taxonomy from KEP titles and summaries.

    Methods:
    - tfidf: Extract and display top terms using TF-IDF (no LLM)
    - llm: Use LLM to build a refined taxonomy from extracted terms
    - refine: Clean up an existing taxonomy (dedupe, remove noise)

    Examples:
        # Show top terms extracted from KEPs
        uv run k8s-pipeline build-taxonomy --method tfidf

        # Build taxonomy with LLM
        uv run k8s-pipeline build-taxonomy --method llm

        # Refine existing taxonomy
        uv run k8s-pipeline build-taxonomy --method refine -i data/curated/keps/label_taxonomy_v2.json

        # Save to custom file
        uv run k8s-pipeline build-taxonomy --method llm -o my_taxonomy.json
    """
    try:
        from .transform.taxonomy_builder import (
            build_taxonomy_with_llm,
            extract_key_terms,
            load_all_kep_texts,
            refine_taxonomy_with_llm,
            save_taxonomy,
        )

        if method == "tfidf":
            console.print("\n[bold]Loading KEPs...[/bold]")
            keps = load_all_kep_texts()
            console.print(f"Loaded {len(keps)} KEPs\n")

            console.print("[bold]Extracting key terms (TF-IDF)...[/bold]\n")
            terms = extract_key_terms(top_n=top_n)

            table = Table(title=f"Top {len(terms)} Terms by TF-IDF Score")
            table.add_column("#", style="dim")
            table.add_column("Term", style="cyan")
            table.add_column("Score", justify="right")

            for i, (term, score) in enumerate(terms, 1):
                table.add_row(str(i), term, f"{score:.2f}")

            console.print(table)
            console.print("\n[dim]These terms can be used to build a taxonomy with --method llm[/dim]")

        elif method == "llm":
            console.print("\n[bold]Building taxonomy with LLM...[/bold]")
            taxonomy = build_taxonomy_with_llm(provider=provider)

            categories = taxonomy.get("categories", {})
            console.print(f"\n[green]✓[/green] Generated {len(categories)} categories:\n")

            for name, info in categories.items():
                desc = info.get("description", "")[:60]
                terms = info.get("related_terms", [])[:5]
                console.print(f"  [cyan]{name}[/cyan]: {desc}")
                console.print(f"    Terms: {', '.join(terms)}")

            # Save
            from ..core.config import CURATED_KEPS_DIR
            default_output = CURATED_KEPS_DIR / "label_taxonomy_v2.json"
            output_path = output or default_output
            save_taxonomy(taxonomy, output_path)
            console.print(f"\n[green]✓[/green] Saved to {output_path}")

        elif method == "refine":
            import json

            # Load input taxonomy
            from ..core.config import CURATED_KEPS_DIR
            input_path = input_file or (CURATED_KEPS_DIR / "label_taxonomy_v2.json")
            if not input_path.exists():
                console.print(f"[red]Input file not found: {input_path}[/red]")
                console.print("[yellow]Specify input with --input or run --method llm first[/yellow]")
                raise typer.Exit(1)

            console.print(f"\n[bold]Refining taxonomy from {input_path}...[/bold]")

            with open(input_path) as f:
                taxonomy = json.load(f)

            categories = taxonomy.get("categories", {})
            console.print(f"Input: {len(categories)} categories")

            refined = refine_taxonomy_with_llm(taxonomy, provider=provider)

            refined_categories = refined.get("categories", {})
            console.print(f"\n[green]✓[/green] Refined to {len(refined_categories)} categories:\n")

            for name, info in refined_categories.items():
                desc = info.get("description", "")[:60]
                terms = info.get("related_terms", [])[:5]
                console.print(f"  [cyan]{name}[/cyan]: {desc}")
                console.print(f"    Terms: {', '.join(terms)}")

            # Save
            default_output = CURATED_KEPS_DIR / "label_taxonomy_v3.json"
            output_path = output or default_output
            save_taxonomy(refined, output_path)
            console.print(f"\n[green]✓[/green] Saved to {output_path}")

        else:
            console.print(f"[red]Unknown method: {method}[/red]")
            raise typer.Exit(1)

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        if "scikit-learn" in str(e):
            console.print("\n[yellow]Install scikit-learn:[/yellow]")
            console.print("  pip install scikit-learn")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("normalize-kep-labels")
def normalize_kep_labels_cmd(
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="Model provider (uses llm_config.yaml if not specified)"
    ),
    model: str | None = typer.Option(
        None, "--model", "-m",
        help="Specific model ID"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-n",
        help="Preview changes without saving"
    ),
    stats_only: bool = typer.Option(
        False, "--stats", "-s",
        help="Only show label statistics"
    ),
):
    """Normalize and consolidate KEP labels (Pass 2).

    After extracting labels from all KEPs (extract-kep-metadata),
    this command uses LLM to:
    - Merge singular/plural forms (pod/pods → pod)
    - Merge synonyms (feature-gate/feature-gates → feature-gate)
    - Consolidate related concepts

    Examples:
        # Preview normalizations
        uv run k8s-pipeline normalize-kep-labels --dry-run

        # Apply normalizations
        uv run k8s-pipeline normalize-kep-labels

        # Show current label stats
        uv run k8s-pipeline normalize-kep-labels --stats
    """
    try:
        from .transform.kep_label_normalizer import normalize_labels, show_label_stats

        if stats_only:
            show_label_stats()
            return

        normalize_labels(
            provider=provider,  # type: ignore
            model_id=model,
            dry_run=dry_run,
        )

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[anthropic]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("fetch-youtube")
def fetch_youtube_cmd(
    conference: str = typer.Argument(None, help="Conference ID (e.g., kubecon-na-2024)"),
    playlist_id: str | None = typer.Option(
        None, "--playlist", "-p",
        help="YouTube playlist ID (if not using a known conference)"
    ),
    max_videos: int = typer.Option(
        500, "--max", "-n",
        help="Maximum videos to fetch"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-d",
        help="Preview without saving"
    ),
    list_playlists: bool = typer.Option(
        False, "--list", "-l",
        help="List available KubeCon playlists"
    ),
):
    """Fetch KubeCon videos from YouTube playlists.

    Requires YOUTUBE_API_KEY environment variable.
    Get an API key from https://console.cloud.google.com/apis/credentials

    Examples:
        # List available playlists
        uv run k8s-pipeline fetch-youtube --list

        # Fetch KubeCon NA 2024 videos
        uv run k8s-pipeline fetch-youtube kubecon-na-2024

        # Fetch from a custom playlist
        uv run k8s-pipeline fetch-youtube --playlist PLj6h78yzYM2N8GdbjmhVU65KYm_68qBmo

        # Preview without saving
        uv run k8s-pipeline fetch-youtube kubecon-na-2024 --dry-run
    """
    try:
        from .transform.youtube_fetcher import (
            KUBECON_PLAYLISTS,
            import_kubecon_playlist,
            import_playlist_to_content,
        )

        if list_playlists:
            console.print("\n[bold]Available KubeCon playlists:[/bold]\n")
            for conf_id, info in KUBECON_PLAYLISTS.items():
                console.print(f"  [cyan]{conf_id}[/cyan]")
                console.print(f"    {info['name']}")
                console.print(f"    Playlist: {info['playlist_id']}")
                console.print()
            return

        if playlist_id:
            # Custom playlist
            if not conference:
                console.print("[red]Specify a conference ID with --playlist[/red]")
                raise typer.Exit(1)
            count = import_playlist_to_content(
                playlist_id=playlist_id,
                conference_id=conference,
                conference_date="2024-01-01",  # Default date
                max_videos=max_videos,
                dry_run=dry_run,
            )
        elif conference:
            # Known conference
            count = import_kubecon_playlist(
                conference=conference,
                max_videos=max_videos,
                dry_run=dry_run,
            )
        else:
            console.print("[yellow]Specify a conference or use --list[/yellow]")
            raise typer.Exit(1)

        if dry_run:
            console.print(f"\n[yellow]Dry run: would import {count} videos[/yellow]")
        else:
            console.print(f"\n[green]✓[/green] Imported {count} videos")

    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("fetch-sched")
def fetch_sched_cmd(
    conference: str = typer.Argument(None, help="Conference ID (e.g., kubecon-na-2024)"),
    max_sessions: int | None = typer.Option(
        None, "--max", "-n",
        help="Maximum sessions to fetch"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-d",
        help="Preview without saving"
    ),
    list_conferences: bool = typer.Option(
        False, "--list", "-l",
        help="List available conferences"
    ),
    enrich: bool = typer.Option(
        True, "--enrich/--no-enrich", "-e",
        help="Use LLM to enrich sessions with better summaries and labels (default: yes)"
    ),
    scrape_media: bool = typer.Option(
        True, "--scrape/--no-scrape", "-s",
        help="Scrape YouTube video and slides URLs from Sched pages (default: yes)"
    ),
    scrape_delay: float = typer.Option(
        1.0, "--delay",
        help="Delay between scrape requests in seconds (default: 1.0)"
    ),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="LLM provider override (uses llm_config.yaml if not specified)"
    ),
    concurrency: int = typer.Option(
        10, "--concurrency", "-c",
        help="Number of concurrent LLM requests (default: 10)"
    ),
):
    """Scrape KubeCon sessions from Sched.com.

    Fetches session data from iCal export, then scrapes each session page
    to extract YouTube video URLs and slides PDFs. Optionally enriches
    sessions with LLM-generated summaries and topic labels.

    Examples:
        # List available conferences
        uv run k8s-pipeline fetch-sched --list

        # Scrape KubeCon NA 2024 sessions (full pipeline)
        uv run k8s-pipeline fetch-sched kubecon-na-2024

        # Skip LLM enrichment (faster, no API costs)
        uv run k8s-pipeline fetch-sched kubecon-na-2024 --no-enrich

        # Skip media scraping (just iCal data)
        uv run k8s-pipeline fetch-sched kubecon-na-2024 --no-scrape --no-enrich

        # Preview without saving
        uv run k8s-pipeline fetch-sched kubecon-na-2024 --dry-run

        # Limit to 50 sessions
        uv run k8s-pipeline fetch-sched kubecon-na-2024 --max 50
    """
    try:
        from .transform.sched_fetcher import (
            SCHED_CONFERENCES,
            import_sched_sessions,
        )

        if list_conferences:
            console.print("\n[bold]Available conferences:[/bold]\n")
            for conf_id, info in SCHED_CONFERENCES.items():
                console.print(f"  [cyan]{conf_id}[/cyan]")
                console.print(f"    {info['name']}")
                console.print(f"    {info['location']} ({info['conference_date']})")
                console.print(f"    {info['sched_url']}")
                console.print()
            return

        if not conference:
            console.print("[yellow]Specify a conference or use --list[/yellow]")
            raise typer.Exit(1)

        count = import_sched_sessions(
            conference_id=conference,
            max_sessions=max_sessions,
            dry_run=dry_run,
            enrich=enrich,
            scrape_media=scrape_media,
            scrape_delay=scrape_delay,
            provider=provider,  # type: ignore
            concurrency=concurrency,
        )

        if dry_run:
            console.print(f"\n[yellow]Dry run: would import {count} sessions[/yellow]")
        else:
            console.print(f"\n[green]✓[/green] Imported {count} sessions")
            console.print("\n[yellow]Run 'uv run k8s-pipeline export-parquet' to update the UI data[/yellow]")

    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install beautifulsoup4:[/yellow]")
        console.print("  uv pip install beautifulsoup4")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("re-enrich-sched")
def re_enrich_sched_cmd(
    conference: str = typer.Argument(..., help="Conference ID (e.g., kubecon-na-2024)"),
    max_sessions: int | None = typer.Option(
        None, "--max", "-n",
        help="Maximum sessions to review"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-d",
        help="Preview changes without saving"
    ),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="LLM provider override"
    ),
    concurrency: int = typer.Option(
        10, "--concurrency", "-c",
        help="Number of concurrent LLM requests (default: 10)"
    ),
):
    """Re-enrich existing sessions to fix labels.

    Reviews sessions that have SIG labels and fixes any that are incorrectly applied.
    SIG labels should only be used for sessions about Kubernetes development/features,
    not just sessions that USE Kubernetes features.

    Examples:
        # Review all sessions with SIG labels
        uv run k8s-pipeline re-enrich-sched kubecon-na-2024

        # Preview changes without saving
        uv run k8s-pipeline re-enrich-sched kubecon-na-2024 --dry-run

        # Review only 10 sessions
        uv run k8s-pipeline re-enrich-sched kubecon-na-2024 --max 10
    """
    try:
        from .transform.sched_fetcher import re_enrich_conference_labels

        count = re_enrich_conference_labels(
            conference_id=conference,
            max_sessions=max_sessions,
            dry_run=dry_run,
            provider=provider,  # type: ignore
            concurrency=concurrency,
        )

        if dry_run:
            console.print(f"\n[yellow]Dry run: would update {count} sessions[/yellow]")
        else:
            console.print(f"\n[green]✓[/green] Updated {count} sessions")
            if count > 0:
                console.print("\n[yellow]Run 'uv run k8s-pipeline export-parquet' to update the UI data[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("link-content-keps")
def link_content_keps_cmd(
    conference: str = typer.Argument(..., help="Conference ID (e.g., kubecon-na-2024)"),
    max_items: int | None = typer.Option(
        None, "--max", "-n",
        help="Maximum items to process"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-d",
        help="Preview changes without saving"
    ),
    force: bool = typer.Option(
        False, "--force", "-f",
        help="Re-process all items, removing existing KEP links"
    ),
    provider: str | None = typer.Option(
        None, "--provider", "-p",
        help="LLM provider override"
    ),
    concurrency: int = typer.Option(
        10, "--concurrency", "-c",
        help="Number of concurrent LLM requests (default: 10)"
    ),
    min_confidence: float = typer.Option(
        0.85, "--min-confidence",
        help="Minimum confidence for KEP links (default: 0.85)"
    ),
):
    """Link conference content to KEPs using LLM.

    Analyzes content items and identifies relevant KEPs based on:
    - Title and description matching
    - Shared topic labels
    - Mentioned Kubernetes resources

    Only processes items that don't already have KEP links (unless --force).

    Examples:
        # Link all content without KEP links
        uv run k8s-pipeline link-content-keps kubecon-na-2024

        # Preview changes without saving
        uv run k8s-pipeline link-content-keps kubecon-na-2024 --dry-run

        # Re-process all items (remove old KEP links and re-link)
        uv run k8s-pipeline link-content-keps kubecon-na-2024 --force

        # Process only 20 items
        uv run k8s-pipeline link-content-keps kubecon-na-2024 --max 20
    """
    try:
        from .transform.sched_fetcher import link_conference_to_keps

        count = link_conference_to_keps(
            conference_id=conference,
            max_items=max_items,
            dry_run=dry_run,
            force=force,
            provider=provider,  # type: ignore
            concurrency=concurrency,
            min_confidence=min_confidence,
        )

        if dry_run:
            console.print(f"\n[yellow]Dry run: would add {count} KEP links[/yellow]")
        else:
            console.print(f"\n[green]✓[/green] Added {count} KEP links")
            if count > 0:
                console.print("\n[yellow]Run 'uv run k8s-pipeline export-parquet' to update the UI data[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("validate-kep-links")
def validate_kep_links_cmd(
    conference: str | None = typer.Argument(
        None, help="Conference ID (e.g., kubecon-na-2024), or omit for all"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", "-d",
        help="Preview changes without saving"
    ),
):
    """Validate and remove invalid KEP links from content files.

    Checks all KEP links against kep_metadata.json and removes any
    that reference non-existent KEPs (hallucinated by LLM).

    Examples:
        # Validate all conference files
        uv run k8s-pipeline validate-kep-links

        # Validate specific conference
        uv run k8s-pipeline validate-kep-links kubecon-na-2024

        # Preview without saving
        uv run k8s-pipeline validate-kep-links --dry-run
    """
    try:
        from .transform.sched_fetcher import validate_kep_links

        removed, valid = validate_kep_links(
            conference_id=conference,
            dry_run=dry_run,
        )

        if dry_run:
            console.print(f"\n[yellow]Dry run: would remove {removed} invalid KEP links[/yellow]")
        else:
            console.print(f"\n[green]✓[/green] Removed {removed} invalid KEP links, kept {valid} valid")
            if removed > 0:
                console.print("\n[yellow]Run 'uv run k8s-pipeline export-parquet' to update the UI data[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


# ============================================================================
# Cloud Provider Commands
# ============================================================================


@app.command("fetch-providers")
def fetch_providers_cmd(
    provider: str | None = typer.Argument(
        None, help="Provider ID (eks, gke, aks, openshift), or omit for all"
    ),
    list_providers: bool = typer.Option(
        False, "--list", "-l",
        help="List available providers"
    ),
    summary: bool = typer.Option(
        False, "--summary", "-s",
        help="Show summary statistics for all providers"
    ),
):
    """Fetch K8s version support data from cloud providers.

    Fetches version support information from endoflife.date for:
    - Amazon EKS
    - Google GKE
    - Azure AKS
    - Red Hat OpenShift

    The data enables comparison queries like:
    - Which provider has the longest support period?
    - Which provider releases new K8s versions fastest?
    - How many versions does each provider currently support?

    Examples:
        # List available providers
        uv run k8s-pipeline fetch-providers --list

        # Fetch all providers
        uv run k8s-pipeline fetch-providers

        # Fetch specific provider
        uv run k8s-pipeline fetch-providers eks

        # Show summary statistics
        uv run k8s-pipeline fetch-providers --summary
    """
    from .core.config import PROVIDERS
    from .transform.provider_versions import (
        fetch_all_providers,
        fetch_provider_versions,
        get_provider_summary,
        save_provider_data,
    )

    if list_providers:
        console.print("\n[bold]Available providers:[/bold]\n")
        for pid, info in PROVIDERS.items():
            console.print(f"  [cyan]{pid}[/cyan]")
            console.print(f"    {info['display_name']}")
            console.print(f"    Product: {info['product']}")
            console.print(f"    Versioning: {info['versioning']}")
            console.print()
        return

    if summary:
        stats = get_provider_summary()
        if not stats:
            console.print("[yellow]No provider data found. Run 'fetch-providers' first.[/yellow]")
            raise typer.Exit(1)

        console.print("\n[bold]Provider Summary:[/bold]\n")
        table = Table()
        table.add_column("Provider", style="cyan")
        table.add_column("Supported", justify="right")
        table.add_column("Avg Support (days)", justify="right")
        table.add_column("Avg Days to Release", justify="right")

        for _pid, s in stats.items():
            avg_support = f"{s['avg_support_days']:.0f}" if s['avg_support_days'] else "-"
            avg_days = f"{s['avg_days_to_availability']:.0f}" if s['avg_days_to_availability'] else "-"
            table.add_row(
                s['display_name'],
                str(s['supported_count']),
                avg_support,
                avg_days,
            )

        console.print(table)
        return

    try:
        console.print("\n[bold]Fetching provider version data...[/bold]\n")

        if provider:
            if provider not in PROVIDERS:
                console.print(f"[red]Unknown provider: {provider}[/red]")
                console.print(f"[dim]Available: {', '.join(PROVIDERS.keys())}[/dim]")
                raise typer.Exit(1)

            versions = fetch_provider_versions(provider)
            data = {provider: versions}
        else:
            data = fetch_all_providers()

        # Save data
        path = save_provider_data(data)
        console.print(f"\n[green]✓[/green] Saved to {path}")

        # Show summary
        total_versions = sum(len(v) for v in data.values())
        console.print("\n[bold]Summary:[/bold]")
        console.print(f"  Total versions: {total_versions}")
        for pid, versions in data.items():
            supported = sum(1 for v in versions if v["status"] == "supported")
            console.print(f"  {PROVIDERS[pid]['display_name']}: {len(versions)} versions ({supported} supported)")

        console.print("\n[yellow]Run 'uv run k8s-pipeline export-parquet' to update the UI data[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("extract-component-flags")
def extract_component_flags_cmd(
    version: str = typer.Argument(..., help="K8s version (e.g., 1.32)"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file (default: data/curated/components/components.json)"
    ),
    link_keps: bool = typer.Option(
        True, "--link-keps/--no-link-keps",
        help="Link flags to KEPs via feature gates (default: yes)"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Extract component CLI flags from kubernetes/website docs.

    Parses the command-line reference documentation from the kubernetes/website
    repo to extract flags for control plane and node components.

    The website repo uses tags like `snapshot-final-v1.32` for each K8s release,
    ensuring we get version-specific documentation.

    By default, also links flags to KEPs by detecting feature gate names in
    flag descriptions. Use --no-link-keps to skip this step.

    Components extracted:
    - kube-apiserver
    - kube-controller-manager
    - kube-scheduler
    - kubelet
    - kube-proxy

    Examples:
        # Extract flags for K8s 1.32
        uv run k8s-pipeline extract-component-flags 1.32

        # Extract to specific file
        uv run k8s-pipeline extract-component-flags 1.32 -o components-1.32.json

        # Skip KEP linking
        uv run k8s-pipeline extract-component-flags 1.32 --no-link-keps
    """
    from .transform.component_extractor import (
        update_curated_components,
        update_curated_components_with_keps,
    )

    try:
        # Ensure website repo is cloned
        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[bold]Cloning website repo...[/bold]")
            sync_repos(["website"])
            console.print()

        if link_keps:
            result = update_curated_components_with_keps(version, output_path=output, quiet=quiet)
        else:
            result = update_curated_components(version, output_path=output, quiet=quiet)

        if not quiet:
            # Show summary
            total_flags = sum(
                len(c.get("key_flags", []))
                for c in result.get("components", [])
            )
            linked_flags = sum(
                1 for c in result.get("components", [])
                for f in c.get("key_flags", [])
                if f.get("related_keps")
            )
            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Components: {len(result.get('components', []))}")
            console.print(f"  Total flags: {total_flags}")
            if link_keps:
                console.print(f"  Flags linked to KEPs: {linked_flags}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-component-flags")
def compare_component_flags_cmd(
    version1: str = typer.Argument(..., help="First K8s version (e.g., 1.31)"),
    version2: str = typer.Argument(..., help="Second K8s version (e.g., 1.32)"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file for diff"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Compare component flags between two K8s versions.

    Shows which flags were added or removed between versions.

    Examples:
        # Compare 1.31 to 1.32
        uv run k8s-pipeline compare-component-flags 1.31 1.32

        # Save diff to file
        uv run k8s-pipeline compare-component-flags 1.31 1.32 -o diff.json
    """
    import json

    from .transform.component_extractor import compare_versions

    try:
        # Ensure website repo is cloned
        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[bold]Cloning website repo...[/bold]")
            sync_repos(["website"])
            console.print()

        diff = compare_versions(version1, version2, quiet=quiet)

        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(diff, indent=2))
            console.print(f"\n[green]✓[/green] Saved diff to {output}")

        if not quiet:
            # Show summary
            total_added = sum(
                len(c.get("added", []))
                for c in diff.get("changes", {}).values()
            )
            total_removed = sum(
                len(c.get("removed", []))
                for c in diff.get("changes", {}).values()
            )
            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Flags added: [green]+{total_added}[/green]")
            console.print(f"  Flags removed: [red]-{total_removed}[/red]")

            # Show details per component
            if diff.get("changes"):
                console.print("\n[bold]Changes by component:[/bold]")
                for comp_id, changes in diff["changes"].items():
                    added = changes.get("added", [])
                    removed = changes.get("removed", [])
                    if added:
                        console.print(f"\n  [cyan]{comp_id}[/cyan] [green]+{len(added)}[/green]:")
                        for flag in added[:5]:  # Show first 5
                            console.print(f"    [green]+[/green] {flag['name']}")
                        if len(added) > 5:
                            console.print(f"    [dim]... and {len(added) - 5} more[/dim]")
                    if removed:
                        console.print(f"\n  [cyan]{comp_id}[/cyan] [red]-{len(removed)}[/red]:")
                        for flag in removed[:5]:  # Show first 5
                            console.print(f"    [red]-[/red] {flag['name']}")
                        if len(removed) > 5:
                            console.print(f"    [dim]... and {len(removed) - 5} more[/dim]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("list-website-tags")
def list_website_tags_cmd(
    version: str | None = typer.Argument(None, help="K8s version to find tag for"),
):
    """List available tags in the kubernetes/website repo.

    Shows the snapshot tags used for version-specific documentation.

    Examples:
        # List all snapshot tags
        uv run k8s-pipeline list-website-tags

        # Find tag for specific version
        uv run k8s-pipeline list-website-tags 1.32
    """
    from .transform.component_extractor import find_website_tag_for_version

    try:
        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[yellow]Website repo not cloned. Run:[/yellow]")
            console.print("  uv run k8s-pipeline sync-repos website")
            raise typer.Exit(1)

        # Fetch latest tags
        from .input.repo_manager import fetch_repo
        fetch_repo("website", quiet=False)

        if version:
            # Find tag for specific version
            tag = find_website_tag_for_version(repo_path, version)
            if tag:
                console.print(f"\n[green]✓[/green] Tag for {version}: [cyan]{tag}[/cyan]")
            else:
                console.print(f"\n[yellow]No tag found for version {version}[/yellow]")
        else:
            # List all snapshot tags
            success, output = run_git(["tag", "-l", "snapshot-*"], cwd=repo_path)
            if success and output:
                tags = sorted(output.strip().split("\n"), reverse=True)
                console.print("\n[bold]Available snapshot tags:[/bold]\n")
                for tag in tags[:20]:  # Show latest 20
                    console.print(f"  {tag}")
                if len(tags) > 20:
                    console.print(f"\n  [dim]... and {len(tags) - 20} more[/dim]")
            else:
                console.print("[yellow]No snapshot tags found[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("link-component-keps")
def link_component_keps_cmd(
    version: str = typer.Argument(..., help="K8s version (e.g., 1.35)"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file (default: data/curated/components/components.json)"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Link component flags to KEPs based on feature gates.

    Extracts component flags and links them to KEPs by matching:
    - Feature gate names mentioned in flag descriptions
    - KEPs that define those feature gates

    Examples:
        # Extract flags and link to KEPs
        uv run k8s-pipeline link-component-keps 1.35

        # Save to specific file
        uv run k8s-pipeline link-component-keps 1.35 -o components-linked.json
    """
    from .transform.component_extractor import update_curated_components_with_keps

    try:
        # Ensure website repo is cloned
        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[bold]Cloning website repo...[/bold]")
            sync_repos(["website"])
            console.print()

        result = update_curated_components_with_keps(version, output_path=output, quiet=quiet)

        if not quiet:
            # Show summary
            total_flags = sum(
                len(c.get("key_flags", []))
                for c in result.get("components", [])
            )
            linked_flags = sum(
                1 for c in result.get("components", [])
                for f in c.get("key_flags", [])
                if f.get("related_keps")
            )
            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Components: {len(result.get('components', []))}")
            console.print(f"  Total flags: {total_flags}")
            console.print(f"  Flags linked to KEPs: {linked_flags}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("extract-kubectl")
def extract_kubectl_cmd(
    version: str = typer.Argument(None, help="K8s version (e.g., 1.32)"),
    all_versions: bool = typer.Option(False, "--all", help="Extract for all versions"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file (default: data/curated/kubectl/kubectl_commands_{version}.json)"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Extract kubectl commands from kubernetes/website docs.

    Parses the generated kubectl reference documentation from the kubernetes/website
    repo to extract all kubectl commands, their options, and examples.

    The website repo uses tags like `snapshot-final-v1.32` for each K8s release,
    ensuring we get version-specific documentation.

    Data extracted:
    - Command names and hierarchy (kubectl apply, kubectl apply edit-last-applied)
    - Synopsis/description
    - Usage patterns
    - Examples
    - Command-specific options (flags with types, defaults, descriptions)
    - Subcommands

    Examples:
        # Extract kubectl commands for K8s 1.35
        uv run k8s-pipeline extract-kubectl 1.35

        # Extract for all versions
        uv run k8s-pipeline extract-kubectl --all

        # Extract to specific file
        uv run k8s-pipeline extract-kubectl 1.35 -o kubectl-1.35.json
    """
    from .transform.kubectl_extractor import extract_all_versions, extract_and_save_kubectl

    if not version and not all_versions:
        console.print("[red]Error: Provide a version or use --all[/red]")
        raise typer.Exit(1)

    try:
        # Ensure website repo is cloned
        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[bold]Cloning website repo...[/bold]")
            sync_repos(["website"])
            console.print()

        if all_versions:
            results = extract_all_versions(quiet=quiet)

            if not quiet:
                # Show summary
                total_commands = sum(r.get("command_count", 0) for r in results.values())
                console.print("\n[bold]Summary:[/bold]")
                console.print(f"  Versions processed: {len(results)}")
                console.print(f"  Total commands across all versions: {total_commands}")
        else:
            result = extract_and_save_kubectl(version, output_path=output, quiet=quiet)

            if not quiet:
                # Show summary
                total_options = sum(
                    len(c.get("options", []))
                    for c in result.get("commands", [])
                )
                total_examples = sum(
                    len(c.get("examples", []))
                    for c in result.get("commands", [])
                )
                console.print("\n[bold]Summary:[/bold]")
                console.print(f"  Commands: {result.get('command_count', 0)}")
                console.print(f"  Total options: {total_options}")
                console.print(f"  Total examples: {total_examples}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-kubectl")
def compare_kubectl_cmd(
    version1: str = typer.Argument(..., help="First K8s version (e.g., 1.34)"),
    version2: str = typer.Argument(..., help="Second K8s version (e.g., 1.35)"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file for diff"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Compare kubectl commands between two K8s versions.

    Shows which commands and options were added or removed between versions.

    Examples:
        # Compare 1.34 to 1.35
        uv run k8s-pipeline compare-kubectl 1.34 1.35

        # Save diff to file
        uv run k8s-pipeline compare-kubectl 1.34 1.35 -o kubectl-diff.json
    """
    import json

    from .transform.kubectl_extractor import compare_kubectl_versions

    try:
        # Ensure website repo is cloned
        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[bold]Cloning website repo...[/bold]")
            sync_repos(["website"])
            console.print()

        diff = compare_kubectl_versions(version1, version2, quiet=quiet)

        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(diff, indent=2))
            console.print(f"\n[green]✓[/green] Saved diff to {output}")

        if not quiet:
            # Show summary
            added_cmds = len(diff.get("commands_added", []))
            removed_cmds = len(diff.get("commands_removed", []))
            opt_changes = len(diff.get("option_changes", {}))

            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Commands added: [green]+{added_cmds}[/green]")
            console.print(f"  Commands removed: [red]-{removed_cmds}[/red]")
            console.print(f"  Commands with option changes: [yellow]{opt_changes}[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("extract-feature-gates")
def extract_feature_gates_cmd(
    version: str = typer.Argument(None, help="K8s version (e.g., 1.32)"),
    all_versions: bool = typer.Option(False, "--all", help="Extract for all versions"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file (default: data/curated/feature-gates/feature_gates_{version}.json)"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Extract feature gates from kubernetes/kubernetes source code.

    Parses the feature gate definitions from pkg/features/kube_features.go
    to extract all feature gates with their version history.

    This allows users to see the feature gate status at any given K8s version,
    not just the latest. Each feature gate includes:
    - Stage (alpha, beta, stable, deprecated)
    - Default value (enabled/disabled)
    - Lock to default flag
    - Owner and KEP link from comments
    - Full version history

    Examples:
        # Extract feature gates for K8s 1.35
        uv run k8s-pipeline extract-feature-gates 1.35

        # Extract for all versions
        uv run k8s-pipeline extract-feature-gates --all

        # Extract to specific file
        uv run k8s-pipeline extract-feature-gates 1.35 -o feature-gates-1.35.json
    """
    from .transform.feature_gate_extractor import (
        extract_all_versions,
        extract_and_save_feature_gates,
    )

    if not version and not all_versions:
        console.print("[red]Error: Provide a version or use --all[/red]")
        raise typer.Exit(1)

    try:
        # Ensure kubernetes repo is cloned
        repo_path = get_repo_path("kubernetes")
        if not repo_path.exists():
            console.print("[bold]Cloning kubernetes repo...[/bold]")
            sync_repos(["kubernetes"])
            console.print()

        if all_versions:
            results = extract_all_versions(quiet=quiet)

            if not quiet:
                # Show summary
                total_gates = sum(r.get("feature_gate_count", 0) for r in results.values())
                console.print("\n[bold]Summary:[/bold]")
                console.print(f"  Versions processed: {len(results)}")
                console.print(f"  Total feature gates across all versions: {total_gates}")
        else:
            result = extract_and_save_feature_gates(version, output_path=output, quiet=quiet)

            if not quiet:
                # Show summary by stage
                gates = result.get("feature_gates", [])
                by_stage: dict[str, int] = {}
                for gate in gates:
                    stage = gate.get("stage", "unknown")
                    by_stage[stage] = by_stage.get(stage, 0) + 1

                console.print("\n[bold]Summary:[/bold]")
                console.print(f"  Total feature gates: {len(gates)}")
                for stage in ["alpha", "beta", "stable", "deprecated"]:
                    if stage in by_stage:
                        console.print(f"  {stage}: {by_stage[stage]}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-feature-gates")
def compare_feature_gates_cmd(
    version1: str = typer.Argument(..., help="First K8s version (e.g., 1.34)"),
    version2: str = typer.Argument(..., help="Second K8s version (e.g., 1.35)"),
    output: Path | None = typer.Option(
        None, "--output", "-o",
        help="Output JSON file for diff"
    ),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Suppress output"),
):
    """Compare feature gates between two K8s versions.

    Shows which feature gates were added, removed, or changed stage between versions.

    Examples:
        # Compare 1.34 to 1.35
        uv run k8s-pipeline compare-feature-gates 1.34 1.35

        # Save diff to file
        uv run k8s-pipeline compare-feature-gates 1.34 1.35 -o feature-gates-diff.json
    """
    import json

    from .transform.feature_gate_extractor import compare_feature_gates

    try:
        # Ensure kubernetes repo is cloned
        repo_path = get_repo_path("kubernetes")
        if not repo_path.exists():
            console.print("[bold]Cloning kubernetes repo...[/bold]")
            sync_repos(["kubernetes"])
            console.print()

        diff = compare_feature_gates(version1, version2, quiet=quiet)

        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(diff, indent=2))
            console.print(f"\n[green]✓[/green] Saved diff to {output}")

        if not quiet:
            # Show summary
            added = len(diff.get("added", []))
            removed = len(diff.get("removed", []))
            stage_changes = len(diff.get("stage_changes", []))

            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Feature gates added: [green]+{added}[/green]")
            console.print(f"  Feature gates removed: [red]-{removed}[/red]")
            console.print(f"  Stage changes: [yellow]{stage_changes}[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
