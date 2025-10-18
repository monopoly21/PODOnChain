import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import {
  buildPickupTypedData as buildLegacyPickupTypedData,
  buildDropTypedData as buildLegacyDropTypedData,
} from "@/lib/shipment-attestation"
import { hashToken, verifyMagicLinkToken } from "@/lib/signing-session"

const PICKUP_SIGNING_VERIFIER =
  process.env.PICKUP_SIGNING_VERIFIER ?? "0x0000000000000000000000000000000000000000"
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "0")

export async function GET(
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
  if (payload.sid !== sessionId) {
    return NextResponse.json({ error: "Token does not match session" }, { status: 403 })
  }

  const session = await prisma.signingSession.findFirst({
    where: { sessionUid: sessionId },
  })
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }
  if (!session.kind) {
    return NextResponse.json({ error: "Session missing kind" }, { status: 500 })
  }

  const expectedRole = session.kind === "drop" ? "buyer" : "supplier"

  if (payload.role !== expectedRole) {
    return NextResponse.json({ error: "Token role invalid" }, { status: 403 })
  }

  const expectedStatus = session.kind === "drop" ? "PENDING_BUYER" : "PENDING_SUPPLIER"

  if (session.status !== expectedStatus) {
    return NextResponse.json({ error: "Session no longer available" }, { status: 409 })
  }

  const tokenHash = hashToken(token)
  const link = await prisma.magicLink.findUnique({ where: { tokenHash } })
  if (!link || link.usedAt) {
    return NextResponse.json({ error: "Link already used" }, { status: 409 })
  }
  if (link.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Link expired" }, { status: 403 })
  }

  let parsedPayload: Record<string, unknown> | null = null
  try {
    parsedPayload = session.payload ? (JSON.parse(session.payload) as Record<string, unknown>) : null
  } catch {
    parsedPayload = null
  }

  if (
    !parsedPayload ||
    typeof parsedPayload.shipmentHash !== "string" ||
    typeof parsedPayload.chainOrderId !== "string" ||
    typeof parsedPayload.claimedTs !== "number" ||
    typeof parsedPayload.currentLat !== "number" ||
    typeof parsedPayload.currentLon !== "number"
  ) {
    return NextResponse.json({ error: "Session payload incomplete" }, { status: 500 })
  }

  if (session.kind === "drop" && typeof parsedPayload.distanceMeters !== "number") {
    return NextResponse.json({ error: "Session payload missing distance" }, { status: 500 })
  }

  const typedData =
    session.kind === "drop"
      ? buildLegacyDropTypedData({
          verifyingContract: PICKUP_SIGNING_VERIFIER,
          chainId: CHAIN_ID,
          shipmentId: parsedPayload.shipmentHash,
          orderId: parsedPayload.chainOrderId,
          courier: session.courier,
          buyer: session.supplier,
          claimedTs: parsedPayload.claimedTs,
          latitude: parsedPayload.currentLat,
          longitude: parsedPayload.currentLon,
          distanceMeters: typeof parsedPayload.distanceMeters === "number" ? parsedPayload.distanceMeters : 0,
        })
      : buildLegacyPickupTypedData({
          verifyingContract: PICKUP_SIGNING_VERIFIER,
          chainId: CHAIN_ID,
          shipmentId: parsedPayload.shipmentHash,
          orderId: parsedPayload.chainOrderId,
          courier: session.courier,
          supplier: session.supplier,
          claimedTs: parsedPayload.claimedTs,
          latitude: parsedPayload.currentLat,
          longitude: parsedPayload.currentLon,
        })

  const safeTypedData = {
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: { ...typedData.message },
  }

  return NextResponse.json({
    session: {
      shipmentId: session.shipmentId,
      orderId: String(session.orderId),
      courier: session.courier,
      supplier: session.supplier,
      deadline: session.deadline.toISOString(),
      payload: parsedPayload,
      role: expectedRole,
      kind: session.kind,
    },
    typedData: safeTypedData,
  })
}
