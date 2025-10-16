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
from agents.agents.inventory_agent import handle_inventory_query
from agents.shared.agent_factory import create_agent
from agents.shared.messages import InventoryQuery, PurchaseOrderAck, PurchaseOrderRequest


class PurchaseOrderRestRequest(Model):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  sku_id: str
  quantity: int
  unit_price: float


class PurchaseOrderRestResponse(Model):
  order_id: str
  status: str
  notes: str | None = None


class PurchaseOrderHealthResponse(Model):
  status: str
  agent: str

logger = logging.getLogger(__name__)

AGENT_NAME = "POAgent"
agent = create_agent(AGENT_NAME, seed_suffix="core", port_offset=1)
chat_protocol = Protocol(spec=chat_protocol_spec)


async def process_purchase_order(request: PurchaseOrderRequest) -> PurchaseOrderAck:
  logger.info("Processing PO request %s for %s qty %s", request.order_id, request.sku_id, request.quantity)

  order = await get_order(request.order_id)
  if not order:
    return PurchaseOrderAck(
      order_id=request.order_id,
      status="REJECTED",
      notes="Order not found in PODx database.",
    )

  query = InventoryQuery(sku_id=request.sku_id, owner_wallet=request.buyer_wallet, supplier_wallet=request.supplier_wallet)
  status = await handle_inventory_query(query)
  if status.recommended_action == "REORDER":
    return PurchaseOrderAck(
      order_id=request.order_id,
      status="REJECTED",
      notes=status.recommendation_reason or "Inventory insufficient.",
    )

  await update_order_status(request.order_id, "Approved")

  return PurchaseOrderAck(
    order_id=request.order_id,
    status="ACCEPTED",
    notes="Order approved and ready for supplier processing.",
  )


@agent.on_message(model=PurchaseOrderRequest, replies=PurchaseOrderAck)
async def handle_po_request(ctx: Context, sender: str, request: PurchaseOrderRequest) -> None:
  response = await process_purchase_order(request)
  await ctx.send(sender, response)


@agent.on_rest_post("/confirm", PurchaseOrderRestRequest, PurchaseOrderRestResponse)
async def rest_confirm(_ctx: Context, req: PurchaseOrderRestRequest) -> PurchaseOrderRestResponse:
  ack = await process_purchase_order(
    PurchaseOrderRequest(
      order_id=req.order_id,
      buyer_wallet=req.buyer_wallet,
      supplier_wallet=req.supplier_wallet,
      sku_id=req.sku_id,
      quantity=req.quantity,
      unit_price=req.unit_price,
    )
  )
  return PurchaseOrderRestResponse(order_id=ack.order_id, status=ack.status, notes=ack.notes)


@agent.on_rest_get("/health", PurchaseOrderHealthResponse)
async def rest_health(_ctx: Context) -> PurchaseOrderHealthResponse:
  return PurchaseOrderHealthResponse(status="healthy", agent=AGENT_NAME)


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

  if "status" in text and "order" in text:
    parts = text.split()
    try:
      order_id = parts[parts.index("order") + 1]
    except Exception:
      order_id = None
    if order_id:
      order = await get_order(order_id)
      message = (
        f"Order {order_id} status: {order['status']}"
        if order
        else f"Order {order_id} not found."
      )
    else:
      message = "Please specify an order id, e.g. 'status order abc123'."
  else:
    message = "Ask me about order status, e.g. 'status order abc123'."

  await ctx.send(
    sender,
    ChatMessage(
      timestamp=datetime.utcnow(),
      msg_id=uuid4(),
      content=[TextContent(type="text", text=message)],
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
