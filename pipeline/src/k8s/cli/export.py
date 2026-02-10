"""Data export commands."""

from pathlib import Path

import typer
from rich.console import Console

from ..output.parquet import export_to_parquet

app = typer.Typer(name="export", help="Data export")
console = Console()


@app.command()
def parquet(
    output_dir: str | None = typer.Option(None, "--output", "-o", help="Output directory"),
    backend: str = typer.Option("pyarrow", "--backend", "-b", help="Export backend: pyarrow or duckdb"),
):
    """Export all data to Parquet files for DuckDB WASM.

    This is the critical step - the UI reads ONLY from Parquet files.
    Always run this after updating any JSON data.
    """
    export_to_parquet(Path(output_dir) if output_dir else None, backend=backend)


@app.command()
def docs(
    output: str | None = typer.Option(
        None, "--output", "-o",
        help="Output file path (default: docs/data-model.md)"
    ),
):
    """Generate schema documentation from PyArrow schema definitions.

    Reads the schema definitions in schemas.py and generates markdown
    documentation that accurately reflects the current schema.
    """
    from ..output.schema_docs import write_schema_docs

    try:
        path = write_schema_docs(Path(output) if output else None)
        console.print(f"[green]✓[/green] Generated schema docs: {path}")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def types(
    output: str | None = typer.Option(
        None, "--output", "-o",
        help="Output file path (default: packages/web/src/shared/types/db-types.ts)"
    ),
):
    """Generate TypeScript types from PyArrow schema definitions.

    Creates TypeScript interfaces for each DuckDB table, ensuring
    frontend types stay in sync with the database schema.

    Example:
        uv run k8s-pipeline export types
        uv run k8s-pipeline export types -o src/types/db.ts
    """
    from ..output.typescript_types import write_types

    try:
        path = write_types(Path(output) if output else None)
        console.print(f"[green]✓[/green] Generated TypeScript types: {path}")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command(name="all")
def export_all(
    output_dir: str | None = typer.Option(None, "--output", "-o", help="Output directory for parquet"),
    backend: str = typer.Option("pyarrow", "--backend", "-b", help="Parquet backend: pyarrow or duckdb"),
):
    """Export everything: parquet files, schema docs, and TypeScript types.

    Convenience command that runs:
      1. export parquet - Generate Parquet files for DuckDB WASM
      2. export docs - Generate schema documentation
      3. export types - Generate TypeScript types

    Example:
        uv run k8s-pipeline export all
    """
    from ..output.schema_docs import write_schema_docs
    from ..output.typescript_types import write_types

    console.print("[bold]Exporting all...[/bold]\n")

    # 1. Parquet
    console.print("[cyan]1/3[/cyan] Exporting Parquet files...")
    export_to_parquet(Path(output_dir) if output_dir else None, backend=backend)

    # 2. Docs
    console.print("\n[cyan]2/3[/cyan] Generating schema docs...")
    try:
        docs_path = write_schema_docs(None)
        console.print(f"  [green]✓[/green] {docs_path}")
    except Exception as e:
        console.print(f"  [red]✗[/red] Error: {e}")

    # 3. Types
    console.print("\n[cyan]3/3[/cyan] Generating TypeScript types...")
    try:
        types_path = write_types(None)
        console.print(f"  [green]✓[/green] {types_path}")
    except Exception as e:
        console.print(f"  [red]✗[/red] Error: {e}")

    console.print("\n[bold green]Done![/bold green]")


@app.command()
def benchmark(
    include_lance: bool = typer.Option(False, "--lance", "-l", help="Include Lance format"),
    include_vortex: bool = typer.Option(False, "--vortex", "-v", help="Include Vortex format"),
    include_duckdb_native: bool = typer.Option(True, "--duckdb-native/--no-duckdb-native", help="Include DuckDB native"),
    per_table: bool = typer.Option(False, "--per-table", "-t", help="Show per-table breakdown"),
):
    """Benchmark different columnar file formats.

    Compares disk size and export time for:
    - Parquet (PyArrow) - default, used by frontend
    - Parquet (DuckDB) - alternative Parquet writer
    - Lance - ML-optimized columnar format (optional)
    - Vortex - state-of-the-art columnar format (optional)
    - DuckDB native - single database file

    NOTE: Lance and Vortex are NOT supported in DuckDB WASM.
    """
    from ..output.parquet.benchmark import print_per_table_comparison, print_results, run_benchmark

    results = run_benchmark(
        include_lance=include_lance,
        include_vortex=include_vortex,
        include_duckdb_native=include_duckdb_native,
    )
    print_results(results)

    if per_table:
        print_per_table_comparison()
