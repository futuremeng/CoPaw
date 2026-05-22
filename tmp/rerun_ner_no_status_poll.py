import json
import time
import urllib.request
from pathlib import Path

project_id = "project-2ZHU4d"
run_url = f"http://localhost:5173/api/knowledge/project-pipeline/run?project_id={project_id}"
ner_dir = Path("/Users/futuremeng/.copaw/workspaces/default/projects/project-2ZHU4d/.knowledge/ner")

payload = {
    "trigger": "manual-rerun-ner-no-poll",
    "force": True,
    "processing_mode": "nlp",
    "changed_paths": [],
    "idempotency_key": f"rerun-no-poll-{int(time.time()*1000)}",
}
req = urllib.request.Request(
    run_url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as resp:
    run_resp = json.loads(resp.read().decode("utf-8"))
print("run_resp=", {"accepted": run_resp.get("accepted"), "reason": run_resp.get("reason")})

# Do NOT poll /status (it can resume/restart workflow); wait and watch files only.
deadline = time.time() + 180
last_count = -1
while time.time() < deadline:
    files = sorted(ner_dir.glob("*.ner.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if len(files) != last_count:
        print("ner_count=", len(files))
        last_count = len(files)
    if files:
        p = files[0]
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            time.sleep(2)
            continue
        mentions = len(data.get("entity_mentions") or [])
        catalog = len(data.get("entity_catalog") or [])
        print("latest=", p.name)
        print("mtime=", p.stat().st_mtime)
        print("mentions=", mentions)
        print("catalog=", catalog)
        break
    time.sleep(2)
else:
    print("timeout_waiting_for_ner_files")
