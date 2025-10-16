from __future__ import annotations

import logging
from typing import Optional
from uuid import uuid4

from uagents import Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
  ChatAcknowledgement,
  ChatMessage,
  TextContent,
  chat_protocol_spec,
)

from agents.bridge.podx import get_shipment
from agents.shared.agent_factory import create_agent
from agents.shared.messages import ShipmentMilestoneUpdate


class ShipmentRestRequest(Model):
  shipment_id: str


class ShipmentRestResponse(Model):
  shipment_id: str
  status: str | None
  assigned_courier: str | None


class ShipmentMilestoneRestRequest(Model):
  shipment_id: str
  shipment_no: int
  order_id: str
  milestone: str
  courier_wallet: str
  latitude: float | None = None
  longitude: float | None = None
  claimed_ts: int | None = None
  radius_m: float | None = None


class ShipmentMilestoneRestResponse(Model):
  status: str
  escrow_tx: str | None = None
  distance: float | None = None
  radius: float | None = None
  shipment_status: str | None = None
  order_status: str | None = None
from agents.services.shipment import process_milestone

logger = logging.getLogger(__name__)

AGENT_NAME = "ShipmentAgent"

agent = create_agent(AGENT_NAME, seed_suffix="core", port_offset=3)
chat_protocol = Protocol(spec=chat_protocol_spec)

@agent.on_message(model=ShipmentMilestoneUpdate)
async def milestone_handler(ctx: Context, sender: str, update: ShipmentMilestoneUpdate) -> None:
  logger.info(
    "Shipment %s milestone update %s by %s",
    update.shipment_id,
    update.milestone,
    update.courier_wallet,
  )
  await process_milestone(update)


@agent.on_rest_post("/status", ShipmentRestRequest, ShipmentRestResponse)
async def rest_status(_ctx: Context, req: ShipmentRestRequest) -> ShipmentRestResponse:
  shipment = await get_shipment(req.shipment_id)
  if not shipment:
    return ShipmentRestResponse(shipment_id=req.shipment_id, status=None, assigned_courier=None)
  return ShipmentRestResponse(
    shipment_id=shipment["id"],
    status=shipment.get("status"),
    assigned_courier=shipment.get("assignedCourier"),
  )


@agent.on_rest_post("/milestone", ShipmentMilestoneRestRequest, ShipmentMilestoneRestResponse)
async def rest_milestone(_ctx: Context, req: ShipmentMilestoneRestRequest) -> ShipmentMilestoneRestResponse:
  result = await process_milestone(
    ShipmentMilestoneUpdate(
      shipment_id=req.shipment_id,
      shipment_no=req.shipment_no,
      order_id=req.order_id,
      milestone=req.milestone,  # type: ignore[arg-type]
      courier_wallet=req.courier_wallet,
      latitude=req.latitude,
      longitude=req.longitude,
      claimed_ts=req.claimed_ts,
    ),
    radius_m=req.radius_m,
  )
  return ShipmentMilestoneRestResponse(
    status=result.get("status", "unknown"),
    escrow_tx=result.get("escrow_tx"),
    distance=result.get("distance"),
    radius=result.get("radius"),
    shipment_status=result.get("shipment_status"),
    order_status=result.get("order_status"),
  )


class ShipmentHealthResponse(Model):
  status: str
  agent: str


@agent.on_rest_get("/health", ShipmentHealthResponse)
async def rest_health(_ctx: Context) -> ShipmentHealthResponse:
  return ShipmentHealthResponse(status="healthy", agent=AGENT_NAME)


@chat_protocol.on_message(ChatMessage)
async def chat_handler(ctx: Context, sender: str, msg: ChatMessage) -> None:
  await ctx.send(
    sender,
    ChatAcknowledgement(timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id),
  )
  text_fragments = [content.text for content in msg.content if isinstance(content, TextContent)]
  if not text_fragments:
    return
  text = " ".join(text_fragments).lower()
  response: Optional[str] = None
  if text.startswith("shipment"):
    parts = text.split()
    try:
      shipment_id = parts[1]
      shipment = await get_shipment(shipment_id)
      if shipment:
        response = (
          f"Shipment {shipment_id} status {shipment['status']}, "
          f"assigned courier {shipment.get('assignedCourier') or 'n/a'}."
        )
      else:
        response = f"Shipment {shipment_id} not found."
    except Exception as error:
      response = f"Could not parse shipment query: {error}"
  else:
    response = "Ask me about shipments: 'shipment <id>'."

  await ctx.send(
    sender,
    ChatMessage(
      timestamp=datetime.utcnow(),
      msg_id=uuid4(),
      content=[TextContent(type="text", text=response or "No response.")],
    ),
  )


@chat_protocol.on_message(ChatAcknowledgement)
async def acknowledgement_handler(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
  ctx.logger.info("Acknowledgement %s from %s", msg.acknowledged_msg_id, sender)


def run() -> None:
  agent.include(chat_protocol, publish_manifest=True)
  agent.run()


if __name__ == "__main__":
  run()
