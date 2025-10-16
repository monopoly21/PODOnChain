from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
import logging
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4

from hyperon import E, S, ValueAtom

from .db import db_connection
from agents.metta import get_metta

ORDER_STATUS_TIMESTAMPS = {
  "Approved": "approvedAt",
  "Funded": "fundedAt",
  "Delivered": "completedAt",
  "Resolved": "completedAt",
  "Cancelled": "cancelledAt",
}

SHIPMENT_STATUS_TIMESTAMPS = {
  "ReadyForPickup": "readyAt",
  "InTransit": "pickedUpAt",
  "Delivered": "deliveredAt",
  "Cancelled": "cancelledAt",
}


_status_atom_cache: dict[tuple[str, Tuple[str, ...]], list[Any]] = {}


def _normalize_wallet(value: Optional[str]) -> str:
  return (value or "").lower()


def _now_iso() -> str:
  # Always return an explicit UTC timestamp so Prisma DateTime columns stay valid.
  return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_ts() -> float:
  return datetime.utcnow().timestamp()


def _to_numeric(value: Any) -> Optional[float]:
  if value is None:
    return None
  if isinstance(value, Decimal):
    return float(value)
  try:
    return float(value)
  except (TypeError, ValueError):
    return None


def _add_status_atom(kind: str, keys: list[str], status: str) -> None:
  status_value = status or ""
  metta = get_metta()
  space = metta.space()
  cache_key = (kind, tuple(keys))
  existing_atoms = _status_atom_cache.pop(cache_key, [])
  for atom in existing_atoms:
    try:
      space.remove_atom(atom)
    except Exception:
      logger = logging.getLogger(__name__)
      logger.exception("Failed to remove prior %s atom for %s", kind, cache_key)

  new_atoms: list[Any] = []
  atom = E(S(kind), *[S(key) for key in keys], S(status_value))
  space.add_atom(atom)
  new_atoms.append(atom)
  ts_atom = E(S(f"{kind}_ts"), *[S(key) for key in keys], ValueAtom(_now_ts()))
  space.add_atom(ts_atom)
  new_atoms.append(ts_atom)
  _status_atom_cache[cache_key] = new_atoms


def _add_numeric_atom(kind: str, keys: list[str], value: float) -> None:
  metta = get_metta()
  args = [S(kind), *[S(key) for key in keys], ValueAtom(value)]
  metta.space().add_atom(E(*args))


def _record_order_atoms(order: Dict[str, Any]) -> None:
  order_id = str(order.get("id") or "").strip()
  buyer = _normalize_wallet(order.get("buyer"))
  supplier = _normalize_wallet(order.get("supplier"))
  status = str(order.get("status") or "")
  if not order_id or not buyer or not supplier:
    return
  _add_status_atom("order_status", [buyer, supplier, order_id], status)
  currency = order.get("currency")
  if currency:
    metta = get_metta()
    metta.space().add_atom(E(S("order_currency"), S(buyer), S(supplier), S(order_id), S(str(currency))))
  total = _to_numeric(order.get("totalAmount"))
  if total is not None:
    _add_numeric_atom("order_total", [buyer, supplier, order_id], total)


def _record_shipment_atoms(shipment: Dict[str, Any]) -> None:
  shipment_id = str(shipment.get("id") or "").strip()
  buyer = _normalize_wallet(shipment.get("buyer"))
  supplier = _normalize_wallet(shipment.get("supplier"))
  status = str(shipment.get("status") or "")
  if not shipment_id or not buyer or not supplier:
    return
  _add_status_atom("shipment_status", [buyer, supplier, shipment_id], status)
  shipment_no = shipment.get("shipmentNo")
  if shipment_no is not None:
    metta = get_metta()
    metta.space().add_atom(
      E(
        S("shipment_no"),
        S(buyer),
        S(supplier),
        S(shipment_id),
        ValueAtom(int(shipment_no)),
      )
    )


def _record_payment_atoms(payment: Dict[str, Any]) -> None:
  order_id = str(payment.get("orderId") or "").strip()
  payer = _normalize_wallet(payment.get("payer"))
  payee = _normalize_wallet(payment.get("payee"))
  status = str(payment.get("status") or "")
  if not order_id or not payer or not payee:
    return
  _add_status_atom("payment_status", [payer, payee, order_id], status)
  amount = _to_numeric(payment.get("amount"))
  if amount is not None:
    _add_numeric_atom("payment_amount", [payer, payee, order_id], amount)
  currency = payment.get("currency")
  if currency:
    metta = get_metta()
    metta.space().add_atom(E(S("payment_currency"), S(payer), S(payee), S(order_id), S(str(currency))))


