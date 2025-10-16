import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"
import { geodesicDistance } from "@/lib/geo"

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

  const order = await prisma.order.findUnique({ where: { id: shipment.orderId } })
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }

  if (!shipment.dropLat || !shipment.dropLon || !shipment.pickupLat || !shipment.pickupLon) {
    return NextResponse.json({ error: "Shipment missing drop coordinates" }, { status: 400 })
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

  const claimedTimestamp = Number(payload.claimedTs ?? Math.floor(Date.now() / 1000))
  if (!Number.isFinite(claimedTimestamp) || claimedTimestamp <= 0) {
    return NextResponse.json({ error: "Invalid claimed timestamp" }, { status: 400 })
  }

  const shipmentHash = typeof payload.shipmentHash === "string" ? payload.shipmentHash : null
  const courierSignature = typeof payload.courierSignature === "string" ? payload.courierSignature : null
  const buyerSignature = typeof payload.counterpartySignature === "string" ? payload.counterpartySignature : null
  const locationHash = typeof payload.locationHash === "string" ? payload.locationHash : null
  const distanceMeters = Math.round(Number(payload.distanceMeters ?? 0))
  const orderChainId = typeof payload.orderId === "string" ? payload.orderId : null

  if (!shipmentHash || !courierSignature || !buyerSignature || !locationHash || !orderChainId) {
    return NextResponse.json({ error: "Missing attestation payload" }, { status: 400 })
  }
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return NextResponse.json({ error: "Invalid distance" }, { status: 400 })
  }

  const plannedDistance = Math.round(
    geodesicDistance(shipment.pickupLat, shipment.pickupLon, shipment.dropLat, shipment.dropLon),
  )
  if (Math.abs(distanceMeters - plannedDistance) > 5) {
    return NextResponse.json({ error: "Distance mismatch" }, { status: 400 })
  }

  const response = await fetch(`${AGENT_BRIDGE_URL}/shipments/milestone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shipment_id: shipment.id,
      shipment_no: shipment.shipmentNo,
      order_id: shipment.orderId,
      milestone: "Delivered",
      courier_wallet: courier,
      latitude: payload.currentLat,
      longitude: payload.currentLon,
      claimed_ts: claimedTimestamp,
      radius_m: Number.isFinite(Number(payload.radiusM)) ? Number(payload.radiusM) : 5000,
      shipment_hash: shipmentHash,
      location_hash: locationHash,
      courier_signature: courierSignature,
      buyer_signature: buyerSignature,
      distance_meters: distanceMeters,
      chain_order_id: orderChainId,
    }),
  })

  if (!response.ok) {
    const details = await response.json().catch(() => null)
    return NextResponse.json(
      { error: "Drop verification failed", details: details ?? undefined },
      { status: response.status },
    )
  }

  const { escrow_tx } = await response.json()

  const updatedShipment = await prisma.shipment.findUnique({ where: { id: shipment.id } })
  if (!updatedShipment) {
    return NextResponse.json({ error: "Shipment not found after agent update" }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    shipment: serializeShipment(updatedShipment),
    escrowTx: escrow_tx ?? null,
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
