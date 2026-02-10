"""Benchmark tool for comparing different columnar file formats.

Compares:
- Parquet (PyArrow) - default, used by frontend, best for JSON data
- Parquet (DuckDB) - alternative Parquet writer
- Lance - ML-optimized columnar format (poor JSON compression)
- Vortex - state-of-the-art columnar format (moderate JSON compression)
- DuckDB native - single database file
- DuckDB native + zstd - compressed database file

IMPORTANT: Lance and Vortex are optimized for ML/analytical workloads with
vectors and embeddings, NOT for JSON blob storage. For tables with large JSON
columns (like `kinds` with `schema_json`), they will be significantly larger
than Parquet with ZSTD compression. This is expected behavior.

Usage:
    uv run k8s-pipeline benchmark-formats
    uv run k8s-pipeline benchmark-formats --lance --vortex
"""

import time
from dataclasses import dataclass

from rich.console import Console
from rich.table import Table

from ....core.config import BENCHMARK_DIR, PARQUET_DIR

console = Console()


@dataclass
class FormatResult:
    """Results for a single format."""

    name: str
    total_size_bytes: int
    export_time_seconds: float
    file_count: int
    available: bool = True
    error: str | None = None

    @property
    def size_mb(self) -> float:
        return self.total_size_bytes / 1024 / 1024

    @property
    def size_kb(self) -> float:
        return self.total_size_bytes / 1024


def benchmark_pyarrow_parquet() -> FormatResult:
    """Benchmark PyArrow Parquet export."""
    from ..pyarrow import export_to_parquet

    output_dir = BENCHMARK_DIR / "benchmark" / "parquet_pyarrow"
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    export_to_parquet(output_dir)
    elapsed = time.time() - start

    total_size = sum(f.stat().st_size for f in output_dir.glob("*.parquet"))
    file_count = len(list(output_dir.glob("*.parquet")))

    return FormatResult(
        name="Parquet (PyArrow)",
        total_size_bytes=total_size,
        export_time_seconds=elapsed,
        file_count=file_count,
    )


def benchmark_duckdb_parquet() -> FormatResult:
    """Benchmark DuckDB Parquet export."""
    try:
        import duckdb  # noqa: F401
    except ImportError:
        return FormatResult(
            name="Parquet (DuckDB)",
            total_size_bytes=0,
            export_time_seconds=0,
            file_count=0,
            available=False,
            error="duckdb not installed",
        )

    from .duckdb import export_to_parquet

    output_dir = BENCHMARK_DIR / "benchmark" / "parquet_duckdb"
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    export_to_parquet(output_dir)
    elapsed = time.time() - start

    total_size = sum(f.stat().st_size for f in output_dir.glob("*.parquet"))
    file_count = len(list(output_dir.glob("*.parquet")))

    return FormatResult(
        name="Parquet (DuckDB)",
        total_size_bytes=total_size,
        export_time_seconds=elapsed,
        file_count=file_count,
    )


def benchmark_lance() -> FormatResult:
    """Benchmark Lance export."""
    try:
        import lance  # noqa: F401
    except ImportError:
        return FormatResult(
            name="Lance",
            total_size_bytes=0,
            export_time_seconds=0,
            file_count=0,
            available=False,
            error="pylance not installed (pip install pylance)",
        )

    from .lance_exporter import export_to_lance

    output_dir = BENCHMARK_DIR / "benchmark" / "lance"
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    # Use stable data_storage_version (default, best compression)
    total_size = export_to_lance(output_dir, data_storage_version="stable")
    elapsed = time.time() - start

    file_count = len(list(output_dir.glob("*.lance")))

    return FormatResult(
        name="Lance",
        total_size_bytes=total_size,
        export_time_seconds=elapsed,
        file_count=file_count,
    )


