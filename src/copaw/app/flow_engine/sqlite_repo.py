# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .models import (
    FLOW_ENGINE_SCHEMA_VERSION,
    FlowCommandRecord,
    FlowDefinition,
    FlowEventRecord,
    FlowRunRecord,
)


class SQLiteFlowEngineRepository:
    """SQLite-backed repository for the minimal flow engine kernel."""

    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path).expanduser()

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.database_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @staticmethod
    def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {str(row["name"]) for row in rows}

    @classmethod
    def _ensure_agent_id_columns(cls, conn: sqlite3.Connection) -> None:
        run_columns = cls._table_columns(conn, "flow_runs")
        if "agent_id" not in run_columns:
            conn.execute("ALTER TABLE flow_runs ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''")

        event_columns = cls._table_columns(conn, "flow_events")
        if "agent_id" not in event_columns:
            conn.execute("ALTER TABLE flow_events ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''")

        command_columns = cls._table_columns(conn, "flow_commands")
        if "agent_id" not in command_columns:
            conn.execute("ALTER TABLE flow_commands ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''")

    @staticmethod
    def _json_dumps(payload: dict | list | None) -> str:
        return json.dumps(payload or {}, ensure_ascii=False, sort_keys=True)

    @staticmethod
    def _json_loads(raw: str | None) -> dict:
        if not raw:
            return {}
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}

    def ensure_schema(self) -> Path:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS flow_meta (
                    meta_key TEXT PRIMARY KEY,
                    meta_value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS flow_definitions (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    version TEXT NOT NULL,
                    description TEXT NOT NULL,
                    steps_json TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    system_owned INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS flow_runs (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL DEFAULT '',
                    definition_id TEXT NOT NULL,
                    scope_kind TEXT NOT NULL,
                    scope_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 100,
                    idempotency_key TEXT NOT NULL DEFAULT '',
                    current_step_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (definition_id) REFERENCES flow_definitions(id)
                );

                CREATE TABLE IF NOT EXISTS flow_events (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL DEFAULT '',
                    run_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT '',
                    step_id TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES flow_runs(id)
                );

                CREATE TABLE IF NOT EXISTS flow_commands (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL DEFAULT '',
                    run_id TEXT NOT NULL,
                    command_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES flow_runs(id)
                );

                CREATE INDEX IF NOT EXISTS idx_flow_runs_scope
                    ON flow_runs(scope_kind, scope_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_flow_runs_agent_scope
                    ON flow_runs(agent_id, scope_kind, scope_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_flow_events_run
                    ON flow_events(run_id, created_at ASC);
                CREATE INDEX IF NOT EXISTS idx_flow_events_agent_run
                    ON flow_events(agent_id, run_id, created_at ASC);
                CREATE INDEX IF NOT EXISTS idx_flow_commands_run
                    ON flow_commands(run_id, created_at ASC);
                CREATE INDEX IF NOT EXISTS idx_flow_commands_agent_run
                    ON flow_commands(agent_id, run_id, created_at ASC);
                """
            )
            self._ensure_agent_id_columns(conn)
            conn.execute(
                """
                INSERT OR REPLACE INTO flow_meta(meta_key, meta_value, updated_at)
                VALUES ('schema_version', ?, CURRENT_TIMESTAMP)
                """,
                [str(FLOW_ENGINE_SCHEMA_VERSION)],
            )
        return self.database_path

    def get_schema_version(self) -> int:
        self.ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT meta_value FROM flow_meta WHERE meta_key = 'schema_version'"
            ).fetchone()
        return int(str(row["meta_value"]) if row else FLOW_ENGINE_SCHEMA_VERSION)

    def upsert_definition(self, definition: FlowDefinition) -> FlowDefinition:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO flow_definitions(
                    id, name, version, description, steps_json, tags_json,
                    system_owned, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    definition.id,
                    definition.name,
                    definition.version,
                    definition.description,
                    self._json_dumps([step.model_dump(mode="json") for step in definition.steps]),
                    self._json_dumps(definition.tags),
                    1 if definition.system_owned else 0,
                    definition.created_at,
                    definition.updated_at,
                ],
            )
        return definition

    def get_definition(self, definition_id: str) -> FlowDefinition | None:
        self.ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM flow_definitions WHERE id = ?",
                [definition_id],
            ).fetchone()
        if row is None:
            return None
        steps_raw = json.loads(str(row["steps_json"])) if row["steps_json"] else []
        tags_raw = json.loads(str(row["tags_json"])) if row["tags_json"] else []
        return FlowDefinition.model_validate(
            {
                "id": row["id"],
                "name": row["name"],
                "version": row["version"],
                "description": row["description"],
                "steps": steps_raw if isinstance(steps_raw, list) else [],
                "tags": tags_raw if isinstance(tags_raw, list) else [],
                "system_owned": bool(row["system_owned"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )

    def list_definitions(self) -> list[FlowDefinition]:
        self.ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM flow_definitions ORDER BY updated_at DESC"
            ).fetchall()
        definitions: list[FlowDefinition] = []
        for row in rows:
            steps_raw = json.loads(str(row["steps_json"])) if row["steps_json"] else []
            tags_raw = json.loads(str(row["tags_json"])) if row["tags_json"] else []
            definitions.append(
                FlowDefinition.model_validate(
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "version": row["version"],
                        "description": row["description"],
                        "steps": steps_raw if isinstance(steps_raw, list) else [],
                        "tags": tags_raw if isinstance(tags_raw, list) else [],
                        "system_owned": bool(row["system_owned"]),
                        "created_at": row["created_at"],
                        "updated_at": row["updated_at"],
                    }
                )
            )
        return definitions

    def insert_run(self, run: FlowRunRecord) -> FlowRunRecord:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO flow_runs(
                    id, agent_id, definition_id, scope_kind, scope_id, status, priority,
                    idempotency_key, current_step_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    run.id,
                    run.agent_id,
                    run.definition_id,
                    run.scope_kind,
                    run.scope_id,
                    run.status,
                    run.priority,
                    run.idempotency_key,
                    run.current_step_id,
                    run.created_at,
                    run.updated_at,
                ],
            )
        return run

    def get_run(self, run_id: str, *, agent_id: str | None = None) -> FlowRunRecord | None:
        self.ensure_schema()
        params: list[str] = [run_id]
        sql = "SELECT * FROM flow_runs WHERE id = ?"
        if agent_id is not None:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        with self._connect() as conn:
            row = conn.execute(sql, params).fetchone()
        if row is None:
            return None
        return FlowRunRecord.model_validate(dict(row))

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        scope_kind: str | None = None,
        scope_id: str | None = None,
    ) -> list[FlowRunRecord]:
        self.ensure_schema()
        clauses: list[str] = []
        params: list[str] = []
        if agent_id is not None:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        if scope_kind:
            clauses.append("scope_kind = ?")
            params.append(scope_kind)
        if scope_id:
            clauses.append("scope_id = ?")
            params.append(scope_id)
        sql = "SELECT * FROM flow_runs"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at DESC"
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [FlowRunRecord.model_validate(dict(row)) for row in rows]

    def update_run_status(
        self,
        run_id: str,
        *,
        agent_id: str,
        status: str,
        current_step_id: str = "",
        updated_at: str,
    ) -> FlowRunRecord:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE flow_runs
                SET status = ?, current_step_id = ?, updated_at = ?
                WHERE id = ? AND agent_id = ?
                """,
                [status, current_step_id, updated_at, run_id, agent_id],
            )
        run = self.get_run(run_id, agent_id=agent_id)
        if run is None:
            raise KeyError(f"Flow run '{run_id}' not found")
        return run

    def append_event(self, event: FlowEventRecord) -> FlowEventRecord:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO flow_events(id, agent_id, run_id, event_type, status, step_id, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    event.id,
                    event.agent_id,
                    event.run_id,
                    event.event_type,
                    event.status,
                    event.step_id,
                    self._json_dumps(event.payload),
                    event.created_at,
                ],
            )
        return event

    def list_events(self, run_id: str, *, agent_id: str | None = None) -> list[FlowEventRecord]:
        self.ensure_schema()
        params: list[str] = [run_id]
        sql = "SELECT * FROM flow_events WHERE run_id = ?"
        if agent_id is not None:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        sql += " ORDER BY created_at ASC"
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [
            FlowEventRecord.model_validate(
                {
                    "id": row["id"],
                    "agent_id": row["agent_id"],
                    "run_id": row["run_id"],
                    "event_type": row["event_type"],
                    "status": row["status"],
                    "step_id": row["step_id"],
                    "payload": self._json_loads(row["payload_json"]),
                    "created_at": row["created_at"],
                }
            )
            for row in rows
        ]

    def insert_command(self, command: FlowCommandRecord) -> FlowCommandRecord:
        self.ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO flow_commands(id, agent_id, run_id, command_type, payload_json, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    command.id,
                    command.agent_id,
                    command.run_id,
                    command.command_type,
                    self._json_dumps(command.payload),
                    command.status,
                    command.created_at,
                    command.updated_at,
                ],
            )
        return command

    def list_commands(self, run_id: str, *, agent_id: str | None = None) -> list[FlowCommandRecord]:
        self.ensure_schema()
        params: list[str] = [run_id]
        sql = "SELECT * FROM flow_commands WHERE run_id = ?"
        if agent_id is not None:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        sql += " ORDER BY created_at ASC"
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [
            FlowCommandRecord.model_validate(
                {
                    "id": row["id"],
                    "agent_id": row["agent_id"],
                    "run_id": row["run_id"],
                    "command_type": row["command_type"],
                    "payload": self._json_loads(row["payload_json"]),
                    "status": row["status"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            )
            for row in rows
        ]