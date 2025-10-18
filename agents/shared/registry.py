from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional


@dataclass(frozen=True)
class AgentRegistry:
  inventory_agent: Optional[str]
  po_agent: Optional[str]
  supplier_agent: Optional[str]
  logistics_agent: Optional[str]
  risk_agent: Optional[str]
  payments_agent: Optional[str]


@lru_cache(maxsize=1)
def get_registry() -> AgentRegistry:
  return AgentRegistry(
    inventory_agent=os.getenv("INVENTORY_AGENT_ADDRESS"),
    po_agent=os.getenv("PO_AGENT_ADDRESS"),
    supplier_agent=os.getenv("SUPPLIER_AGENT_ADDRESS"),
    logistics_agent=os.getenv("LOGISTICS_AGENT_ADDRESS"),
    risk_agent=os.getenv("RISK_AGENT_ADDRESS"),
    payments_agent=os.getenv("PAYMENTS_AGENT_ADDRESS"),
  )
