from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class BaseEnvelope(BaseModel):
  request_id: UUID = Field(default_factory=uuid4)
  timestamp: datetime = Field(default_factory=datetime.utcnow)


class InventoryQuery(BaseEnvelope):
  sku_id: str
  owner_wallet: str
  supplier_wallet: Optional[str] = None


class InventoryStatus(BaseEnvelope):
  sku_id: str
  owner_wallet: str
  supplier_wallet: Optional[str] = None
  quantity_on_hand: int
  reorder_threshold: int
  target_quantity: Optional[int] = None
  min_reorder_qty: Optional[int] = None
  max_reorder_qty: Optional[int] = None
  max_unit_price: Optional[float] = None
  currency: Optional[str] = None
  recommended_action: Literal["OK", "REORDER"] = "OK"
  recommendation_reason: Optional[str] = None


class PurchaseOrderRequest(BaseEnvelope):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  sku_id: str
  quantity: int
  unit_price: float


class PurchaseOrderAck(BaseEnvelope):
  order_id: str
  status: Literal["ACCEPTED", "REJECTED", "PENDING"]
  notes: Optional[str] = None


class ShipmentMilestoneUpdate(BaseEnvelope):
  shipment_id: str
  shipment_no: int
  order_id: str
  milestone: Literal["Pickup", "InTransit", "Delivered", "Cancelled"]
  courier_wallet: str
  latitude: Optional[float] = None
  longitude: Optional[float] = None
  claimed_ts: Optional[int] = None
  courier_signature: Optional[str] = None
  supplier_signature: Optional[str] = None
  buyer_signature: Optional[str] = None
  location_hash: Optional[str] = None
  distance_meters: Optional[float] = None
  shipment_hash: Optional[str] = None
  chain_order_id: Optional[str] = None


class EscrowReleaseRequest(BaseEnvelope):
  order_id: str
  buyer_wallet: str
  supplier_wallet: str
  amount: float
  milestone: Literal["Pickup", "Delivered"]
  shipment_id: Optional[str] = None
  courier_signature: Optional[str] = None
  supplier_signature: Optional[str] = None
  buyer_signature: Optional[str] = None
  location_hash: Optional[str] = None
  claimed_ts: Optional[int] = None
  distance_meters: Optional[float] = None


class EscrowReleaseResult(BaseEnvelope):
  order_id: str
  tx_hash: Optional[str] = None
  status: Literal["SUCCESS", "FAILED"]
  error: Optional[str] = None


class LogisticsEtaRequest(BaseEnvelope):
  shipment_id: str


class LogisticsEtaResponse(BaseEnvelope):
  shipment_id: str
  eta_iso: Optional[str] = None
  message: str


class RiskAssessmentRequest(BaseEnvelope):
  shipment_id: Optional[str] = None
  route_id: Optional[str] = None


class RiskAssessmentResponse(BaseEnvelope):
  subject: str
  risk_level: Literal["LOW", "MEDIUM", "HIGH"]
  reason: str
