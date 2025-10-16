export type OrderStatus =
  | "Created"
  | "Approved"
  | "Funded"
  | "InFulfillment"
  | "Shipped"
  | "Delivered"
  | "Disputed"
  | "Resolved"
  | "Cancelled"
export type EscrowState = "Unfunded" | "Funded" | "Released" | "Refunded"

export type Order = {
  id: number
  chain?: string
  skuId: string
  qty: number
  unitPrice: number
  supplier: string
  status: OrderStatus
  escrow: EscrowState
  txHash?: string
}

export type ShipmentEvent = {
  id: string
  chain?: string
  orderId: number
  label: "PickedUp" | "InTransit" | "OutForDelivery" | "Delivered"
  blockTime: number
  claimedTs: number
  geohash: string
  payloadHash: string
  verified: boolean
  tx?: string
}
