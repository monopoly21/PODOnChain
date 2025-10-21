import { keccak256, toUtf8Bytes } from "ethers"

export function deriveShipmentRegistryId(shipmentId: string): string {
  const value = shipmentId?.toString().trim()
  if (!value) {
    throw new Error("Shipment identifier required to derive registry id")
  }
  return keccak256(toUtf8Bytes(value))
}

export function parseChainOrderId(raw: unknown): bigint {
  if (raw === null || raw === undefined) {
    throw new Error("Missing on-chain order id")
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) {
      throw new Error("Missing on-chain order id")
    }
    try {
      return trimmed.startsWith("0x") ? BigInt(trimmed) : BigInt(trimmed)
    } catch {
      throw new Error("Invalid on-chain order id")
    }
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new Error("Invalid on-chain order id")
    }
    return BigInt(Math.floor(raw))
  }
  if (typeof raw === "bigint") {
    return raw
  }
  if (typeof raw === "object") {
    const hex = (raw as { hex?: unknown }).hex
    if (typeof hex === "string") {
      try {
        return BigInt(hex)
      } catch {
        throw new Error("Invalid on-chain order id")
      }
    }
  }
  throw new Error("Unsupported on-chain order id format")
}
