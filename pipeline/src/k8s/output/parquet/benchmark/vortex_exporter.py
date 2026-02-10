"""Export data to Vortex format.

Vortex is an extensible, state-of-the-art columnar file format with:
- 100-200x faster random access than Parquet
- 2-10x faster scans than Parquet
- Optimized for "transparent" compression that allows compute without decompression

NOTE: Vortex format is NOT supported in DuckDB WASM, so this is for
experimentation and benchmarking only. The frontend still requires Parquet.

IMPORTANT: Vortex is optimized for ML/analytical workloads, not JSON blob storage.
For tables with large JSON columns (like `kinds` with `schema_json`), Vortex will
be significantly larger than Parquet with ZSTD compression. This is expected behavior.

Requires: pip install vortex-data
"""

from pathlib import Path

from rich.console import Console

console = Console()


def export_to_vortex(output_dir: Path | None = None, use_compact: bool = True) -> int:
    """Export all data to Vortex format.

    Args:
        output_dir: Output directory for Vortex files
        use_compact: Use VortexWriteOptions.compact() for better compression (default: True)

    Returns total size in bytes.
    """
    try:
        import vortex
        from vortex.io import VortexWriteOptions
    except ImportError:
        console.print("[red]Error: vortex-data not installed. Run: pip install vortex-data[/red]")
        return 0

    import pyarrow.parquet as pq

    from ....core.config import BENCHMARK_DIR, PARQUET_DIR

    vortex_dir = output_dir or (BENCHMARK_DIR / "vortex")
    vortex_dir.mkdir(parents=True, exist_ok=True)

    mode = "compact" if use_compact else "default"
    console.print(f"\n[bold]Exporting to Vortex ({mode}): {vortex_dir}[/bold]\n")

    # Load from existing parquet files
    parquet_dir = PARQUET_DIR
    if not parquet_dir.exists():
        console.print("[yellow]Warning: Parquet files not found. Run export-parquet first.[/yellow]")
        return 0

    total_size = 0

    for parquet_file in parquet_dir.glob("*.parquet"):
        table_name = parquet_file.stem
        vortex_path = vortex_dir / f"{table_name}.vortex"

        try:
            # Read parquet table
            table = pq.read_table(parquet_file)

            # Convert to RecordBatchReader for streaming to Vortex
            reader = table.to_reader()

            # Write using VortexWriteOptions for better compression
            if use_compact:
                opts = VortexWriteOptions.compact()
                opts.write_path(reader, str(vortex_path))
            else:
                vortex.io.write(reader, str(vortex_path))

            size = vortex_path.stat().st_size
            total_size += size
            console.print(f"  [green]✓[/green] {table_name}.vortex: {size / 1024:.1f} KB")
        except Exception as e:
            console.print(f"  [yellow]⚠[/yellow] {table_name}.vortex: {e}")

    console.print(
        f"\n[bold green]✓ Total Vortex size: {total_size / 1024 / 1024:.2f} MB[/bold green]"
    )

    return total_size
