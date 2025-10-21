from __future__ import annotations

import logging
from datetime import datetime
import json
from typing import Any, Dict, Optional, cast

from math import isfinite, asin, cos, sin, sqrt

from hyperon import E, S, ValueAtom

from agents.bridge.podx import (
  adjust_product_stock,
  get_order,
  get_shipment,
  update_order_status,
  update_shipment_status,
)
from agents.metta import get_metta
from agents.shared.config import get_settings
from agents.shared.messages import ShipmentMilestoneUpdate, InventoryQuery

from web3 import Web3
from web3.middleware import geth_poa_middleware
from agents.agents.inventory_agent import handle_inventory_query

logger = logging.getLogger(__name__)

EARTH_RADIUS_M = 6371000.0


SHIPMENT_REGISTRY_ABI = [
  {
    "inputs": [
      {"internalType": "bytes32", "name": "shipmentId", "type": "bytes32"},
      {"internalType": "uint256", "name": "orderId", "type": "uint256"},
      {"internalType": "address", "name": "buyer", "type": "address"},
      {"internalType": "address", "name": "supplier", "type": "address"},
      {"internalType": "address", "name": "courier", "type": "address"},
    ],
    "name": "registerShipment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function",
  },
  {
    "inputs": [
      {
        "components": [
          {"internalType": "bytes32", "name": "shipmentId", "type": "bytes32"},
          {"internalType": "uint256", "name": "orderId", "type": "uint256"},
          {"internalType": "bytes32", "name": "locationHash", "type": "bytes32"},
          {"internalType": "uint64", "name": "claimedTs", "type": "uint64"},
        ],
        "internalType": "struct PickupApproval",
        "name": "approval",
        "type": "tuple",
      },
      {"internalType": "bytes", "name": "courierSignature", "type": "bytes"},
      {"internalType": "bytes", "name": "supplierSignature", "type": "bytes"},
    ],
    "name": "confirmPickup",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function",
  },
  {
    "inputs": [
      {
        "components": [
          {"internalType": "bytes32", "name": "shipmentId", "type": "bytes32"},
          {"internalType": "uint256", "name": "orderId", "type": "uint256"},
          {"internalType": "bytes32", "name": "locationHash", "type": "bytes32"},
          {"internalType": "uint64", "name": "claimedTs", "type": "uint64"},
          {"internalType": "uint256", "name": "distanceMeters", "type": "uint256"},
        ],
        "internalType": "struct DropApproval",
        "name": "approval",
        "type": "tuple",
      },
      {"internalType": "bytes", "name": "courierSignature", "type": "bytes"},
      {"internalType": "bytes", "name": "buyerSignature", "type": "bytes"},
      {"internalType": "string", "name": "lineItems", "type": "string"},
      {"internalType": "string", "name": "metadataUri", "type": "string"},
    ],
    "name": "confirmDrop",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function",
  },
  {
    "inputs": [
      {"internalType": "bytes32", "name": "shipmentId", "type": "bytes32"},
      {"internalType": "address", "name": "courier", "type": "address"},
    ],
    "name": "updateCourier",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function",
  },
]


