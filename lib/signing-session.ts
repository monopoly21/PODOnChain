import { createHmac, createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "crypto"
import { keccak256, toUtf8Bytes, zeroPadBytes, hexlify } from "ethers"

const DOMAIN_NAME = "PickupSign"
const DOMAIN_VERSION = "1"
const DEFAULT_VERIFIER = "0x0000000000000000000000000000000000000000"

export type PickupRole = "courier" | "supplier"
export type SigningSessionRole = "courier" | "supplier" | "buyer"

type BuildPickupTypedDataParams = {
  chainId: number
  verifyingContract?: string
  orderId: string
  signingSessionId: string
  role: PickupRole
  courier: string
  supplier: string
  deadline: number
  nonce: string
  contextHash: string
}

export function buildPickupTypedData({
  chainId,
  verifyingContract,
  orderId,
  signingSessionId,
  role,
  courier,
  supplier,
  deadline,
  nonce,
  contextHash,
}: BuildPickupTypedDataParams) {
  const orderHash = keccak256(toUtf8Bytes(orderId))
  const sessionBytes = toBytes32(signingSessionId)
  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: verifyingContract ?? DEFAULT_VERIFIER,
  }

  const types = {
    PickupAttestation: [
      { name: "orderId", type: "bytes32" },
      { name: "signingSessionId", type: "bytes32" },
      { name: "role", type: "string" },
      { name: "courier", type: "address" },
      { name: "supplier", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "contextHash", type: "bytes32" },
    ],
  } as const

  const message = {
    orderId: orderHash,
    signingSessionId: sessionBytes,
    role,
    courier,
    supplier,
    deadline: BigInt(deadline),
    nonce: toBytes32(nonce),
    contextHash,
  }

  return {
    domain,
    types,
    primaryType: "PickupAttestation" as const,
    message,
  }
}

function toBytes32(value: string): string {
  if (value.startsWith("0x")) {
    const stripped = value.slice(2)
    const buf = Buffer.from(stripped, "hex")
    return hexlify(zeroPadBytes(buf, 32))
  }
  const buf = Buffer.from(value, "utf8")
  return hexlify(zeroPadBytes(buf, 32))
}

export type MagicLinkPayload = {
  sid: string
  role: SigningSessionRole
  jti: string
  exp: number
}

function getSecret(): string {
  const secret = process.env.SIGNING_SESSION_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error("SIGNING_SESSION_SECRET (or NEXTAUTH_SECRET) must be configured for signing sessions")
  }
  return secret
}

export function createMagicLinkToken(payload: MagicLinkPayload): string {
  const secret = getSecret()
  const json = JSON.stringify(payload)
  const body = Buffer.from(json).toString("base64url")
  const sig = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifyMagicLinkToken(token: string): MagicLinkPayload | null {
  const secret = getSecret()
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  if (!timingSafeEqual(expected, sig)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MagicLinkPayload
    if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) {
      return null
    }
    if (payload.role !== "courier" && payload.role !== "supplier" && payload.role !== "buyer") {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export function randomNonce(): string {
  return `0x${randomBytes(16).toString("hex")}`
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  try {
    return nodeTimingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}
