import { NextResponse } from "next/server"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getShipmentRegistryWithSigner } from "@/lib/contracts"
import { deriveShipmentRegistryId } from "@/lib/shipment-registry"

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

  const normalizedNextCourier = nextCourier?.toLowerCase() ?? null
  if (!normalizedNextCourier) {
    return NextResponse.json({ error: "courier required" }, { status: 400 })
  }

  const currentCourier = shipment.assignedCourier?.toLowerCase() ?? null
  if (currentCourier === normalizedNextCourier) {
    return NextResponse.json(shipment)
  }

  const registry = getShipmentRegistryWithSigner()
  const registryShipmentId = deriveShipmentRegistryId(shipment.id)
  let updateTxHash = ""
  try {
    const tx = await registry.updateCourier(registryShipmentId, normalizedNextCourier)
    const receipt = await tx.wait()
    updateTxHash = receipt?.hash ?? tx.hash
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update courier on-chain"
    return NextResponse.json({ error: `Courier update failed: ${message}` }, { status: 502 })
  }

  const existingMetadata = safeParse(shipment.metadataRaw)
  const existingOnchain =
    existingMetadata && typeof existingMetadata.onchain === "object" && existingMetadata.onchain !== null
      ? (existingMetadata.onchain as Record<string, unknown>)
      : {}
  const nextMetadata = {
    ...(existingMetadata ?? {}),
    onchain: {
      ...existingOnchain,
      registerCourier: normalizedNextCourier,
      lastCourierUpdateTxHash: updateTxHash,
    },
  }

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      assignedCourier: normalizedNextCourier,
      metadataRaw: JSON.stringify(nextMetadata),
    },
  })

  return NextResponse.json(updated)
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}
