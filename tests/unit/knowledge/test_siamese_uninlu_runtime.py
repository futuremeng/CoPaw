# -*- coding: utf-8 -*-

from __future__ import annotations

from copaw.knowledge.siamese_uninlu_runtime import _SIAMESE_METHODS


def test_siamese_ner_default_schema_includes_company_and_product() -> None:
    schema = _SIAMESE_METHODS["named_entity_recognition"]["default_schema"]

    assert isinstance(schema, dict)
    assert "公司" in schema
    assert "产品" in schema