# PODx Agents

Python microservices built with Fetch.ai’s `uAgents` framework and SingularityNET’s MeTTa knowledge graphs.

## Quick start

```bash
cd agents
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Agents expect environment variables defined in `.env` (see `.env.example`). Once configured, run any agent module:

```bash
python -m agents.agents.inventory_agent
python -m agents.agents.po_agent
python -m agents.agents.payments_agent
python -m agents.agents.shipment_agent
python -m agents.agents.supplier_agent
python -m agents.agents.logistics_agent
python -m agents.agents.risk_agent

# launch every agent at once (for Agentverse/ASI testing)
python run_agents.py

# HTTP / WebSocket bridge for Next.js
python -m agents.bridge.server  # exposes REST + WS on port 8200
```

Detailed run instructions will be added as agents come online.
