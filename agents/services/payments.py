from __future__ import annotations

import asyncio
import json
import logging
from agents.shared.messages import EscrowReleaseRequest, EscrowReleaseResult
from agents.agents.payments_agent import get_processor
from agents.bridge.podx import record_payment_status

logger = logging.getLogger(__name__)


async def release_escrow(request: EscrowReleaseRequest) -> EscrowReleaseResult:
  """
  Trigger escrow release using the payments processor.
  """
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
    tx_hash = await asyncio.get_running_loop().run_in_executor(None, _call)
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
    logger.exception("Escrow release failed for %s", request.order_id)
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
