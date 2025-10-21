import { NextResponse } from "next/server"

import type { Prisma } from "@prisma/client"
import type { Interface } from "ethers"

import { prisma } from "@/lib/prisma"
import { buildPickupTypedData, buildDropTypedData } from "@/lib/shipment-attestation"
import { hashToken, verifyMagicLinkToken } from "@/lib/signing-session"
import { verifyTypedSignature } from "@/lib/verify-signature"
import { geodesicDistance } from "@/lib/geo"
import { getShipmentRegistryWithSigner } from "@/lib/contracts"
import { deriveShipmentRegistryId, parseChainOrderId } from "@/lib/shipment-registry"

const PICKUP_SIGNING_VERIFIER =
  process.env.PICKUP_SIGNING_VERIFIER ?? "0x0000000000000000000000000000000000000000"
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "0")
const DEFAULT_RADIUS_METERS = Number.isFinite(Number(process.env.MAX_DISTANCE_IN_METERS))
  ? Number(process.env.MAX_DISTANCE_IN_METERS)
  : 2000
const REWARD_PER_METER = 10n

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const token = new URL(request.url).searchParams.get("t")
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 })
  }
  const payload = verifyMagicLinkToken(token)
  if (!payload) {
    return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 })
  }

  const { sessionId } = await context.params

  const session = await prisma.signingSession.findFirst({
    where: { sessionUid: sessionId },
  })
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const expectedRole = session.kind === "drop" ? "buyer" : "supplier"
  const expectedStatus = session.kind === "drop" ? "PENDING_BUYER" : "PENDING_SUPPLIER"

  if (payload.sid !== sessionId || payload.role !== expectedRole) {
    return NextResponse.json({ error: "Token invalid for this session" }, { status: 403 })
  }

  const tokenHash = hashToken(token)
  const magicLink = await prisma.magicLink.findUnique({ where: { tokenHash } })
  if (!magicLink || magicLink.usedAt) {
    return NextResponse.json({ error: "Link already used" }, { status: 409 })
  }
  if (magicLink.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Link expired" }, { status: 403 })
  }

  if (session.status !== expectedStatus) {
    return NextResponse.json({ error: "Session no longer available" }, { status: 409 })
  }
  if (!session.courierSignature) {
    return NextResponse.json({ error: "Courier signature missing" }, { status: 500 })
  }

  const body = (await request.json()) as { signature?: string }
  if (!body || typeof body.signature !== "string" || !body.signature.trim()) {
    return NextResponse.json({ error: "Signature required" }, { status: 400 })
  }

  let payloadData: Record<string, any>
  try {
    payloadData = session.payload ? (JSON.parse(session.payload) as Record<string, any>) : {}
  } catch {
    return NextResponse.json({ error: "Stored session payload corrupted" }, { status: 500 })
  }

  if (
    typeof payloadData.shipmentHash !== "string" ||
    typeof payloadData.chainOrderId !== "string" ||
    typeof payloadData.claimedTs !== "number" ||
    typeof payloadData.currentLat !== "number" ||
    typeof payloadData.currentLon !== "number"
  ) {
    return NextResponse.json({ error: "Session payload missing required data" }, { status: 500 })
  }

  if (session.kind === "drop" && typeof payloadData.distanceMeters !== "number") {
    return NextResponse.json({ error: "Session payload missing distance" }, { status: 500 })
  }

  const radiusMeters =
    typeof payloadData.radiusM === "number" && Number.isFinite(payloadData.radiusM) && payloadData.radiusM > 0
      ? payloadData.radiusM
      : DEFAULT_RADIUS_METERS

  const targetLat =
    session.kind === "drop"
      ? typeof payloadData.dropLat === "number"
        ? payloadData.dropLat
        : null
      : typeof payloadData.pickupLat === "number"
        ? payloadData.pickupLat
        : null
  const targetLon =
    session.kind === "drop"
      ? typeof payloadData.dropLon === "number"
        ? payloadData.dropLon
        : null
      : typeof payloadData.pickupLon === "number"
        ? payloadData.pickupLon
        : null

  if (targetLat === null || targetLon === null) {
    return NextResponse.json({ error: "Session payload missing target coordinates" }, { status: 500 })
  }

  const distanceToTarget = geodesicDistance(targetLat, targetLon, payloadData.currentLat, payloadData.currentLon)
  if (!Number.isFinite(distanceToTarget)) {
    return NextResponse.json({ error: "Unable to compute courier distance from target" }, { status: 500 })
  }

  if (distanceToTarget > radiusMeters) {
    return NextResponse.json(
      {
        error: `Courier location outside ${session.kind === "drop" ? "drop" : "pickup"} radius`,
        radius: Math.round(radiusMeters),
        distance: Math.round(distanceToTarget),
      },
      { status: 403 },
    )
  }

  const typedData =
    session.kind === "drop"
      ? buildDropTypedData({
          verifyingContract: PICKUP_SIGNING_VERIFIER,
          chainId: CHAIN_ID,
          shipmentId: payloadData.shipmentHash,
          orderId: payloadData.chainOrderId,
          courier: session.courier,
          buyer: session.supplier,
          claimedTs: payloadData.claimedTs,
          latitude: payloadData.currentLat,
          longitude: payloadData.currentLon,
          distanceMeters: payloadData.distanceMeters ?? 0,
        })
      : buildPickupTypedData({
          verifyingContract: PICKUP_SIGNING_VERIFIER,
          chainId: CHAIN_ID,
          shipmentId: payloadData.shipmentHash,
          orderId: payloadData.chainOrderId,
          courier: session.courier,
          supplier: session.supplier,
          claimedTs: payloadData.claimedTs,
          latitude: payloadData.currentLat,
          longitude: payloadData.currentLon,
        })

  const verification = await verifyTypedSignature({
    expectedSigner: session.supplier,
    domain: typedData.domain,
    types: typedData.types,
    message: typedData.message,
    signature: body.signature,
  })

  if (!verification.valid) {
    return NextResponse.json(
      { error: "Signature invalid", expectedSigner: session.supplier, recovered: verification.recovered ?? null },
      { status: 400 },
    )
  }

  let dropTx: string | null = null

  if (session.kind === "drop") {
    dropTx = await finalizeDropMilestone({
      session,
      payloadData,
      buyerSignature: body.signature,
    })
  } else {
    await finalizePickupMilestone({
      session,
      payloadData,
      supplierSignature: body.signature,
    })
  }

  const usedAt = new Date()
  await prisma.$transaction([
    prisma.signingSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        supplierSignature: body.signature,
        updatedAt: usedAt,
      },
    }),
    prisma.magicLink.update({
      where: { id: magicLink.id },
      data: { usedAt },
    }),
  ])

  return NextResponse.json({
    ok: true,
    dropTx,
    escrowTx: dropTx,
  })
}

