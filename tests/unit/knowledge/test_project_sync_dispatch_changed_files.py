"""Tests for changed_files generation in project sync dispatch."""

import pytest
from src.copaw.knowledge.project_sync_dispatch import _build_changed_files_list


def test_build_changed_files_list_empty():
    """Test with empty paths."""
    result = _build_changed_files_list([], "project_watcher_change", "idle", "2026-05-18T12:00:00Z")
    assert result == []


def test_build_changed_files_list_automatic_trigger():
    """Test trigger_mode detection for automatic watcher."""
    paths = ["original/a.md", "original/b.txt"]
    result = _build_changed_files_list(paths, "project_watcher_change", "pending", "2026-05-18T12:00:00Z")
    
    assert len(result) == 2
    assert all(f["trigger_mode"] == "automatic" for f in result)
    assert result[0]["path"] == "original/a.md"
    assert result[1]["path"] == "original/b.txt"


def test_build_changed_files_list_manual_trigger():
    """Test trigger_mode detection for manual triggers."""
    paths = ["original/a.md"]
    result = _build_changed_files_list(paths, "manual-panel", "pending", "2026-05-18T12:00:00Z")
    
    assert len(result) == 1
    assert result[0]["trigger_mode"] == "manual"


def test_build_changed_files_list_resume_trigger():
    """Test trigger_mode detection for resume (should be automatic)."""
    paths = ["original/a.md"]
    result = _build_changed_files_list(paths, "resume_sync", "pending", "2026-05-18T12:00:00Z")
    
    assert len(result) == 1
    assert result[0]["trigger_mode"] == "automatic"


def test_build_changed_files_list_status_mapping():
    """Test processing_status mapping."""
    paths = ["original/a.md"]
    
    # Test idle status
    result = _build_changed_files_list(paths, "project_watcher_change", "idle", "2026-05-18T12:00:00Z")
    assert result[0]["processing_status"] == "idle"
    
    # Test queued status
    result = _build_changed_files_list(paths, "project_watcher_change", "queued", "2026-05-18T12:00:00Z")
    assert result[0]["processing_status"] == "queued"
    
    # Test indexing status
    result = _build_changed_files_list(paths, "project_watcher_change", "indexing", "2026-05-18T12:00:00Z")
    assert result[0]["processing_status"] == "indexing"
    
    # Test succeeded status
    result = _build_changed_files_list(paths, "project_watcher_change", "succeeded", "2026-05-18T12:00:00Z")
    assert result[0]["processing_status"] == "succeeded"


def test_build_changed_files_list_scope():
    """Test that all files have original scope."""
    paths = ["original/a.md", "original/b.txt", "original/c.json"]
    result = _build_changed_files_list(paths, "project_watcher_change", "pending", "2026-05-18T12:00:00Z")
    
    assert all(f["scope"] == "original" for f in result)


def test_build_changed_files_list_detected_at():
    """Test that detected_at timestamp is preserved."""
    timestamp = "2026-05-18T15:30:45Z"
    paths = ["original/a.md"]
    result = _build_changed_files_list(paths, "project_watcher_change", "pending", timestamp)
    
    assert result[0]["detected_at"] == timestamp
