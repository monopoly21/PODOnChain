import { NextResponse } from "next/server"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const BUYER_TRANSITIONS: Record<string, string[]> = {
  Created: ["Approved", "Cancelled"],
  Approved: ["Funded", "Cancelled"],
  Funded: ["Disputed"],
  Shipped: ["Disputed"],
  Delivered: ["Disputed"],
  Disputed: ["Resolved"],
  Resolved: [],
}

const SUPPLIER_TRANSITIONS: Record<string, string[]> = {
  Created: ["Approved"],
  Approved: ["InFulfillment", "Cancelled"],
  Funded: ["InFulfillment"],
  InFulfillment: ["Shipped", "Cancelled"],
  Shipped: ["Delivered", "Cancelled"],
  Delivered: ["Resolved"],
  Disputed: ["Resolved"],
  Resolved: [],
}

function allowedStatuses(current: string, isBuyer: boolean, isSupplier: boolean) {
  const set = new Set<string>()
  if (isBuyer) {
    (BUYER_TRANSITIONS[current] ?? []).forEach((s) => set.add(s))
  }
  if (isSupplier) {
    (SUPPLIER_TRANSITIONS[current] ?? []).forEach((s) => set.add(s))
  }
  return set
}

const ORDER_STATUS_TIMESTAMPS: Record<string, "approvedAt" | "fundedAt" | "completedAt" | "cancelledAt"> = {
  Approved: "approvedAt",
  Funded: "fundedAt",
  Delivered: "completedAt",
  Resolved: "completedAt",
  Cancelled: "cancelledAt",
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params
  const wallet = await getUserAddress()
  const body = await request.json()
  const nextStatus = String(body?.status ?? "").trim()

  if (!nextStatus) {
    return NextResponse.json({ error: "status required" }, { status: 400 })
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } })

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }

  if (order.status === nextStatus) {
    return NextResponse.json(order)
  }

  const allowed = allowedStatuses(order.status, order.buyer === wallet, order.supplier === wallet)

  if (!allowed.has(nextStatus)) {
    return NextResponse.json({ error: "Transition not permitted" }, { status: 403 })
  }

  let metadata = safeParse(order.metadataRaw) || {}
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    metadata = {}
  }

  let metadataChanged = false

  if (nextStatus === "InFulfillment" || nextStatus === "Approved") {
    if (typeof body.pickupLat === "undefined" || typeof body.pickupLon === "undefined") {
      return NextResponse.json({ error: "pickupLat and pickupLon required" }, { status: 400 })
    }

    const pickupLat = Number(body.pickupLat)
    const pickupLon = Number(body.pickupLon)

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLon)) {
      return NextResponse.json({ error: "Invalid pickup coordinates" }, { status: 400 })
    }

    metadata = {
      ...metadata,
      pickup: { lat: pickupLat, lon: pickupLon },
    }
    metadataChanged = true
  } else if (typeof body.pickupLat !== "undefined" || typeof body.pickupLon !== "undefined") {
    const pickupLat = Number(body.pickupLat)
    const pickupLon = Number(body.pickupLon)
    if (Number.isFinite(pickupLat) && Number.isFinite(pickupLon)) {
      metadata = {
        ...metadata,
        pickup: { lat: pickupLat, lon: pickupLon },
      }
      metadataChanged = true
    }
  }

  if (typeof body.escrowTxHash === "string" || typeof body.approvalTxHash === "string") {
    const escrowMeta: Record<string, unknown> = {
      ...(metadata.escrow && typeof metadata.escrow === "object" ? metadata.escrow : {}),
    }
    if (typeof body.escrowTxHash === "string" && body.escrowTxHash.startsWith("0x")) {
      escrowMeta.fundTx = body.escrowTxHash
    }
    if (typeof body.approvalTxHash === "string" && body.approvalTxHash.startsWith("0x")) {
      escrowMeta.approvalTx = body.approvalTxHash
    }
    metadata = {
      ...metadata,
      escrow: escrowMeta,
    }
    metadataChanged = true
  }

  const metadataRaw = metadataChanged ? JSON.stringify(metadata) : order.metadataRaw
  const updateData: Record<string, unknown> = { status: nextStatus }

  const timestampField = ORDER_STATUS_TIMESTAMPS[nextStatus]
  if (timestampField) {
    updateData[timestampField] = new Date()
  }
  if (metadataChanged) {
    updateData.metadataRaw = metadataRaw
  }

  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: updateData,
  })

  if (nextStatus === "Funded") {
    const escrowTx = typeof body.escrowTxHash === "string" && body.escrowTxHash.startsWith("0x") ? body.escrowTxHash : null
    const approvalTx =
      typeof body.approvalTxHash === "string" && body.approvalTxHash.startsWith("0x") ? body.approvalTxHash : null

    const existingPayment = await prisma.payment.findFirst({
      where: { orderId: order.id, payer: order.buyer, payee: order.supplier },
    })

    const paymentData = {
      orderId: order.id,
      payer: order.buyer,
      payee: order.supplier,
      amount: order.totalAmount,
      currency: order.currency,
      status: "Escrowed" as const,
      escrowTx,
      releaseTx: existingPayment?.releaseTx ?? null,
      metadataRaw: metadataRaw ?? null,
    }

    if (existingPayment) {
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: paymentData,
      })
    } else {
      await prisma.payment.create({ data: paymentData })
    }
  }

  return NextResponse.json(serializeOrder(updatedOrder))
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

function serializeOrder(order: Awaited<ReturnType<typeof prisma.order.findUnique>>) {
  if (!order) return null
  return {
    id: order.id,
    buyer: order.buyer,
    supplier: order.supplier,
    status: order.status,
    totalAmount: order.totalAmount,
    metadata: safeParse(order.metadataRaw),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }
}
