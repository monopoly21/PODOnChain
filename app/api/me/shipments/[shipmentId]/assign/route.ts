import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

function normalise(address: string) {
  const value = (address || "").toLowerCase()
  if (!value.startsWith("0x") || value.length !== 42) {
    throw new Error("Invalid address")
  }
  return value
}

export async function POST(request: Request, { params }: { params: { shipmentId: string } }) {
  const wallet = await getUserAddress()
  const body = await request.json()
  const assignToRaw = body?.courier as string | undefined

  const shipment = await prisma.shipment.findUnique({ where: { id: params.shipmentId } })

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 })
  }

  const isSupplier = shipment.supplier === wallet
  const isCourier = shipment.assignedCourier === wallet || shipment.assignedCourier === null

  if (!isSupplier && !isCourier) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 })
  }

  let nextCourier: string | null = null

  if (isSupplier) {
    if (!assignToRaw) {
      return NextResponse.json({ error: "courier required" }, { status: 400 })
    }
    const assignTo = normalise(assignToRaw)
    const allowlisted = await prisma.courier.findUnique({
      where: { owner_courierWallet: { owner: wallet, courierWallet: assignTo } },
    })
    if (!allowlisted) {
      return NextResponse.json({ error: "Courier not allowlisted" }, { status: 400 })
    }
    nextCourier = assignTo
  } else {
    // courier claiming a job
    if (shipment.assignedCourier && shipment.assignedCourier !== wallet) {
      return NextResponse.json({ error: "Shipment already assigned" }, { status: 400 })
    }
    const allowlisted = await prisma.courier.findUnique({
      where: { owner_courierWallet: { owner: shipment.supplier, courierWallet: wallet } },
    })
    if (!allowlisted) {
      return NextResponse.json({ error: "Not allowlisted" }, { status: 403 })
    }
    nextCourier = wallet
  }

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: { assignedCourier: nextCourier },
  })

  return NextResponse.json(updated)
}