def benchmark_vortex() -> FormatResult:
    """Benchmark Vortex export."""
    try:
        import vortex  # noqa: F401
    except ImportError:
        return FormatResult(
            name="Vortex (compact)",
            total_size_bytes=0,
            export_time_seconds=0,
            file_count=0,
            available=False,
            error="vortex-data not installed (pip install vortex-data)",
        )

    from .vortex_exporter import export_to_vortex

    output_dir = BENCHMARK_DIR / "benchmark" / "vortex"
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    # Use compact mode for better compression
    total_size = export_to_vortex(output_dir, use_compact=True)
    elapsed = time.time() - start

    file_count = len(list(output_dir.glob("*.vortex")))

    return FormatResult(
        name="Vortex (compact)",
        total_size_bytes=total_size,
        export_time_seconds=elapsed,
        file_count=file_count,
    )


def benchmark_duckdb_native() -> FormatResult:
    """Benchmark DuckDB native format export."""
    try:
        import duckdb  # noqa: F401
    except ImportError:
        return FormatResult(
            name="DuckDB Native",
            total_size_bytes=0,
            export_time_seconds=0,
            file_count=0,
            available=False,
            error="duckdb not installed",
        )

    from .duckdb_native import export_to_duckdb_native

    output_dir = BENCHMARK_DIR / "benchmark" / "duckdb_native"
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    total_size = export_to_duckdb_native(output_dir)
    elapsed = time.time() - start

    return FormatResult(
        name="DuckDB Native",
        total_size_bytes=total_size,
        export_time_seconds=elapsed,
        file_count=1,
    )


def benchmark_duckdb_native_compressed() -> FormatResult:
    """Benchmark DuckDB native format with zstd compression."""
    try:
        import duckdb  # noqa: F401
        import zstandard  # noqa: F401
    except ImportError as e:
        return FormatResult(
            name="DuckDB Native + zstd",
            total_size_bytes=0,
            export_time_seconds=0,
            file_count=0,
            available=False,
            error=f"Missing dependency: {e}",
        )

    from .duckdb_native import export_to_duckdb_native_compressed

    output_dir = BENCHMARK_DIR / "benchmark" / "duckdb_native_zstd"
    output_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    total_size = export_to_duckdb_native_compressed(output_dir)
    elapsed = time.time() - start

    return FormatResult(
        name="DuckDB Native + zstd",
        total_size_bytes=total_size,
        export_time_seconds=elapsed,
        file_count=1,
    )


def run_benchmark(
    include_lance: bool = False,
    include_vortex: bool = False,
    include_duckdb_native: bool = True,
) -> list[FormatResult]:
    """Run benchmarks for all requested formats.

    Args:
        include_lance: Include Lance format (requires pylance)
        include_vortex: Include Vortex format (requires vortex-array)
        include_duckdb_native: Include DuckDB native format

    Returns:
        List of FormatResult objects
    """
    console.print("\n[bold blue]═══ Format Benchmark ═══[/bold blue]\n")

    # Check that parquet files exist (needed as source for some formats)
    parquet_dir = PARQUET_DIR
    if not parquet_dir.exists() or not list(parquet_dir.glob("*.parquet")):
        console.print("[yellow]Warning: No parquet files found. Running PyArrow export first...[/yellow]\n")
        from ..pyarrow import export_to_parquet
        export_to_parquet()
        console.print()

    results: list[FormatResult] = []

    # Always run Parquet benchmarks
    console.print("[bold]1. Parquet (PyArrow)[/bold]")
    results.append(benchmark_pyarrow_parquet())

    console.print("\n[bold]2. Parquet (DuckDB)[/bold]")
    results.append(benchmark_duckdb_parquet())

    if include_lance:
        console.print("\n[bold]3. Lance[/bold]")
        results.append(benchmark_lance())

    if include_vortex:
        console.print("\n[bold]4. Vortex[/bold]")
        results.append(benchmark_vortex())

    if include_duckdb_native:
        console.print("\n[bold]5. DuckDB Native[/bold]")
        results.append(benchmark_duckdb_native())

        console.print("\n[bold]6. DuckDB Native + zstd[/bold]")
        results.append(benchmark_duckdb_native_compressed())

    return results