async function finalizePickupMilestone({
  session,
  payloadData,
  supplierSignature,
}: {
  session: Awaited<ReturnType<typeof prisma.signingSession.findFirst>>
  payloadData: Record<string, any>
  supplierSignature: string
}) {
  if (!session) {
    throw new Error("Signing session not found")
  }
  if (typeof supplierSignature !== "string" || !supplierSignature.trim()) {
    throw new Error("Supplier signature missing")
  }
  const shipment = await prisma.shipment.findUnique({ where: { id: session.shipmentId } })
  if (!shipment) {
    throw new Error("Shipment not found")
  }
  const order = await prisma.order.findUnique({ where: { id: session.orderId } })
  if (!order) {
    throw new Error("Order not found")
  }
  const claimedTimestamp = Number(payloadData.claimedTs ?? Math.floor(Date.now() / 1000))
  if (!Number.isFinite(claimedTimestamp) || claimedTimestamp <= 0) {
    throw new Error("Invalid pickup timestamp")
  }
  if (typeof payloadData.locationHash !== "string") {
    throw new Error("Session payload missing location hash")
  }
  if (typeof payloadData.shipmentHash !== "string") {
    throw new Error("Session payload missing shipment hash")
  }

  const expectedRegistryId = deriveShipmentRegistryId(session.shipmentId)
  if (payloadData.shipmentHash.toLowerCase() !== expectedRegistryId.toLowerCase()) {
    throw new Error("Shipment hash mismatch for pickup confirmation")
  }

  const chainOrderNumeric = parseChainOrderId(payloadData.chainOrderId)

  const courierSignature = session.courierSignature
  if (typeof courierSignature !== "string" || !courierSignature.trim()) {
    throw new Error("Courier signature missing")
  }

  const registry = getShipmentRegistryWithSigner()
  let pickupTxHash = ""
  try {
    const tx = await registry.confirmPickup(
      [payloadData.shipmentHash, chainOrderNumeric, payloadData.locationHash, BigInt(claimedTimestamp)],
      courierSignature,
      supplierSignature,
    )
    const receipt = await tx.wait()
    pickupTxHash = receipt?.hash ?? tx.hash
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm pickup on-chain"
    throw new Error(`Pickup confirmation failed: ${message}`)
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.proof.create({
      data: {
        shipmentNo: shipment.shipmentNo,
        kind: "pickup-countersign",
        signer: session.supplier,
        claimedTs: claimedTimestamp,
        photoHash: null,
        photoCid: null,
        litDistance: payloadData.targetDistance ?? null,
        litOk: true,
      },
    })

    const shipmentUpdate: Record<string, unknown> = {
      status: "InTransit",
      pickedUpAt: now,
      updatedAt: now,
    }
    if (!shipment.assignedCourier) {
      shipmentUpdate.assignedCourier = session.courier
    }

    const existingShipmentMetadata = safeParse(shipment.metadataRaw)
    const existingShipmentOnchain =
      existingShipmentMetadata &&
      typeof existingShipmentMetadata.onchain === "object" &&
      existingShipmentMetadata.onchain !== null
        ? (existingShipmentMetadata.onchain as Record<string, unknown>)
        : {}
    const nextShipmentMetadata = {
      ...(existingShipmentMetadata ?? {}),
      pickupTxHash,
      onchain: {
        ...existingShipmentOnchain,
        pickupTxHash,
        pickupConfirmedTs: claimedTimestamp,
      },
    }
    shipmentUpdate.metadataRaw = JSON.stringify(nextShipmentMetadata)

    await tx.shipment.update({
      where: { id: shipment.id },
      data: shipmentUpdate,
    })

    const orderMetadata = safeParse(order.metadataRaw)
    const existingOrderMetadata = orderMetadata
    const existingOrderOnchain =
      existingOrderMetadata && typeof existingOrderMetadata.onchain === "object" && existingOrderMetadata.onchain !== null
        ? (existingOrderMetadata.onchain as Record<string, unknown>)
        : {}
    const nextOrderMetadata = {
      ...(existingOrderMetadata ?? {}),
      pickupTxHash,
      onchain: {
        ...existingOrderOnchain,
        pickupTxHash,
      },
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "Shipped",
        updatedAt: now,
        metadataRaw: JSON.stringify(nextOrderMetadata),
      },
    })
  })
}

