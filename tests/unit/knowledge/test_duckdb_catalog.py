# -*- coding: utf-8 -*-

import json

import pytest

from copaw.knowledge.duckdb_catalog import DuckDBKnowledgeCatalog


duckdb = pytest.importorskip("duckdb")


def test_ensure_layout_creates_duckdb_directories(tmp_path):
    catalog = DuckDBKnowledgeCatalog(tmp_path, knowledge_dirname=".knowledge")

    result = catalog.ensure_layout()

    assert catalog.duckdb_root.is_dir()
    assert catalog.catalog_dir.is_dir()
    assert catalog.parquet_dir.is_dir()
    assert catalog.staging_dir.is_dir()
    assert catalog.snapshots_dir.is_dir()
    assert catalog.layout_meta_path.is_file()
    assert result["database_path"].endswith("knowledge_catalog.duckdb")

    layout = json.loads(catalog.layout_meta_path.read_text(encoding="utf-8"))
    assert layout["layout_version"] == 1
    assert layout["schema_version"] == 1


def test_ensure_schema_creates_catalog_tables(tmp_path):
    catalog = DuckDBKnowledgeCatalog(tmp_path, knowledge_dirname=".knowledge")

    database_path = catalog.ensure_schema()

    assert database_path.endswith("knowledge_catalog.duckdb")
    assert catalog.database_path.is_file()

    with duckdb.connect(str(catalog.database_path), read_only=True) as conn:
        table_names = {
            row[0]
            for row in conn.execute("SHOW TABLES").fetchall()
        }

    assert "catalog_meta" in table_names
    assert "materialization_runs" in table_names
    assert "materialization_watermarks" in table_names


def test_record_run_and_watermark_roundtrip(tmp_path):
    catalog = DuckDBKnowledgeCatalog(tmp_path, knowledge_dirname=".knowledge")

    started = catalog.record_materialization_run_started(
        run_id="run-001",
        stage="l1",
        source_id="project-demo-workspace",
        snapshot_id="snapshot-001",
        metadata={"trigger": "manual"},
    )
    finished = catalog.record_materialization_run_finished(
        run_id="run-001",
        status="succeeded",
        rows_written=42,
        metadata={"mode": "agentic"},
    )
    watermark = catalog.update_watermark(
        watermark_key="project:project-demo-workspace:l1",
        watermark_value="snapshot-001",
        metadata={"rows": 42},
    )

    run_row = catalog.get_materialization_run("run-001")
    watermark_row = catalog.get_watermark("project:project-demo-workspace:l1")

    assert started["status"] == "running"
    assert finished["status"] == "succeeded"
    assert finished["rows_written"] == 42
    assert watermark["watermark_value"] == "snapshot-001"

    assert run_row is not None
    assert run_row["status"] == "succeeded"
    assert run_row["rows_written"] == 42

    assert watermark_row is not None
    assert watermark_row["watermark_value"] == "snapshot-001"
