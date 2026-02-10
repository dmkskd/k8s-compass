"""Benchmark and experimental format exporters.

This module contains:
- benchmark.py: Format comparison tool
- duckdb.py: DuckDB-based Parquet exporter (NOT actively maintained)
- duckdb_native.py: DuckDB native database format exporter
- lance_exporter.py: Lance format exporter (experimental)
- vortex_exporter.py: Vortex format exporter (experimental)

⚠️  NOTE: These exporters are for benchmarking and experimentation only.
The PyArrow exporter (../pyarrow.py) is the production exporter used by the frontend.
Lance and Vortex are NOT supported in DuckDB WASM.
"""

from .benchmark import print_results, run_benchmark
from .duckdb import export_to_parquet as export_to_parquet_duckdb
from .duckdb_native import export_to_duckdb_native, export_to_duckdb_native_compressed
from .lance_exporter import export_to_lance
from .vortex_exporter import export_to_vortex

__all__ = [
    "run_benchmark",
    "print_results",
    "export_to_parquet_duckdb",
    "export_to_duckdb_native",
    "export_to_duckdb_native_compressed",
    "export_to_lance",
    "export_to_vortex",
]
