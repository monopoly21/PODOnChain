from __future__ import annotations

import logging
import json
from datetime import datetime
from typing import Any, Dict, Literal, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator

from agents.agents.inventory_agent import handle_inventory_query
from agents.agents.po_agent import process_purchase_order
from agents.shared.messages import (
  EscrowReleaseRequest,
  InventoryQuery,
  PurchaseOrderRequest,
  ShipmentMilestoneUpdate,
)
from agents.services.payments import release_escrow
from agents.services.shipment import (
  process_milestone,
  register_shipment_onchain,
  update_shipment_courier_onchain,
)
from agents.shared.logging import setup_logging
from agents.bridge.podx import (
  create_shipment,
  get_order,
  record_payment_status,
  update_order,
)

logger = logging.getLogger(__name__)

setup_logging()

app = FastAPI(title="PODx Agent Bridge", version="1.0.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_methods=["*"],
  allow_headers=["*"],
)


def _parse_metadata(raw: Optional[str]) -> Dict[str, Any]:
  if not raw:
    return {}
  try:
    data = json.loads(raw)
    if isinstance(data, dict):
      return data
  except json.JSONDecodeError:
    ...
  return {}


def _merge_metadata(base: Dict[str, Any], updates: Optional[Dict[str, Any]]) -> Dict[str, Any]:
  if not updates:
    return base
  merged = {**base}
  for key, value in updates.items():
    merged[key] = value
  return merged


def _extract_chain_order_id(metadata: Dict[str, Any]) -> Optional[int]:
  value = metadata.get("chainOrderId") if metadata else None
  if isinstance(value, str) and value.strip():
    try:
      return int(value, 0)
    except ValueError:
      try:
        return int(value)
      except ValueError:
        return None
  if isinstance(value, (int, float)) and value:
    return int(value)
  return None


class InventoryPayload(BaseModel):
  owner_wallet: str
  sku_id: str
  supplier_wallet: str | None = None


class PurchaseOrderPayload(BaseModel):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  sku_id: str
  quantity: int
  unit_price: float


class ShipmentMilestonePayload(BaseModel):
  shipment_id: str
  shipment_no: int
  order_id: str
  milestone: Literal["Pickup", "InTransit", "Delivered", "Cancelled"]
  courier_wallet: str
  latitude: float | None = None
  longitude: float | None = None
  claimed_ts: int | None = None
  radius_m: float | None = None
  courier_signature: str | None = None
  supplier_signature: str | None = None
  buyer_signature: str | None = None
  location_hash: str | None = None
  distance_meters: float | None = None
  shipment_hash: str | None = None
  chain_order_id: str | None = None


class EscrowReleasePayload(BaseModel):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  amount: float
  milestone: Literal["Pickup", "Delivered"]


class OrderStatusPayload(BaseModel):
  order_id: str
  status: Literal["Approved", "InFulfillment", "Shipped", "Delivered", "Disputed", "Resolved", "Cancelled"]
  metadata: Dict[str, Any] | None = None


class PaymentEscrowPayload(BaseModel):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  amount: float
  escrow_tx: str | None = None
  approval_tx: str | None = None
  metadata: Dict[str, Any] | None = None


class ShipmentCreatePayload(BaseModel):
  order_id: str
  shipment_no: int
  supplier_wallet: str
  buyer_wallet: str
  pickup_lat: float
  pickup_lon: float
  drop_lat: float
  drop_lon: float
  due_by: datetime
  assigned_courier: str | None = None
  metadata: Dict[str, Any] | None = None
  order_metadata: Dict[str, Any] | None = None

  @validator("due_by", pre=True)
  def _parse_due_by(cls, value: Any) -> datetime:
    if isinstance(value, datetime):
      return value
    if isinstance(value, str):
      try:
        cleaned = value.strip()
        if cleaned.endswith("Z"):
          cleaned = cleaned[:-1] + "+00:00"
        return datetime.fromisoformat(cleaned)
      except ValueError as error:
        raise ValueError(f"Invalid due_by: {value}") from error
    raise ValueError("due_by must be datetime or ISO string")


class ShipmentCourierUpdatePayload(BaseModel):
  shipment_id: str
  courier_wallet: str


@app.get("/health")
async def health() -> Dict[str, Any]:
  return {"ok": True}


@app.post("/inventory/status")
async def inventory_status(payload: InventoryPayload) -> Dict[str, Any]:
  query = InventoryQuery(owner_wallet=payload.owner_wallet, sku_id=payload.sku_id)
  if payload.supplier_wallet:
    query.supplier_wallet = payload.supplier_wallet
  status = await handle_inventory_query(query)
  return status.model_dump()


@app.post("/orders/confirm")
async def confirm_order(payload: PurchaseOrderPayload) -> Dict[str, Any]:
  request = PurchaseOrderRequest(
    order_id=payload.order_id,
    buyer_wallet=payload.buyer_wallet,
    supplier_wallet=payload.supplier_wallet,
    sku_id=payload.sku_id,
    quantity=payload.quantity,
    unit_price=payload.unit_price,
  )
  ack = await process_purchase_order(request)
  if ack.status == "REJECTED":
    raise HTTPException(status_code=400, detail=ack.notes or "Order rejected")
  return ack.model_dump()


@app.post("/orders/status")
async def update_order_status_route(payload: OrderStatusPayload) -> Dict[str, Any]:
  order = await get_order(payload.order_id)
  if not order:
    raise HTTPException(status_code=404, detail="Order not found")

  metadata = _parse_metadata(order.get("metadataRaw")) if isinstance(order, dict) else {}
  merged_metadata = _merge_metadata(metadata, payload.metadata)
  updated = await update_order(
    payload.order_id,
    status=payload.status,
    metadata=merged_metadata if payload.metadata is not None else None,
  )
  if not updated:
    raise HTTPException(status_code=404, detail="Order not found after update")
  return {"order": updated}


