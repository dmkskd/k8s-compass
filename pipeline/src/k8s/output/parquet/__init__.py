"""Parquet export modules for DuckDB WASM.

Main modules:
- pyarrow.py: Production Parquet exporter (actively maintained)
- schemas.py: PyArrow schema definitions
- exporter.py: Interface that delegates to pyarrow or benchmark exporters

Benchmark modules (in benchmark/ subfolder):
- benchmark/benchmark.py: Format comparison tool
- benchmark/duckdb.py: DuckDB-based Parquet exporter (not maintained)
- benchmark/duckdb_native.py: DuckDB native database format
- benchmark/lance_exporter.py: Lance format (experimental)
- benchmark/vortex_exporter.py: Vortex format (experimental)
"""

from .exporter import export_to_parquet

__all__ = ["export_to_parquet"]
