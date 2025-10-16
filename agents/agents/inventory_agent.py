from __future__ import annotations

import logging
from decimal import Decimal
from datetime import datetime
from typing import Any, Literal, Optional
from uuid import uuid4

from hyperon import E, S, ValueAtom
from uagents import Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
  ChatAcknowledgement,
  ChatMessage,
  TextContent,
  chat_protocol_spec,
)

from agents.bridge.podx import get_inventory_policy, get_product
from agents.metta import get_metta
from agents.shared.agent_factory import create_agent
from agents.shared.messages import InventoryQuery, InventoryStatus


class InventoryRestRequest(Model):
  owner_wallet: str
  sku_id: str
  supplier_wallet: str | None = None


class InventoryRestResponse(Model):
  sku_id: str
  owner_wallet: str
  supplier_wallet: str | None = None
  quantity_on_hand: int
  reorder_threshold: int
  target_quantity: int | None = None
  min_reorder_qty: int | None = None
  max_reorder_qty: int | None = None
  max_unit_price: float | None = None
  currency: str | None = None
  recommended_action: str
  recommendation_reason: str | None = None


class InventoryHealthResponse(Model):
  status: str
  agent: str

logger = logging.getLogger(__name__)

AGENT_NAME = "InventoryAgent"

agent = create_agent(AGENT_NAME, seed_suffix="core", port_offset=0)

chat_protocol = Protocol(spec=chat_protocol_spec)


_inventory_atom_cache: dict[tuple[str, str, str], list[Any]] = {}


def _get_stock_atom_key(owner: str, supplier: str, sku_id: str) -> tuple[str, str, str]:
  return (sku_id.lower(), owner.lower(), supplier.lower())


async def _update_inventory_atoms(
  owner: str,
  supplier: str,
  sku_id: str,
  quantity: int,
  policy_data: dict[str, Optional[int | float | str]],
) -> None:
  metta = get_metta()
  owner_key = owner.lower()
  supplier_key = supplier.lower()
  sku_atom_value = sku_id
  cache_key = _get_stock_atom_key(owner, supplier, sku_id)
  legacy_cache_key = (owner_key, supplier_key, sku_id)
  space = metta.space()

  existing_atoms: list[Any] = []
  for key in {cache_key, legacy_cache_key}:
    atoms = _inventory_atom_cache.pop(key, [])
    if atoms:
      existing_atoms.extend(atoms)
  for atom in existing_atoms:
    try:
      space.remove_atom(atom)
    except Exception:  # noqa: BLE001
      logger.exception(
        "Failed to remove existing inventory atom %s for %s/%s/%s", atom, owner_key, supplier_key, sku_id
      )

  new_atoms: list[object] = []

  stock_atom = E(S("stock"), S(sku_atom_value), S(owner_key), S(supplier_key), ValueAtom(quantity))
  space.add_atom(stock_atom)
  new_atoms.append(stock_atom)

  threshold = policy_data.get("reorder_threshold")
  if threshold is not None:
    threshold_atom = E(
      S("reorder_threshold"), S(sku_atom_value), S(owner_key), S(supplier_key), ValueAtom(int(threshold))
    )
    space.add_atom(threshold_atom)
    new_atoms.append(threshold_atom)
  target_quantity = policy_data.get("target_quantity")
  if target_quantity is not None:
    target_atom = E(
      S("target_quantity"), S(sku_atom_value), S(owner_key), S(supplier_key), ValueAtom(int(target_quantity))
    )
    space.add_atom(target_atom)
    new_atoms.append(target_atom)
  min_qty = policy_data.get("min_reorder_qty")
  if min_qty is not None:
    min_atom = E(S("min_reorder_qty"), S(sku_atom_value), S(owner_key), S(supplier_key), ValueAtom(int(min_qty)))
    space.add_atom(min_atom)
    new_atoms.append(min_atom)
  max_qty = policy_data.get("max_reorder_qty")
  if max_qty is not None:
    max_atom = E(S("max_reorder_qty"), S(sku_atom_value), S(owner_key), S(supplier_key), ValueAtom(int(max_qty)))
    space.add_atom(max_atom)
    new_atoms.append(max_atom)
  max_price = policy_data.get("max_unit_price")
  if max_price is not None:
    price_atom = E(
      S("max_unit_price"), S(sku_atom_value), S(owner_key), S(supplier_key), ValueAtom(float(max_price))
    )
    space.add_atom(price_atom)
    new_atoms.append(price_atom)
  currency = policy_data.get("currency")
  if currency:
    currency_atom = E(S("inventory_currency"), S(sku_atom_value), S(owner_key), S(supplier_key), S(str(currency)))
    space.add_atom(currency_atom)
    new_atoms.append(currency_atom)
  preferred = policy_data.get("preferred_supplier")
  if preferred:
    preferred_atom = E(S("preferred_supplier"), S(sku_atom_value), S(owner_key), S(supplier_key), S(preferred))
    space.add_atom(preferred_atom)
    new_atoms.append(preferred_atom)
  updated_atom = E(
    S("inventory_updated_ts"),
    S(sku_atom_value),
    S(owner_key),
    S(supplier_key),
    ValueAtom(datetime.utcnow().timestamp()),
  )
  space.add_atom(updated_atom)
  new_atoms.append(updated_atom)
  _inventory_atom_cache[cache_key] = new_atoms


