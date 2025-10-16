"use client"

import Link from "next/link"
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useActiveAccount, useSendTransaction } from "thirdweb/react"
import { getContract, prepareContractCall, readContract } from "thirdweb"
import { sepolia } from "thirdweb/chains"
import { getAddress } from "viem"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DashboardTabs } from "@/components/DashboardTabs"
import { AgentChat, type AgentChatConfig } from "@/components/AgentChat"
import { cn } from "@/lib/utils"
import {
  claimShipment,
  createOrder,
  createShipment,
  fetchBuyerLocations,
  fetchBuyerProducts,
  fetchOrders,
  fetchPublicPrices,
  fetchShipments,
  fetchSupplierAllowlist,
  fetchSupplierPrices,
  upsertBuyerProduct,
  upsertSupplierPrice,
  updateOrderStatus,
  type OrderRecord,
  type ProductRecord,
  type ShipmentRecord,
  type SupplierPriceRecord,
} from "@/lib/api-client"
import { client } from "@/lib/thirdweb"
import { toast } from "@/components/ui/use-toast"

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "allowance", type: "uint256", internalType: "uint256" },
      { name: "needed", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address", internalType: "address" },
      { name: "balance", type: "uint256", internalType: "uint256" },
      { name: "needed", type: "uint256", internalType: "uint256" },
    ],
  },
]

