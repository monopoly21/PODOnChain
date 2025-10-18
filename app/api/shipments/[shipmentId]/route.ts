import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ shipmentId: string }> }) {
  const wallet = await getUserAddress()
  const { shipmentId } = await context.params

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { order: true },
  })

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 })
  }

  const isSupplier = shipment.supplier === wallet
  const isBuyer = shipment.buyer === wallet
  const isCourier = shipment.assignedCourier === wallet

  let allowlisted = false

  if (!isSupplier && !isBuyer && !isCourier) {
    const entry = await prisma.courier.findFirst({
      where: { owner: shipment.supplier, courierWallet: wallet },
    })
    allowlisted = !!entry
  }

  if (!isSupplier && !isBuyer && !isCourier && !allowlisted) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 })
  }

  const proofs = await prisma.proof.findMany({
    where: { shipmentNo: shipment.shipmentNo },
    orderBy: { createdAt: "asc" },
  })

  const normalizedProofs = proofs.map(({ litDistance, litOk, ...rest }) => ({
    ...rest,
    distanceMeters: typeof litDistance === "number" ? litDistance : null,
    withinRadius: typeof litOk === "boolean" ? litOk : null,
  }))

  return NextResponse.json({ shipment: serializeShipment(shipment), proofs: normalizedProofs })
}

function serializeShipment(shipment: any) {
  const { metadataRaw, order, ...rest } = shipment
  const shipmentMetadata = metadataRaw ? safeParse(metadataRaw) : null
  const orderMetadata = order?.metadataRaw ? safeParse(order.metadataRaw) : null
  const chainOrderId =
    extractChainOrderId(shipmentMetadata) ?? extractChainOrderId(orderMetadata) ?? null

  const metadata =
    chainOrderId !== null
      ? { ...(shipmentMetadata ?? {}), chainOrderId }
      : shipmentMetadata

  return {
    ...rest,
    metadata,
    chainOrderId,
  }
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

function extractChainOrderId(metadata: any): string | number | null {
  if (!metadata || typeof metadata !== "object") {
    return null
  }
  const raw =
    (metadata as Record<string, unknown>).chainOrderId ??
    (metadata as Record<string, unknown>).chain_order_id ??
    (metadata as Record<string, unknown>).chain_orderId

  if (raw === undefined || raw === null) {
    return null
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim()
    return trimmed.length ? trimmed : null
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null
  }

  if (typeof raw === "bigint") {
    return raw.toString()
  }

  if (typeof raw === "object" && raw !== null) {
    const hex = (raw as { hex?: unknown }).hex
    if (typeof hex === "string") {
      try {
        return BigInt(hex).toString()
      } catch {
        return null
      }
    }
  }

  return null
}
