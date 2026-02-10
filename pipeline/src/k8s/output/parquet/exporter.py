"""Parquet export interface - delegates to PyArrow (production exporter).

Also provides access to experimental format exporters (in benchmark/ subfolder):
- DuckDB Parquet exporter (not actively maintained)
- Lance format exporter
- Vortex format exporter
- DuckDB native database format
- Benchmarking tools

⚠️  PRODUCTION NOTE:
PyArrow is the only actively maintained exporter. All new tables and columns
should be added to pyarrow.py first. The benchmark exporters may be out of sync.
"""

from pathlib import Path
from typing import Literal


def export_to_parquet(
    output_dir: Path | None = None, backend: Literal["pyarrow", "duckdb"] = "pyarrow"
) -> None:
    """
    Export JSON data to Parquet files.

    Args:
        output_dir: Output directory (default: packages/web/public/data/parquet/)
        backend: "pyarrow" (default, actively maintained) or "duckdb" (not maintained, may be incomplete)

    Note:
        The DuckDB backend is NOT actively maintained and may be missing newer tables
        (providers, provider_versions) and columns. Use PyArrow for production.
    """
    if backend == "duckdb":
        from .benchmark.duckdb import export_to_parquet as duckdb_export

        duckdb_export(output_dir)
    else:
        from .pyarrow import export_to_parquet as pyarrow_export

        pyarrow_export(output_dir)


def export_to_lance(output_dir: Path | None = None) -> int:
    """Export to Lance format (experimental, not supported in WASM).

    Requires: pip install pylance
    Returns total size in bytes.
    """
    from .benchmark.lance_exporter import export_to_lance as lance_export

    return lance_export(output_dir)


def export_to_vortex(output_dir: Path | None = None) -> int:
    """Export to Vortex format (experimental, not supported in WASM).

    Requires: pip install vortex-array
    Returns total size in bytes.
    """
    from .benchmark.vortex_exporter import export_to_vortex as vortex_export

    return vortex_export(output_dir)


def export_to_duckdb_native(output_dir: Path | None = None) -> int:
    """Export to DuckDB native database format.

    Creates a single .duckdb file containing all tables.
    Returns total size in bytes.
    """
    from .benchmark.duckdb_native import export_to_duckdb_native as native_export

    return native_export(output_dir)


def run_format_benchmark(
    include_lance: bool = False,
    include_vortex: bool = False,
    include_duckdb_native: bool = True,
) -> None:
    """Run benchmarks comparing all format exporters.

    Args:
        include_lance: Include Lance format (requires pylance)
        include_vortex: Include Vortex format (requires vortex-array)
        include_duckdb_native: Include DuckDB native format
    """
    from .benchmark.benchmark import print_results, run_benchmark

    results = run_benchmark(
        include_lance=include_lance,
        include_vortex=include_vortex,
        include_duckdb_native=include_duckdb_native,
    )
    print_results(results)
