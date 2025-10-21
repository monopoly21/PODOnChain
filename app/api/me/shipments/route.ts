import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { geodesicDistance } from "@/lib/geo"
import { getShipmentRegistryWithSigner } from "@/lib/contracts"
import { deriveShipmentRegistryId, parseChainOrderId } from "@/lib/shipment-registry"

export const runtime = "nodejs"

const REWARD_PER_METER = 10n

type ShipmentRecord = Awaited<ReturnType<typeof prisma.shipment.findMany>>[number]

function normaliseAddress(value: string | null | undefined) {
  if (!value) return undefined
  const v = value.toLowerCase()
  if (!v.startsWith("0x") || v.length !== 42) {
    throw new Error("Invalid address")
  }
  return v
}

export async function GET(request: Request) {
  const wallet = await getUserAddress()
  const { searchParams } = new URL(request.url)
  const scope = (searchParams.get("scope") || "").toLowerCase()

  if (scope === "supplier") {
    const shipments = await prisma.shipment.findMany({
      where: { supplier: wallet },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(shipments.map(serializeShipment))
  }

  if (scope === "buyer") {
    const shipments = await prisma.shipment.findMany({
      where: { buyer: wallet },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(shipments.map(serializeShipment))
  }

  if (scope === "courier") {
    const assigned = await prisma.shipment.findMany({
      where: {
        OR: [
          { assignedCourier: wallet },
          { assignedCourier: null, status: "Created" },
        ],
      },
      orderBy: { createdAt: "desc" },
    })

    const allowlisted = await Promise.all(
      assigned.map(async (shipment: ShipmentRecord) => {
        if (shipment.assignedCourier && shipment.assignedCourier !== wallet) {
          return null
        }
        if (!shipment.assignedCourier) {
          const allowed = await prisma.courier.findFirst({
            where: { owner: shipment.supplier, courierWallet: wallet },
          })
          if (!allowed) return null
        }
        return shipment
      }),
    )

    return NextResponse.json(allowlisted.filter(Boolean).map(serializeShipment))
  }

  const [supplierShipments, buyerShipments, courierShipments] = await Promise.all([
    prisma.shipment.findMany({ where: { supplier: wallet }, orderBy: { createdAt: "desc" } }),
    prisma.shipment.findMany({ where: { buyer: wallet }, orderBy: { createdAt: "desc" } }),
    prisma.shipment.findMany({
      where: {
        OR: [
          { assignedCourier: wallet },
          { assignedCourier: null, status: "Created" },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const filteredCourier = await Promise.all(
    courierShipments.map(async (shipment: ShipmentRecord) => {
      if (shipment.assignedCourier && shipment.assignedCourier !== wallet) {
        return null
      }
      if (!shipment.assignedCourier) {
        const allowed = await prisma.courier.findFirst({
          where: { owner: shipment.supplier, courierWallet: wallet },
        })
        if (!allowed) return null
      }
      return shipment
    }),
  )

  return NextResponse.json({
    supplier: supplierShipments.map(serializeShipment),
    buyer: buyerShipments.map(serializeShipment),
    courier: filteredCourier.filter(Boolean).map(serializeShipment),
  })
}

export async function POST(request: Request) {
  const supplier = await getUserAddress()
  const body = await request.json()

  if (!body.orderId || typeof body.orderId !== "string") {
    return NextResponse.json({ error: "orderId required" }, { status: 400 })
  }

  const order = await prisma.order.findUnique({ where: { id: body.orderId } })

  if (!order || order.supplier !== supplier) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }

  if (typeof body.pickupLat === "undefined" || typeof body.pickupLon === "undefined") {
    return NextResponse.json({ error: "pickupLat and pickupLon required" }, { status: 400 })
  }

  if (typeof body.dropLat === "undefined" || typeof body.dropLon === "undefined") {
    return NextResponse.json({ error: "dropLat and dropLon required" }, { status: 400 })
  }

  const shipmentNo = Number(body.shipmentNo ?? Date.now())

  const metadata = (safeParse(order.metadataRaw) || {}) as Record<string, any>

  function getCoordinate(input: unknown, fallback: unknown, label: string) {
    if (input !== undefined && input !== null && input !== "") {
      const value = Number(input)
      if (!Number.isFinite(value)) {
        throw new Error(`${label} is required and must be numeric`)
      }
      return value
    }

    if (typeof fallback === "number" && Number.isFinite(fallback)) {
      return fallback
    }

    throw new Error(`${label} is required and must be numeric`)
  }

  let pickupLatValue: number
  let pickupLonValue: number
  let dropLatValue: number
  let dropLonValue: number

  try {
    pickupLatValue = getCoordinate(body.pickupLat, metadata?.pickup?.lat, "pickupLat")
    pickupLonValue = getCoordinate(body.pickupLon, metadata?.pickup?.lon, "pickupLon")
    dropLatValue = getCoordinate(body.dropLat, metadata?.drop?.lat, "dropLat")
    dropLonValue = getCoordinate(body.dropLon, metadata?.drop?.lon, "dropLon")
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid coordinates" },
      { status: 400 },
    )
  }
  const dueDate = body.dueBy ? new Date(body.dueBy) : new Date(Date.now() + 72 * 3600 * 1000)

  const chainOrderIdRaw =
    typeof body.chainOrderId === "string" && body.chainOrderId.trim()
      ? body.chainOrderId.trim()
      : metadata?.chainOrderId ?? metadata?.chain_orderId ?? metadata?.chain_order_id ?? null

  let chainOrderNumeric: bigint
  try {
    chainOrderNumeric = parseChainOrderId(chainOrderIdRaw)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing on-chain order id" },
      { status: 400 },
    )
  }
  const chainOrderIdString = chainOrderNumeric.toString()

  const plannedDistance = Math.round(geodesicDistance(pickupLatValue, pickupLonValue, dropLatValue, dropLonValue))
  const rewardEstimate = Number((BigInt(plannedDistance) * REWARD_PER_METER) / 1_000_000n)

  const shipmentMetadataBase =
    typeof body.metadata === "string"
      ? safeParse(body.metadata)
      : body.metadata && typeof body.metadata === "object"
      ? body.metadata
      : undefined

  const assignedCourier = normaliseAddress(body.assignedCourier ?? null) ?? null
  const registerCourier = assignedCourier ?? supplier

  const shipmentId =
    typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : randomUUID()
  const registryShipmentId = deriveShipmentRegistryId(shipmentId)

  const registry = getShipmentRegistryWithSigner()
  let registerTxHash = ""
  try {
    const tx = await registry.registerShipment(
      registryShipmentId,
      chainOrderNumeric,
      order.buyer,
      supplier,
      registerCourier,
    )
    const receipt = await tx.wait()
    registerTxHash = receipt?.hash ?? tx.hash
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to register shipment on-chain"
    return NextResponse.json(
      { error: `Shipment registry transaction failed: ${message}` },
      { status: 502 },
    )
  }

  const baseShipmentMetadata = { ...(shipmentMetadataBase ?? {}) }
  const existingOnchainMeta =
    typeof baseShipmentMetadata.onchain === "object" && baseShipmentMetadata.onchain !== null
      ? (baseShipmentMetadata.onchain as Record<string, unknown>)
      : {}

  const shipmentMetadata = {
    ...baseShipmentMetadata,
    chainOrderId: chainOrderIdString,
    shipmentRegistryId: registryShipmentId,
    courierRewardEstimate: rewardEstimate,
    courierRewardCurrency: "PYUSD",
    onchain: {
      ...existingOnchainMeta,
      chainOrderId: chainOrderIdString,
      shipmentRegistryId: registryShipmentId,
      registerTxHash,
      registerCourier,
    },
  }

  const orderShipmentRegistryMeta =
    typeof metadata?.shipmentRegistry === "object" && metadata.shipmentRegistry !== null
      ? (metadata.shipmentRegistry as Record<string, unknown>)
      : {}

  const orderMetadataUpdate: Record<string, any> = {
    ...metadata,
    pickup: { lat: pickupLatValue, lon: pickupLonValue },
    drop: { lat: dropLatValue, lon: dropLonValue },
    courierRewardEstimate: rewardEstimate,
    chainOrderId: chainOrderIdString,
    shipmentRegistry: {
      ...orderShipmentRegistryMeta,
      [shipmentId]: {
        shipmentRegistryId: registryShipmentId,
        registerTxHash,
      },
    },
  }

  const shipment = await prisma.shipment.create({
    data: {
      id: shipmentId,
      orderId: order.id,
      shipmentNo,
      supplier,
      buyer: order.buyer,
      pickupLat: pickupLatValue,
      pickupLon: pickupLonValue,
      dropLat: dropLatValue,
      dropLon: dropLonValue,
      dueBy: dueDate,
      assignedCourier,
      status: "Created",
      metadataRaw: JSON.stringify(shipmentMetadata),
    },
  })

  const orderUpdate: Record<string, unknown> = {
    metadataRaw: JSON.stringify(orderMetadataUpdate),
  }

  if (["Approved", "Funded"].includes(order.status)) {
    orderUpdate.status = "InFulfillment"
    orderUpdate.updatedAt = new Date()
  }

  await prisma.order.update({
    where: { id: order.id },
    data: orderUpdate,
  })

  return NextResponse.json({ ok: true, shipment: serializeShipment(shipment) })
}

function serializeShipment(shipment: any) {
  const { metadataRaw, ...rest } = shipment
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
