import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

function normaliseAddress(value: string) {
  const v = (value || "").toLowerCase()
  if (!v.startsWith("0x") || v.length !== 42) {
    throw new Error("Invalid address")
  }
  return v
}

export async function GET(request: Request) {
  const owner = await getUserAddress()
  const { searchParams } = new URL(request.url)
  const role = searchParams.get("role")

  if (role === "buyer") {
    const orders = await prisma.order.findMany({
      where: { buyer: owner },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(orders.map(serializeOrder))
  }

  if (role === "supplier") {
    const orders = await prisma.order.findMany({
      where: { supplier: owner },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(orders.map(serializeOrder))
  }

  const [asBuyer, asSupplier] = await Promise.all([
    prisma.order.findMany({ where: { buyer: owner }, orderBy: { createdAt: "desc" } }),
    prisma.order.findMany({ where: { supplier: owner }, orderBy: { createdAt: "desc" } }),
  ])

  return NextResponse.json({
    buyer: asBuyer.map(serializeOrder),
    supplier: asSupplier.map(serializeOrder),
  })
}

export async function POST(request: Request) {
  const buyer = await getUserAddress()
  const body = await request.json()

  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items array required" }, { status: 400 })
  }

  let supplier: string
  try {
    supplier = normaliseAddress(body.supplier)
  } catch (error) {
    return NextResponse.json({ error: "Invalid supplier address" }, { status: 400 })
  }

  const unitPrices = body.unitPrices || {}

  type SummaryItem = { skuId: string; qty: number; unitPrice: number; lineTotal: number }

  const summary: SummaryItem[] = body.items.map((item: any) => {
    if (!item || typeof item.skuId !== "string") {
      throw new Error("Each item needs skuId")
    }
    const qty = Number(item.qty ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Quantity must be > 0")
    }
    const price = Number(unitPrices[item.skuId] ?? 0)
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Missing unit price for ${item.skuId}`)
    }
    return { skuId: item.skuId, qty, unitPrice: price, lineTotal: qty * price }
  })

  if (typeof body.dropLat === "undefined" || typeof body.dropLon === "undefined") {
    return NextResponse.json({ error: "dropLat and dropLon required" }, { status: 400 })
  }

  const dropLat = Number(body.dropLat)
  const dropLon = Number(body.dropLon)

  if (!Number.isFinite(dropLat) || !Number.isFinite(dropLon)) {
    return NextResponse.json({ error: "Invalid drop coordinates" }, { status: 400 })
  }

  if (typeof body.chainOrderId === "undefined" || body.chainOrderId === null) {
    return NextResponse.json({ error: "chainOrderId required" }, { status: 400 })
  }

  const chainOrderIdValue = String(body.chainOrderId).trim()
  if (!chainOrderIdValue) {
    return NextResponse.json({ error: "chainOrderId required" }, { status: 400 })
  }

  const createTxHash =
    typeof body.createTxHash === "string" && body.createTxHash.startsWith("0x")
      ? body.createTxHash
      : undefined

  const total = summary.reduce((sum: number, item: SummaryItem) => sum + item.lineTotal, 0)

  const order = await prisma.order.create({
    data: {
      buyer,
      supplier,
      status: "Created",
      totalAmount: total,
      metadataRaw: JSON.stringify({
        items: summary,
        currency: body.currency || "USD",
        chainOrderId: chainOrderIdValue,
        chainCreateTxHash: createTxHash ?? null,
        drop: { lat: dropLat, lon: dropLon },
      }),
    },
  })

  return NextResponse.json({ orderId: order.id, chainOrderId: chainOrderIdValue, total, order: serializeOrder(order) })
}

function serializeOrder(order: any) {
  const { metadataRaw, ...rest } = order
  return {
    ...rest,
    metadata: metadataRaw ? safeParse(metadataRaw) : null,
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