async def handle_inventory_query(query: InventoryQuery) -> InventoryStatus:
  product = await get_product(query.owner_wallet, query.sku_id)
  policy = await get_inventory_policy(query.owner_wallet, query.sku_id)

  def _as_int(value: Optional[int | float | str | Decimal]) -> Optional[int]:
    if value is None:
      return None
    try:
      return int(value)
    except (TypeError, ValueError):
      return None

  def _as_float(value: Optional[int | float | str | Decimal]) -> Optional[float]:
    if value is None:
      return None
    try:
      return float(value)
    except (TypeError, ValueError):
      return None

  owner_wallet = (product["owner"] if product else query.owner_wallet).lower()
  preferred_supplier_raw = policy.get("preferredSupplier") if policy else None
  preferred_supplier = preferred_supplier_raw.lower() if isinstance(preferred_supplier_raw, str) else None
  supplier_wallet = (query.supplier_wallet or preferred_supplier or "unknown_supplier").lower()

  product_data: dict[str, Any] = dict(product) if isinstance(product, dict) else {}
  policy_data_raw: dict[str, Any] = dict(policy) if isinstance(policy, dict) else {}

  quantity = int(product_data.get("targetStock") or 0)
  threshold = (_as_int(policy_data_raw.get("reorderThreshold")) or _as_int(product_data.get("minThreshold"))) or 0
  target_quantity = (
    _as_int(policy_data_raw.get("targetQuantity")) or _as_int(product_data.get("targetStock")) or None
  )
  min_reorder_qty = _as_int(policy_data_raw.get("minReorderQty"))
  max_reorder_qty = _as_int(policy_data_raw.get("maxReorderQty"))
  max_unit_price = _as_float(policy_data_raw.get("maxUnitPrice"))
  currency = policy_data_raw.get("currency")

  policy_data: dict[str, Optional[int | float | str]] = {
    "reorder_threshold": threshold,
    "target_quantity": target_quantity,
    "min_reorder_qty": min_reorder_qty,
    "max_reorder_qty": max_reorder_qty,
    "max_unit_price": max_unit_price,
    "currency": currency,
    "preferred_supplier": preferred_supplier,
  }

  if not product:
    await _update_inventory_atoms(query.owner_wallet, supplier_wallet, query.sku_id, 0, policy_data)
    return InventoryStatus(
      request_id=query.request_id,
      timestamp=datetime.utcnow(),
      sku_id=query.sku_id,
      owner_wallet=query.owner_wallet,
      supplier_wallet=supplier_wallet,
      quantity_on_hand=0,
      reorder_threshold=threshold,
      target_quantity=target_quantity,
      min_reorder_qty=min_reorder_qty,
      max_reorder_qty=max_reorder_qty,
      max_unit_price=max_unit_price,
      currency=currency,
      recommended_action="REORDER",
      recommendation_reason="Product not found; treat inventory as depleted.",
    )

  await _update_inventory_atoms(owner_wallet, supplier_wallet, product_data.get("skuId", query.sku_id), quantity, policy_data)

  recommended_action: Literal["OK", "REORDER"] = "REORDER" if quantity <= threshold else "OK"
  recommendation_reason = (
    "Quantity is below configured reorder threshold." if recommended_action == "REORDER" else None
  )

  return InventoryStatus(
    request_id=query.request_id,
    timestamp=datetime.utcnow(),
    sku_id=product["skuId"],
    owner_wallet=product["owner"],
    supplier_wallet=supplier_wallet,
    quantity_on_hand=quantity,
    reorder_threshold=threshold,
    target_quantity=target_quantity,
    min_reorder_qty=min_reorder_qty,
    max_reorder_qty=max_reorder_qty,
    max_unit_price=max_unit_price,
    currency=currency,
    recommended_action=recommended_action,
    recommendation_reason=recommendation_reason,
  )