async def _fetch_one(query: str, *params: Any) -> Optional[Dict[str, Any]]:
  async with db_connection() as conn:
    async with conn.execute(query, params) as cursor:
      row = await cursor.fetchone()
      if not row:
        return None
      data = dict(row)
      if "dueBy" in data and isinstance(data["dueBy"], str):
        from datetime import datetime

        try:
          data["dueBy"] = datetime.fromisoformat(data["dueBy"])
        except ValueError:
          ...
      return data


async def _execute(query: str, *params: Any) -> None:
  async with db_connection() as conn:
    await conn.execute(query, params)
    await conn.commit()


def _normalise_sku_match(value: str) -> tuple[str, str]:
  lower = value.lower()
  compact = lower.replace("-", "").replace(" ", "")
  return lower, compact


async def get_product(owner_wallet: str, sku_id: str) -> Optional[Dict[str, Any]]:
  sku_lower, sku_compact = _normalise_sku_match(sku_id)
  return await _fetch_one(
    """
    SELECT * FROM Product
    WHERE owner = ?
      AND (lower(skuId) = ? OR replace(replace(lower(skuId), '-', ''), ' ', '') = ?)
    """,
    owner_wallet.lower(),
    sku_lower,
    sku_compact,
  )


async def adjust_product_stock(owner_wallet: str, sku_id: str, delta: int) -> Optional[Dict[str, Any]]:
  owner_lower = owner_wallet.lower()
  sku_lower, sku_compact = _normalise_sku_match(sku_id)
  product = await get_product(owner_wallet, sku_id)
  current = _to_numeric(product.get("targetStock")) or 0.0 if product else 0.0
  new_value = max(0, int(round(current)) + int(delta))
  now_iso = _now_iso()
  if product:
    await _execute(
      """
      UPDATE Product
      SET targetStock = ?, updatedAt = ?, active = 1
      WHERE owner = ?
        AND (lower(skuId) = ? OR replace(replace(lower(skuId), '-', ''), ' ', '') = ?)
      """,
      new_value,
      now_iso,
      owner_lower,
      sku_lower,
      sku_compact,
    )
  else:
    await _execute(
      "INSERT OR IGNORE INTO Product (owner, skuId, name, unit, minThreshold, targetStock, active, version, createdAt, updatedAt) "
      "VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
      owner_lower,
      sku_id,
      sku_id,
      "unit",
      0,
      new_value,
      now_iso,
      now_iso,
    )
    await _execute(
      """
      UPDATE Product
      SET targetStock = ?, updatedAt = ?, active = 1
      WHERE owner = ?
        AND (lower(skuId) = ? OR replace(replace(lower(skuId), '-', ''), ' ', '') = ?)
      """,
      new_value,
      now_iso,
      owner_lower,
      sku_lower,
      sku_compact,
    )
  updated = await get_product(owner_wallet, sku_id)
  return updated


async def get_inventory_policy(buyer_wallet: str, sku_id: str) -> Optional[Dict[str, Any]]:
  sku_lower, sku_compact = _normalise_sku_match(sku_id)
  return await _fetch_one(
    """
    SELECT * FROM InventoryPolicy
    WHERE buyer = ?
      AND (lower(skuId) = ? OR replace(replace(lower(skuId), '-', ''), ' ', '') = ?)
    """,
    buyer_wallet.lower(),
    sku_lower,
    sku_compact,
  )


async def get_order(order_id: str) -> Optional[Dict[str, Any]]:
  return await _fetch_one("SELECT * FROM `Order` WHERE id = ?", order_id)


