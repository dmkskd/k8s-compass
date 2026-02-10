"""Export data to Lance format.

Lance is a modern columnar data format optimized for ML/AI workloads.
It offers faster random access than Parquet (100-200x) and faster scans (2-10x).

NOTE: Lance format is NOT supported in DuckDB WASM, so this is for
experimentation and benchmarking only. The frontend still requires Parquet.

IMPORTANT: Lance is optimized for ML workloads (vectors, embeddings), not JSON blob storage.
For tables with large JSON columns (like `kinds` with `schema_json`), Lance will be
significantly larger than Parquet with ZSTD compression. This is expected behavior -
Lance uses "transparent" compression optimized for random access, not maximum compression.

Requires: pip install pylance
"""

from pathlib import Path
from typing import Literal

from rich.console import Console

console = Console()


def export_to_lance(
    output_dir: Path | None = None,
    data_storage_version: Literal["stable", "2.0", "2.1", "legacy"] | None = None,
) -> int:
    """Export all data to Lance format.

    Args:
        output_dir: Output directory for Lance files
        data_storage_version: Lance data storage version. Options:
            - None (default): Uses latest stable version
            - "stable": Explicit stable version (same as None)
            - "2.0", "2.1": Specific versions with different compression
            - "legacy": Old format, much larger files (not recommended)

    Returns total size in bytes.
    """
    try:
        import lance
        import pyarrow as pa
    except ImportError:
        console.print("[red]Error: pylance not installed. Run: pip install pylance[/red]")
        return 0

    from ....core.config import BENCHMARK_DIR, PARQUET_DIR

    lance_dir = output_dir or (BENCHMARK_DIR / "lance")
    lance_dir.mkdir(parents=True, exist_ok=True)

    version_str = data_storage_version or "stable (default)"
    console.print(f"\n[bold]Exporting to Lance (version={version_str}): {lance_dir}[/bold]\n")

    # Load from existing parquet files
    parquet_dir = PARQUET_DIR
    if not parquet_dir.exists():
        console.print("[yellow]Warning: Parquet files not found. Run export-parquet first.[/yellow]")
        return 0

    total_size = 0

    for parquet_file in parquet_dir.glob("*.parquet"):
        table_name = parquet_file.stem
        lance_path = lance_dir / f"{table_name}.lance"

        # Read parquet and write to lance
        table = pa.parquet.read_table(parquet_file)

        # Lance write - overwrites if exists
        if lance_path.exists():
            import shutil
            shutil.rmtree(lance_path)

        # Write with specified data storage version
        lance.write_dataset(
            table,
            str(lance_path),
            data_storage_version=data_storage_version,
        )

        # Calculate size (lance creates a directory)
        size = sum(f.stat().st_size for f in lance_path.rglob("*") if f.is_file())
        total_size += size
        console.print(f"  [green]✓[/green] {table_name}.lance: {size / 1024:.1f} KB")

    console.print(
        f"\n[bold green]✓ Total Lance size: {total_size / 1024 / 1024:.2f} MB[/bold green]"
    )

    return total_size
