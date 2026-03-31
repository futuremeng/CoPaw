# -*- coding: utf-8 -*-

import frontmatter

from copaw.agents import skills_hub


def test_fetch_bundle_from_github_url_normalizes_markdown_blob(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        skills_hub,
        "_github_get_default_branch",
        lambda owner, repo: "main",
    )
    monkeypatch.setattr(
        skills_hub,
        "_github_get_content_entry",
        lambda owner, repo, path, ref: {"type": "file", "path": path},
    )
    monkeypatch.setattr(
        skills_hub,
        "_github_read_file",
        lambda entry: "# Weather Assistant\n\nQuery weather quickly.\n",
    )

    bundle, source_url = skills_hub._fetch_bundle_from_github_url(
        "https://github.com/example/skills/blob/main/skills/weather.md",
        "",
    )

    assert source_url == "https://github.com/example/skills"
    assert bundle["name"] == "Weather Assistant"
    post = frontmatter.loads(bundle["files"]["SKILL.md"])
    assert post["name"] == "Weather Assistant"
    assert post["description"] == "Query weather quickly."