async function finalizeDropMilestone({
  session,
  payloadData,
  buyerSignature,
}: {
  session: Awaited<ReturnType<typeof prisma.signingSession.findFirst>>
  payloadData: Record<string, any>
  buyerSignature: string
}): Promise<string | null> {
  if (!session) {
    throw new Error("Signing session not found")
  }
  if (typeof buyerSignature !== "string" || !buyerSignature.trim()) {
    throw new Error("Buyer signature missing")
  }
  const shipment = await prisma.shipment.findUnique({ where: { id: session.shipmentId } })
  if (!shipment) {
    throw new Error("Shipment not found")
  }
  const order = await prisma.order.findUnique({ where: { id: session.orderId } })
  if (!order) {
    throw new Error("Order not found")
  }

  const claimedTimestamp = Number(payloadData.claimedTs ?? Math.floor(Date.now() / 1000))
  if (!Number.isFinite(claimedTimestamp) || claimedTimestamp <= 0) {
    throw new Error("Invalid drop timestamp")
  }
  const now = new Date()

  if (
    typeof shipment.pickupLat !== "number" ||
    typeof shipment.pickupLon !== "number" ||
    typeof shipment.dropLat !== "number" ||
    typeof shipment.dropLon !== "number"
  ) {
    throw new Error("Shipment missing coordinates")
  }

  if (typeof payloadData.shipmentHash !== "string" || typeof payloadData.locationHash !== "string") {
    throw new Error("Session payload missing shipment hash")
  }

  const expectedRegistryId = deriveShipmentRegistryId(session.shipmentId)
  if (payloadData.shipmentHash.toLowerCase() !== expectedRegistryId.toLowerCase()) {
    throw new Error("Shipment hash mismatch for drop confirmation")
  }

  const chainOrderNumeric = parseChainOrderId(payloadData.chainOrderId)
  const courierSignature = session.courierSignature
  if (typeof courierSignature !== "string" || !courierSignature.trim()) {
    throw new Error("Courier signature missing")
  }

  const plannedDistance = Math.round(
    geodesicDistance(shipment.pickupLat, shipment.pickupLon, shipment.dropLat, shipment.dropLon),
  )
  const distanceMeters = Math.max(0, Math.round(Number(payloadData.distanceMeters ?? plannedDistance)))

  const registry = getShipmentRegistryWithSigner()
  let dropTxHash = ""
  let courierRewardWei = 0n
  const orderMetadata = safeParse(order.metadataRaw)
  const lineItems = Array.isArray(orderMetadata?.items) ? orderMetadata.items : []
  const lineItemsJson = JSON.stringify(lineItems)
  const metadataUri = typeof payloadData.metadataUri === "string" ? payloadData.metadataUri : ""
  try {
    const tx = await registry.confirmDrop(
      [payloadData.shipmentHash, chainOrderNumeric, payloadData.locationHash, BigInt(claimedTimestamp), BigInt(distanceMeters)],
      courierSignature,
      buyerSignature,
      lineItemsJson,
      metadataUri,
    )
    const receipt = await tx.wait()
    dropTxHash = receipt?.hash ?? tx.hash
    courierRewardWei = extractCourierRewardFromLogs(receipt?.logs ?? [], registry.target?.toString() ?? "", registry.interface)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm drop on-chain"
    throw new Error(`Drop confirmation failed: ${message}`)
  }

  if (courierRewardWei === 0n) {
    courierRewardWei = BigInt(distanceMeters) * REWARD_PER_METER
  }

  await prisma.$transaction(async (tx) => {
    await tx.proof.create({
      data: {
        shipmentNo: shipment.shipmentNo,
        kind: "drop-countersign",
        signer: session.supplier,
        claimedTs: claimedTimestamp,
        photoHash: null,
        photoCid: null,
        litDistance: distanceMeters,
        litOk: true,
      },
    })

    const existingShipmentMetadata = safeParse(shipment.metadataRaw)
    const existingOnchain =
      existingShipmentMetadata &&
      typeof existingShipmentMetadata.onchain === "object" &&
      existingShipmentMetadata.onchain !== null
        ? (existingShipmentMetadata.onchain as Record<string, unknown>)
        : {}

    const shipmentMeta = {
      ...(existingShipmentMetadata ?? {}),
      dropPendingSignature: false,
      courierRewardPaid: Number(courierRewardWei) / 1_000_000,
      courierRewardWei: courierRewardWei.toString(),
      dropTxHash,
      dropMetadataUri: metadataUri || undefined,
      dropPlannedDistance: plannedDistance,
      onchain: {
        ...existingOnchain,
        dropTxHash,
        courierRewardWei: courierRewardWei.toString(),
        dropConfirmedTs: claimedTimestamp,
      },
    }

    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: "Delivered",
        deliveredAt: now,
        updatedAt: now,
        metadataRaw: JSON.stringify(shipmentMeta),
      },
    })

    const existingOrderMetadata = orderMetadata
    const existingOrderOnchain =
      existingOrderMetadata && typeof existingOrderMetadata.onchain === "object" && existingOrderMetadata.onchain !== null
        ? (existingOrderMetadata.onchain as Record<string, unknown>)
        : {}

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "Delivered",
        completedAt: now,
        updatedAt: now,
        metadataRaw: JSON.stringify({
          ...(existingOrderMetadata ?? {}),
          escrowReleaseTx: dropTxHash,
          courierRewardWei: courierRewardWei.toString(),
          courierRewardPaid: Number(courierRewardWei) / 1_000_000,
          dropPendingBuyerSignature: false,
          onchain: {
            ...existingOrderOnchain,
            dropTxHash,
            courierRewardWei: courierRewardWei.toString(),
            dropConfirmedTs: claimedTimestamp,
          },
        }),
      },
    })

    await incrementBuyerInventory(tx, order)

    const existingPayment = await tx.payment.findFirst({
      where: { orderId: order.id, payer: order.buyer, payee: order.supplier },
    })
    if (existingPayment) {
      await tx.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: "Released",
          releaseTx: dropTxHash,
          updatedAt: now,
        },
      })
    }
  })

  return dropTxHash
}

