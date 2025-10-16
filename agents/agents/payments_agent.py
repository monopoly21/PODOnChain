from __future__ import annotations

import logging
import asyncio
import json
from datetime import datetime
from typing import Optional
from uuid import uuid4

from uagents import Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
  ChatAcknowledgement,
  ChatMessage,
  TextContent,
  chat_protocol_spec,
)
from web3 import Web3
from web3.middleware import geth_poa_middleware

from agents.shared.agent_factory import create_agent
from agents.shared.config import get_settings
from agents.shared.messages import EscrowReleaseRequest, EscrowReleaseResult
from agents.bridge.podx import record_payment_status


class PaymentsRestRequest(Model):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  amount: float
  milestone: str


class PaymentsRestResponse(Model):
  order_id: str
  status: str
  tx_hash: str | None = None
  error: str | None = None

logger = logging.getLogger(__name__)

AGENT_NAME = "PaymentsAgent"

class EscrowProcessor:
  def __init__(self) -> None:
    settings = get_settings()
    if not settings.sepolia_rpc_url:
      raise RuntimeError("SEPOLIA_RPC_URL is required for PaymentsAgent")
    if not settings.shipment_registry_address:
      raise RuntimeError("SHIPMENT_REGISTRY_ADDRESS is required for PaymentsAgent")
    if not settings.delivery_oracle_private_key:
      raise RuntimeError("DELIVERY_ORACLE_PRIVATE_KEY is required for PaymentsAgent")

    self.web3 = Web3(Web3.HTTPProvider(settings.sepolia_rpc_url))
    # required for Sepolia
    self.web3.middleware_onion.inject(geth_poa_middleware, layer=0)
    self.account = self.web3.eth.account.from_key(settings.delivery_oracle_private_key)
    self.order_registry = self.web3.eth.contract(
      address=Web3.to_checksum_address(settings.order_registry_address),
      abi=[
        {
          "inputs": [
            {"internalType": "uint256", "name": "orderId", "type": "uint256"},
            {"internalType": "address", "name": "courier", "type": "address"},
            {"internalType": "uint256", "name": "courierReward", "type": "uint256"},
          ],
          "name": "releaseEscrowFromShipment",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function",
        },
      ],
    )
    logger.info("PaymentsAgent ready. Using account %s", self.account.address)

  def release_from_shipment(self, order_id: int) -> str:
    raise RuntimeError("On-chain escrow release now handled by ShipmentRegistry.confirmDrop")


agent = create_agent(AGENT_NAME, seed_suffix="core", port_offset=2)
chat_protocol = Protocol(spec=chat_protocol_spec)

_processor: Optional[EscrowProcessor] = None


def get_processor() -> EscrowProcessor:
  global _processor
  if _processor is None:
    _processor = EscrowProcessor()
  return _processor


async def process_release(request: EscrowReleaseRequest) -> EscrowReleaseResult:
  logger.info("Processing escrow release request for order %s", request.order_id)
  amount_value = float(request.amount or 0)
  metadata_raw = json.dumps({"milestone": request.milestone, "amount": amount_value})
  try:
    processor = get_processor()
  except RuntimeError as error:
    await record_payment_status(
      order_id=request.order_id,
      payer=request.buyer_wallet,
      payee=request.supplier_wallet,
      amount=amount_value,
      status="Failed",
      metadata_raw=metadata_raw,
    )
    return EscrowReleaseResult(
      order_id=request.order_id,
      status="FAILED",
      error=str(error),
    )

  def _call() -> str:
    order_numeric = (
      int(request.order_id, 0) if request.order_id.startswith("0x") else int(request.order_id)
    )
    return processor.release_from_shipment(order_numeric)

  try:
    loop = asyncio.get_running_loop()
  except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

  try:
    tx_hash = await loop.run_in_executor(None, _call)
    await record_payment_status(
      order_id=request.order_id,
      payer=request.buyer_wallet,
      payee=request.supplier_wallet,
      amount=amount_value,
      status="Released",
      release_tx=tx_hash,
      metadata_raw=metadata_raw,
    )
    return EscrowReleaseResult(order_id=request.order_id, status="SUCCESS", tx_hash=tx_hash)
  except Exception as error:  # noqa: BLE001
    logger.exception("Failed to release escrow for %s", request.order_id)
    await record_payment_status(
      order_id=request.order_id,
      payer=request.buyer_wallet,
      payee=request.supplier_wallet,
      amount=amount_value,
      status="Failed",
      metadata_raw=metadata_raw,
    )
    return EscrowReleaseResult(
      order_id=request.order_id,
      status="FAILED",
      error=str(error),
    )


@agent.on_message(model=EscrowReleaseRequest, replies=EscrowReleaseResult)
async def release_handler(ctx: Context, sender: str, request: EscrowReleaseRequest) -> None:
  result = await process_release(request)
  await ctx.send(sender, result)


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
  if text.startswith("release order"):
    parts = text.split()
    try:
      order_id = parts[2]
      result = await process_release(
        EscrowReleaseRequest(
          order_id=order_id,
          buyer_wallet="",
          supplier_wallet="",
          amount=0,
          milestone="Delivered",
        )
      )
      if result.status == "SUCCESS":
        response = f"Escrow released for order {order_id}, tx {result.tx_hash}."
      else:
        response = f"Failed to release escrow: {result.error}"
    except Exception as error:
      response = f"Failed to release escrow: {error}"
  else:
    response = "Ask me to release escrow: 'release order 1234'."

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


@agent.on_rest_post("/release", PaymentsRestRequest, PaymentsRestResponse)
async def rest_release(_ctx: Context, req: PaymentsRestRequest) -> PaymentsRestResponse:
  result = await process_release(
    EscrowReleaseRequest(
      order_id=req.order_id,
      buyer_wallet=req.buyer_wallet,
      supplier_wallet=req.supplier_wallet,
      amount=req.amount,
      milestone=req.milestone,  # type: ignore[arg-type]
    )
  )
  return PaymentsRestResponse(
    order_id=result.order_id,
    status=result.status,
    tx_hash=result.tx_hash,
    error=result.error,
  )


@agent.on_rest_get("/health", PaymentsRestResponse)
async def rest_health(_ctx: Context) -> PaymentsRestResponse:
  return PaymentsRestResponse(order_id="", status="healthy", tx_hash=None, error=None)


def run() -> None:
  agent.include(chat_protocol, publish_manifest=True)
  agent.run()


if __name__ == "__main__":
  run()
