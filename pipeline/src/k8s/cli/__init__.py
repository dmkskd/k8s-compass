"""Modular CLI for the K8s API pipeline.

This package provides a nested subcommand structure:
    k8s-pipeline release process 1.35
    k8s-pipeline openapi fetch 1.35
    k8s-pipeline export parquet
    etc.
"""

from pathlib import Path

import typer
from dotenv import load_dotenv
from rich.console import Console

from ..core.config import PIPELINE_ROOT

# Load .env file from pipeline directory (if exists)
_env_path = PIPELINE_ROOT / ".env"
load_dotenv(_env_path)

# Import subcommand modules
from . import component, content, export, kep, openapi, release, repo, util

# Create main app
app = typer.Typer(
    name="k8s-pipeline",
    help="Kubernetes API data pipeline for K8s Compass",
    rich_markup_mode="rich",
    invoke_without_command=True,
)
console = Console()


@app.callback()
def main_callback(ctx: typer.Context):
    """Show help if no command is provided."""
    if ctx.invoked_subcommand is None:
        # No subcommand provided, show help
        console.print(ctx.get_help())

# Register subcommand groups
app.add_typer(release.app, name="release")
app.add_typer(kep.app, name="kep")
app.add_typer(openapi.app, name="openapi")
app.add_typer(component.app, name="component")
app.add_typer(content.app, name="content")
app.add_typer(repo.app, name="repo")
app.add_typer(export.app, name="export")
app.add_typer(util.app, name="util")


@app.command()
def tui():
    """Launch the interactive TUI for pipeline management.

    The TUI provides a visual interface for:
    - Browsing and running pipeline commands
    - Viewing data files and their status
    - Monitoring command output

    Requires a terminal that supports rich text rendering.
    """
    from ..tui.app import main as tui_main
    tui_main()


def main():
    """Entry point for the CLI."""
    app()


if __name__ == "__main__":
    main()
