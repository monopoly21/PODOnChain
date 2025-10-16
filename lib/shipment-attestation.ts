import { AbiCoder, keccak256, type TypedDataDomain, type TypedDataField } from "ethers"

const coder = AbiCoder.defaultAbiCoder()

const SCALE = 1_000_000n

export type PickupTypedMessage = {
  shipmentId: string
  orderId: string
  courier: string
  supplier: string
  claimedTs: string
  locationHash: string
}

export type DropTypedMessage = {
  shipmentId: string
  orderId: string
  courier: string
  buyer: string
  claimedTs: string
  locationHash: string
  distanceMeters: string
}

export type PickupTypedMessageForVerify = Omit<PickupTypedMessage, "claimedTs"> & { claimedTs: bigint }
export type DropTypedMessageForVerify = Omit<DropTypedMessage, "claimedTs" | "distanceMeters"> & {
  claimedTs: bigint
  distanceMeters: bigint
}

export type ShipmentTypedData<TMessage> = {
  domain: TypedDataDomain
  types: Record<string, TypedDataField[]>
  primaryType: string
  message: TMessage
  locationHash: string
}

export type ShipmentTypedDataWithVerify<TMessage, TVerify> = ShipmentTypedData<TMessage> & {
  verifyMessage: TVerify
}

export const PICKUP_TYPES: Record<string, TypedDataField[]> = {
  PickupApproval: [
    { name: "shipmentId", type: "bytes32" },
    { name: "orderId", type: "uint256" },
    { name: "locationHash", type: "bytes32" },
    { name: "claimedTs", type: "uint64" },
  ],
}

export const DROP_TYPES: Record<string, TypedDataField[]> = {
  DropApproval: [
    { name: "shipmentId", type: "bytes32" },
    { name: "orderId", type: "uint256" },
    { name: "locationHash", type: "bytes32" },
    { name: "claimedTs", type: "uint64" },
    { name: "distanceMeters", type: "uint256" },
  ],
}

export function buildDomain(verifyingContract: string, chainId: number): TypedDataDomain {
  if (!verifyingContract) {
    throw new Error("Shipment attestation verifying contract is required")
  }
  if (!Number.isFinite(chainId)) {
    throw new Error("Shipment attestation chainId is invalid")
  }
  return {
    name: "PODxShipment",
    version: "1",
    verifyingContract,
    chainId,
  }
}

export function computeLocationHash(latitude: number, longitude: number, claimedTs: bigint): string {
  const latScaled = BigInt(Math.round(latitude * Number(SCALE)))
  const lonScaled = BigInt(Math.round(longitude * Number(SCALE)))
  return keccak256(coder.encode(["int256", "int256", "uint64"], [latScaled, lonScaled, claimedTs]))
}

export function buildPickupTypedData(params: {
  verifyingContract: string
  chainId: number
  shipmentId: string
  orderId: string
  courier: string
  supplier: string
  claimedTs: number
  latitude: number
  longitude: number
}): ShipmentTypedDataWithVerify<PickupTypedMessage, PickupTypedMessageForVerify> {
  const claimed = BigInt(Math.floor(params.claimedTs))
  const locationHash = computeLocationHash(params.latitude, params.longitude, claimed)
  const domain = buildDomain(params.verifyingContract, params.chainId)
  const message: PickupTypedMessage = {
    shipmentId: params.shipmentId,
    orderId: params.orderId,
    courier: params.courier,
    supplier: params.supplier,
    claimedTs: claimed.toString(),
    locationHash,
  }
  const verifyMessage: PickupTypedMessageForVerify = {
    shipmentId: params.shipmentId,
    orderId: params.orderId,
    courier: params.courier,
    supplier: params.supplier,
    claimedTs: claimed,
    locationHash,
  }
  return {
    domain,
    types: PICKUP_TYPES,
    primaryType: "PickupApproval",
    message,
    verifyMessage,
    locationHash,
  }
}

export function buildDropTypedData(params: {
  verifyingContract: string
  chainId: number
  shipmentId: string
  orderId: string
  courier: string
  buyer: string
  claimedTs: number
  latitude: number
  longitude: number
  distanceMeters: number
}): ShipmentTypedDataWithVerify<DropTypedMessage, DropTypedMessageForVerify> {
  const claimed = BigInt(Math.floor(params.claimedTs))
  const locationHash = computeLocationHash(params.latitude, params.longitude, claimed)
  const distance = BigInt(Math.max(0, Math.floor(params.distanceMeters)))
  const domain = buildDomain(params.verifyingContract, params.chainId)
  const message: DropTypedMessage = {
    shipmentId: params.shipmentId,
    orderId: params.orderId,
    courier: params.courier,
    buyer: params.buyer,
    claimedTs: claimed.toString(),
    locationHash,
    distanceMeters: distance.toString(),
  }
  const verifyMessage: DropTypedMessageForVerify = {
    shipmentId: params.shipmentId,
    orderId: params.orderId,
    courier: params.courier,
    buyer: params.buyer,
    claimedTs: claimed,
    locationHash,
    distanceMeters: distance,
  }
  return {
    domain,
    types: DROP_TYPES,
    primaryType: "DropApproval",
    message,
    verifyMessage,
    locationHash,
  }
}