class ShipmentContractProcessor:
  def __init__(self) -> None:
    settings = get_settings()
    if not settings.sepolia_rpc_url:
      raise RuntimeError("SEPOLIA_RPC_URL required for shipment processing")
    if not settings.shipment_registry_address:
      raise RuntimeError("SHIPMENT_REGISTRY_ADDRESS required")
    if not settings.delivery_oracle_private_key:
      raise RuntimeError("DELIVERY_ORACLE_PRIVATE_KEY required")

    self.web3 = Web3(Web3.HTTPProvider(settings.sepolia_rpc_url))
    self.web3.middleware_onion.inject(geth_poa_middleware, layer=0)
    self.account = self.web3.eth.account.from_key(settings.delivery_oracle_private_key)
    self.contract = self.web3.eth.contract(
      address=Web3.to_checksum_address(settings.shipment_registry_address),
      abi=SHIPMENT_REGISTRY_ABI,
    )
    logger.info("ShipmentContractProcessor ready with account %s", self.account.address)

  def confirm_pickup(
    self,
    *,
    shipment_hash: bytes,
    order_id: int,
    location_hash: bytes,
    claimed_ts: int,
    courier_sig: bytes,
    supplier_sig: bytes,
  ) -> str:
    nonce = self.web3.eth.get_transaction_count(self.account.address)
    tx = self.contract.functions.confirmPickup(
      (shipment_hash, order_id, location_hash, claimed_ts),
      courier_sig,
      supplier_sig,
    ).build_transaction(
      {
        "from": self.account.address,
        "nonce": nonce,
        "gas": 250000,
        "gasPrice": self.web3.eth.gas_price,
      }
    )
    signed = self.account.sign_transaction(tx)
    tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash)
    if receipt.status != 1:
      raise RuntimeError(f"confirmPickup failed: {tx_hash.hex()}")
    return tx_hash.hex()

  def confirm_drop(
    self,
    *,
    shipment_hash: bytes,
    order_id: int,
    location_hash: bytes,
    claimed_ts: int,
    distance_m: int,
    courier_sig: bytes,
    buyer_sig: bytes,
    line_items: str,
    metadata_uri: str,
  ) -> str:
    nonce = self.web3.eth.get_transaction_count(self.account.address)
    tx = self.contract.functions.confirmDrop(
      (shipment_hash, order_id, location_hash, claimed_ts, distance_m),
      courier_sig,
      buyer_sig,
      line_items,
      metadata_uri,
    ).build_transaction(
      {
        "from": self.account.address,
        "nonce": nonce,
        "gas": 350000,
        "gasPrice": self.web3.eth.gas_price,
      }
    )
    signed = self.account.sign_transaction(tx)
    tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash)
    if receipt.status != 1:
      raise RuntimeError(f"confirmDrop failed: {tx_hash.hex()}")
    return tx_hash.hex()

  def register_shipment(
    self,
    *,
    shipment_hash: bytes,
    order_id: int,
    buyer: str,
    supplier: str,
    courier: str,
  ) -> str:
    nonce = self.web3.eth.get_transaction_count(self.account.address)
    tx = self.contract.functions.registerShipment(
      shipment_hash,
      order_id,
      Web3.to_checksum_address(buyer),
      Web3.to_checksum_address(supplier),
      Web3.to_checksum_address(courier),
    ).build_transaction(
      {
        "from": self.account.address,
        "nonce": nonce,
        "gas": 300000,
        "gasPrice": self.web3.eth.gas_price,
      }
    )
    signed = self.account.sign_transaction(tx)
    tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash)
    if receipt.status != 1:
      raise RuntimeError(f"registerShipment failed: {tx_hash.hex()}")
    return tx_hash.hex()

  def update_courier(self, *, shipment_hash: bytes, courier: str) -> str:
    nonce = self.web3.eth.get_transaction_count(self.account.address)
    tx = self.contract.functions.updateCourier(
      shipment_hash,
      Web3.to_checksum_address(courier),
    ).build_transaction(
      {
        "from": self.account.address,
        "nonce": nonce,
        "gas": 200000,
        "gasPrice": self.web3.eth.gas_price,
      }
    )
    signed = self.account.sign_transaction(tx)
    tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash)
    if receipt.status != 1:
      raise RuntimeError(f"updateCourier failed: {tx_hash.hex()}")
    return tx_hash.hex()


_processor: ShipmentContractProcessor | None = None


def get_processor() -> ShipmentContractProcessor:
  global _processor
  if _processor is None:
    _processor = ShipmentContractProcessor()
  return _processor


