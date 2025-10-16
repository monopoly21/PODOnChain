import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET() {
  const owner = await getUserAddress()
  const couriers = await prisma.courier.findMany({
    where: { owner, active: true },
    orderBy: { courierWallet: "asc" },
  })
  return NextResponse.json(couriers)
}

export async function POST(request: Request) {
  const owner = await getUserAddress()
  const body = await request.json()

  const rawWallet = typeof body?.courierWallet === "string" ? body.courierWallet.trim() : ""
  if (!rawWallet || !rawWallet.startsWith("0x") || rawWallet.length !== 42) {
    return NextResponse.json({ error: "Valid courier wallet required" }, { status: 400 })
  }

  const courierWallet = rawWallet.toLowerCase()
  const label = typeof body?.label === "string" && body.label.trim().length ? body.label.trim() : null

  const existing = await prisma.courier.findUnique({
    where: { owner_courierWallet: { owner, courierWallet } },
  })

  const courier = await prisma.courier.upsert({
    where: { owner_courierWallet: { owner, courierWallet } },
    update: {
      label,
      active: true,
      version: existing ? { increment: 1 } : undefined,
    },
    create: {
      owner,
      courierWallet,
      label,
    },
  })

  return NextResponse.json(courier)
}
