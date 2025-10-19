import { NextResponse } from "next/server"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  const owner = await getUserAddress()
  const products = await prisma.product.findMany({
    where: { owner, active: true },
    orderBy: { skuId: "asc" },
  })
  return NextResponse.json(products)
}

type CreateProductPayload = {
  skuId?: string
  name?: string
  unit?: string
  minThreshold?: number
  targetStock?: number
}

function parseInteger(value: unknown, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback
  }
  return Math.floor(numeric)
}

export async function POST(request: Request) {
  const owner = await getUserAddress()
  let body: CreateProductPayload
  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const skuId = body.skuId?.trim()
  const name = body.name?.trim()
  const unit = body.unit?.trim() || "unit"

  if (!skuId) {
    return NextResponse.json({ error: "skuId is required" }, { status: 400 })
  }

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }

  const minThreshold = parseInteger(body.minThreshold)
  const targetStock = parseInteger(body.targetStock)

  const product = await prisma.product.upsert({
    where: { owner_skuId: { owner, skuId } },
    create: {
      owner,
      skuId,
      name,
      unit,
      minThreshold,
      targetStock,
      active: true,
    },
    update: {
      name,
      unit,
      minThreshold,
      targetStock,
      active: true,
    },
  })

  return NextResponse.json(product)
}