def geodesic_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
  rad_lat1 = lat1 * (3.141592653589793 / 180.0)
  rad_lat2 = lat2 * (3.141592653589793 / 180.0)
  d_lat = (lat2 - lat1) * (3.141592653589793 / 180.0)
  d_lon = (lon2 - lon1) * (3.141592653589793 / 180.0)

  a = sin(d_lat / 2) ** 2 + cos(rad_lat1) * cos(rad_lat2) * sin(d_lon / 2) ** 2
  c = 2 * asin(sqrt(a))
  return EARTH_RADIUS_M * c


def _hex_to_bytes(value: str) -> bytes:
  if value.startswith("0x"):
    return bytes.fromhex(value[2:])
  return bytes.fromhex(value)


def _extract_chain_order_id(order: Optional[Dict[str, Any]]) -> Optional[int]:
  if not order:
    return None
  metadata_raw = order.get("metadataRaw")
  metadata: Dict[str, Any] = {}
  if isinstance(metadata_raw, dict):
    metadata = metadata_raw
  elif isinstance(metadata_raw, str):
    try:
      metadata = json.loads(metadata_raw) or {}
    except json.JSONDecodeError:
      metadata = {}
  chain_raw = metadata.get("chainOrderId")
  if isinstance(chain_raw, str) and chain_raw.strip():
    try:
      return int(chain_raw, 0)
    except ValueError:
      try:
        return int(chain_raw)
      except ValueError:
        return None
  if isinstance(chain_raw, (int, float)) and chain_raw:
    return int(chain_raw)
  return None


def register_shipment_onchain(
  *,
  shipment_id: str,
  order_id: int,
  buyer: str,
  supplier: str,
  courier: str,
) -> Optional[str]:
  try:
    processor = get_processor()
  except Exception:
    logger.exception("Shipment contract processor unavailable")
    return None

  shipment_hash = Web3.keccak(text=shipment_id)
  try:
    tx_hash = processor.register_shipment(
      shipment_hash=shipment_hash,
      order_id=order_id,
      buyer=buyer,
      supplier=supplier,
      courier=courier,
    )
    return tx_hash
  except Exception:
    logger.exception("Failed to register shipment %s on-chain", shipment_id)
    return None


def update_shipment_courier_onchain(*, shipment_id: str, courier: str) -> Optional[str]:
  try:
    processor = get_processor()
  except Exception:
    logger.exception("Shipment contract processor unavailable")
    return None

  shipment_hash = Web3.keccak(text=shipment_id)
  try:
    tx_hash = processor.update_courier(shipment_hash=shipment_hash, courier=courier)
    return tx_hash
  except Exception:
    logger.exception("Failed to update courier on-chain for shipment %s", shipment_id)
    return None


