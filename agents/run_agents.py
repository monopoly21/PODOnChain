from __future__ import annotations

import argparse
import asyncio
import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import List

AGENT_MODULES = [
  "agents.agents.inventory_agent",
  "agents.agents.po_agent",
  "agents.agents.supplier_agent",
  "agents.agents.payments_agent",
]


AGENT_ENV_OVERRIDES = {
  "agents.agents.payments_agent": {
    "AGENTVERSE_API_KEY": os.getenv("PAYMENTS_AGENTVERSE_API_KEY"),
  }
}


def _venv_python() -> str:
  venv = Path(__file__).resolve().parent / ".venv"
  python = venv / "bin" / "python"
  if python.exists():
    return str(python)
  return sys.executable


async def launch_agents(modules: List[str]) -> None:
  processes: List[subprocess.Popen[str]] = []
  python = _venv_python()
  try:
    for module in modules:
      env = os.environ.copy()
      overrides = AGENT_ENV_OVERRIDES.get(module, {})
      for key, value in overrides.items():
        if value:
          env[key] = value
      process = subprocess.Popen(
        [python, "-m", module], stdout=sys.stdout, stderr=sys.stderr, env=env
      )
      processes.append(process)
    # keep running until interrupted
    while all(proc.poll() is None for proc in processes):
      await asyncio.sleep(1)
  except KeyboardInterrupt:
    pass
  finally:
    for proc in processes:
      if proc.poll() is None:
        proc.send_signal(signal.SIGINT)
    for proc in processes:
      proc.wait()


def main() -> None:
  parser = argparse.ArgumentParser(description="Launch all PODx uAgents.")
  parser.add_argument(
    "--subset",
    nargs="+",
    help="Optional subset of agent module paths to run.",
  )
  args = parser.parse_args()

  modules = args.subset or AGENT_MODULES

  os.environ.setdefault("PYTHONUNBUFFERED", "1")

  asyncio.run(launch_agents(modules))


if __name__ == "__main__":
  main()