@app.post("/shipments/milestone")
async def shipment_milestone(payload: ShipmentMilestonePayload) -> Dict[str, Any]:
  update = ShipmentMilestoneUpdate(
    shipment_id=payload.shipment_id,
    shipment_no=payload.shipment_no,
    order_id=payload.order_id,
    milestone=payload.milestone,
    courier_wallet=payload.courier_wallet,
    latitude=payload.latitude,
    longitude=payload.longitude,
    claimed_ts=payload.claimed_ts,
    courier_signature=payload.courier_signature,
    supplier_signature=payload.supplier_signature,
    buyer_signature=payload.buyer_signature,
    location_hash=payload.location_hash,
    distance_meters=payload.distance_meters,
    shipment_hash=payload.shipment_hash,
    chain_order_id=payload.chain_order_id,
  )
  result = await process_milestone(update, radius_m=payload.radius_m)
  if result.get("status") not in {"ok"}:
    raise HTTPException(status_code=400, detail=result)
  return result


@app.post("/payments/release")
async def payments_release(payload: EscrowReleasePayload) -> Dict[str, Any]:
  request = EscrowReleaseRequest(
    order_id=payload.order_id,
    buyer_wallet=payload.buyer_wallet,
    supplier_wallet=payload.supplier_wallet,
    amount=payload.amount,
    milestone=payload.milestone,
  )
  result = await release_escrow(request)
  if result.status == "FAILED":
    raise HTTPException(status_code=400, detail=result.error or "Escrow release failed")
  return result.model_dump()


@app.post("/payments/escrow")
async def payments_escrow(payload: PaymentEscrowPayload) -> Dict[str, Any]:
  order = await get_order(payload.order_id)
  if not order:
    raise HTTPException(status_code=404, detail="Order not found")
  base_metadata = _parse_metadata(order.get("metadataRaw")) if isinstance(order, dict) else {}
  merged_metadata = _merge_metadata(base_metadata, payload.metadata)
  if payload.escrow_tx or payload.approval_tx:
    escrow_meta = dict(merged_metadata.get("escrow", {})) if isinstance(merged_metadata.get("escrow"), dict) else {}
    if payload.escrow_tx:
      escrow_meta["fundTx"] = payload.escrow_tx
    if payload.approval_tx:
      escrow_meta["approvalTx"] = payload.approval_tx
    merged_metadata["escrow"] = escrow_meta

  updated = await update_order(
    payload.order_id,
    status="Funded",
    metadata=merged_metadata,
  )
  metadata_raw = json.dumps(
    {
      "milestone": "Funded",
      "escrowTx": payload.escrow_tx,
      "approvalTx": payload.approval_tx,
    }
  )
  payment = await record_payment_status(
    order_id=payload.order_id,
    payer=payload.buyer_wallet,
    payee=payload.supplier_wallet,
    amount=payload.amount,
    status="Escrowed",
    escrow_tx=payload.escrow_tx,
    metadata_raw=metadata_raw,
  )

  return {"order": updated, "payment": payment}


@app.post("/shipments/create")
async def shipments_create(payload: ShipmentCreatePayload) -> Dict[str, Any]:
  order = await get_order(payload.order_id)
  if not order:
    raise HTTPException(status_code=404, detail="Order not found")

  shipment = await create_shipment(
    order_id=payload.order_id,
    shipment_no=payload.shipment_no,
    supplier=payload.supplier_wallet,
    buyer=payload.buyer_wallet,
    pickup_lat=payload.pickup_lat,
    pickup_lon=payload.pickup_lon,
    drop_lat=payload.drop_lat,
    drop_lon=payload.drop_lon,
    due_by=payload.due_by,
    assigned_courier=payload.assigned_courier,
    metadata=payload.metadata,
  )
  if not shipment:
    raise HTTPException(status_code=500, detail="Failed to create shipment")

  merged_metadata = _merge_metadata(
    _parse_metadata(order.get("metadataRaw")) if isinstance(order, dict) else {},
    payload.order_metadata,
  )

  chain_order_id = _extract_chain_order_id(merged_metadata)
  if chain_order_id is not None:
    initial_courier = shipment.get("assignedCourier") or payload.assigned_courier or shipment["supplier"]
    register_shipment_onchain(
      shipment_id=shipment["id"],
      order_id=chain_order_id,
      buyer=shipment["buyer"],
      supplier=shipment["supplier"],
      courier=initial_courier,
    )

  updated_order = await update_order(
    payload.order_id,
    status="InFulfillment",
    metadata=merged_metadata if payload.order_metadata is not None else None,
  )

  return {"shipment": shipment, "order": updated_order}


@app.post("/shipments/update_courier")
async def shipments_update_courier(payload: ShipmentCourierUpdatePayload) -> Dict[str, Any]:
  tx_hash = update_shipment_courier_onchain(
    shipment_id=payload.shipment_id,
    courier=payload.courier_wallet,
  )
  return {"tx": tx_hash}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
  await websocket.accept()
  try:
    while True:
      data = await websocket.receive_json()
      agent = data.get("agent")
      payload = data.get("payload") or {}

      if agent == "inventory":
        result = await inventory_status(InventoryPayload(**payload))
      else:
        result = {"error": f"Unknown agent {agent}"}

      await websocket.send_json(result)
  except WebSocketDisconnect:
    logger.info("WebSocket disconnected")
  except Exception as error:  # noqa: BLE001
    logger.exception("WebSocket error")
    await websocket.close(code=1011, reason=str(error))


def run() -> None:
  import uvicorn

  uvicorn.run(app, host="0.0.0.0", port=8200)


if __name__ == "__main__":
  run()