def print_results(results: list[FormatResult]) -> None:
    """Print benchmark results in a nice table."""
    console.print("\n[bold blue]═══ Benchmark Results ═══[/bold blue]\n")

    # Find baseline (PyArrow Parquet)
    baseline = next((r for r in results if "PyArrow" in r.name), results[0])

    table = Table(title="Format Comparison")
    table.add_column("Format", style="cyan")
    table.add_column("Size", justify="right")
    table.add_column("vs Baseline", justify="right")
    table.add_column("Time", justify="right")
    table.add_column("Files", justify="right")
    table.add_column("Status")

    for result in results:
        if not result.available:
            table.add_row(
                result.name,
                "-",
                "-",
                "-",
                "-",
                f"[red]✗ {result.error}[/red]",
            )
            continue

        size_str = f"{result.size_mb:.2f} MB" if result.size_mb >= 1 else f"{result.size_kb:.1f} KB"

        # Calculate ratio vs baseline
        if baseline.total_size_bytes > 0:
            ratio = result.total_size_bytes / baseline.total_size_bytes
            if ratio < 1:
                ratio_str = f"[green]{ratio:.2f}x[/green]"
            elif ratio > 1:
                ratio_str = f"[red]{ratio:.2f}x[/red]"
            else:
                ratio_str = "1.00x"
        else:
            ratio_str = "-"

        time_str = f"{result.export_time_seconds:.1f}s"

        table.add_row(
            result.name,
            size_str,
            ratio_str,
            time_str,
            str(result.file_count),
            "[green]✓[/green]",
        )

    console.print(table)

    # Print notes
    console.print("\n[dim]Notes:[/dim]")
    console.print("[dim]- Parquet (PyArrow) is the baseline and is used by the frontend[/dim]")
    console.print("[dim]- Lance and Vortex are NOT supported in DuckDB WASM (frontend)[/dim]")
    console.print("[dim]- Lance/Vortex are optimized for ML workloads, not JSON compression[/dim]")
    console.print("[dim]- The `kinds` table has ~60MB of JSON schemas, causing large Lance/Vortex files[/dim]")
    console.print("[dim]- DuckDB Native would require loading entire DB into browser memory[/dim]")
    console.print("[dim]- Smaller size = better for network transfer[/dim]")


def get_per_table_sizes() -> dict[str, dict[str, int]]:
    """Get per-table sizes for each format that was benchmarked."""
    benchmark_dir = BENCHMARK_DIR / "benchmark"
    if not benchmark_dir.exists():
        return {}

    sizes: dict[str, dict[str, int]] = {}

    # PyArrow Parquet
    pyarrow_dir = benchmark_dir / "parquet_pyarrow"
    if pyarrow_dir.exists():
        sizes["Parquet (PyArrow)"] = {
            f.stem: f.stat().st_size for f in pyarrow_dir.glob("*.parquet")
        }

    # DuckDB Parquet
    duckdb_dir = benchmark_dir / "parquet_duckdb"
    if duckdb_dir.exists():
        sizes["Parquet (DuckDB)"] = {
            f.stem: f.stat().st_size for f in duckdb_dir.glob("*.parquet")
        }

    # Lance
    lance_dir = benchmark_dir / "lance"
    if lance_dir.exists():
        sizes["Lance"] = {}
        for d in lance_dir.glob("*.lance"):
            if d.is_dir():
                sizes["Lance"][d.stem] = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())

    # Vortex
    vortex_dir = benchmark_dir / "vortex"
    if vortex_dir.exists():
        sizes["Vortex"] = {
            f.stem: f.stat().st_size for f in vortex_dir.glob("*.vortex")
        }

    return sizes


def print_per_table_comparison() -> None:
    """Print per-table size comparison."""
    sizes = get_per_table_sizes()
    if not sizes:
        console.print("[yellow]No benchmark data found. Run benchmark-formats first.[/yellow]")
        return

    console.print("\n[bold blue]═══ Per-Table Size Comparison ═══[/bold blue]\n")

    # Get all table names
    all_tables = set()
    for format_sizes in sizes.values():
        all_tables.update(format_sizes.keys())

    table = Table(title="Size by Table (KB)")
    table.add_column("Table", style="cyan")
    for format_name in sizes.keys():
        table.add_column(format_name, justify="right")

    for table_name in sorted(all_tables):
        row = [table_name]
        for format_name in sizes.keys():
            size = sizes[format_name].get(table_name, 0)
            row.append(f"{size / 1024:.1f}" if size > 0 else "-")
        table.add_row(*row)

    console.print(table)