function extractCourierRewardFromLogs(
  logs: Array<{ address?: string; topics: readonly string[]; data: string }>,
  registryAddress: string,
  iface: Interface,
): bigint {
  if (!registryAddress) {
    return 0n
  }
  const normalized = registryAddress.toLowerCase()
  for (const log of logs) {
    if (!log || typeof log !== "object") continue
    const logAddress = typeof log.address === "string" ? log.address.toLowerCase() : ""
    if (logAddress !== normalized) continue
    try {
      const parsed = iface.parseLog(log)
      if (parsed && parsed.name === "DropApproved") {
        const reward = parsed.args?.courierReward
        if (typeof reward === "bigint") {
          return reward
        }
        if (typeof reward === "number") {
          return BigInt(Math.floor(reward))
        }
        if (reward && typeof reward === "object" && "toString" in reward) {
          const stringValue = (reward as { toString(): string }).toString()
          if (stringValue) {
            try {
              return BigInt(stringValue)
            } catch {
              // ignore parse error, fall back to 0
            }
          }
        }
      }
    } catch {
      // ignore logs that fail to parse
    }
  }
  return 0n
}

async function incrementBuyerInventory(
  tx: Prisma.TransactionClient,
  order: Awaited<ReturnType<typeof prisma.order.findUnique>>,
) {
  if (!order) return
  const metadata = safeParse(order.metadataRaw)
  const items = Array.isArray(metadata?.items) ? metadata.items : []
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue
    const skuId = typeof entry.skuId === "string" ? entry.skuId : undefined
    const qtyValue = entry.qty ?? entry.quantity
    const quantity = Number(qtyValue)
    if (!skuId || !Number.isFinite(quantity) || quantity <= 0) continue
    await tx.product.upsert({
      where: { owner_skuId: { owner: order.buyer, skuId } },
      update: {
        targetStock: { increment: Math.round(quantity) },
        active: true,
      },
      create: {
        owner: order.buyer,
        skuId,
        name: skuId,
        unit: "unit",
        minThreshold: 0,
        targetStock: Math.max(0, Math.round(quantity)),
        active: true,
      },
    })
  }
}

function safeParse(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
