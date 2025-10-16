export type ProductRecord = {
  owner: string
  skuId: string
  name: string
  unit: string
  minThreshold: number
  targetStock: number
  updatedAt: string
}

export type LocationRecord = {
  owner: string
  locationId: string
  name: string
  address: {
    line1: string
    city: string
    state: string
    country: string
    postal: string
  }
  lat: number | null
  lon: number | null
  timezone: string
  updatedAt: string
}

export type SupplierPriceRecord = {
  owner: string
  skuId: string
  unitPrice: string
  currency: string
  leadDays: number
  minQty: number
}

export type CourierAllowRecord = {
  owner: string
  courierWallet: string
  label: string | null
  updatedAt: string
}

export type OrderRecord = {
  id: string
  buyer: string
  supplier: string
  status: string
  totalAmount: number
  metadata: any
  createdAt: string
  updatedAt: string
}

export type ShipmentRecord = {
  id: string
  orderId: string
  shipmentNo: number
  supplier: string
  buyer: string
  pickupLat: number | null
  pickupLon: number | null
  dropLat: number | null
  dropLon: number | null
  dueBy: string
  status: string
  assignedCourier: string | null
  metadata: any
  createdAt: string
  updatedAt: string
}

async function handleJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    try {
      const data = JSON.parse(text)
      throw new Error(typeof data === "string" ? data : JSON.stringify(data))
    } catch (error) {
      throw new Error(text || `Request failed with status ${response.status}`)
    }
  }
  return response.json() as Promise<T>
}

export async function fetchBuyerProducts() {
  return handleJson<ProductRecord[]>(await fetch("/api/me/catalog/products", { cache: "no-store" }))
}

export async function fetchBuyerLocations() {
  return handleJson<LocationRecord[]>(await fetch("/api/me/catalog/locations", { cache: "no-store" }))
}

export async function fetchSupplierPrices() {
  return handleJson<SupplierPriceRecord[]>(await fetch("/api/me/catalog/prices", { cache: "no-store" }))
}

export async function fetchSupplierAllowlist() {
  return handleJson<CourierAllowRecord[]>(await fetch("/api/me/catalog/couriers", { cache: "no-store" }))
}

export async function addCourierToAllowlist(payload: { courierWallet: string; label?: string | null }) {
  return handleJson(
    await fetch("/api/me/catalog/couriers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  )
}

export async function fetchPublicPrices(wallet: string) {
  const response = await fetch(`/api/catalog/prices?wallet=${wallet}`)
  return handleJson<SupplierPriceRecord[]>(response)
}

export async function upsertBuyerProduct(payload: {
  skuId: string
  name: string
  unit?: string
  minThreshold?: number
  targetStock?: number
}) {
  return handleJson(
    await fetch("/api/me/catalog/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  )
}

export async function upsertSupplierPrice(payload: {
  skuId: string
  unitPrice: number
  currency?: string
  leadDays?: number
  minQty?: number
}) {
  return handleJson(
    await fetch("/api/me/catalog/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  )
}

export async function createOrder(payload: any) {
  return handleJson(await fetch("/api/me/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }))
}

export async function fetchOrders(role: "buyer" | "supplier") {
  return handleJson<OrderRecord[]>(await fetch(`/api/me/orders?role=${role}`, { cache: "no-store" }))
}

export async function updateOrderStatus(
  orderId: string,
  payload: {
    status: string
    pickupLat?: number | null
    pickupLon?: number | null
    escrowTxHash?: string
    approvalTxHash?: string
  },
) {
  return handleJson<OrderRecord>(
    await fetch(`/api/me/orders/${orderId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  )
}

export async function createShipment(payload: any) {
  return handleJson(await fetch("/api/me/shipments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }))
}

export async function fetchShipments(scope: "supplier" | "buyer" | "courier") {
  return handleJson<ShipmentRecord[]>(await fetch(`/api/me/shipments?scope=${scope}`, { cache: "no-store" }))
}

export async function assignShipment(shipmentId: string, courier: string) {
  return handleJson(
    await fetch(`/api/me/shipments/${shipmentId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courier }),
    }),
  )
}

export async function claimShipment(shipmentId: string) {
  return handleJson(
    await fetch(`/api/courier/shipments/${shipmentId}/claim`, {
      method: "POST",
    }),
  )
}
