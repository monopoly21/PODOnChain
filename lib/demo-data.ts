import type { Order, ShipmentEvent } from "./types"

export function demoKPIs() {
  return {
    openOrders: 4,
    inTransit: 3,
    delivered: 8,
    disputed: 1,
    onTimePct: 92,
    escrowFunded: 48250,
  }
}

export function demoOrders(): Order[] {
  return [
    {
      id: 101,
      chain: "sepolia",
      skuId: "SKU-42",
      qty: 250,
      unitPrice: 10,
      supplier: "Supplier A",
      status: "Shipped",
      escrow: "Funded",
      txHash: "0x1234...abcd",
    },
    {
      id: 102,
      chain: "sepolia",
      skuId: "SKU-17",
      qty: 120,
      unitPrice: 15,
      supplier: "Supplier B",
      status: "Created",
      escrow: "Unfunded",
    },
    {
      id: 103,
      chain: "sepolia",
      skuId: "SKU-7",
      qty: 500,
      unitPrice: 6,
      supplier: "Supplier A",
      status: "Delivered",
      escrow: "Funded",
      txHash: "0x9876...beef",
    },
    {
      id: 104,
      chain: "sepolia",
      skuId: "SKU-88",
      qty: 60,
      unitPrice: 20,
      supplier: "Supplier C",
      status: "Disputed",
      escrow: "Funded",
    },
  ]
}

export function demoShipments(): ShipmentEvent[] {
  const now = Date.now()
  return [
    {
      id: "ev-1",
      chain: "sepolia",
      orderId: 101,
      label: "PickedUp",
      blockTime: now - 1000 * 60 * 60 * 8,
      claimedTs: now - 1000 * 60 * 60 * 8 - 30_000,
      geohash: "tdr5z7q",
      payloadHash: "0x7a3b6f2a1d4c9e0087ff1122aa33bb44cc55dd66ee77ff88aa99bb00ccddeeff",
      verified: true,
      tx: "0xabcde12345",
    },
    {
      id: "ev-2",
      chain: "sepolia",
      orderId: 101,
      label: "InTransit",
      blockTime: now - 1000 * 60 * 60 * 4,
      claimedTs: now - 1000 * 60 * 60 * 4,
      geohash: "tdr5ztp",
      payloadHash: "0x91d0e4a5b6c7d8e9f00112233445566778899aabbccddeeff00112233445566",
      verified: true,
      tx: "0xdef456789",
    },
    {
      id: "ev-3",
      chain: "sepolia",
      orderId: 103,
      label: "Delivered",
      blockTime: now - 1000 * 60 * 30,
      claimedTs: now - 1000 * 60 * 32,
      geohash: "tdr60mk",
      payloadHash: "0x0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221100",
      verified: true,
      tx: "0xfeedface",
    },
  ]
}

export const demoSkus = [
  { id: "SKU-42", name: "Widget Pro", unitPrice: 10, leadDays: 3 },
  { id: "SKU-17", name: "Gadget Mini", unitPrice: 15, leadDays: 5 },
  { id: "SKU-7", name: "Bolt Pack", unitPrice: 6, leadDays: 2 },
]
