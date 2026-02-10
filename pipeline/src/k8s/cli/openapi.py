"""OpenAPI schema operations commands."""

import typer
from rich.console import Console
from rich.table import Table

from ..core.config import K8S_VERSIONS
from ..input.repo_manager import get_repo_path, reset_to_default_branch
from ..output.json_writer import write_api_tree, write_schemas_file, write_versions_file
from ..transform.openapi.field_parser import parse_kind_schema
from ..transform.openapi.schema_differ import (
    compute_diff,
    compute_field_history,
    compute_kind_history,
    write_diff,
    write_field_history,
    write_kind_history,
)
from ..transform.openapi.tree_parser import (
    clear_openapi_cache,
    load_openapi_spec,
    parse_openapi_spec,
)

app = typer.Typer(name="openapi", help="OpenAPI schema operations")
console = Console()


def _parse_all_schemas(spec: dict, version: str) -> dict:
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
    version: str | None = typer.Option(None, "--version", "-v", help="Specific K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Fetch all configured versions"),
    no_cache: bool = typer.Option(False, "--no-cache", help="Ignore cached specs"),
    with_schemas: bool = typer.Option(True, "--schemas/--no-schemas", help="Generate full schema files"),
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
            spec = load_openapi_spec(ver, use_cache=not no_cache)
            tree = parse_openapi_spec(spec, ver)
            trees.append(tree)
            write_api_tree(tree)

            if with_schemas:
                schemas = _parse_all_schemas(spec, ver)
                write_schemas_file(ver, schemas)
        except Exception as e:
            console.print(f"[red]Error processing {ver}: {e}[/red]")
            import traceback
            traceback.print_exc()
            continue

    if get_repo_path("kubernetes").exists():
        reset_to_default_branch("kubernetes")

    if trees:
        write_versions_file(trees)
        console.print(f"\n[bold green]✓ Successfully processed {len(trees)} version(s)[/bold green]\n")

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
def diff(
    from_version: str | None = typer.Option(None, "--from", "-f", help="Starting version"),
    to_version: str | None = typer.Option(None, "--to", "-t", help="Ending version"),
    all_diffs: bool = typer.Option(False, "--all", "-a", help="Generate all consecutive diffs"),
    with_history: bool = typer.Option(True, "--history/--no-history", help="Also generate field history"),
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
                f"  [green]✓[/green] {v_from} → {v_to}: "
                f"[green]+{len(d.fields_added)}[/green] [red]-{len(d.fields_removed)}[/red]"
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
            f"  Added: {len(d.fields_added)}, Removed: {len(d.fields_removed)}, "
            f"Modified: {len(d.fields_modified)}"
        )


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


@app.command("clear-cache")
def clear_cache_cmd():
    """Clear the OpenAPI spec cache."""
    clear_openapi_cache()
    console.print("[green]✓[/green] Cache cleared")
