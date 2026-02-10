"""Utility commands."""

import typer
from rich.console import Console

app = typer.Typer(name="util", help="Utilities")
console = Console()


@app.command("clear-cache")
def clear_cache_cmd():
    """Clear the OpenAPI spec cache."""
    from ..transform.openapi.tree_parser import clear_openapi_cache
    clear_openapi_cache()
    console.print("[green]✓[/green] Cache cleared")
