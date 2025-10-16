import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const wallet = (searchParams.get("wallet") || "").toLowerCase()

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return NextResponse.json({ error: "wallet query param required" }, { status: 400 })
  }

  const prices = await prisma.supplierPrice.findMany({
    where: { owner: wallet, active: true },
    orderBy: { skuId: "asc" },
  })

  return NextResponse.json(prices)
}