async def update_order(
  order_id: str,
  *,
  status: Optional[str] = None,
  metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
  now_iso = _now_iso()
  set_parts: list[str] = []
  params: list[Any] = []

  if status is not None:
    set_parts.append("status = ?")
    params.append(status)
    timestamp_field = ORDER_STATUS_TIMESTAMPS.get(status)
    if timestamp_field:
      set_parts.append(f"{timestamp_field} = ?")
      params.append(now_iso)

  if metadata is not None:
    set_parts.append("metadataRaw = ?")
    params.append(json.dumps(metadata))

  if not set_parts:
    return await get_order(order_id)

  set_parts.append("updatedAt = ?")
  params.append(now_iso)

  await _execute(f"UPDATE `Order` SET {', '.join(set_parts)} WHERE id = ?", *params, order_id)
  order = await get_order(order_id)
  if order:
    _record_order_atoms(order)
  return order


async def update_order_status(order_id: str, status: str) -> Optional[Dict[str, Any]]:
  return await update_order(order_id, status=status)


async def update_order_metadata(order_id: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
  return await update_order(order_id, metadata=metadata)


async def get_shipment(shipment_id: str) -> Optional[Dict[str, Any]]:
  return await _fetch_one("SELECT * FROM Shipment WHERE id = ?", shipment_id)


async def update_shipment_status(shipment_id: str, status: str) -> Optional[Dict[str, Any]]:
  now_iso = _now_iso()
  set_parts = ["status = ?", "updatedAt = ?"]
  params: list[Any] = [status, now_iso]

  timestamp_field = SHIPMENT_STATUS_TIMESTAMPS.get(status)
  if timestamp_field:
    set_parts.append(f"{timestamp_field} = ?")
    params.append(now_iso)

  await _execute(f"UPDATE Shipment SET {', '.join(set_parts)} WHERE id = ?", *params, shipment_id)
  shipment = await get_shipment(shipment_id)
  if shipment:
    _record_shipment_atoms(shipment)
  return shipment


async def create_shipment(
  *,
  order_id: str,
  shipment_no: int,
  supplier: str,
  buyer: str,
  pickup_lat: float,
  pickup_lon: float,
  drop_lat: float,
  drop_lon: float,
  due_by: datetime,
  status: str = "Created",
  assigned_courier: Optional[str] = None,
  metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
  shipment_id = f"shp_{uuid4().hex}"
  now_iso = _now_iso()
  metadata_raw = json.dumps(metadata) if metadata is not None else None
  await _execute(
    "INSERT INTO Shipment (id, orderId, shipmentNo, supplier, buyer, pickupLat, pickupLon, dropLat, dropLon, dueBy, status, "
    "assignedCourier, metadataRaw, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    shipment_id,
    order_id,
    shipment_no,
    _normalize_wallet(supplier),
    _normalize_wallet(buyer),
    pickup_lat,
    pickup_lon,
    drop_lat,
    drop_lon,
    due_by.isoformat(),
    status,
    _normalize_wallet(assigned_courier) if assigned_courier else None,
    metadata_raw,
    now_iso,
    now_iso,
  )
  shipment = await get_shipment(shipment_id)
  if shipment:
    _record_shipment_atoms(shipment)
  return shipment


async def get_payment_for_order(order_id: str) -> Optional[Dict[str, Any]]:
  return await _fetch_one(
    "SELECT * FROM Payment WHERE orderId = ? ORDER BY updatedAt DESC LIMIT 1",
    order_id,
  )


async def upsert_payment(
  *,
  order_id: str,
  payer: str,
  payee: str,
  amount: float,
  currency: str,
  status: str,
  escrow_tx: Optional[str] = None,
  release_tx: Optional[str] = None,
  metadata_raw: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
  existing = await get_payment_for_order(order_id)
  now_iso = _now_iso()
  lower_payer = _normalize_wallet(payer)
  lower_payee = _normalize_wallet(payee)
  amount_value = _to_numeric(amount) or 0.0

  if existing:
    escrow_value = escrow_tx if escrow_tx is not None else existing.get("escrowTx")
    release_value = release_tx if release_tx is not None else existing.get("releaseTx")
    metadata_value = metadata_raw if metadata_raw is not None else existing.get("metadataRaw")
    await _execute(
      "UPDATE Payment SET payer = ?, payee = ?, amount = ?, currency = ?, status = ?, escrowTx = ?, releaseTx = ?, metadataRaw = ?, updatedAt = ? WHERE id = ?",
      lower_payer,
      lower_payee,
      amount_value,
      currency,
      status,
      escrow_value,
      release_value,
      metadata_value,
      now_iso,
      existing["id"],
    )
    payment = await _fetch_one("SELECT * FROM Payment WHERE id = ?", existing["id"])
  else:
    payment_id = f"pay_{uuid4().hex}"
    await _execute(
      "INSERT INTO Payment (id, orderId, payer, payee, amount, currency, status, escrowTx, releaseTx, metadataRaw, createdAt, updatedAt) "
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      payment_id,
      order_id,
      lower_payer,
      lower_payee,
      amount_value,
      currency,
      status,
      escrow_tx,
      release_tx,
      metadata_raw,
      now_iso,
      now_iso,
    )
    payment = await _fetch_one("SELECT * FROM Payment WHERE id = ?", payment_id)

  if payment:
    _record_payment_atoms(payment)
  return payment


async def record_payment_status(
  *,
  order_id: str,
  payer: str,
  payee: str,
  amount: float,
  status: str,
  escrow_tx: Optional[str] = None,
  release_tx: Optional[str] = None,
  metadata_raw: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
  order = await get_order(order_id)
  currency = (order or {}).get("currency") or "USD"
  payment = await upsert_payment(
    order_id=order_id,
    payer=payer,
    payee=payee,
    amount=amount,
    currency=str(currency),
    status=status,
    escrow_tx=escrow_tx,
    release_tx=release_tx,
    metadata_raw=metadata_raw,
  )
  return payment
