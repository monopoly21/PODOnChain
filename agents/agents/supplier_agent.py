from __future__ import annotations

import logging
from datetime import datetime
from uuid import uuid4

from uagents import Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
  ChatAcknowledgement,
  ChatMessage,
  TextContent,
  chat_protocol_spec,
)

from agents.bridge.podx import get_order, update_order_status
from agents.shared.agent_factory import create_agent
from agents.shared.messages import PurchaseOrderAck, PurchaseOrderRequest


class SupplierRestRequest(Model):
  order_id: str


class SupplierRestResponse(Model):
  order_id: str
  status: str
  notes: str | None = None

logger = logging.getLogger(__name__)

AGENT_NAME = "SupplierAgent"
agent = create_agent(AGENT_NAME, seed_suffix="core", port_offset=4)
chat_protocol = Protocol(spec=chat_protocol_spec)


@agent.on_message(model=PurchaseOrderRequest, replies=PurchaseOrderAck)
async def handle_po(ctx: Context, sender: str, request: PurchaseOrderRequest) -> None:
  logger.info("SupplierAgent processing order %s", request.order_id)
  order = await get_order(request.order_id)
  if not order:
    await ctx.send(
      sender,
      PurchaseOrderAck(order_id=request.order_id, status="REJECTED", notes="Order not found."),
    )
    return

  await update_order_status(request.order_id, "InFulfillment")
  await ctx.send(
    sender,
    PurchaseOrderAck(
      order_id=request.order_id,
      status="ACCEPTED",
      notes="Order moved to InFulfillment by supplier.",
    ),
  )


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
  if text.startswith("confirm order"):
    parts = text.split()
    order_id = parts[2] if len(parts) > 2 else None
    if not order_id:
      result = "Provide an order id, e.g. 'confirm order abc123'."
    else:
      await update_order_status(order_id, "InFulfillment")
      result = f"Order {order_id} marked InFulfillment."
  else:
    result = "Ask me to confirm orders: 'confirm order <id>'."

  await ctx.send(
    sender,
    ChatMessage(
      timestamp=datetime.utcnow(),
      msg_id=uuid4(),
      content=[TextContent(type="text", text=result)],
    ),
  )


@chat_protocol.on_message(ChatAcknowledgement)
async def acknowledgement_handler(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
  ctx.logger.info("Acknowledgement %s from %s", msg.acknowledged_msg_id, sender)


@agent.on_rest_post("/confirm", SupplierRestRequest, SupplierRestResponse)
async def rest_confirm(_ctx: Context, req: SupplierRestRequest) -> SupplierRestResponse:
  order = await get_order(req.order_id)
  if not order:
    return SupplierRestResponse(order_id=req.order_id, status="REJECTED", notes="Order not found.")
  await update_order_status(req.order_id, "InFulfillment")
  return SupplierRestResponse(order_id=req.order_id, status="ACCEPTED", notes="Order marked InFulfillment by supplier.")


@agent.on_rest_get("/health", SupplierRestResponse)
async def rest_health(_ctx: Context) -> SupplierRestResponse:
  return SupplierRestResponse(order_id="", status="healthy", notes=AGENT_NAME)


def run() -> None:
  agent.include(chat_protocol, publish_manifest=True)
  agent.run()


if __name__ == "__main__":
  run()
