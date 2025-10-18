import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { getAddress } from "ethers"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createMagicLinkToken, hashToken, randomNonce } from "@/lib/signing-session"
import {
  buildPickupTypedData as buildLegacyPickupTypedData,
  buildDropTypedData as buildLegacyDropTypedData,
} from "@/lib/shipment-attestation"
import { geodesicDistance } from "@/lib/geo"
import { verifyTypedSignature } from "@/lib/verify-signature"
const PICKUP_SIGNING_VERIFIER =
  process.env.PICKUP_SIGNING_VERIFIER ?? "0x0000000000000000000000000000000000000000"
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "0")
const DEFAULT_RADIUS_METERS = Number.isFinite(Number(process.env.MAX_DISTANCE_IN_METERS))
  ? Number(process.env.MAX_DISTANCE_IN_METERS)
  : 2000

export async function POST(request: Request) {
  const courier = await getUserAddress()
  const body = (await request.json()) as {
    shipmentId?: string
    shipmentHash?: string
    chainOrderId?: string
    claimedTs?: number
    currentLat?: number | null
    currentLon?: number | null
    locationHash?: string
    courierSignature?: string
    radiusM?: number | null
    notes?: string
    kind?: string
    distanceMeters?: number
    dropLat?: number | null
    dropLon?: number | null
  }

  if (!body || typeof body.shipmentId !== "string") {
    return NextResponse.json({ error: "shipmentId required" }, { status: 400 })
  }

  const shipment = await prisma.shipment.findUnique({ where: { id: body.shipmentId } })
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 })
  }

  const assignedCourier = shipment.assignedCourier
  if (!assignedCourier) {
    return NextResponse.json({ error: "Courier must be assigned before creating session" }, { status: 403 })
  }

  let normalizedCourier: string
  let normalizedSupplier: string
  try {
    normalizedCourier = getAddress(assignedCourier)
    normalizedSupplier = getAddress(shipment.supplier)
  } catch {
    return NextResponse.json({ error: "Invalid participant address" }, { status: 500 })
  }
  if (normalizedCourier.toLowerCase() !== courier.toLowerCase()) {
    return NextResponse.json({ error: "Not assigned to this shipment" }, { status: 403 })
  }

  if (!shipment.pickupLat || !shipment.pickupLon) {
    return NextResponse.json({ error: "Shipment missing pickup coordinates" }, { status: 400 })
  }

  if (typeof body.currentLat !== "number" || typeof body.currentLon !== "number") {
    return NextResponse.json({ error: "Courier coordinates required" }, { status: 400 })
  }

  if (typeof body.chainOrderId !== "string" || !body.chainOrderId.trim()) {
    return NextResponse.json({ error: "chainOrderId required" }, { status: 400 })
  }
  if (typeof body.shipmentHash !== "string" || typeof body.locationHash !== "string") {
    return NextResponse.json({ error: "shipmentHash and locationHash required" }, { status: 400 })
  }
  if (typeof body.claimedTs !== "number" || !Number.isFinite(body.claimedTs)) {
    return NextResponse.json({ error: "claimedTs required" }, { status: 400 })
  }
  if (typeof body.courierSignature !== "string" || !body.courierSignature.trim()) {
    return NextResponse.json({ error: "courierSignature required" }, { status: 400 })
  }

  const kindInput = typeof body.kind === "string" ? body.kind.toLowerCase() : "pickup"
  if (kindInput !== "pickup" && kindInput !== "drop") {
    return NextResponse.json({ error: "Invalid signing session kind" }, { status: 400 })
  }

  const requestedRadius =
    typeof body.radiusM === "number" && Number.isFinite(body.radiusM) ? Math.max(body.radiusM, 0) : null
  const radiusMeters = requestedRadius && requestedRadius > 0 ? requestedRadius : DEFAULT_RADIUS_METERS
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return NextResponse.json({ error: "Unable to resolve geofence radius" }, { status: 500 })
  }

  let counterpartyAddress = normalizedSupplier
  let legacyTypedData:
    | ReturnType<typeof buildLegacyPickupTypedData>
    | ReturnType<typeof buildLegacyDropTypedData>
  let statusLabel = kindInput === "pickup" ? "PENDING_SUPPLIER" : "PENDING_BUYER"
  let contextHash = body.locationHash
  let sessionDistanceMeters: number | null = null
  let targetDistanceMeters: number | null = null

  if (kindInput === "pickup") {
    legacyTypedData = buildLegacyPickupTypedData({
      verifyingContract: PICKUP_SIGNING_VERIFIER,
      chainId: CHAIN_ID,
      shipmentId: body.shipmentHash,
      orderId: body.chainOrderId,
      courier: normalizedCourier,
      supplier: normalizedSupplier,
      claimedTs: body.claimedTs,
      latitude: body.currentLat,
      longitude: body.currentLon,
    })
    contextHash = legacyTypedData.locationHash

    const pickupDistance = geodesicDistance(shipment.pickupLat, shipment.pickupLon, body.currentLat, body.currentLon)
    targetDistanceMeters = Number.isFinite(pickupDistance) ? pickupDistance : null
    if (!Number.isFinite(pickupDistance)) {
      return NextResponse.json({ error: "Unable to compute pickup distance" }, { status: 500 })
    }
    if (pickupDistance > radiusMeters) {
      return NextResponse.json(
        {
          error: "Courier location outside pickup radius",
          radius: Math.round(radiusMeters),
          distance: Math.round(pickupDistance),
        },
        { status: 400 },
      )
    }
  } else {
    if (shipment.status !== "InTransit" && shipment.status !== "Delivered") {
      return NextResponse.json({ error: "Shipment not ready for drop" }, { status: 400 })
    }
    if (
      typeof shipment.dropLat !== "number" ||
      typeof shipment.dropLon !== "number" ||
      typeof shipment.pickupLat !== "number" ||
      typeof shipment.pickupLon !== "number"
    ) {
      return NextResponse.json({ error: "Shipment missing drop coordinates" }, { status: 400 })
    }

    const normalizedBuyer = getAddress(shipment.buyer)
    counterpartyAddress = normalizedBuyer

    const plannedDistance = Math.round(
      geodesicDistance(shipment.pickupLat, shipment.pickupLon, shipment.dropLat, shipment.dropLon),
    )

    const distanceMeters =
      typeof body.distanceMeters === "number" && Number.isFinite(body.distanceMeters)
        ? body.distanceMeters
        : plannedDistance

    legacyTypedData = buildLegacyDropTypedData({
      verifyingContract: PICKUP_SIGNING_VERIFIER,
      chainId: CHAIN_ID,
      shipmentId: body.shipmentHash,
      orderId: body.chainOrderId,
      courier: normalizedCourier,
      buyer: normalizedBuyer,
      claimedTs: body.claimedTs,
      latitude: body.currentLat,
      longitude: body.currentLon,
      distanceMeters,
    })

    contextHash = legacyTypedData.locationHash
    sessionDistanceMeters = distanceMeters

    const dropDistance = geodesicDistance(shipment.dropLat, shipment.dropLon, body.currentLat, body.currentLon)
    targetDistanceMeters = Number.isFinite(dropDistance) ? dropDistance : null
    if (!Number.isFinite(dropDistance)) {
      return NextResponse.json({ error: "Unable to compute drop distance" }, { status: 500 })
    }
    if (dropDistance > radiusMeters) {
      return NextResponse.json(
        {
          error: "Courier location outside drop radius",
          radius: Math.round(radiusMeters),
          distance: Math.round(dropDistance),
        },
        { status: 400 },
      )
    }

    if (Math.abs(distanceMeters - plannedDistance) > 5) {
      return NextResponse.json(
        { error: "Distance mismatch", expected: plannedDistance, received: distanceMeters },
        { status: 400 },
      )
    }
  }

  const courierVerification = await verifyTypedSignature({
    expectedSigner: normalizedCourier,
    domain: legacyTypedData.domain,
    types: legacyTypedData.types,
    message: legacyTypedData.message,
    signature: body.courierSignature,
  })

  if (!courierVerification.valid) {
    return NextResponse.json({ error: "Courier signature invalid" }, { status: 400 })
  }

  const deadlineMinutes = Number(process.env.PICKUP_SIGNATURE_TTL_MINUTES ?? "10")
  const deadline = new Date(Date.now() + deadlineMinutes * 60 * 1000)
  const sessionUid = randomBytes(16).toString("hex")
  const courierNonce = randomNonce()
  const supplierNonce = randomNonce()

  const payload = {
    kind: kindInput,
    shipmentHash: body.shipmentHash,
    locationHash: contextHash,
    claimedTs: body.claimedTs,
    currentLat: body.currentLat,
    currentLon: body.currentLon,
    pickupLat: shipment.pickupLat,
    pickupLon: shipment.pickupLon,
    dropLat: shipment.dropLat ?? null,
    dropLon: shipment.dropLon ?? null,
    targetDistance: targetDistanceMeters,
    shipmentNo: shipment.shipmentNo,
    chainOrderId: body.chainOrderId,
    radiusM: radiusMeters,
    notes: body.notes ?? null,
    courierSignature: body.courierSignature,
    distanceMeters: sessionDistanceMeters,
  }

  const session = await prisma.signingSession.create({
    data: {
      sessionUid,
      shipmentId: shipment.id,
      orderId: shipment.orderId,
      chainOrderId: body.chainOrderId,
      kind: kindInput,
      courier: normalizedCourier,
      supplier: counterpartyAddress,
      deadline,
      status: statusLabel,
      courierNonce,
      supplierNonce,
      contextHash,
      courierSignature: body.courierSignature,
      payload: JSON.stringify(payload),
    },
  })

  const tokenPayload = {
    sid: session.sessionUid,
    role: (kindInput === "pickup" ? "supplier" : "buyer") as "supplier" | "buyer",
    jti: randomBytes(12).toString("hex"),
    exp: Math.floor(deadline.getTime() / 1000),
  }

  const token = createMagicLinkToken(tokenPayload)
  const tokenHash = hashToken(token)

  await prisma.magicLink.create({
    data: {
      tokenHash,
      role: tokenPayload.role,
      jti: tokenPayload.jti,
      expiresAt: deadline,
      sessionId: session.id,
    },
  })

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? ""
  const signingLink = `${origin.replace(/\/$/, "")}/sign/${session.sessionUid}?t=${encodeURIComponent(token)}`

  return NextResponse.json({
    ok: true,
    sessionId: session.sessionUid,
    link: signingLink,
    supplierLink: signingLink,
    role: tokenPayload.role,
    kind: kindInput,
    deadline: deadline.toISOString(),
  })
}
