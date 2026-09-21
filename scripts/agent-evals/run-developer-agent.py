# -*- coding: utf-8 -*-
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.developer.agent_new import Developer
from agents.developer_backend.agent import DeveloperBackend
from agents.developer_frontend.agent import DeveloperFrontend


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: python scripts/agent-evals/run-developer-agent.py <agent-name> <fixture-path>")

    agent_name = sys.argv[1].strip()
    fixture_path = Path(sys.argv[2]).resolve()
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))

    project_id = payload.get("project_id") or "eval-project"
    idea = payload.get("idea") or ""
    architecture = payload.get("architecture") or ""
    backend_output = payload.get("backend_output") or None

    if agent_name == "developer_backend":
        result = DeveloperBackend(project_id).process(idea, architecture)
    elif agent_name == "developer_frontend":
        result = DeveloperFrontend(project_id).process(idea, architecture, backend_output)
    elif agent_name == "developer":
        result = Developer(project_id).process(idea, architecture)
    else:
      raise SystemExit(f"Unknown agent: {agent_name}")

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
