from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


def _load_env() -> None:
  """Load environment variables from agents/.env if present."""
  env_path = Path(__file__).resolve().parent.parent / ".env"
  load_dotenv(dotenv_path=env_path, override=False)


@dataclass(frozen=True)
class AgentSettings:
  agentverse_api_key: str | None
  asi_one_api_key: str | None
  agent_host: str
  agent_port_base: int
  mailbox_url: str | None
  podx_database_url: str
  pyusd_address: str | None
  escrow_pyusd_address: str | None
  order_registry_address: str | None
  shipment_registry_address: str | None
  sepolia_rpc_url: str | None
  lit_delivery_oracle_key: str | None
  delivery_oracle_private_key: str | None
  delivery_oracle_private_key: str | None


@lru_cache(maxsize=1)
def get_settings() -> AgentSettings:
  _load_env()
  return AgentSettings(
    agentverse_api_key=os.getenv("AGENTVERSE_API_KEY"),
    asi_one_api_key=os.getenv("ASI_ONE_API_KEY"),
    agent_host=os.getenv("AGENT_HOST", "0.0.0.0"),
    agent_port_base=int(os.getenv("AGENT_PORT_BASE", "8100")),
    mailbox_url=os.getenv("MAILBOX_URL"),
    podx_database_url=os.getenv("PODX_DATABASE_URL", "file:data/podx.db"),
    pyusd_address=os.getenv("PYUSD_ADDRESS"),
    escrow_pyusd_address=os.getenv("ESCROW_PYUSD_ADDRESS"),
    order_registry_address=os.getenv("ORDER_REGISTRY_ADDRESS"),
    shipment_registry_address=os.getenv("SHIPMENT_REGISTRY_ADDRESS"),
    sepolia_rpc_url=os.getenv("SEPOLIA_RPC_URL"),
    lit_delivery_oracle_key=os.getenv("LIT_DELIVERY_ORACLE_KEY"),
    delivery_oracle_private_key=os.getenv("DELIVERY_ORACLE_PRIVATE_KEY"),
  )