const escrowContractAbi = [
  {
    type: "function",
    name: "fund",
    inputs: [
      { name: "orderId", type: "uint256", internalType: "uint256" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "allowance", type: "uint256", internalType: "uint256" },
      { name: "needed", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address", internalType: "address" },
      { name: "balance", type: "uint256", internalType: "uint256" },
      { name: "needed", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "function",
    name: "escrowed",
    inputs: [{ name: "orderId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
]

const orderRegistryContractAbi = [
  {
    type: "function",
    name: "createOrder",
    inputs: [
      { name: "orderId", type: "uint256", internalType: "uint256" },
      { name: "buyer", type: "address", internalType: "address" },
      { name: "supplier", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "markFunded",
    inputs: [{ name: "orderId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "releaseEscrow",
    inputs: [{ name: "orderId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "releaseEscrowFromShipment",
    inputs: [
      { name: "orderId", type: "uint256", internalType: "uint256" },
      { name: "courier", type: "address", internalType: "address" },
      { name: "courierReward", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "orders",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "buyer", type: "address", internalType: "address" },
      { name: "supplier", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "status", type: "uint8", internalType: "uint8" },
    ],
    stateMutability: "view",
  },
]

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const PYUSD_ADDRESS = process.env.NEXT_PUBLIC_PYUSD_ADDRESS || ""
const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_PYUSD_ADDRESS || ""
const ORDER_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_ORDER_REGISTRY_ADDRESS || ""
const PYUSD_DECIMALS = Number(process.env.NEXT_PUBLIC_PYUSD_DECIMALS || 6)

const AGENT_CHAT_CONFIGS: AgentChatConfig[] = [
  {
    key: "inventory",
    title: "Inventory assistant",
    description: "Check stock levels and reorder thresholds for SKUs you manage.",
    example: "stock SKU-123 supplier 0xsupplier…",
    fields: [
      {
        name: "skuId",
        label: "SKU",
        placeholder: "SKU-123",
      },
      {
        name: "supplierWallet",
        label: "Supplier wallet",
        placeholder: "0xsupplier…",
        optional: true,
        lowercase: true,
        helpText: "Optional override if you want to query a specific supplier.",
      },
    ],
    defaultMessage: "stock",
    messagePlaceholder: "Ask about inventory for a SKU…",
    messageHelper: "Leave the message blank to use the SKU details above.",
    buildMessage: ({ message, fields }) => {
      const trimmed = message.trim()
      if (trimmed) return trimmed
      if (!fields.skuId?.trim()) return ""
      const supplierPart = fields.supplierWallet?.trim() ? ` supplier ${fields.supplierWallet.trim()}` : ""
      return `stock ${fields.skuId.trim()}${supplierPart}`
    },
  },
  {
    key: "po",
    title: "Purchase order assistant",
    description: "Review the latest order status before approvals.",
    example: "status order cmgo3801a0…",
    fields: [
      {
        name: "orderId",
        label: "Order ID",
        placeholder: "cmgo3801a0…",
      },
    ],
    messagePlaceholder: "Ask about an order status…",
    messageHelper: "Leave blank to send 'status order &lt;orderId&gt;'. Order IDs look like cmgo3801a0….",
    buildMessage: ({ message, fields }) => {
      const trimmed = message.trim()
      if (trimmed) return trimmed
      if (!fields.orderId?.trim()) return ""
      return `status order ${fields.orderId.trim()}`
    },
  },
  {
    key: "supplier",
    title: "Supplier assistant",
    description: "Confirm orders when you begin fulfillment.",
    example: "confirm order cmgo3801a0…",
    fields: [
      {
        name: "orderId",
        label: "Order ID",
        placeholder: "cmgo3801a0…",
      },
    ],
    defaultMessage: "confirm order",
    messagePlaceholder: "Confirm an order…",
    sendLabel: "Confirm order",
    messageHelper: "Leave blank to send 'confirm order &lt;orderId&gt;'. Order IDs look like cmgo3801a0….",
    buildMessage: ({ message, fields }) => {
      const trimmed = message.trim()
      if (trimmed) return trimmed
      if (!fields.orderId?.trim()) return ""
      return `confirm order ${fields.orderId.trim()}`
    },
  },
  {
    key: "shipment",
    title: "Shipment assistant",
    description: "Check shipment assignments and delivery progress.",
    example: "shipment shp_123",
    fields: [
      {
        name: "shipmentId",
        label: "Shipment ID",
        placeholder: "shp_123",
      },
    ],
    defaultMessage: "shipment",
    messagePlaceholder: "Ask about a shipment…",
    messageHelper: "Leave blank to send 'shipment &lt;id&gt;'.",
    buildMessage: ({ message, fields }) => {
      const trimmed = message.trim()
      if (trimmed) return trimmed
      if (!fields.shipmentId?.trim()) return ""
      return `shipment ${fields.shipmentId.trim()}`
    },
  },
  {
    key: "payments",
    title: "Payments assistant",
    description: "Release escrow once delivery is complete.",
    example: "release order cmgo3801a0…",
    fields: [
      {
        name: "orderId",
        label: "Order ID",
        placeholder: "cmgo3801a0…",
      },
    ],
    defaultMessage: "release order",
    messagePlaceholder: "Trigger an escrow release…",
    messageHelper:
      "Only the buyer can release escrow. Leave blank to send 'release order &lt;orderId&gt;'. Order IDs look like cmgo3801a0….",
    sendLabel: "Release escrow",
    buildMessage: ({ message, fields }) => {
      const trimmed = message.trim()
      if (trimmed) return trimmed
      if (!fields.orderId?.trim()) return ""
      return `release order ${fields.orderId.trim()}`
    },
  },
]
function toTokenAmount(amount: number, decimals: number) {
  const fixed = amount.toFixed(decimals)
  const [whole, fraction = ""] = fixed.split(".")
  return BigInt((whole || "0") + fraction.padEnd(decimals, "0"))
}

function extractAddress(result: any) {
  if (!result) return undefined
  if (typeof result === "string") return result
  if (typeof result.buyer === "string") return result.buyer
  if (Array.isArray(result) && typeof result[0] === "string") return result[0]
  return undefined
}

function extractStatus(result: any) {
  if (!result) return undefined
  if (typeof result.status !== "undefined") return result.status
  if (Array.isArray(result) && typeof result[3] !== "undefined") return result[3]
  return undefined
}

function toBigInt(value: any): bigint {
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  if (typeof value === "string" && value.trim().length) return BigInt(value)
  return 0n
}

function getFriendlyTxError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message || error.toString()
      : typeof error === "string"
        ? error
        : "Unknown error"
  if (message.includes("ERC20InsufficientBalance")) {
    return "PYUSD transfer failed: wallet balance is too low."
  }
  if (message.includes("ERC20InsufficientAllowance")) {
    return "PYUSD transfer failed: increase the allowance for the escrow."
  }
  if (message.includes("AbiErrorSignatureNotFoundError")) {
    return "PYUSD transfer failed. Double-check balance and allowance, then retry."
  }
  return message
}

const ORDER_STATUS_BADGE: Record<string, string> = {
  Created: "bg-muted text-foreground",
  Approved: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  InFulfillment: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  Funded: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  Shipped: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
  Delivered: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  Disputed: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
  Resolved: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
  Cancelled: "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
}

export default function DashboardPage() {
  const account = useActiveAccount()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = useMemo(() => {
    const value = searchParams.get("tab")
    return value === "supplier" || value === "courier" ? value : "buyer"
  }, [searchParams])
  const [tab, setTab] = useState<"buyer" | "supplier" | "courier">(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const [buyerProducts, setBuyerProducts] = useState<ProductRecord[]>([])
  const [buyerLocations, setBuyerLocations] = useState<any[]>([])
  const [buyerOrders, setBuyerOrders] = useState<OrderRecord[]>([])

  const [supplierPrices, setSupplierPrices] = useState<SupplierPriceRecord[]>([])
  const [supplierAllowlist, setSupplierAllowlist] = useState<{ courierWallet: string; label: string | null }[]>([])
  const [supplierOrders, setSupplierOrders] = useState<OrderRecord[]>([])
  const [supplierShipments, setSupplierShipments] = useState<ShipmentRecord[]>([])

  const [courierShipments, setCourierShipments] = useState<ShipmentRecord[]>([])

  const [supplierAddressInput, setSupplierAddressInput] = useState("")
  const [publicPrices, setPublicPrices] = useState<SupplierPriceRecord[]>([])
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({})
  const [dropCoordinates, setDropCoordinates] = useState({ lat: "", lon: "" })
  const [orderSubmitting, setOrderSubmitting] = useState(false)
  const [orderMessage, setOrderMessage] = useState<string>("")
  const [productForm, setProductForm] = useState({
    skuId: "",
    name: "",
    unit: "",
    minThreshold: "0",
    targetStock: "0",
  })
  const [productSubmitting, setProductSubmitting] = useState(false)
  const [productMessage, setProductMessage] = useState<string>("")
  const [priceForm, setPriceForm] = useState({
    skuId: "",
    unitPrice: "",
    currency: "USD",
    leadDays: "0",
    minQty: "1",
  })
  const [priceSubmitting, setPriceSubmitting] = useState(false)
  const [priceMessage, setPriceMessage] = useState<string>("")
  const [stockAdjustments, setStockAdjustments] = useState<Record<string, string>>({})
  const [stockMessage, setStockMessage] = useState<string>("")
  const [stockSavingSku, setStockSavingSku] = useState<string | null>(null)
  const [fundingOrderId, setFundingOrderId] = useState<string | null>(null)

  const [pickupFormOrder, setPickupFormOrder] = useState<OrderRecord | null>(null)
  const [pickupForm, setPickupForm] = useState({ pickupLat: "", pickupLon: "" })
  const [pickupSubmitting, setPickupSubmitting] = useState(false)
  const [pickupMessage, setPickupMessage] = useState<string>("")

  const [shipmentFormOrder, setShipmentFormOrder] = useState<OrderRecord | null>(null)
  const [shipmentForm, setShipmentForm] = useState({
    orderId: "",
    shipmentNo: "",
    pickupLat: "",
    pickupLon: "",
    dropLat: "",
    dropLon: "",
    dueBy: "",
    assignedCourier: "",
  })
  const [shipmentSubmitting, setShipmentSubmitting] = useState(false)
  const [shipmentMessage, setShipmentMessage] = useState<string>("")

  const { mutateAsync: sendTransactionAsync } = useSendTransaction()

  const refreshBuyerData = useCallback(async () => {
    try {
      const [products, locations, orders] = await Promise.all([
        fetchBuyerProducts(),
        fetchBuyerLocations(),
        fetchOrders("buyer"),
      ])
      setBuyerProducts(products)
      setBuyerLocations(locations)
      setBuyerOrders(orders)
    } catch (error) {
      console.error("Failed to refresh buyer data", error)
    }
  }, [])

  const refreshSupplierData = useCallback(async () => {
    try {
      const [prices, allowlist, orders, shipments] = await Promise.all([
        fetchSupplierPrices(),
        fetchSupplierAllowlist(),
        fetchOrders("supplier"),
        fetchShipments("supplier"),
      ])
      setSupplierPrices(prices)
      setSupplierAllowlist(allowlist)
      setSupplierOrders(orders)
      setSupplierShipments(shipments)
    } catch (error) {
      console.error("Failed to refresh supplier data", error)
    }
  }, [])

  const refreshCourierData = useCallback(async () => {
    try {
      const shipments = await fetchShipments("courier")
      setCourierShipments(shipments)
    } catch (error) {
      console.error("Failed to refresh courier data", error)
    }
  }, [])

  const inventoryStats = useMemo(() => {
    const totals = buyerProducts.reduce(
      (acc, product) => {
        const onHand = Number.isFinite(product.targetStock) ? product.targetStock : Number(product.targetStock) || 0
        const threshold = Number.isFinite(product.minThreshold) ? product.minThreshold : Number(product.minThreshold) || 0
        acc.totalUnits += onHand
        if (onHand <= threshold) {
          acc.belowThreshold += 1
        }
        return acc
      },
      { totalUnits: 0, belowThreshold: 0 },
    )
    return {
      totalSkus: buyerProducts.length,
      totalUnits: totals.totalUnits,
      belowThreshold: totals.belowThreshold,
    }
  }, [buyerProducts])
  useEffect(() => {
    refreshBuyerData().catch(console.error)
    refreshSupplierData().catch(console.error)
    refreshCourierData().catch(console.error)
  }, [refreshBuyerData, refreshSupplierData, refreshCourierData])

  useEffect(() => {
    async function fetchPublic() {
      if (!supplierAddressInput || supplierAddressInput.length !== 42) {
        setPublicPrices([])
        return
      }
      try {
        const prices = await fetchPublicPrices(supplierAddressInput.toLowerCase())
        setPublicPrices(prices)
      } catch (error) {
        console.error("Failed to fetch supplier price list", error)
        setPublicPrices([])
      }
    }
    fetchPublic().catch(console.error)
  }, [supplierAddressInput])

  const publicTotals = useMemo(() => {
    return publicPrices.map((price) => {
      const qty = orderQuantities[price.skuId] ?? 0
      const lineTotal = qty * Number(price.unitPrice)
      return { skuId: price.skuId, qty, lineTotal }
    })
  }, [publicPrices, orderQuantities])

  const publicGrandTotal = publicTotals.reduce((sum, item) => sum + item.lineTotal, 0)

  useEffect(() => {
    if (!account) {
      router.replace("/login")
    }
  }, [account, router])

  if (!account) {
    return null
  }

  async function handleCreateOrder() {
    if (!supplierAddressInput || supplierAddressInput.length !== 42) {
      setOrderMessage("Enter a supplier wallet address")
      return
    }
    const items = publicPrices
      .map((price) => ({
        skuId: price.skuId,
        qty: orderQuantities[price.skuId] ?? 0,
        unitPrice: Number(price.unitPrice),
      }))
      .filter((item) => item.qty > 0)

    if (!items.length) {
      setOrderMessage("Select at least one SKU with quantity")
      return
    }

    setOrderSubmitting(true)
    setOrderMessage("")
    try {
      const parseCoordinate = (value: string) => {
        const trimmed = value.trim()
        if (!trimmed) return NaN
        const numeric = Number(trimmed)
        return Number.isFinite(numeric) ? numeric : NaN
      }

      const dropLat = parseCoordinate(dropCoordinates.lat)
      const dropLon = parseCoordinate(dropCoordinates.lon)

      if (!Number.isFinite(dropLat) || !Number.isFinite(dropLon)) {
        setOrderMessage("Enter valid drop latitude and longitude")
        setOrderSubmitting(false)
        return
      }

      const orderRegistryContract = getContract({ client, address: ORDER_REGISTRY_ADDRESS, abi: orderRegistryContractAbi, chain: sepolia })

      const totalAmount = publicTotals.reduce((sum, item) => sum + item.lineTotal, 0)
      const amount = toTokenAmount(totalAmount, PYUSD_DECIMALS)
      if (amount <= 0n) {
        throw new Error("Order total too small")
      }

      const buyerAddress = account.address
      if (!buyerAddress) {
        throw new Error("Wallet unavailable")
      }

      const chainOrderId = BigInt(Date.now())

      const createOrderTx = prepareContractCall({
        contract: orderRegistryContract,
        method: "createOrder",
        params: [chainOrderId, buyerAddress, supplierAddressInput, amount],
      })

      const createOrderTxResult: any = await sendTransactionAsync(createOrderTx)
      const createTxHash = createOrderTxResult?.transactionHash ?? createOrderTxResult?.hash

      await createOrder({
        supplier: supplierAddressInput,
        items: items.map(({ skuId, qty }) => ({ skuId, qty })),
        unitPrices: items.reduce<Record<string, number>>((acc, item) => {
          acc[item.skuId] = item.unitPrice
          return acc
        }, {}),
        currency: "USD",
        dropLat,
        dropLon,
        chainOrderId: chainOrderId.toString(),
        createTxHash,
      })
      setOrderMessage("Order created.")
      setOrderQuantities({})
      setDropCoordinates({ lat: "", lon: "" })
      await refreshBuyerData()
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : "Failed to create order")
    } finally {
      setOrderSubmitting(false)
    }
  }

  async function handleSaveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProductMessage("")
    setStockMessage("")
    const sku = productForm.skuId.trim()
    const name = productForm.name.trim()
    if (!sku || !name) {
      setProductMessage("SKU and name are required.")
      return
    }
    setProductSubmitting(true)
    try {
      const minThresholdValue = Number(productForm.minThreshold)
      const targetStockValue = Number(productForm.targetStock)
      await upsertBuyerProduct({
        skuId: sku,
        name,
        unit: productForm.unit.trim() || "unit",
        minThreshold: Number.isFinite(minThresholdValue) ? Math.max(0, Math.floor(minThresholdValue)) : 0,
        targetStock: Number.isFinite(targetStockValue) ? Math.max(0, Math.floor(targetStockValue)) : 0,
      })
      setProductMessage("Catalog entry saved.")
      setProductForm({ skuId: "", name: "", unit: "", minThreshold: "0", targetStock: "0" })
      await refreshBuyerData()
    } catch (error) {
      setProductMessage(error instanceof Error ? error.message : "Failed to save catalog entry")
    } finally {
      setProductSubmitting(false)
    }
  }

  async function handleSaveSupplierPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPriceMessage("")
    const sku = priceForm.skuId.trim()
    if (!sku) {
      setPriceMessage("SKU is required.")
      return
    }
    const unitPriceValue = Number(priceForm.unitPrice)
    if (!Number.isFinite(unitPriceValue) || unitPriceValue <= 0) {
      setPriceMessage("Unit price must be greater than zero.")
      return
    }
    const leadDaysValue = Number(priceForm.leadDays)
    const minQtyValue = Number(priceForm.minQty)
    setPriceSubmitting(true)
    try {
      await upsertSupplierPrice({
        skuId: sku,
        unitPrice: unitPriceValue,
        currency: priceForm.currency.trim() || "USD",
        leadDays: Number.isFinite(leadDaysValue) ? Math.max(0, Math.floor(leadDaysValue)) : 0,
        minQty: Number.isFinite(minQtyValue) ? Math.max(1, Math.floor(minQtyValue)) : 1,
      })
      setPriceMessage("Price saved.")
      setPriceForm({ skuId: "", unitPrice: "", currency: priceForm.currency || "USD", leadDays: "0", minQty: "1" })
      await refreshSupplierData()
    } catch (error) {
      setPriceMessage(error instanceof Error ? error.message : "Failed to save price")
    } finally {
      setPriceSubmitting(false)
    }
  }

  async function handleSetInventory(skuId: string) {
    setStockMessage("")
    const entry = buyerProducts.find((product) => product.skuId === skuId)
    if (!entry) {
      setStockMessage("Unable to locate product for update.")
      return
    }
    const inputValue = stockAdjustments[skuId]
    if (typeof inputValue === "undefined" || inputValue.trim() === "") {
      setStockMessage("Enter a new stock value before saving.")
      return
    }
    const nextValue = Number(inputValue)
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      setStockMessage("Stock value must be a non-negative number.")
      return
    }
    setStockSavingSku(skuId)
    setStockMessage("Saving inventory level…")
    try {
      await upsertBuyerProduct({
        skuId,
        name: entry.name,
        unit: entry.unit,
        minThreshold: entry.minThreshold,
        targetStock: Math.floor(nextValue),
      })
      setStockMessage(`Updated stock for ${skuId}.`)
      setStockAdjustments((prev) => ({ ...prev, [skuId]: "" }))
      await refreshBuyerData()
    } catch (error) {
      setStockMessage(error instanceof Error ? error.message : "Failed to update inventory")
    } finally {
      setStockSavingSku(null)
    }
  }

  async function handleOrderStatus(
    orderId: string,
    payload: {
      status: string
      pickupLat?: number | null
      pickupLon?: number | null
      escrowTxHash?: string
      approvalTxHash?: string
    },
  ) {
    try {
      await updateOrderStatus(orderId, payload)
      await Promise.all([refreshBuyerData(), refreshSupplierData()])
    } catch (error) {
      console.error("Failed to update order status", error)
    }
  }

  async function fundOrderEscrow(order: OrderRecord) {
    if (!account) {
      toast({ title: "Connect wallet", description: "Connect your wallet to fund escrow.", variant: "destructive" })
      return
    }

    if (!PYUSD_ADDRESS || !ESCROW_ADDRESS || !ORDER_REGISTRY_ADDRESS) {
      toast({
        title: "Missing configuration",
        description: "Set NEXT_PUBLIC_PYUSD_ADDRESS, NEXT_PUBLIC_ESCROW_PYUSD_ADDRESS, and NEXT_PUBLIC_ORDER_REGISTRY_ADDRESS.",
        variant: "destructive",
      })
      return
    }

    const chainOrderIdValue = order.metadata?.chainOrderId
    let chainOrderId: bigint | null = null
    try {
      if (typeof chainOrderIdValue === "number") {
        chainOrderId = BigInt(chainOrderIdValue)
      } else if (typeof chainOrderIdValue === "string" && chainOrderIdValue.trim().length) {
        chainOrderId = BigInt(chainOrderIdValue)
      }
    } catch (error) {
      chainOrderId = null
    }

    if (!chainOrderId) {
      toast({ title: "Missing order ID", description: "Order is missing an on-chain identifier." })
      return
    }

    const totalAmount = Number(order.totalAmount ?? 0)
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      toast({ title: "Invalid amount", description: "Order total is invalid.", variant: "destructive" })
      return
    }

    const buyerAddress = account.address
    if (!buyerAddress) {
      toast({ title: "Wallet unavailable", description: "Unable to read active wallet address.", variant: "destructive" })
      return
    }

    try {
      setFundingOrderId(order.id)

      const tokenContract = getContract({ client, address: PYUSD_ADDRESS, abi: erc20Abi, chain: sepolia })
      const escrowContract = getContract({ client, address: ESCROW_ADDRESS, abi: escrowContractAbi, chain: sepolia })
      const orderRegistryContract = getContract({ client, address: ORDER_REGISTRY_ADDRESS, abi: orderRegistryContractAbi, chain: sepolia })

      const amount = toTokenAmount(totalAmount, PYUSD_DECIMALS)
      if (amount <= 0n) {
        throw new Error("Order amount too small to fund")
      }

      const onchainOrder = await readContract({
        contract: orderRegistryContract,
        method: "orders",
        params: [chainOrderId],
      })
      const onchainBuyer = extractAddress(onchainOrder)
      const onchainStatus = extractStatus(onchainOrder)

      if (!onchainBuyer || onchainBuyer === ZERO_ADDRESS) {
        const createOrderTx = prepareContractCall({
          contract: orderRegistryContract,
          method: "createOrder",
          params: [chainOrderId, buyerAddress, order.supplier, amount],
        })
        await sendTransactionAsync(createOrderTx)
      }

      let approvalTxHash: string | undefined

      const allowanceResult = await readContract({
        contract: tokenContract,
        method: "allowance",
        params: [buyerAddress, ESCROW_ADDRESS],
      })
      const allowance = toBigInt(allowanceResult)
      if (allowance < amount) {
        const approveTx = prepareContractCall({
          contract: tokenContract,
          method: "approve",
          params: [ESCROW_ADDRESS, amount],
        })
        const approveResult: any = await sendTransactionAsync(approveTx)
        approvalTxHash = approveResult?.transactionHash ?? approveResult?.hash
      }

      const onchainStatusValue =
        typeof onchainStatus === "undefined" ? undefined : toBigInt(onchainStatus)
      const needMarkFunded = !onchainStatusValue || onchainStatusValue < 2n

      const fundTx = prepareContractCall({
        contract: escrowContract,
        method: "fund",
        params: [chainOrderId, amount],
      })
      const fundResult: any = await sendTransactionAsync(fundTx)

      if (needMarkFunded) {
        const markFundedTx = prepareContractCall({
          contract: orderRegistryContract,
          method: "markFunded",
          params: [chainOrderId],
        })
        await sendTransactionAsync(markFundedTx)
      }

      await handleOrderStatus(order.id, {
        status: "Funded",
        escrowTxHash: fundResult?.transactionHash ?? fundResult?.hash,
        approvalTxHash,
      })

      toast({ title: "Escrow funded", description: "PYUSD transferred to escrow." })
    } catch (error) {
      console.error("Failed to fund escrow", error)
      const friendly = getFriendlyTxError(error)
      toast({
        title: "Escrow funding failed",
        description: friendly,
        variant: "destructive",
      })
    } finally {
      setFundingOrderId(null)
    }
  }

  async function handleCreateShipment() {
    if (!shipmentFormOrder) return
    setShipmentSubmitting(true)
    setShipmentMessage("")
    try {
      const metaPickup = shipmentFormOrder.metadata?.pickup || {}
      const metaDrop = shipmentFormOrder.metadata?.drop || {}

      const parseCoordinate = (input: string, fallback: any) => {
        if (input !== "") {
          const value = Number(input)
          return Number.isFinite(value) ? value : NaN
        }
        if (typeof fallback === "number" && Number.isFinite(fallback)) {
          return fallback
        }
        return NaN
      }

      const pickupLatValue = parseCoordinate(shipmentForm.pickupLat, metaPickup.lat)
      const pickupLonValue = parseCoordinate(shipmentForm.pickupLon, metaPickup.lon)
      const dropLatValue = parseCoordinate(shipmentForm.dropLat, metaDrop.lat)
      const dropLonValue = parseCoordinate(shipmentForm.dropLon, metaDrop.lon)

      if ([pickupLatValue, pickupLonValue, dropLatValue, dropLonValue].some((value) => !Number.isFinite(value))) {
        setShipmentMessage("Enter valid pickup and drop coordinates")
        return
      }

      await createShipment({
        orderId: shipmentFormOrder.id,
        shipmentNo: Number(shipmentForm.shipmentNo || Date.now()),
        buyer: shipmentFormOrder.buyer,
        pickupLat: pickupLatValue,
        pickupLon: pickupLonValue,
        dropLat: dropLatValue,
        dropLon: dropLonValue,
        dueBy: shipmentForm.dueBy || new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        assignedCourier: shipmentForm.assignedCourier || undefined,
      })
      setShipmentMessage("Shipment created.")
      setShipmentFormOrder(null)
      setShipmentForm({
        orderId: "",
        shipmentNo: "",
        pickupLat: "",
        pickupLon: "",
        dropLat: "",
        dropLon: "",
        dueBy: "",
        assignedCourier: "",
      })
      await Promise.all([refreshSupplierData(), refreshCourierData()])
    } catch (error) {
      setShipmentMessage(error instanceof Error ? error.message : "Failed to create shipment")
    } finally {
      setShipmentSubmitting(false)
    }
  }

  async function handleClaimShipment(shipment: ShipmentRecord) {
    try {
      await claimShipment(shipment.id)
      await refreshCourierData()
      await refreshSupplierData()
    } catch (error) {
      console.error("Failed to claim shipment", error)
    }
  }

  async function handleApproveOrder() {
    if (!pickupFormOrder) return

    const pickupLat = Number(pickupForm.pickupLat)
    const pickupLon = Number(pickupForm.pickupLon)

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLon)) {
      setPickupMessage("Enter valid pickup latitude and longitude")
      return
    }

    setPickupSubmitting(true)
    setPickupMessage("")

    try {
      await handleOrderStatus(pickupFormOrder.id, {
        status: "Approved",
        pickupLat,
        pickupLon,
      })
      setPickupMessage("Order approved.")
      setPickupFormOrder(null)
      setPickupForm({ pickupLat: "", pickupLon: "" })
    } catch (error) {
      setPickupMessage(error instanceof Error ? error.message : "Failed to approve order")
    } finally {
      setPickupSubmitting(false)
    }
  }

  const buyerTab = (
    <section className="space-y-8">
      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">Buyer catalog</h2>
            <p className="text-xs text-muted-foreground">
              Connected buyer: <code>{account.address}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              Add SKUs, tune reorder thresholds, or set live inventory levels. Updates propagate to the agents instantly.
            </p>
          </div>
        </header>
        <div className="p-4 space-y-4">
          <form onSubmit={handleSaveProduct} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-2">
              <Label htmlFor="buyer-sku">SKU</Label>
              <Input
                id="buyer-sku"
                placeholder="SKU-123"
                value={productForm.skuId}
                onChange={(event) => setProductForm((prev) => ({ ...prev, skuId: event.target.value }))}
              />
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-2">
              <Label htmlFor="buyer-name">Name</Label>
              <Input
                id="buyer-name"
                placeholder="Product name"
                value={productForm.name}
                onChange={(event) => setProductForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buyer-unit">Unit</Label>
              <Input
                id="buyer-unit"
                placeholder="unit"
                value={productForm.unit}
                onChange={(event) => setProductForm((prev) => ({ ...prev, unit: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buyer-min">Reorder threshold</Label>
              <Input
                id="buyer-min"
                type="number"
                min={0}
                value={productForm.minThreshold}
                onChange={(event) => setProductForm((prev) => ({ ...prev, minThreshold: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buyer-target">Target stock</Label>
              <Input
                id="buyer-target"
                type="number"
                min={0}
                value={productForm.targetStock}
                onChange={(event) => setProductForm((prev) => ({ ...prev, targetStock: event.target.value }))}
              />
            </div>
            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <Button type="submit" disabled={productSubmitting} className="w-full">
                {productSubmitting ? "Saving…" : "Save SKU"}
              </Button>
            </div>
          </form>
          {productMessage && <p className="text-xs text-muted-foreground">{productMessage}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">Tracked SKUs</p>
              <p className="mt-1 text-2xl font-semibold">{inventoryStats.totalSkus}</p>
            </div>
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">Units on hand</p>
              <p className="mt-1 text-2xl font-semibold">{inventoryStats.totalUnits}</p>
            </div>
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">SKUs at / below threshold</p>
              <p className={cn("mt-1 text-2xl font-semibold", inventoryStats.belowThreshold > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                {inventoryStats.belowThreshold}
              </p>
              {inventoryStats.belowThreshold > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Reorder suggested for these SKUs.
                </p>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Unit</th>
                  <th className="px-3 py-2 text-left">Threshold</th>
                  <th className="px-3 py-2 text-left">On hand</th>
                  <th className="px-3 py-2 text-left">Set stock</th>
                </tr>
              </thead>
              <tbody>
                {buyerProducts.map((product) => (
                  <tr key={product.skuId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{product.skuId}</td>
                    <td className="px-3 py-2">{product.name}</td>
                    <td className="px-3 py-2">{product.unit}</td>
                    <td className="px-3 py-2">{product.minThreshold}</td>
                    <td className="px-3 py-2">{product.targetStock}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          placeholder={`${product.targetStock}`}
                          value={stockAdjustments[product.skuId] ?? ""}
                          onChange={(event) =>
                            setStockAdjustments((prev) => ({
                              ...prev,
                              [product.skuId]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSetInventory(product.skuId)}
                          disabled={stockSavingSku === product.skuId}
                        >
                          {stockSavingSku === product.skuId ? "Saving…" : "Update"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {buyerProducts.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={6}>
                      No products yet. Add your first SKU above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {stockMessage && <p className="text-xs text-muted-foreground">{stockMessage}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <header className="space-y-2">
          <h2 className="text-lg font-semibold">Create purchase order</h2>
          <p className="text-sm text-muted-foreground">Enter supplier wallet to load their price list.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <div className="space-y-3">
            <Label htmlFor="supplierWallet">Supplier wallet</Label>
            <Input
              id="supplierWallet"
              placeholder="0x..."
              value={supplierAddressInput}
              onChange={(event) => setSupplierAddressInput(event.target.value.trim())}
            />
            <p className="text-xs text-muted-foreground">
              Price list must be imported by the supplier under <code>supplier.csv</code>.
            </p>
            <div className="space-y-2">
              <Label>Drop coordinates</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Lat"
                  value={dropCoordinates.lat}
                  onChange={(event) =>
                    setDropCoordinates((prev) => ({ ...prev, lat: event.target.value }))
                  }
                />
                <Input
                  placeholder="Lon"
                  value={dropCoordinates.lon}
                  onChange={(event) =>
                    setDropCoordinates((prev) => ({ ...prev, lon: event.target.value }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">Provide the delivery latitude and longitude for this order.</p>
            </div>
          </div>
          <div>
            {publicPrices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prices found for this wallet yet.</p>
            ) : (
              <div className="space-y-3">
                <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">Unit price</th>
                      <th className="px-3 py-2 text-left">Lead (d)</th>
                      <th className="px-3 py-2 text-left">Qty</th>
                      <th className="px-3 py-2 text-left">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {publicPrices.map((price) => {
                      const qty = orderQuantities[price.skuId] ?? 0
                      return (
                        <tr key={price.skuId} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{price.skuId}</td>
                          <td className="px-3 py-2">${Number(price.unitPrice).toFixed(2)}</td>
                          <td className="px-3 py-2">{price.leadDays}</td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={qty}
                              onChange={(event) =>
                                setOrderQuantities((prev) => ({
                                  ...prev,
                                  [price.skuId]: Number(event.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">${(qty * Number(price.unitPrice)).toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between text-sm">
                  <span>Total</span>
                  <span className="font-semibold">${publicGrandTotal.toFixed(2)}</span>
                </div>
                <Button onClick={handleCreateOrder} disabled={orderSubmitting}>
                  {orderSubmitting ? "Creating order…" : "Create PO"}
                </Button>
                {orderMessage && <p className="text-xs text-muted-foreground">{orderMessage}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Orders</h2>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Order ID</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Total</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {buyerOrders.map((order) => (
              <tr key={order.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs break-all">
                  <Link href={`/orders/${order.id}`} className="underline">
                    {order.id}
                  </Link>
                </td>
                <td className="px-3 py-2">{order.supplier}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs ${ORDER_STATUS_BADGE[order.status] ?? "bg-muted"}`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-3 py-2">${order.totalAmount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right space-x-2">
                  {order.status === "Approved" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={fundingOrderId === order.id}
                      onClick={() => fundOrderEscrow(order)}
                    >
                      {fundingOrderId === order.id ? "Funding…" : "Mark Escrow Funded"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {buyerOrders.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={5}>
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Ship-to locations</h2>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Address</th>
              <th className="px-3 py-2 text-left">Timezone</th>
            </tr>
          </thead>
          <tbody>
            {buyerLocations.map((loc) => (
              <tr key={loc.locationId} className="border-t border-border">
                <td className="px-3 py-2 text-sm font-medium">{loc.locationId}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {[loc.address?.line1, loc.address?.city, loc.address?.state, loc.address?.country]
                    .filter(Boolean)
                    .join(", ")}
                </td>
                <td className="px-3 py-2 text-xs">{loc.timezone}</td>
              </tr>
            ))}
            {buyerLocations.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={3}>
                  Import locations via buyer.csv to populate this table.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {AGENT_CHAT_CONFIGS.map((config) => (
          <AgentChat key={config.key} config={config} />
        ))}
      </div>
    </section>
  )

  const supplierPickupForm = pickupFormOrder && (
    <div className="rounded-lg border border-dashed border-border bg-card p-4 space-y-4">
      <header className="space-y-1">
        <h3 className="font-medium">Approve order {pickupFormOrder.id.slice(0, 8)}…</h3>
        <p className="text-xs text-muted-foreground">
          Confirm pickup coordinates before fulfilling. Buyer drop coordinates: {pickupFormOrder.metadata?.drop
            ? `${pickupFormOrder.metadata.drop.lat}, ${pickupFormOrder.metadata.drop.lon}`
            : "not provided"}
        </p>
      </header>
      <div className="space-y-2">
        <Label>Pickup coordinates</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Lat"
            value={pickupForm.pickupLat}
            onChange={(event) =>
              setPickupForm((prev) => ({ ...prev, pickupLat: event.target.value }))
            }
          />
          <Input
            placeholder="Lon"
            value={pickupForm.pickupLon}
            onChange={(event) =>
              setPickupForm((prev) => ({ ...prev, pickupLon: event.target.value }))
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handleApproveOrder} disabled={pickupSubmitting}>
          {pickupSubmitting ? "Approving…" : "Approve order"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setPickupFormOrder(null)
            setPickupForm({ pickupLat: "", pickupLon: "" })
            setPickupMessage("")
          }}
        >
          Cancel
        </Button>
        {pickupMessage && <span className="text-xs text-muted-foreground">{pickupMessage}</span>}
      </div>
    </div>
  )

  const supplierOpenShipmentForm = shipmentFormOrder && (
    <div className="rounded-lg border border-dashed border-border bg-card p-4 space-y-4">
      <header className="space-y-1">
        <h3 className="font-medium">Create shipment for order {shipmentFormOrder.id.slice(0, 8)}…</h3>
        <p className="text-xs text-muted-foreground">Confirm pickup/drop coordinates (prefilled from order) and optionally assign a courier.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="shipmentNo">Shipment number</Label>
          <Input
            id="shipmentNo"
            placeholder="e.g. 1001"
            value={shipmentForm.shipmentNo}
            onChange={(event) => setShipmentForm((prev) => ({ ...prev, shipmentNo: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dueBy">Due by (ISO)</Label>
          <Input
            id="dueBy"
            placeholder="2025-10-01T12:00:00.000Z"
            value={shipmentForm.dueBy}
            onChange={(event) => setShipmentForm((prev) => ({ ...prev, dueBy: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Pickup coordinates</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Lat"
              value={shipmentForm.pickupLat}
              onChange={(event) => setShipmentForm((prev) => ({ ...prev, pickupLat: event.target.value }))}
            />
            <Input
              placeholder="Lon"
              value={shipmentForm.pickupLon}
              onChange={(event) => setShipmentForm((prev) => ({ ...prev, pickupLon: event.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Drop coordinates</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Lat"
              value={shipmentForm.dropLat}
              onChange={(event) => setShipmentForm((prev) => ({ ...prev, dropLat: event.target.value }))}
            />
            <Input
              placeholder="Lon"
              value={shipmentForm.dropLon}
              onChange={(event) => setShipmentForm((prev) => ({ ...prev, dropLon: event.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignCourier">Assign courier (wallet)</Label>
          <Input
            id="assignCourier"
            placeholder="0x…"
            value={shipmentForm.assignedCourier}
            onChange={(event) => setShipmentForm((prev) => ({ ...prev, assignedCourier: event.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            Must exist in your courier allowlist. Leave blank to let couriers claim.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={handleCreateShipment} disabled={shipmentSubmitting}>
          {shipmentSubmitting ? "Creating…" : "Create shipment"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setShipmentFormOrder(null)
            setShipmentForm({ orderId: "", shipmentNo: "", pickupLat: "", pickupLon: "", dropLat: "", dropLon: "", dueBy: "", assignedCourier: "" })
          }}
        >
          Cancel
        </Button>
        {shipmentMessage && <span className="text-xs text-muted-foreground">{shipmentMessage}</span>}
      </div>
    </div>
  )

  const supplierTab = (
    <section className="space-y-8">
      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Price list</h2>
          <p className="text-xs text-muted-foreground">Add or update supplier pricing directly from the dashboard.</p>
        </header>
        <div className="p-4 space-y-4">
          <form onSubmit={handleSaveSupplierPrice} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-2">
              <Label htmlFor="supplier-sku">SKU</Label>
              <Input
                id="supplier-sku"
                placeholder="SKU-123"
                value={priceForm.skuId}
                onChange={(event) => setPriceForm((prev) => ({ ...prev, skuId: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-price">Unit price</Label>
              <Input
                id="supplier-price"
                type="number"
                min={0}
                step="0.01"
                placeholder="100.00"
                value={priceForm.unitPrice}
                onChange={(event) => setPriceForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-currency">Currency</Label>
              <Input
                id="supplier-currency"
                placeholder="USD"
                value={priceForm.currency}
                onChange={(event) => setPriceForm((prev) => ({ ...prev, currency: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-lead">Lead days</Label>
              <Input
                id="supplier-lead"
                type="number"
                min={0}
                value={priceForm.leadDays}
                onChange={(event) => setPriceForm((prev) => ({ ...prev, leadDays: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-minqty">Min qty</Label>
              <Input
                id="supplier-minqty"
                type="number"
                min={1}
                value={priceForm.minQty}
                onChange={(event) => setPriceForm((prev) => ({ ...prev, minQty: event.target.value }))}
              />
            </div>
            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <Button type="submit" disabled={priceSubmitting} className="w-full">
                {priceSubmitting ? "Saving…" : "Save price"}
              </Button>
            </div>
          </form>
          {priceMessage && <p className="text-xs text-muted-foreground">{priceMessage}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Unit price</th>
                  <th className="px-3 py-2 text-left">Lead (d)</th>
                  <th className="px-3 py-2 text-left">Min qty</th>
                </tr>
              </thead>
              <tbody>
                {supplierPrices.map((price) => (
                  <tr key={price.skuId} className="border-t border-border">
                    <td className="px-3 py-2">{price.skuId}</td>
                    <td className="px-3 py-2">${Number(price.unitPrice).toFixed(2)}</td>
                    <td className="px-3 py-2">{price.leadDays}</td>
                    <td className="px-3 py-2">{price.minQty}</td>
                  </tr>
                ))}
                {supplierPrices.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={4}>
                      No prices yet. Add your first SKU above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Incoming orders</h2>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Order ID</th>
              <th className="px-3 py-2 text-left">Buyer</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Total</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {supplierOrders.map((order) => (
              <tr key={order.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs break-all">
                  <Link href={`/orders/${order.id}`} className="underline">
                    {order.id}
                  </Link>
                </td>
                <td className="px-3 py-2">{order.buyer}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs ${ORDER_STATUS_BADGE[order.status] ?? "bg-muted"}`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-3 py-2">${order.totalAmount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right space-x-2">
                  {order.status === "Created" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPickupFormOrder(order)
                        setPickupForm({
                          pickupLat: order.metadata?.pickup?.lat ? String(order.metadata.pickup.lat) : "",
                          pickupLon: order.metadata?.pickup?.lon ? String(order.metadata.pickup.lon) : "",
                        })
                        setPickupMessage("")
                      }}
                    >
                      Approve
                    </Button>
                  )}
                  {order.status === "Funded" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setShipmentFormOrder(order)
                        setShipmentForm({
                          orderId: order.id,
                          shipmentNo: "",
                          pickupLat:
                            order.metadata?.pickup && typeof order.metadata.pickup.lat === "number"
                              ? String(order.metadata.pickup.lat)
                              : "",
                          pickupLon:
                            order.metadata?.pickup && typeof order.metadata.pickup.lon === "number"
                              ? String(order.metadata.pickup.lon)
                              : "",
                          dropLat:
                            order.metadata?.drop && typeof order.metadata.drop.lat === "number"
                              ? String(order.metadata.drop.lat)
                              : "",
                          dropLon:
                            order.metadata?.drop && typeof order.metadata.drop.lon === "number"
                              ? String(order.metadata.drop.lon)
                              : "",
                          dueBy: "",
                          assignedCourier: "",
                        })
                      }}
                    >
                      Create shipment
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {supplierOrders.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={5}>
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {supplierPickupForm}

      {supplierOpenShipmentForm}

      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">Shipments</h2>
          <p className="text-xs text-muted-foreground">
            Share the URL <code>/courier/&lt;shipmentId&gt;</code> with your courier or print a QR.
          </p>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Shipment ID</th>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Courier</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Due</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {supplierShipments.map((shipment) => (
              <tr key={shipment.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{shipment.id.slice(0, 10)}…</td>
                <td className="px-3 py-2 text-xs">{shipment.orderId.slice(0, 8)}…</td>
                <td className="px-3 py-2 text-xs">
                  {shipment.assignedCourier ? formatWallet(shipment.assignedCourier) : "Unassigned"}
                </td>
                <td className="px-3 py-2">{shipment.status}</td>
                <td className="px-3 py-2 text-xs">{new Date(shipment.dueBy).toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <a className="text-primary hover:underline" href={`/courier/${shipment.id}`} target="_blank" rel="noreferrer">
                    Open courier view
                  </a>
                </td>
              </tr>
            ))}
            {supplierShipments.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={6}>
                  No shipments created.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Courier allowlist</h2>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Wallet</th>
              <th className="px-3 py-2 text-left">Label</th>
            </tr>
          </thead>
          <tbody>
            {supplierAllowlist.map((courier) => (
              <tr key={courier.courierWallet} className="border-t border-border">
                    <td className="px-3 py-2 text-xs font-mono">{formatWallet(courier.courierWallet)}</td>
                <td className="px-3 py-2 text-xs">{courier.label || "—"}</td>
              </tr>
            ))}
            {supplierAllowlist.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={2}>
                  No couriers allowlisted yet (import via supplier.csv).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )

  const courierTab = (
    <section className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Funded shipments that are unclaimed appear below. Claim a shipment to reserve it, then use the pickup/drop
        buttons to submit Lit-verified proofs. Once claimed, shipments disappear for other couriers and remain visible
        only in your dashboard.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {courierShipments.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No shipments available yet.
          </div>
        )}

        {courierShipments.map((shipment) => {
          const assignedToMe =
            !!account && shipment.assignedCourier?.toLowerCase() === account.address.toLowerCase()
          const awaitingClaim = !shipment.assignedCourier && shipment.status === "Created"
          const pickupCoords =
            shipment.pickupLat !== null && shipment.pickupLon !== null
              ? `${shipment.pickupLat.toFixed(4)}, ${shipment.pickupLon.toFixed(4)}`
              : "—"
          const dropCoords =
            shipment.dropLat !== null && shipment.dropLon !== null
              ? `${shipment.dropLat.toFixed(4)}, ${shipment.dropLon.toFixed(4)}`
              : "—"

          const openCourierView = () => {
            window.open(`/courier/${shipment.id}`, "_blank", "noopener,noreferrer")
          }

          const canHandlePickup = assignedToMe && shipment.status === "Created"
          const canHandleDrop = assignedToMe && shipment.status === "InTransit"

          return (
            <div key={shipment.id} className="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
              <header className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Shipment #{shipment.shipmentNo}</span>
                  <span>{new Date(shipment.dueBy).toLocaleString()}</span>
                </div>
                <div className="font-mono text-xs break-all">{shipment.id}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">Supplier</span>
                  <span className="truncate">{shipment.supplier}</span>
                </div>
                <div className="text-xs">
                  Status:
                  <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide">
                    {shipment.status}
                  </span>
                </div>
                {!!shipment.assignedCourier && (
                  <div className="text-xs text-muted-foreground">
                    Assigned courier: {formatWallet(shipment.assignedCourier) ?? "—"}
                  </div>
                )}
              </header>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-semibold">Pickup (lat, lon)</div>
                  <div>{pickupCoords}</div>
                </div>
                <div>
                  <div className="font-semibold">Drop (lat, lon)</div>
                  <div>{dropCoords}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {awaitingClaim && (
                  <Button variant="secondary" size="sm" onClick={() => handleClaimShipment(shipment)}>
                    Claim shipment
                  </Button>
                )}
                {assignedToMe && (
                  <Button variant="outline" size="sm" onClick={openCourierView}>
                    Open courier view
                  </Button>
                )}
                {canHandlePickup && (
                  <Button size="sm" onClick={openCourierView}>
                    I’m at pickup
                  </Button>
                )}
                {canHandleDrop && (
                  <Button size="sm" onClick={openCourierView}>
                    I’m at drop
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">PODx Control Tower</h1>
          <p className="text-sm text-muted-foreground">
            Manage buyer, supplier, and courier workflows from a single wallet-native dashboard.
          </p>
        </header>

        <DashboardTabs value={tab} onChange={setTab} />

        {tab === "buyer" && buyerTab}
        {tab === "supplier" && supplierTab}
        {tab === "courier" && courierTab}
      </div>
    </main>
  )
}
function formatWallet(value?: string | null) {
  if (!value) return null
  try {
    return getAddress(value)
  } catch (error) {
    return value
  }
}
