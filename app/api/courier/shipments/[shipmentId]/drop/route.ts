import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"
import { geodesicDistance } from "@/lib/geo"

export const runtime = "nodejs"

const MAX_DISTANCE_METERS = Number.isFinite(Number(process.env.MAX_DISTANCE_IN_METERS))
  ? Number(process.env.MAX_DISTANCE_IN_METERS)
  : null
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
  const metadataUri = typeof payload.metadataUri === "string" ? payload.metadataUri : ""

  if (!shipmentHash || !courierSignature || !buyerSignature || !locationHash || !orderChainId) {
    return NextResponse.json({ error: "Missing attestation payload" }, { status: 400 })
  }
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return NextResponse.json({ error: "Invalid distance" }, { status: 400 })
  }

  const plannedDistance = Math.round(
    geodesicDistance(shipment.pickupLat, shipment.pickupLon, shipment.dropLat, shipment.dropLon),
  )
  if (MAX_DISTANCE_METERS !== null && plannedDistance > MAX_DISTANCE_METERS) {
    return NextResponse.json(
      {
        error: "Route exceeds maximum distance policy",
        distance: plannedDistance,
        maxDistance: MAX_DISTANCE_METERS,
      },
      { status: 400 },
    )
  }
  if (Math.abs(distanceMeters - plannedDistance) > 5) {
    return NextResponse.json({ error: "Distance mismatch" }, { status: 400 })
  }

  const now = new Date()

  const metadata = safeParse(order.metadataRaw)

  try {
    orderChainId.startsWith("0x") ? BigInt(orderChainId) : BigInt(orderChainId)
  } catch (error) {
    return NextResponse.json({ error: "Invalid on-chain order id" }, { status: 400 })
  }

  const updatedShipment = await prisma.$transaction(async (tx) => {
    await tx.proof.create({
      data: {
        shipmentNo: shipment.shipmentNo,
        kind: "drop",
        signer: courier,
        claimedTs: claimedTimestamp,
        photoHash: typeof payload.photoHash === "string" ? payload.photoHash : null,
        photoCid: typeof payload.photoCid === "string" ? payload.photoCid : null,
        litDistance: distanceMeters,
        litOk: true,
      },
    })

    const shipmentMeta = {
      ...(safeParse(shipment.metadataRaw) ?? {}),
      dropPendingSignature: true,
      dropMetadataUri: metadataUri,
      dropPlannedDistance: plannedDistance,
    }

    const shipmentUpdate = await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: shipment.status,
        updatedAt: now,
        metadataRaw: JSON.stringify(shipmentMeta),
      },
    })

    await tx.order.update({
      where: { id: order.id },
      data: {
        updatedAt: now,
        metadataRaw: JSON.stringify({
          ...(metadata ?? {}),
          dropPendingBuyerSignature: true,
        }),
      },
    })

    return shipmentUpdate
  })

  return NextResponse.json({
    ok: true,
    shipment: serializeShipment(updatedShipment),
    pendingBuyerSignature: true,
    plannedDistance,
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
