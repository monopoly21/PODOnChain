import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"

const AGENT_BRIDGE_URL = process.env.AGENT_BRIDGE_URL || "http://localhost:8200"

type ChatBody = Record<string, unknown>

function normaliseAddress(value: unknown): string | null {
  if (typeof value !== "string") return null
  const addr = value.trim().toLowerCase()
  if (!addr.startsWith("0x") || addr.length !== 42) return null
  return addr
}

function extractToken(tokens: string[], label: string): string | null {
  const index = tokens.findIndex((token) => token.toLowerCase() === label.toLowerCase())
  if (index !== -1 && tokens[index + 1]) {
    return tokens[index + 1]
  }
  return null
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

type ChatContext = {
  agent: string
  message: string
  ownerWallet: string
  body: ChatBody
  tokens: string[]
}

export async function POST(request: Request) {
  let body: ChatBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const agentRaw = asString(body.agent) ?? "inventory"
  const agent = agentRaw.toLowerCase()
  const message = asString(body.message) ?? ""
  const ownerAddress = normaliseAddress(body.ownerWallet)

  if (!ownerAddress) {
    return NextResponse.json({ error: "ownerWallet must be a valid address" }, { status: 400 })
  }

  const context: ChatContext = {
    agent,
    message,
    ownerWallet: ownerAddress,
    body,
    tokens: message.split(/\s+/).filter(Boolean),
  }

  switch (agent) {
    case "inventory":
      return handleInventoryChat(context)
    case "po":
    case "purchase":
    case "purchase-order":
      return handlePurchaseOrderChat(context)
    case "supplier":
      return handleSupplierChat(context)
    case "shipment":
      return handleShipmentChat(context)
    case "payments":
    case "payment":
      return handlePaymentsChat(context)
    default:
      return NextResponse.json({ error: `Unknown agent ${agent}` }, { status: 400 })
  }
}

async function handleInventoryChat(context: ChatContext) {
  const { message, ownerWallet, tokens, body } = context
  const skuFromBody = asString(body.skuId)
  const skuFromMessage =
    extractToken(tokens, "stock") ?? extractToken(tokens, "sku") ?? tokens[0] ?? null
  const skuId = skuFromBody ?? skuFromMessage
  if (!skuId) {
    return NextResponse.json(
      { error: "Unable to determine SKU. Try 'stock SKU-123 supplier 0x...'" },
      { status: 400 },
    )
  }

  const supplierAddress =
    normaliseAddress(body.supplierWallet) ?? normaliseAddress(extractToken(tokens, "supplier"))

  const inventoryPayload: Record<string, unknown> = {
    owner_wallet: ownerWallet,
    sku_id: skuId,
  }
  if (supplierAddress) {
    inventoryPayload.supplier_wallet = supplierAddress
  }

  const bridgeResponse = await fetch(`${AGENT_BRIDGE_URL}/inventory/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inventoryPayload),
  })

  if (!bridgeResponse.ok) {
    const detail = await bridgeResponse.json().catch(() => null)
    return NextResponse.json(
      { error: "Agent bridge error", details: detail ?? undefined },
      { status: bridgeResponse.status },
    )
  }

  const status = await bridgeResponse.json()
  const quantity = typeof status.quantity_on_hand === "number" ? status.quantity_on_hand : status.quantityOnHand
  const threshold = typeof status.reorder_threshold === "number" ? status.reorder_threshold : status.reorderThreshold
  const action = status.recommended_action ?? status.recommendedAction
  const supplier = status.supplier_wallet ?? status.supplierWallet
  const target = status.target_quantity ?? status.targetQuantity

  const replyParts = [
    `SKU ${skuId} has ${typeof quantity === "number" ? quantity : "unknown"} units on hand.`,
    `Reorder threshold ${typeof threshold === "number" ? threshold : "n/a"}.`,
    `Recommended action: ${action ?? "n/a"}.`,
  ]
  if (target !== null && typeof target !== "undefined") {
    replyParts.push(`Target quantity ${target}.`)
  }
  if (supplier) {
    replyParts.push(`Preferred supplier ${supplier}.`)
  }

  if (message) {
    replyParts.push(`Request: ${message}.`)
  }

  return NextResponse.json({
    reply: replyParts.join(" "),
    data: status,
  })
}

async function handlePurchaseOrderChat(context: ChatContext) {
  const { tokens, ownerWallet, body } = context
  const orderId = asString(body.orderId) ?? extractToken(tokens, "order")
  if (!orderId) {
    return NextResponse.json({
      reply: "Provide an order id, e.g. 'status order ord_123'.",
    })
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) {
    return NextResponse.json({
      reply: `Order ${orderId} not found.`,
    })
  }

  const ownerLower = ownerWallet.toLowerCase()
  if (order.buyer.toLowerCase() !== ownerLower && order.supplier.toLowerCase() !== ownerLower) {
    return NextResponse.json({
      reply: `You are not a participant in order ${orderId}.`,
    })
  }

  const drop = order.metadataRaw ? safeParse(order.metadataRaw)?.drop : null
  const dropInfo =
    drop && typeof drop === "object" && drop?.lat && drop?.lon
      ? `Drop ${drop.lat}, ${drop.lon}.`
      : undefined

  const replyParts = [
    `Order ${orderId} status ${order.status}.`,
    `Buyer ${order.buyer.slice(0, 8)}…, supplier ${order.supplier.slice(0, 8)}….`,
    `Total amount ${Number(order.totalAmount).toFixed(2)} ${order.currency}.`,
  ]
  if (dropInfo) {
    replyParts.push(dropInfo)
  }

  return NextResponse.json({
    reply: replyParts.join(" "),
    data: { order },
  })
}

async function handleSupplierChat(context: ChatContext) {
  const { tokens, ownerWallet, body } = context
  const orderId = asString(body.orderId) ?? extractToken(tokens, "order")
  if (!orderId) {
    return NextResponse.json({
      reply: "Provide an order id, e.g. 'confirm order ord_123'.",
    })
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) {
    return NextResponse.json({
      reply: `Order ${orderId} not found.`,
    })
  }

  const ownerLower = ownerWallet.toLowerCase()
  if (order.supplier.toLowerCase() !== ownerLower) {
    return NextResponse.json({
      reply: `Only the supplier ${order.supplier.slice(0, 8)}… can confirm this order.`,
    })
  }

  const bridgeResponse = await fetch(`${AGENT_BRIDGE_URL}/orders/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      status: "InFulfillment",
    }),
  })

  if (!bridgeResponse.ok) {
    const detail = await bridgeResponse.json().catch(() => null)
    return NextResponse.json(
      { error: "Order confirmation failed", details: detail ?? undefined },
      { status: bridgeResponse.status },
    )
  }

  return NextResponse.json({
    reply: `Order ${orderId} marked InFulfillment.`,
    data: await bridgeResponse.json().catch(() => null),
  })
}

