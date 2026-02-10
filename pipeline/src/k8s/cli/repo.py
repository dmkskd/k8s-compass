"""Repository management commands."""

import typer
from rich.console import Console
from rich.table import Table

from ..input.repo_manager import (
    DEFAULT_REPOS,
    REPOS,
    checkout_version,
    list_repos,
    sync_repos,
)

app = typer.Typer(name="repo", help="Repository management")
console = Console()


@app.command()
def sync(
    repos: list[str] | None = typer.Argument(None, help="Repos to sync"),
    pull: bool = typer.Option(False, "--pull", "-p", help="Pull updates for existing repos"),
    all_repos: bool = typer.Option(False, "--all", "-a", help="Sync all configured repos"),
):
    """Clone or update upstream Kubernetes repositories.

    Repos: kubernetes, enhancements, website, lwkd
    """
    target_repos = list(REPOS.keys()) if all_repos else (repos or DEFAULT_REPOS)
    console.print(f"\n[bold]Syncing {len(target_repos)} repo(s)...[/bold]")
    results = sync_repos(repos=target_repos, pull=pull)
    success_count = sum(1 for v in results.values() if v)
    console.print(f"\n[bold green]✓ {success_count}/{len(results)} repo(s) synced[/bold green]")


@app.command()
def list():
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


@app.command()
def checkout(
    version: str = typer.Argument(..., help="K8s version to checkout"),
    repo: str = typer.Option("kubernetes", "--repo", "-r", help="Repository"),
):
    """Checkout a specific K8s release version in a cloned repo."""
    if not checkout_version(repo, version):
        raise typer.Exit(1)
    console.print(f"[green]✓[/green] Checked out {version} in {repo}")