@agent.on_message(model=InventoryQuery, replies=InventoryStatus)
async def inventory_request_handler(ctx: Context, sender: str, query: InventoryQuery) -> None:
  status = await handle_inventory_query(query)
  await ctx.send(sender, status)


@agent.on_rest_post("/status", InventoryRestRequest, InventoryRestResponse)
async def inventory_rest_handler(_ctx: Context, req: InventoryRestRequest) -> InventoryRestResponse:
  status = await handle_inventory_query(
    InventoryQuery(owner_wallet=req.owner_wallet, sku_id=req.sku_id, supplier_wallet=req.supplier_wallet)
  )
  return InventoryRestResponse(
    sku_id=status.sku_id,
    owner_wallet=status.owner_wallet,
    supplier_wallet=status.supplier_wallet,
    quantity_on_hand=status.quantity_on_hand,
    reorder_threshold=status.reorder_threshold,
    target_quantity=status.target_quantity,
    min_reorder_qty=status.min_reorder_qty,
    max_reorder_qty=status.max_reorder_qty,
    max_unit_price=status.max_unit_price,
    currency=status.currency,
    recommended_action=status.recommended_action,
    recommendation_reason=status.recommendation_reason,
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
  response: Optional[str] = None
  if "stock" in text:
    # naive parse: expecting "stock <sku> for <wallet>"
    parts = text.split()
    try:
      sku_index = parts.index("stock") + 1
      sku_id = parts[sku_index]
      wallet_index = parts.index("for") + 1
      owner_wallet = parts[wallet_index]
      query = InventoryQuery(sku_id=sku_id, owner_wallet=owner_wallet)
      status = await handle_inventory_query(query)
      supplier_hint = f" supplier {status.supplier_wallet}" if status.supplier_wallet else ""
      target_hint = (
        f" target {status.target_quantity}" if status.target_quantity is not None else ""
      )
      response = (
        f"Inventory status for {status.sku_id}{supplier_hint}: {status.quantity_on_hand} units on hand, "
        f"threshold {status.reorder_threshold}{target_hint}. Action: {status.recommended_action}."
      )
    except Exception as error:
      logger.exception("Failed to parse chat message %s", text)
      response = f"Could not parse inventory query: {error}"
  else:
    response = "Ask me about stock levels: e.g. 'stock SKU-100 for 0xBuyer...'"

  if response:
    await ctx.send(
      sender,
      ChatMessage(
        timestamp=datetime.utcnow(),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=response)],
      ),
    )


@chat_protocol.on_message(ChatAcknowledgement)
async def acknowledgement_handler(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
  ctx.logger.info("Received acknowledgement %s from %s", msg.acknowledged_msg_id, sender)


@agent.on_rest_get("/health", InventoryHealthResponse)
async def rest_health(_ctx: Context) -> InventoryHealthResponse:
  return InventoryHealthResponse(status="healthy", agent=AGENT_NAME)


def run() -> None:
  agent.include(chat_protocol, publish_manifest=True)
  agent.run()


if __name__ == "__main__":
  run()
