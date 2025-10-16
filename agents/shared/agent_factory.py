from __future__ import annotations

import os
from typing import Optional

os.environ.setdefault("UAGENTS_NO_LEDGER", "1")
os.environ.setdefault("UAGENTS_DISABLE_LEDGER", "1")

from uagents import Agent
from uagents.registration import AgentRegistrationPolicy


class NoopRegistrationPolicy(AgentRegistrationPolicy):
  async def register(self, *args, **kwargs):  # type: ignore[override]
    return None

  async def deregister(self, *args, **kwargs):
    return None

  async def update_status(self, *args, **kwargs):
    return None

from .config import get_settings


def create_agent(
  name: str,
  seed_suffix: str,
  port_offset: int,
  *,
  publish_agent_details: bool = True,
) -> Agent:
  """
  Helper to instantiate a uAgent with consistent defaults.
  """
  settings = get_settings()
  seed = f"podx::{name}::{seed_suffix}"
  agent = Agent(
    name=name,
    seed=seed,
    port=settings.agent_port_base + port_offset,
    mailbox=True,
    publish_agent_details=publish_agent_details,
    registration_policy=NoopRegistrationPolicy(),
  )
  return agent
