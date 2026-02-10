"""Export data to DuckDB native database format.

This creates a single .duckdb file containing all tables.
The native format is optimized for DuckDB's query engine but uses
lightweight compression (not ZSTD) for faster query performance.

NOTE: DuckDB native format can be used with DuckDB WASM, but the file
would need to be loaded entirely into memory. For large datasets,
Parquet files are more memory-efficient as they can be queried lazily.
"""

from pathlib import Path

import duckdb
from rich.console import Console

from ....core.config import BENCHMARK_DIR, PARQUET_DIR

console = Console()


def export_to_duckdb_native(output_dir: Path | None = None) -> int:
    """Export all data to a single DuckDB database file.

    Returns total size in bytes.
    """
    db_dir = output_dir or BENCHMARK_DIR
    db_dir.mkdir(parents=True, exist_ok=True)
    db_path = db_dir / "k8s_compass.duckdb"

    console.print(f"\n[bold]Exporting to DuckDB native: {db_path}[/bold]\n")

    # Load from existing parquet files
    parquet_dir = PARQUET_DIR
    if not parquet_dir.exists():
        console.print("[yellow]Warning: Parquet files not found. Run export-parquet first.[/yellow]")
        return 0

    # Remove existing database
    if db_path.exists():
        db_path.unlink()

    # Create new database and import all parquet files
    con = duckdb.connect(str(db_path))

    total_rows = 0
    for parquet_file in parquet_dir.glob("*.parquet"):
        table_name = parquet_file.stem

        # Create table from parquet
        con.execute(f"CREATE TABLE {table_name} AS SELECT * FROM read_parquet('{parquet_file}')")

        # Get row count
        count = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        total_rows += count
        console.print(f"  [green]✓[/green] {table_name}: {count} rows")

    con.close()

    size = db_path.stat().st_size
    console.print(
        f"\n[bold green]✓ DuckDB native size: {size / 1024 / 1024:.2f} MB ({total_rows} total rows)[/bold green]"
    )

    return size


def export_to_duckdb_native_compressed(output_dir: Path | None = None) -> int:
    """Export to DuckDB native format, then compress with zstd.

    This is an experiment to see if external compression helps.
    Returns total size in bytes (compressed).
    """
    try:
        import zstandard as zstd
    except ImportError:
        console.print("[red]Error: zstandard not installed. Run: pip install zstandard[/red]")
        return 0

    db_dir = output_dir or BENCHMARK_DIR
    db_path = db_dir / "k8s_compass.duckdb"
    compressed_path = db_dir / "k8s_compass.duckdb.zst"

    # First create the native database
    native_size = export_to_duckdb_native(output_dir)
    if native_size == 0:
        return 0

    console.print("\n[bold]Compressing with zstd...[/bold]")

    # Compress with zstd
    cctx = zstd.ZstdCompressor(level=19)
    with open(db_path, "rb") as f_in:
        with open(compressed_path, "wb") as f_out:
            cctx.copy_stream(f_in, f_out)

    compressed_size = compressed_path.stat().st_size
    ratio = native_size / compressed_size if compressed_size > 0 else 0

    console.print(
        f"[bold green]✓ Compressed size: {compressed_size / 1024 / 1024:.2f} MB "
        f"(ratio: {ratio:.1f}x)[/bold green]"
    )

    return compressed_size
