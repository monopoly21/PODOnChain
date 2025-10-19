import { ethers } from "ethers"

const REQUIRED_ENV = [
  "RPC_URL",
  "ESCROW_PYUSD_ADDRESS",
  "ORDER_REGISTRY_ADDRESS",
  "SHIPMENT_REGISTRY_ADDRESS",
  "DELIVERY_ORACLE_PRIVATE_KEY",
]

function ensureEnv() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      throw new Error(`${key} is not configured`)
    }
  }
}

export const escrowAbi = [
  "function fund(uint256 orderId, uint256 amount) external",
  "function escrowed(uint256 orderId) view returns (uint256)",
]

export const orderRegistryAbi = [
  "function createOrder(uint256 orderId, address buyer, address supplier, uint256 amount) external",
  "function markFunded(uint256 orderId) external",
  "function markDisputed(uint256 orderId) external",
  "function releaseEscrow(uint256 orderId) external",
  "function releaseEscrowFromShipment(uint256 orderId, address courier, uint256 courierReward) external",
  "function releaseEscrowWithReward(uint256 orderId, address courier, uint256 courierReward, bytes32 shipmentId, string lineItems, string metadataUri) external",
  "function deliveryOracle() view returns (address)",
  "function orders(uint256) view returns (address buyer, address supplier, uint256 amount, uint8 status)",
]

export const shipmentRegistryAbi = [
  "function registerShipment(bytes32 shipmentId, uint256 orderId, address buyer, address supplier, address courier) external",
  "function updateCourier(bytes32 shipmentId, address courier) external",
  "function confirmPickup((bytes32,uint256,bytes32,uint64) approval, bytes courierSignature, bytes supplierSignature) external",
  "function confirmDrop((bytes32,uint256,bytes32,uint64,uint256) approval, bytes courierSignature, bytes buyerSignature) external",
  "function markEvent(uint256 orderId, uint8 milestone, string geohash, bytes32 proofHash) external",
  "event PickupApproved(bytes32 indexed shipmentId, uint256 indexed orderId, bytes32 locationHash, uint64 claimedTimestamp)",
  "event DropApproved(bytes32 indexed shipmentId, uint256 indexed orderId, bytes32 locationHash, uint64 claimedTimestamp, uint256 distanceMeters, uint256 courierReward)",
  "event ShipmentEvent(uint256 indexed orderId, uint8 indexed milestone, string geohash, bytes32 proofHash, uint256 blockTimestamp)",
]

let cachedProvider: ethers.JsonRpcProvider | null = null
let cachedSigner: ethers.Wallet | null = null

export function getProvider() {
  if (!cachedProvider) {
    ensureEnv()
    cachedProvider = new ethers.JsonRpcProvider(process.env.RPC_URL)
  }
  return cachedProvider
}

export function getEscrowContract() {
  return new ethers.Contract(process.env.ESCROW_PYUSD_ADDRESS!, escrowAbi, getProvider())
}

export function getOrderRegistryContract() {
  return new ethers.Contract(process.env.ORDER_REGISTRY_ADDRESS!, orderRegistryAbi, getProvider())
}

export function getShipmentRegistryContract() {
  return new ethers.Contract(process.env.SHIPMENT_REGISTRY_ADDRESS!, shipmentRegistryAbi, getProvider())
}

export function getDeliveryOracleSigner() {
  if (!cachedSigner) {
    ensureEnv()
    cachedSigner = new ethers.Wallet(process.env.DELIVERY_ORACLE_PRIVATE_KEY!, getProvider())
  }
  return cachedSigner
}

export function getOrderRegistryWithSigner() {
  return getOrderRegistryContract().connect(getDeliveryOracleSigner())
}
