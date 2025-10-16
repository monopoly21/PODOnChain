import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(_request: Request, { params }: { params: { shipmentId: string } }) {
  const courier = await getUserAddress()
  const normalizedCourier = courier.toLowerCase()

  const shipment = await prisma.shipment.findUnique({ where: { id: params.shipmentId } })
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 })
  }

  if (shipment.assignedCourier && shipment.assignedCourier !== courier) {
    return NextResponse.json({ error: "Shipment already assigned" }, { status: 400 })
  }

  const allowlisted = await prisma.courier.findFirst({
    where: { owner: shipment.supplier, courierWallet: normalizedCourier },
  })

  if (!allowlisted) {
    return NextResponse.json({ error: "Courier not allowlisted" }, { status: 403 })
  }

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: { assignedCourier: courier },
  })

  return NextResponse.json(updated)
}
