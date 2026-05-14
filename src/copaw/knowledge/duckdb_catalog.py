# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LAYOUT_VERSION = 1
SCHEMA_VERSION = 1


class DuckDBKnowledgeCatalog:
    """DuckDB-backed metadata catalog for knowledge materialization state."""

    def __init__(
        self,
        working_dir: Path | str,
        *,
        knowledge_dirname: str = ".knowledge",
    ) -> None:
        self.working_dir = Path(working_dir)
        self.knowledge_dirname = knowledge_dirname
        self.knowledge_root = self.working_dir / knowledge_dirname
        self.duckdb_root = self.knowledge_root / "duckdb"
        self.catalog_dir = self.duckdb_root / "catalog"
        self.parquet_dir = self.duckdb_root / "parquet"
        self.staging_dir = self.duckdb_root / "staging"
        self.snapshots_dir = self.duckdb_root / "snapshots"
        self.layout_meta_path = self.duckdb_root / "layout.json"
        self.database_path = self.catalog_dir / "knowledge_catalog.duckdb"

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _to_json(value: dict[str, Any] | None) -> str:
        if not value:
            return "{}"
        return json.dumps(value, ensure_ascii=False, sort_keys=True)

    @staticmethod
    def _load_duckdb_module() -> Any:
        try:
            import duckdb  # type: ignore

            return duckdb
        except ImportError as exc:
            raise RuntimeError(
                "duckdb is required for DuckDBKnowledgeCatalog. "
                "Install dependencies with `pip install duckdb` or project extras."
            ) from exc

    def ensure_layout(self) -> dict[str, str]:
        self.catalog_dir.mkdir(parents=True, exist_ok=True)
        self.parquet_dir.mkdir(parents=True, exist_ok=True)
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)

        layout_meta = {
            "layout_version": LAYOUT_VERSION,
            "schema_version": SCHEMA_VERSION,
            "updated_at": self._now_iso(),
            "paths": {
                "catalog": str(self.catalog_dir),
                "parquet": str(self.parquet_dir),
                "staging": str(self.staging_dir),
                "snapshots": str(self.snapshots_dir),
                "database": str(self.database_path),
            },
        }
        self.layout_meta_path.write_text(
            json.dumps(layout_meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return {
            "duckdb_root": str(self.duckdb_root),
            "database_path": str(self.database_path),
            "layout_meta_path": str(self.layout_meta_path),
        }

    def ensure_schema(self) -> str:
        self.ensure_layout()
        duckdb = self._load_duckdb_module()

        with duckdb.connect(str(self.database_path)) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS catalog_meta (
                    meta_key TEXT PRIMARY KEY,
                    meta_value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS materialization_runs (
                    run_id TEXT PRIMARY KEY,
                    stage TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    snapshot_id TEXT,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    rows_written BIGINT DEFAULT 0,
                    error_message TEXT,
                    metadata_json TEXT DEFAULT '{}'
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS materialization_watermarks (
                    watermark_key TEXT PRIMARY KEY,
                    watermark_value TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata_json TEXT DEFAULT '{}'
                )
                """
            )

            now = self._now_iso()
            conn.execute(
                """
                INSERT OR REPLACE INTO catalog_meta (meta_key, meta_value, updated_at)
                VALUES ('layout_version', ?, ?)
                """,
                [str(LAYOUT_VERSION), now],
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO catalog_meta (meta_key, meta_value, updated_at)
                VALUES ('schema_version', ?, ?)
                """,
                [str(SCHEMA_VERSION), now],
            )

        return str(self.database_path)

    def record_materialization_run_started(
        self,
        *,
        run_id: str,
        stage: str,
        source_id: str,
        snapshot_id: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.ensure_schema()
        duckdb = self._load_duckdb_module()

        started_at = self._now_iso()
        with duckdb.connect(str(self.database_path)) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO materialization_runs (
                    run_id,
                    stage,
                    source_id,
                    snapshot_id,
                    status,
                    started_at,
                    finished_at,
                    rows_written,
                    error_message,
                    metadata_json
                )
                VALUES (?, ?, ?, ?, 'running', ?, NULL, 0, NULL, ?)
                """,
                [
                    run_id,
                    stage,
                    source_id,
                    snapshot_id,
                    started_at,
                    self._to_json(metadata),
                ],
            )

        return {
            "run_id": run_id,
            "stage": stage,
            "source_id": source_id,
            "snapshot_id": snapshot_id,
            "status": "running",
            "started_at": started_at,
        }

    def record_materialization_run_finished(
        self,
        *,
        run_id: str,
        status: str,
        rows_written: int = 0,
        error_message: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.ensure_schema()
        duckdb = self._load_duckdb_module()

        finished_at = self._now_iso()
        with duckdb.connect(str(self.database_path)) as conn:
            conn.execute(
                """
                UPDATE materialization_runs
                SET
                    status = ?,
                    finished_at = ?,
                    rows_written = ?,
                    error_message = ?,
                    metadata_json = ?
                WHERE run_id = ?
                """,
                [
                    status,
                    finished_at,
                    int(rows_written),
                    error_message,
                    self._to_json(metadata),
                    run_id,
                ],
            )

        return {
            "run_id": run_id,
            "status": status,
            "rows_written": int(rows_written),
            "finished_at": finished_at,
            "error_message": error_message,
        }

    def update_watermark(
        self,
        *,
        watermark_key: str,
        watermark_value: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.ensure_schema()
        duckdb = self._load_duckdb_module()

        updated_at = self._now_iso()
        with duckdb.connect(str(self.database_path)) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO materialization_watermarks (
                    watermark_key,
                    watermark_value,
                    updated_at,
                    metadata_json
                )
                VALUES (?, ?, ?, ?)
                """,
                [watermark_key, watermark_value, updated_at, self._to_json(metadata)],
            )

        return {
            "watermark_key": watermark_key,
            "watermark_value": watermark_value,
            "updated_at": updated_at,
        }

    def get_materialization_run(self, run_id: str) -> dict[str, Any] | None:
        self.ensure_schema()
        duckdb = self._load_duckdb_module()

        with duckdb.connect(str(self.database_path), read_only=True) as conn:
            row = conn.execute(
                """
                SELECT
                    run_id,
                    stage,
                    source_id,
                    snapshot_id,
                    status,
                    started_at,
                    finished_at,
                    rows_written,
                    error_message,
                    metadata_json
                FROM materialization_runs
                WHERE run_id = ?
                """,
                [run_id],
            ).fetchone()

        if row is None:
            return None
        return {
            "run_id": row[0],
            "stage": row[1],
            "source_id": row[2],
            "snapshot_id": row[3],
            "status": row[4],
            "started_at": row[5],
            "finished_at": row[6],
            "rows_written": row[7],
            "error_message": row[8],
            "metadata_json": row[9],
        }

    def get_watermark(self, watermark_key: str) -> dict[str, Any] | None:
        self.ensure_schema()
        duckdb = self._load_duckdb_module()

        with duckdb.connect(str(self.database_path), read_only=True) as conn:
            row = conn.execute(
                """
                SELECT watermark_key, watermark_value, updated_at, metadata_json
                FROM materialization_watermarks
                WHERE watermark_key = ?
                """,
                [watermark_key],
            ).fetchone()

        if row is None:
            return None
        return {
            "watermark_key": row[0],
            "watermark_value": row[1],
            "updated_at": row[2],
            "metadata_json": row[3],
        }
