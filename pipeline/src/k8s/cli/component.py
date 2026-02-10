"""K8s component extraction commands."""

import typer
from rich.console import Console
from rich.table import Table

from ..core.config import K8S_VERSIONS

app = typer.Typer(name="component", help="K8s component extraction")
console = Console()


@app.command()
def flags(
    version: str = typer.Argument(..., help="K8s version (e.g., 1.32)"),
    component: str | None = typer.Option(None, "--component", "-c", help="Specific component"),
    force: bool = typer.Option(False, "--force", "-f", help="Force re-extraction"),
):
    """Extract component CLI flags from kubernetes/website docs.

    Components: kube-apiserver, kube-controller-manager, kube-scheduler, kubelet, kube-proxy
    """
    try:
        from ..transform.components.component_extractor import extract_component_flags

        result = extract_component_flags(version, component=component, force=force)

        if result:
            console.print(f"\n[green]✓[/green] Extracted flags for {version}")
            for comp_name, flags_list in result.items():
                console.print(f"  {comp_name}: {len(flags_list)} flags")
        else:
            console.print(f"[yellow]No flags extracted for {version}[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-flags")
def compare_flags_cmd(
    version1: str = typer.Argument(..., help="First K8s version (e.g., 1.31)"),
    version2: str = typer.Argument(..., help="Second K8s version (e.g., 1.32)"),
    component: str | None = typer.Option(None, "--component", "-c", help="Specific component"),
):
    """Compare component flags between two K8s versions."""
    try:
        from ..transform.components.component_extractor import compare_component_flags

        diff = compare_component_flags(version1, version2, component=component)

        console.print(f"\n[bold]Component Flags: {version1} → {version2}[/bold]\n")

        for comp_name, changes in diff.items():
            added = changes.get("added", [])
            removed = changes.get("removed", [])
            if added or removed:
                console.print(f"[cyan]{comp_name}[/cyan]")
                for flag in added[:5]:
                    console.print(f"  [green]+ {flag}[/green]")
                if len(added) > 5:
                    console.print(f"  [green]  ... +{len(added) - 5} more[/green]")
                for flag in removed[:5]:
                    console.print(f"  [red]- {flag}[/red]")
                if len(removed) > 5:
                    console.print(f"  [red]  ... +{len(removed) - 5} more[/red]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def kubectl(
    version: str = typer.Argument(None, help="K8s version (e.g., 1.32)"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Extract for all versions"),
    force: bool = typer.Option(False, "--force", "-f", help="Force re-extraction"),
):
    """Extract kubectl commands from kubernetes/website docs."""
    try:
        from ..transform.components.kubectl_extractor import extract_kubectl_commands

        versions = K8S_VERSIONS if all_versions else ([version] if version else K8S_VERSIONS)

        for ver in versions:
            result = extract_kubectl_commands(ver, force=force)
            if result:
                console.print(f"[green]✓[/green] {ver}: {len(result)} commands")
            else:
                console.print(f"[yellow]⚠[/yellow] {ver}: no commands extracted")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-kubectl")
def compare_kubectl_cmd(
    version1: str = typer.Argument(..., help="First K8s version (e.g., 1.34)"),
    version2: str = typer.Argument(..., help="Second K8s version (e.g., 1.35)"),
):
    """Compare kubectl commands between two K8s versions."""
    try:
        from ..transform.components.kubectl_extractor import compare_kubectl_commands

        diff = compare_kubectl_commands(version1, version2)

        console.print(f"\n[bold]kubectl Commands: {version1} → {version2}[/bold]\n")

        added = diff.get("added", [])
        removed = diff.get("removed", [])

        if added:
            console.print("[green]Added commands:[/green]")
            for cmd in added[:10]:
                console.print(f"  + {cmd}")
            if len(added) > 10:
                console.print(f"  ... +{len(added) - 10} more")

        if removed:
            console.print("[red]Removed commands:[/red]")
            for cmd in removed[:10]:
                console.print(f"  - {cmd}")
            if len(removed) > 10:
                console.print(f"  ... +{len(removed) - 10} more")

        if not added and not removed:
            console.print("[dim]No changes[/dim]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def gates(
    version: str = typer.Argument(None, help="K8s version (e.g., 1.32)"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Extract for all versions"),
    force: bool = typer.Option(False, "--force", "-f", help="Force re-extraction"),
):
    """Extract feature gates from kubernetes/kubernetes source code."""
    try:
        from ..transform.components.feature_gate_extractor import extract_feature_gates

        versions = K8S_VERSIONS if all_versions else ([version] if version else K8S_VERSIONS)

        for ver in versions:
            result = extract_feature_gates(ver, force=force)
            if result:
                console.print(f"[green]✓[/green] {ver}: {len(result)} feature gates")
            else:
                console.print(f"[yellow]⚠[/yellow] {ver}: no gates extracted")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("compare-gates")
def compare_gates_cmd(
    version1: str = typer.Argument(..., help="First K8s version"),
    version2: str = typer.Argument(..., help="Second K8s version"),
):
    """Compare feature gates between two K8s versions."""
    try:
        from ..transform.components.feature_gate_extractor import compare_feature_gates

        diff = compare_feature_gates(version1, version2)

        console.print(f"\n[bold]Feature Gates: {version1} → {version2}[/bold]\n")

        for change_type in ["added", "removed", "promoted", "deprecated"]:
            items = diff.get(change_type, [])
            if items:
                color = {"added": "green", "removed": "red", "promoted": "cyan", "deprecated": "yellow"}[change_type]
                console.print(f"[{color}]{change_type.title()}:[/{color}]")
                for item in items[:10]:
                    console.print(f"  {item}")
                if len(items) > 10:
                    console.print(f"  ... +{len(items) - 10} more")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("link-keps")
def link_keps_cmd(
    version: str = typer.Argument(..., help="K8s version (e.g., 1.35)"),
):
    """Link component flags to KEPs based on feature gates."""
    try:
        from ..transform.components.component_extractor import link_component_keps

        result = link_component_keps(version)

        if result:
            console.print(f"\n[green]✓[/green] Linked {len(result)} flags to KEPs")
        else:
            console.print("[yellow]No links found[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("list-tags")
def list_tags_cmd(
    version: str | None = typer.Argument(None, help="K8s version to find tag for"),
):
    """List available tags in the kubernetes/website repo."""
    try:
        from ..input.repo_manager import get_repo_path, run_git

        repo_path = get_repo_path("website")
        if not repo_path.exists():
            console.print("[red]Website repo not cloned. Run 'repo sync website' first.[/red]")
            raise typer.Exit(1)

        result = run_git(["tag", "-l", "snapshot-*"], cwd=repo_path)
        tags = sorted(result.stdout.strip().split("\n"), reverse=True)

        if version:
            matching = [t for t in tags if version in t]
            console.print(f"\n[bold]Tags matching {version}:[/bold]")
            for tag in matching[:10]:
                console.print(f"  {tag}")
        else:
            console.print("\n[bold]Recent snapshot tags:[/bold]")
            for tag in tags[:20]:
                console.print(f"  {tag}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)
