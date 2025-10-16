import { NextResponse } from "next/server"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const AGENT_BRIDGE_URL = process.env.AGENT_BRIDGE_URL || "http://localhost:8200"

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

  let responseData: any

  if (nextStatus === "Funded") {
    const escrowTx = typeof body.escrowTxHash === "string" ? body.escrowTxHash : undefined
    const approvalTx = typeof body.approvalTxHash === "string" ? body.approvalTxHash : undefined
    const escrowPayload = {
      order_id: order.id,
      buyer_wallet: order.buyer,
      supplier_wallet: order.supplier,
      amount: order.totalAmount,
      escrow_tx: escrowTx,
      approval_tx: approvalTx,
      metadata: metadataChanged ? metadata : undefined,
    }
    const bridgeResponse = await fetch(`${AGENT_BRIDGE_URL}/payments/escrow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(escrowPayload),
    })
    if (!bridgeResponse.ok) {
      const detail = await bridgeResponse.json().catch(() => null)
      return NextResponse.json(
        { error: "Escrow funding failed", details: detail ?? undefined },
        { status: bridgeResponse.status },
      )
    }
    responseData = await bridgeResponse.json()
  } else {
    const bridgePayload = {
      order_id: order.id,
      status: nextStatus,
      metadata: metadataChanged ? metadata : undefined,
    }
    const bridgeResponse = await fetch(`${AGENT_BRIDGE_URL}/orders/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bridgePayload),
    })
    if (!bridgeResponse.ok) {
      const detail = await bridgeResponse.json().catch(() => null)
      return NextResponse.json(
        { error: "Order status update failed", details: detail ?? undefined },
        { status: bridgeResponse.status },
      )
    }
    responseData = await bridgeResponse.json()
  }

  const updatedOrder = responseData?.order
  if (!updatedOrder) {
    return NextResponse.json(
      { error: "Bridge response missing order data", details: responseData ?? undefined },
      { status: 502 },
    )
  }

  return NextResponse.json(updatedOrder)
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}
