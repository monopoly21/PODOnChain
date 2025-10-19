import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

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

  const claimedTimestamp = Number(payload.claimedTs ?? Math.floor(Date.now() / 1000))
  const now = new Date()

  const updatedShipment = await prisma.$transaction(async (tx) => {
    await tx.proof.create({
      data: {
        shipmentNo: shipment.shipmentNo,
        kind: "pickup",
        signer: courier,
        claimedTs: claimedTimestamp,
        photoHash: typeof payload.photoHash === "string" ? payload.photoHash : null,
        photoCid: typeof payload.photoCid === "string" ? payload.photoCid : null,
        litDistance: null,
        litOk: true,
      },
    })

    const shipmentUpdate: Record<string, unknown> = {
      status: "InTransit",
      pickedUpAt: now,
      updatedAt: now,
    }
    if (!shipment.assignedCourier) {
      shipmentUpdate.assignedCourier = courier
    }

    const updated = await tx.shipment.update({
      where: { id: shipment.id },
      data: shipmentUpdate,
    })

    await tx.order.update({
      where: { id: shipment.orderId },
      data: {
        status: "Shipped",
        updatedAt: now,
      },
    })

    return updated
  })

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