async def process_milestone(update: ShipmentMilestoneUpdate, *, radius_m: Optional[float] = None) -> dict[str, Optional[str | float]]:
  shipment = await get_shipment(update.shipment_id)
  if not shipment:
    logger.warning("Shipment %s not found while processing milestone", update.shipment_id)
    return {"status": "shipment_not_found", "escrow_tx": None}

  effective_radius = radius_m if radius_m is not None and radius_m > 0 else 200.0

  pickup_lat = float(shipment["pickupLat"]) if shipment.get("pickupLat") is not None else None
  pickup_lon = float(shipment["pickupLon"]) if shipment.get("pickupLon") is not None else None
  drop_lat = float(shipment["dropLat"]) if shipment.get("dropLat") is not None else None
  drop_lon = float(shipment["dropLon"]) if shipment.get("dropLon") is not None else None

  if update.milestone == "Pickup":
    if pickup_lat is None or pickup_lon is None:
      logger.warning("Shipment %s missing pickup coordinates", update.shipment_id)
      return {"status": "missing_pickup_coordinates", "escrow_tx": None}

    if update.latitude is None or update.longitude is None:
      logger.warning("Pickup update missing courier coordinates for shipment %s", update.shipment_id)
      return {"status": "missing_courier_coordinates", "escrow_tx": None}

    distance = geodesic_distance(pickup_lat, pickup_lon, update.latitude, update.longitude)
    if not isfinite(distance) or distance > effective_radius:
      logger.warning(
        "Shipment %s pickup location outside geofence (distance %.2f m, radius %.2f m)",
        update.shipment_id,
        distance,
        effective_radius,
      )
      return {
        "status": "outside_pickup_geofence",
        "escrow_tx": None,
        "distance": distance if isfinite(distance) else None,
        "radius": effective_radius,
      }

  if update.milestone == "Delivered":
    if drop_lat is None or drop_lon is None:
      logger.warning("Shipment %s missing drop coordinates", update.shipment_id)
      return {"status": "missing_drop_coordinates", "escrow_tx": None}

    if update.latitude is None or update.longitude is None:
      logger.warning("Delivered update missing courier coordinates for shipment %s", update.shipment_id)
      return {"status": "missing_courier_coordinates", "escrow_tx": None}

    distance = geodesic_distance(drop_lat, drop_lon, update.latitude, update.longitude)
    if not isfinite(distance) or distance > effective_radius:
      logger.warning(
        "Shipment %s drop location outside geofence (distance %.2f m, radius %.2f m)",
        update.shipment_id,
        distance,
        effective_radius,
      )
      return {
        "status": "outside_drop_geofence",
        "escrow_tx": None,
        "distance": distance if isfinite(distance) else None,
        "radius": effective_radius,
      }

  status_map = {
    "Pickup": "InTransit",
    "InTransit": "InTransit",
    "Delivered": "Delivered",
    "Cancelled": "Cancelled",
  }
  new_status = status_map.get(update.milestone, shipment.get("status", "Created"))

  updated_shipment = await update_shipment_status(update.shipment_id, new_status)
  metta = get_metta()
  now_ts = datetime.utcnow().timestamp()
  metta.space().add_atom(
    E(
      S("milestone"),
      S(shipment["id"]),
      S(update.milestone),
      ValueAtom(now_ts),
    )
  )
  buyer_wallet = str(shipment.get("buyer") or "").lower()
  supplier_wallet = str(shipment.get("supplier") or "").lower()
  metta.space().add_atom(
    E(
      S("shipment_milestone"),
      S(buyer_wallet),
      S(supplier_wallet),
      S(shipment["id"]),
      S(update.milestone),
      ValueAtom(now_ts),
    )
  )

  escrow_tx: Optional[str] = None
  updated_order: Optional[Dict[str, Any]] = None

  if update.milestone in {"Pickup", "InTransit"}:
    updated_order = await update_order_status(shipment["orderId"], "Shipped")
  elif update.milestone == "Cancelled":
    updated_order = await update_order_status(shipment["orderId"], "Cancelled")

  chain_order_numeric: Optional[int] = None
  if update.chain_order_id:
    try:
      chain_order_numeric = int(update.chain_order_id, 0)
    except ValueError:
      try:
        chain_order_numeric = int(update.chain_order_id)
      except ValueError:
        logger.warning("Invalid chain_order_id payload %s", update.chain_order_id)

  order: Optional[Dict[str, Any]] = None

  if update.milestone == "Pickup":
    try:
      processor = get_processor()
      shipment_hash = update.shipment_hash
      location_hash = update.location_hash
      courier_sig = update.courier_signature
      supplier_sig = update.supplier_signature
      claimed_ts = update.claimed_ts or int(datetime.utcnow().timestamp())
      if chain_order_numeric is None:
        order = await get_order(shipment["orderId"])
        chain_order_numeric = _extract_chain_order_id(order)
      if (
        shipment_hash is None
        or location_hash is None
        or courier_sig is None
        or supplier_sig is None
        or chain_order_numeric is None
      ):
        raise ValueError("Incomplete pickup attestation payload")
      tx_hash = processor.confirm_pickup(
        shipment_hash=_hex_to_bytes(shipment_hash),
        order_id=chain_order_numeric,
        location_hash=_hex_to_bytes(location_hash),
        claimed_ts=int(claimed_ts),
        courier_sig=_hex_to_bytes(courier_sig),
        supplier_sig=_hex_to_bytes(supplier_sig),
      )
      escrow_tx = tx_hash
    except Exception:
      logger.exception("Failed to confirm pickup on-chain for shipment %s", update.shipment_id)
      return {"status": "onchain_pickup_failed", "escrow_tx": None}

  if update.milestone == "Delivered":
    updated_order = await update_order_status(shipment["orderId"], "Delivered")
    order = updated_order or await get_order(shipment["orderId"])
    if order:
      metadata_raw = order.get("metadataRaw")
      metadata: dict[str, Any] = {}
      if isinstance(metadata_raw, dict):
        metadata = metadata_raw
      elif isinstance(metadata_raw, str):
        try:
          metadata = json.loads(metadata_raw) or {}
        except json.JSONDecodeError:
          metadata = {}
      items = metadata.get("items")
      line_items_json = "[]"
      if isinstance(items, list):
        try:
          line_items_json = json.dumps(items)
        except (TypeError, ValueError):
          line_items_json = "[]"
      metadata_uri_value = ""
      drop_metadata_uri = metadata.get("dropMetadataUri") if isinstance(metadata, dict) else None
      if isinstance(drop_metadata_uri, str):
        metadata_uri_value = drop_metadata_uri
      if isinstance(items, list):
        for entry in items:
          if not isinstance(entry, dict):
            continue
          sku_id = entry.get("skuId")
          qty_value = entry.get("qty")
          if not isinstance(sku_id, str):
            continue
          try:
            qty = int(qty_value)
          except (TypeError, ValueError):
            continue
          if qty <= 0:
            continue
          try:
            await adjust_product_stock(order["buyer"], sku_id, qty)
            await handle_inventory_query(
              InventoryQuery(
                owner_wallet=order["buyer"],
                sku_id=sku_id,
                supplier_wallet=order.get("supplier"),
              )
            )
          except Exception:
            logger.exception("Failed to sync inventory for order %s sku %s", order["id"], sku_id)

      if chain_order_numeric is None:
        chain_order_numeric = _extract_chain_order_id(order)

      processor = get_processor()
      try:
        shipment_hash = update.shipment_hash
        location_hash = update.location_hash
        courier_sig = update.courier_signature
        buyer_sig = update.buyer_signature
        chain_order = chain_order_numeric
        distance = update.distance_meters
        if not shipment_hash or not location_hash or not courier_sig or not buyer_sig or chain_order is None:
          raise ValueError("Missing drop attestation payload")
        if distance is None:
          if (
            pickup_lat is not None
            and pickup_lon is not None
            and drop_lat is not None
            and drop_lon is not None
          ):
            distance = geodesic_distance(pickup_lat, pickup_lon, drop_lat, drop_lon)
          else:
            distance = 0.0
        courier_sig_bytes = _hex_to_bytes(courier_sig)
        buyer_sig_bytes = _hex_to_bytes(buyer_sig)
        shipment_hash_bytes = _hex_to_bytes(shipment_hash)
        location_hash_bytes = _hex_to_bytes(location_hash)
        tx_hash = processor.confirm_drop(
          shipment_hash=shipment_hash_bytes,
          order_id=int(chain_order),
          location_hash=location_hash_bytes,
          claimed_ts=int(update.claimed_ts or int(datetime.utcnow().timestamp())),
          distance_m=int(round(distance)),
          courier_sig=courier_sig_bytes,
          buyer_sig=buyer_sig_bytes,
          line_items=line_items_json,
          metadata_uri=metadata_uri_value,
        )
        escrow_tx = tx_hash
      except Exception:
        logger.exception("Failed to confirm drop on-chain for shipment %s", update.shipment_id)
        return {"status": "onchain_drop_failed", "escrow_tx": None}

  response: Dict[str, Optional[str | float]] = {"status": "ok", "escrow_tx": escrow_tx}
  if updated_shipment:
    response["shipment_status"] = updated_shipment.get("status")
  if updated_order:
    response["order_status"] = cast(Optional[str], updated_order.get("status"))
  return response
