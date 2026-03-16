# -*- coding: utf-8 -*-

from __future__ import annotations

import asyncio
from typing import Optional
from types import SimpleNamespace

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile

from ...config import load_config, save_config
from ...config.config import KnowledgeConfig, KnowledgeSourceSpec
from ...constant import WORKING_DIR
from ...knowledge import KnowledgeManager

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
_titles_regenerate_enqueue_lock = asyncio.Lock()

def _manager() -> KnowledgeManager:
    return KnowledgeManager(WORKING_DIR)


def _find_source(config: KnowledgeConfig, source_id: str) -> Optional[KnowledgeSourceSpec]:
    for source in config.sources:
        if source.id == source_id:
            return source
    return None


@router.get("/config", response_model=KnowledgeConfig)
async def get_knowledge_config() -> KnowledgeConfig:
    return load_config().knowledge


@router.put("/config", response_model=KnowledgeConfig)
async def put_knowledge_config(
    knowledge_config: KnowledgeConfig = Body(...),
) -> KnowledgeConfig:
    config = load_config()
    config.knowledge = knowledge_config
    save_config(config)
    return config.knowledge


@router.get("/sources")
async def list_sources():
    config = load_config()
    return {
        "enabled": config.knowledge.enabled,
        "sources": _manager().list_sources(config.knowledge),
    }


@router.put("/sources", response_model=KnowledgeSourceSpec)
async def upsert_source(
    source: KnowledgeSourceSpec = Body(...),
) -> KnowledgeSourceSpec:
    config = load_config()
    manager = _manager()
    source = manager.normalize_source_name(source)
    existing = _find_source(config.knowledge, source.id)
    if existing is None:
        config.knowledge.sources.append(source)
    else:
        index = config.knowledge.sources.index(existing)
        config.knowledge.sources[index] = source
    save_config(config)
    return source


@router.post("/upload/file")
async def upload_knowledge_file(
    source_id: str = Form(...),
    file: UploadFile = File(...),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    saved_path = _manager().save_uploaded_file(
        source_id=source_id,
        filename=file.filename or "knowledge-upload",
        data=data,
    )
    return {
        "location": str(saved_path),
        "filename": saved_path.name,
    }


@router.post("/upload/directory")
async def upload_knowledge_directory(
    source_id: str = Form(...),
    relative_paths: list[str] = Form(...),
    files: list[UploadFile] = File(...),
):
    if len(files) != len(relative_paths):
        raise HTTPException(
            status_code=400,
            detail="files and relative_paths length mismatch",
        )
    saved_pairs = []
    for relative_path, upload in zip(relative_paths, files):
        saved_pairs.append((relative_path, await upload.read()))
    saved_root = _manager().save_uploaded_directory(source_id, saved_pairs)
    return {
        "location": str(saved_root),
        "file_count": len(saved_pairs),
    }


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str):
    config = load_config()
    source = _find_source(config.knowledge, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")
    config.knowledge.sources = [
        item for item in config.knowledge.sources if item.id != source_id
    ]
    save_config(config)
    _manager().delete_index(source_id)
    return {"deleted": True, "source_id": source_id}


@router.post("/sources/{source_id}/index")
async def index_source(source_id: str):
    config = load_config()
    source = _find_source(config.knowledge, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")
    try:
        result = _manager().index_source(
            source,
            config.knowledge,
            config.agents.running,
        )
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return result


@router.get("/sources/{source_id}/content")
async def get_source_content(source_id: str):
    config = load_config()
    source = _find_source(config.knowledge, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")
    return _manager().get_source_documents(source_id)


@router.post("/index")
async def index_all_sources():
    config = load_config()
    try:
        return _manager().index_all(config.knowledge, config.agents.running)
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/search")
async def search_knowledge(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    source_ids: Optional[str] = Query(default=None),
    source_types: Optional[str] = Query(default=None),
):
    config = load_config()
    ids = [item for item in (source_ids or "").split(",") if item]
    types = [item for item in (source_types or "").split(",") if item]
    return _manager().search(
        query=q,
        config=config.knowledge,
        limit=limit,
        source_ids=ids or None,
        source_types=types or None,
    )


@router.get("/history-backfill/status")
async def get_history_backfill_status():
    """Get history backfill status for knowledge enable flow and CTA display."""
    return _manager().history_backfill_status()


@router.post("/history-backfill/run")
async def run_history_backfill_now():
    """Run history backfill immediately regardless of runtime auto-backfill toggle."""
    config = load_config()
    manager = _manager()
    running = config.agents.running
    force_running = SimpleNamespace(
        auto_backfill_history_data=True,
        auto_collect_chat_files=running.auto_collect_chat_files,
        auto_collect_chat_urls=running.auto_collect_chat_urls,
        auto_collect_long_text=running.auto_collect_long_text,
        long_text_min_chars=running.long_text_min_chars,
        knowledge_chunk_size=running.knowledge_chunk_size,
    )
    result = manager.auto_backfill_history_data(config.knowledge, force_running)
    if result.get("changed"):
        save_config(config)
    return {
        "result": result,
        "status": manager.history_backfill_status(),
    }


@router.post("/titles/regenerate")
async def regenerate_all_titles(
    use_llm: bool = Query(default=False),
    confirm: bool = Query(default=False),
    enabled_only: bool = Query(default=True),
    batch_size: int = Query(default=5, ge=1, le=20),
    force_clear: bool = Query(default=False),
):
    """Queue a low-priority batched title-regeneration job."""
    if not confirm:
        raise HTTPException(status_code=400, detail="KNOWLEDGE_TITLES_CONFIRM_REQUIRED")

    config = load_config()
    manager = _manager()
    cancelled_payload = {
        "cancelled": False,
        "cancelled_count": 0,
        "cancelled_job_ids": [],
    }
    async with _titles_regenerate_enqueue_lock:
        if force_clear:
            cancelled_payload = manager.cancel_active_title_regeneration_jobs()
        result = manager.enqueue_title_regeneration(
            config.knowledge,
            use_llm=use_llm,
            enabled_only=enabled_only,
            batch_size=batch_size,
            yield_interval_seconds=config.agents.running.knowledge_maintenance_llm_yield_seconds,
        )
    if not result.get("queued"):
        raise HTTPException(status_code=409, detail="KNOWLEDGE_TITLES_QUEUE_ALREADY_ACTIVE")
    result["force_clear"] = force_clear
    result["restarted"] = bool(force_clear and cancelled_payload.get("cancelled"))
    result["cleared_jobs"] = int(cancelled_payload.get("cancelled_count", 0) or 0)
    result["cleared_job_ids"] = cancelled_payload.get("cancelled_job_ids", [])
    return result


@router.get("/titles/regenerate/queue")
async def get_title_regenerate_queue_status():
    """Get queued title-regeneration runtime status."""
    return _manager().get_title_regen_queue_status()