async function handleShipmentChat(context: ChatContext) {
  const { tokens, ownerWallet, body } = context
  const shipmentId = asString(body.shipmentId) ?? (tokens[0]?.toLowerCase() === "shipment" ? tokens[1] : tokens[0])
  if (!shipmentId) {
    return NextResponse.json({
      reply: "Ask about shipments with 'shipment shp_123'.",
    })
  }

  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!shipment) {
    return NextResponse.json({ reply: `Shipment ${shipmentId} not found.` })
  }

  const ownerLower = ownerWallet.toLowerCase()
  const allowed = [
    shipment.buyer?.toLowerCase(),
    shipment.supplier?.toLowerCase(),
    shipment.assignedCourier?.toLowerCase(),
  ].filter(Boolean)
  if (!allowed.includes(ownerLower)) {
    return NextResponse.json({
      reply: `You are not allowed to view shipment ${shipmentId}.`,
    })
  }

  const replyParts = [
    `Shipment ${shipmentId} status ${shipment.status}.`,
    `Courier ${shipment.assignedCourier ? shipment.assignedCourier.slice(0, 8) + "…" : "unassigned"}.`,
  ]
  if (shipment.dueBy) {
    replyParts.push(`Due by ${shipment.dueBy.toISOString()}.`)
  }
  if (typeof shipment.pickupLat === "number" && typeof shipment.pickupLon === "number") {
    replyParts.push(`Pickup ${shipment.pickupLat.toFixed(4)}, ${shipment.pickupLon.toFixed(4)}.`)
  }
  if (typeof shipment.dropLat === "number" && typeof shipment.dropLon === "number") {
    replyParts.push(`Drop ${shipment.dropLat.toFixed(4)}, ${shipment.dropLon.toFixed(4)}.`)
  }

  return NextResponse.json({
    reply: replyParts.join(" "),
    data: { shipment },
  })
}

async function handlePaymentsChat(context: ChatContext) {
  const { tokens, ownerWallet, body } = context
  const orderId = asString(body.orderId) ?? extractToken(tokens, "order")
  if (!orderId) {
    return NextResponse.json({
      reply: "Provide an order id, e.g. 'release order ord_123'.",
    })
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) {
    return NextResponse.json({ reply: `Order ${orderId} not found.` })
  }

  const ownerLower = ownerWallet.toLowerCase()
  if (order.buyer.toLowerCase() !== ownerLower) {
    return NextResponse.json({
      reply: `Only the buyer ${order.buyer.slice(0, 8)}… can release escrow.`,
    })
  }

  const bridgeResponse = await fetch(`${AGENT_BRIDGE_URL}/payments/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      buyer_wallet: order.buyer,
      supplier_wallet: order.supplier,
      amount: Number(order.totalAmount),
      milestone: "Delivered",
    }),
  })

  if (!bridgeResponse.ok) {
    const detail = await bridgeResponse.json().catch(() => null)
    return NextResponse.json(
      { error: "Escrow release failed", details: detail ?? undefined },
      { status: bridgeResponse.status },
    )
  }

  const result = await bridgeResponse.json()
  const txHash = result?.tx_hash ?? result?.txHash ?? null
  const reply = txHash
    ? `Escrow released for order ${orderId}. Transaction ${txHash}.`
    : `Escrow release initiated for order ${orderId}.`

  return NextResponse.json({
    reply,
    data: result,
  })
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
