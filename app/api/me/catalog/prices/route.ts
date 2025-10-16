import { NextResponse } from "next/server"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  const owner = await getUserAddress()
  const prices = await prisma.supplierPrice.findMany({
    where: { owner, active: true },
    orderBy: { skuId: "asc" },
  })
  return NextResponse.json(prices)
}

type UpsertPricePayload = {
  skuId?: string
  unitPrice?: number
  currency?: string
  leadDays?: number
  minQty?: number
}

function requirePositive(value: unknown, field: string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${field} must be > 0`)
  }
  return numeric
}

export async function POST(request: Request) {
  const owner = await getUserAddress()
  let body: UpsertPricePayload
  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const skuId = body.skuId?.trim()
  const currency = body.currency?.trim() || "USD"

  if (!skuId) {
    return NextResponse.json({ error: "skuId is required" }, { status: 400 })
  }

  let unitPrice: number
  let leadDays: number
  let minQty: number
  try {
    unitPrice = requirePositive(body.unitPrice, "unitPrice")
    leadDays = Math.max(0, Math.floor(Number(body.leadDays ?? 0)))
    minQty = Math.max(1, Math.floor(Number(body.minQty ?? 1)))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }

  const record = await prisma.supplierPrice.upsert({
    where: { owner_skuId: { owner, skuId } },
    create: {
      owner,
      skuId,
      unitPrice,
      currency,
      leadDays,
      minQty,
      active: true,
    },
    update: {
      unitPrice,
      currency,
      leadDays,
      minQty,
      active: true,
    },
  })

  return NextResponse.json(record)
}
