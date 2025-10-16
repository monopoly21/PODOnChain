import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

const AGENT_BRIDGE_URL = process.env.AGENT_BRIDGE_URL || "http://localhost:8200"

export async function POST(request: Request, context: { params: Promise<{ shipmentId: string }> }) {
  const courier = await getUserAddress()
  const normalizedCourier = courier.toLowerCase()
  const payload = await request.json()

  const { shipmentId } = await context.params

  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 })
  }

  if (!shipment.pickupLat || !shipment.pickupLon) {
    return NextResponse.json({ error: "Shipment missing pickup coordinates" }, { status: 400 })
  }

  const isBuyer = shipment.buyer.toLowerCase() === normalizedCourier
  const isAssigned = shipment.assignedCourier?.toLowerCase() === normalizedCourier

  if (shipment.assignedCourier) {
    if (!isAssigned) {
      return NextResponse.json({ error: "Not assigned to this shipment" }, { status: 403 })
    }
  } else if (!isBuyer) {
    const allowlisted = await prisma.courier.findFirst({
      where: { owner: shipment.supplier, courierWallet: normalizedCourier },
    })
    if (!allowlisted) {
      return NextResponse.json({ error: "Courier not allowlisted" }, { status: 403 })
    }
  }

  const shipmentHash = typeof payload.shipmentHash === "string" ? payload.shipmentHash : null
  const courierSignature = typeof payload.courierSignature === "string" ? payload.courierSignature : null
  const supplierSignature = typeof payload.counterpartySignature === "string" ? payload.counterpartySignature : null
  const locationHash = typeof payload.locationHash === "string" ? payload.locationHash : null
  const orderChainId = typeof payload.orderId === "string" ? payload.orderId : null

  if (!shipmentHash || !courierSignature || !supplierSignature || !locationHash || !orderChainId) {
    return NextResponse.json({ error: "Missing attestation payload" }, { status: 400 })
  }

  const response = await fetch(`${AGENT_BRIDGE_URL}/shipments/milestone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shipment_id: shipment.id,
      shipment_no: shipment.shipmentNo,
      order_id: shipment.orderId,
      milestone: "Pickup",
      courier_wallet: courier,
      latitude: payload.currentLat,
      longitude: payload.currentLon,
      claimed_ts: Number(payload.claimedTs ?? Math.floor(Date.now() / 1000)),
      radius_m: Number.isFinite(Number(payload.radiusM)) ? Number(payload.radiusM) : 5000,
      shipment_hash: shipmentHash,
      location_hash: locationHash,
      courier_signature: courierSignature,
      supplier_signature: supplierSignature,
      chain_order_id: orderChainId,
    }),
  })

  if (!response.ok) {
    const details = await response.json().catch(() => null)
    return NextResponse.json(
      { error: "Pickup verification failed", details: details ?? undefined },
      { status: response.status },
    )
  }

  const updatedShipment = await prisma.shipment.findUnique({ where: { id: shipment.id } })
  if (!updatedShipment) {
    return NextResponse.json({ error: "Shipment not found after agent update" }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    shipment: serializeShipment(updatedShipment),
  })
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

function serializeShipment(shipment: any) {
  const { metadataRaw, ...rest } = shipment
  return {
    ...rest,
    metadata: metadataRaw ? safeParse(metadataRaw) : null,
  }
}
