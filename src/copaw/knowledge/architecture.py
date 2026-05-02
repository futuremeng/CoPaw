# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

UTC = timezone.utc

QUANTIZATION_STAGES = ("l1", "l2", "l3")


def _safe_name(value: str) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"[^a-z0-9_-]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "unknown"


def _safe_name_optional(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    return _safe_name(text)


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


class QuantizationArchitectureManager:
    """B-lane storage skeleton for staged quantization artifacts."""

    def __init__(self, project_root: Path | str, knowledge_dirname: str = ".knowledge"):
        self.project_root = Path(project_root)
        self.knowledge_dir = self.project_root / knowledge_dirname
        self.quantization_dir = self.knowledge_dir / "quantization"
        self.stage_dirs = {
            "l1": self.quantization_dir / "b_l1",
            "l2": self.quantization_dir / "b_l2",
            "l3": self.quantization_dir / "b_l3",
        }
        self.stage_index_paths = {
            "l1": self.stage_dirs["l1"] / "index.json",
            "l2": self.stage_dirs["l2"] / "index.json",
            "l3": self.stage_dirs["l3"] / "index.json",
        }
        self._ensure_layout()

    def _ensure_layout(self) -> None:
        self.quantization_dir.mkdir(parents=True, exist_ok=True)
        for stage in QUANTIZATION_STAGES:
            stage_dir = self.stage_dirs[stage]
            (stage_dir / "manifests").mkdir(parents=True, exist_ok=True)
            (stage_dir / "stats").mkdir(parents=True, exist_ok=True)
            if not self.stage_index_paths[stage].exists():
                self._dump_json(
                    self.stage_index_paths[stage],
                    {
                        "stage": stage,
                        "updated_at": None,
                        "sources": {},
                        "records": {},
                    },
                )

    def _validate_stage(self, stage: str) -> str:
        normalized = (stage or "").strip().lower()
        if normalized not in QUANTIZATION_STAGES:
            raise ValueError("QUANTIZATION_STAGE_INVALID")
        return normalized

    def _artifact_base_name(self, source_id: str, snapshot_id: str) -> str:
        return f"{_safe_name(source_id)}--{_safe_name(snapshot_id)}"

    def _manifest_path(self, stage: str, source_id: str, snapshot_id: str) -> Path:
        name = self._artifact_base_name(source_id, snapshot_id)
        return self.stage_dirs[stage] / "manifests" / f"{name}.json"

    def _stats_path(self, stage: str, source_id: str, snapshot_id: str) -> Path:
        name = self._artifact_base_name(source_id, snapshot_id)
        return self.stage_dirs[stage] / "stats" / f"{name}.json"

    def _load_json(self, path: Path) -> dict[str, Any] | None:
        if not path.exists() or not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        if isinstance(payload, dict):
            return payload
        return None

    def _dump_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def _load_stage_index(self, stage: str) -> dict[str, Any]:
        payload = self._load_json(self.stage_index_paths[stage])
        if isinstance(payload, dict):
            payload.setdefault("stage", stage)
            payload.setdefault("updated_at", None)
            payload.setdefault("sources", {})
            payload.setdefault("records", {})
            if not isinstance(payload.get("sources"), dict):
                payload["sources"] = {}
            if not isinstance(payload.get("records"), dict):
                payload["records"] = {}
            return payload
        return {
            "stage": stage,
            "updated_at": None,
            "sources": {},
            "records": {},
        }

    def _save_stage_index(self, stage: str, payload: dict[str, Any]) -> None:
        self._dump_json(self.stage_index_paths[stage], payload)

    def _record_key(self, source_id: str, snapshot_id: str) -> str:
        return self._artifact_base_name(source_id, snapshot_id)

    def _update_stage_index(
        self,
        *,
        stage: str,
        source_id: str,
        snapshot_id: str,
        manifest_path: Path,
        stats_path: Path,
        run_id: str,
        updated_at: str,
    ) -> None:
        index = self._load_stage_index(stage)
        record_key = self._record_key(source_id, snapshot_id)
        index["updated_at"] = updated_at
        index["sources"][source_id] = {
            "latest_snapshot_id": snapshot_id,
            "latest_run_id": run_id,
            "updated_at": updated_at,
        }
        index["records"][record_key] = {
            "source_id": source_id,
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "updated_at": updated_at,
            "manifest_path": str(manifest_path),
            "stats_path": str(stats_path),
        }
        self._save_stage_index(stage, index)

    def _resolve_snapshot_id(self, stage: str, source_id: str, snapshot_id: str | None) -> str:
        normalized_source = _safe_name(source_id)
        candidate = _safe_name_optional(snapshot_id)
        if candidate and candidate != "latest":
            return candidate
        index = self._load_stage_index(stage)
        source_entry = index.get("sources", {}).get(normalized_source)
        if isinstance(source_entry, dict):
            resolved = _safe_name_optional(str(source_entry.get("latest_snapshot_id") or ""))
            if resolved:
                return resolved
        return "latest"

    def write_stage_result(
        self,
        *,
        stage: str,
        source_id: str,
        snapshot_id: str,
        metrics: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_stage = self._validate_stage(stage)
        normalized_source = _safe_name(source_id)
        normalized_snapshot = _safe_name(snapshot_id)
        now = _iso_now()
        run_id = f"{normalized_stage}-{normalized_source}-{normalized_snapshot}-{int(datetime.now(UTC).timestamp())}"

        manifest = {
            "stage": normalized_stage,
            "source_id": normalized_source,
            "snapshot_id": normalized_snapshot,
            "run_id": run_id,
            "updated_at": now,
            "schema_version": "v1alpha",
            "metadata": dict(metadata or {}),
        }
        stats = {
            "stage": normalized_stage,
            "source_id": normalized_source,
            "snapshot_id": normalized_snapshot,
            "run_id": run_id,
            "updated_at": now,
            "schema_version": "v1alpha",
            "metrics": dict(metrics or {}),
        }

        manifest_path = self._manifest_path(
            normalized_stage,
            normalized_source,
            normalized_snapshot,
        )
        stats_path = self._stats_path(
            normalized_stage,
            normalized_source,
            normalized_snapshot,
        )

        self._dump_json(manifest_path, manifest)
        self._dump_json(stats_path, stats)
        self._update_stage_index(
            stage=normalized_stage,
            source_id=normalized_source,
            snapshot_id=normalized_snapshot,
            manifest_path=manifest_path,
            stats_path=stats_path,
            run_id=run_id,
            updated_at=now,
        )

        return {
            "stage": normalized_stage,
            "source_id": normalized_source,
            "snapshot_id": normalized_snapshot,
            "run_id": run_id,
            "manifest_path": str(manifest_path),
            "stats_path": str(stats_path),
            "status": "ready",
        }

    def get_stage_result(
        self,
        *,
        stage: str,
        source_id: str,
        snapshot_id: str,
    ) -> dict[str, Any] | None:
        normalized_stage = self._validate_stage(stage)
        normalized_source = _safe_name(source_id)
        normalized_snapshot = self._resolve_snapshot_id(
            normalized_stage,
            normalized_source,
            snapshot_id,
        )
        manifest = self._load_json(
            self._manifest_path(
                normalized_stage,
                normalized_source,
                normalized_snapshot,
            )
        )
        stats = self._load_json(
            self._stats_path(
                normalized_stage,
                normalized_source,
                normalized_snapshot,
            )
        )
        if manifest is None and stats is None:
            return None
        status = "ready" if manifest and stats else "incomplete"
        return {
            "stage": normalized_stage,
            "source_id": normalized_source,
            "snapshot_id": normalized_snapshot,
            "manifest": manifest or {},
            "stats": stats or {},
            "status": status,
        }

    def list_stage_results(
        self,
        *,
        stage: str,
        source_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        normalized_stage = self._validate_stage(stage)
        normalized_source = _safe_name(source_id or "") if source_id else ""
        index = self._load_stage_index(normalized_stage)
        payloads: list[dict[str, Any]] = []
        records = index.get("records", {})
        if not isinstance(records, dict):
            records = {}
        sorted_items = sorted(
            records.values(),
            key=lambda item: str((item or {}).get("updated_at") or ""),
            reverse=True,
        )
        for item in sorted_items:
            if not isinstance(item, dict):
                continue
            if normalized_source and str(item.get("source_id") or "") != normalized_source:
                continue
            stats_path = Path(str(item.get("stats_path") or "").strip())
            data = self._load_json(stats_path)
            if data is None:
                continue
            payloads.append(data)
            if len(payloads) >= max(1, int(limit)):
                break
        return payloads

    def compare_stages(self, *, source_id: str, snapshot_id: str) -> dict[str, Any]:
        normalized_source = _safe_name(source_id)
        normalized_snapshot = _safe_name(snapshot_id)
        rows: list[dict[str, Any]] = []
        for stage in QUANTIZATION_STAGES:
            result = self.get_stage_result(
                stage=stage,
                source_id=normalized_source,
                snapshot_id=normalized_snapshot,
            )
            rows.append(
                {
                    "stage": stage,
                    "available": result is not None,
                    "metrics": (result or {}).get("stats", {}).get("metrics", {}),
                }
            )
        return {
            "compare_type": "stages",
            "source_id": normalized_source,
            "snapshot_id": normalized_snapshot,
            "items": rows,
        }

    def compare_versions(
        self,
        *,
        source_id: str,
        snapshot_a: str,
        snapshot_b: str,
        stage: str,
    ) -> dict[str, Any]:
        normalized_stage = self._validate_stage(stage)
        normalized_source = _safe_name(source_id)
        a_payload = self.get_stage_result(
            stage=normalized_stage,
            source_id=normalized_source,
            snapshot_id=snapshot_a,
        )
        b_payload = self.get_stage_result(
            stage=normalized_stage,
            source_id=normalized_source,
            snapshot_id=snapshot_b,
        )
        return {
            "compare_type": "versions",
            "stage": normalized_stage,
            "source_id": normalized_source,
            "snapshot_a": _safe_name(snapshot_a),
            "snapshot_b": _safe_name(snapshot_b),
            "a": (a_payload or {}).get("stats", {}).get("metrics", {}),
            "b": (b_payload or {}).get("stats", {}).get("metrics", {}),
        }

    def compare_sources(
        self,
        *,
        source_a: str,
        source_b: str,
        stage: str,
        snapshot_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_stage = self._validate_stage(stage)
        source_a_safe = _safe_name(source_a)
        source_b_safe = _safe_name(source_b)
        snapshot_a = self._resolve_snapshot_id(
            normalized_stage,
            source_a_safe,
            snapshot_id,
        )
        snapshot_b = self._resolve_snapshot_id(
            normalized_stage,
            source_b_safe,
            snapshot_id,
        )

        a_payload = self.get_stage_result(
            stage=normalized_stage,
            source_id=source_a_safe,
            snapshot_id=snapshot_a,
        )
        b_payload = self.get_stage_result(
            stage=normalized_stage,
            source_id=source_b_safe,
            snapshot_id=snapshot_b,
        )

        return {
            "compare_type": "sources",
            "stage": normalized_stage,
            "snapshot_id": (snapshot_id or "latest").strip() or "latest",
            "snapshot_a": snapshot_a,
            "snapshot_b": snapshot_b,
            "source_a": source_a_safe,
            "source_b": source_b_safe,
            "a": (a_payload or {}).get("stats", {}).get("metrics", {}),
            "b": (b_payload or {}).get("stats", {}).get("metrics", {}),
        }

    def schedule_stage_run(self, stage: str, source_id: str, snapshot_id: str | None = None) -> dict[str, Any]:
        """
        Schedule a run for the given stage. Ensures dependencies are met.
        """
        normalized_stage = self._validate_stage(stage)
        normalized_source = _safe_name(source_id)
        resolved_snapshot = self._resolve_snapshot_id(normalized_stage, normalized_source, snapshot_id)

        # Ensure dependencies are met
        if normalized_stage != "l1":
            previous_stage = QUANTIZATION_STAGES[QUANTIZATION_STAGES.index(normalized_stage) - 1]
            # resolve snapshot for previous stage independently
            prev_snapshot = self._resolve_snapshot_id(previous_stage, normalized_source, snapshot_id)
            previous_result = self.get_stage_result(
                stage=previous_stage, source_id=normalized_source, snapshot_id=prev_snapshot
            )
            # 调试输出
            print(f"[DEBUG] schedule_stage_run: {previous_stage=}, {prev_snapshot=}, {previous_result=}")
            if not previous_result or previous_result.get("status") != "ready":
                raise RuntimeError(f"Dependency not met: {previous_stage} must complete before {normalized_stage}.")

        # Write stage result as a placeholder
        return self.write_stage_result(
            stage=normalized_stage,
            source_id=normalized_source,
            snapshot_id=resolved_snapshot,
            metadata={"scheduled": True},
        )
