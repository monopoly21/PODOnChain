import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { buildPickupTypedData, buildDropTypedData } from "@/lib/shipment-attestation"
import { hashToken, verifyMagicLinkToken } from "@/lib/signing-session"
import { verifyTypedSignature } from "@/lib/verify-signature"
import { geodesicDistance } from "@/lib/geo"

const PICKUP_SIGNING_VERIFIER =
  process.env.PICKUP_SIGNING_VERIFIER ?? "0x0000000000000000000000000000000000000000"
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "0")
const AGENT_BRIDGE_URL = process.env.AGENT_BRIDGE_URL || "http://localhost:8200"
const DEFAULT_RADIUS_METERS = Number.isFinite(Number(process.env.MAX_DISTANCE_IN_METERS))
  ? Number(process.env.MAX_DISTANCE_IN_METERS)
  : 2000

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

  const milestonePayload =
    session.kind === "drop"
      ? {
          shipment_id: session.shipmentId,
          shipment_no: payloadData.shipmentNo ?? null,
          order_id: session.orderId,
          milestone: "Delivered",
          courier_wallet: session.courier,
          latitude: payloadData.currentLat ?? null,
          longitude: payloadData.currentLon ?? null,
          claimed_ts: payloadData.claimedTs,
          radius_m: radiusMeters,
          shipment_hash: payloadData.shipmentHash,
          location_hash: typedData.locationHash,
          courier_signature: session.courierSignature,
          buyer_signature: body.signature,
          chain_order_id: session.chainOrderId,
          notes: payloadData.notes ?? null,
          distance_meters: payloadData.distanceMeters ?? null,
          drop_lat: payloadData.dropLat ?? null,
          drop_lon: payloadData.dropLon ?? null,
          pickup_lat: payloadData.pickupLat ?? null,
          pickup_lon: payloadData.pickupLon ?? null,
        }
      : {
          shipment_id: session.shipmentId,
          shipment_no: payloadData.shipmentNo ?? null,
          order_id: session.orderId,
          milestone: "Pickup",
          courier_wallet: session.courier,
          latitude: payloadData.currentLat ?? null,
          longitude: payloadData.currentLon ?? null,
          claimed_ts: payloadData.claimedTs,
          radius_m: radiusMeters,
          shipment_hash: payloadData.shipmentHash,
          location_hash: typedData.locationHash,
          courier_signature: session.courierSignature,
          supplier_signature: body.signature,
          chain_order_id: session.chainOrderId,
          notes: payloadData.notes ?? null,
          pickup_lat: payloadData.pickupLat ?? null,
          pickup_lon: payloadData.pickupLon ?? null,
        }

  const agentResponse = await fetch(`${AGENT_BRIDGE_URL}/shipments/milestone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(milestonePayload),
  })

  if (!agentResponse.ok) {
    const detail = await agentResponse.json().catch(() => null)
    return NextResponse.json(
      { error: `${session.kind === "drop" ? "Drop" : "Pickup"} verification failed`, details: detail ?? undefined },
      { status: agentResponse.status },
    )
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

  const detail = await agentResponse.json().catch(() => ({ escrow_tx: null }))

  return NextResponse.json({
    ok: true,
    escrowTx: detail?.escrow_tx ?? null,
  })
}
