"use client"

import { useEffect, useState } from "react"
import { BrowserProvider, getAddress, keccak256, toUtf8Bytes, verifyTypedData } from "ethers"
import type { Account } from "thirdweb"
import { useActiveAccount } from "thirdweb/react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  buildDropTypedData,
  buildPickupTypedData,
  type DropTypedMessage,
  type DropTypedMessageForVerify,
  type PickupTypedMessage,
  type PickupTypedMessageForVerify,
  type ShipmentTypedDataWithVerify,
} from "@/lib/shipment-attestation"
import { geodesicDistance } from "@/lib/geo"

const SHIPMENT_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_SHIPMENT_REGISTRY_ADDRESS ?? ""
const SHIPMENT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "0")

if (!SHIPMENT_REGISTRY_ADDRESS || !SHIPMENT_CHAIN_ID) {
  console.warn("Shipment registry configuration missing – signatures will fail")
}

type ShipmentResponse = {
  shipment: {
    id: string
    orderId: string
    chainOrderId: string | number | null
    shipmentNo: number
    supplier: string
    buyer: string
    pickupLat: number | null
    pickupLon: number | null
    dropLat: number | null
    dropLon: number | null
    status: string
    metadata: Record<string, unknown> | null
  }
  proofs: Array<{
    id: string
    kind: string
    signer: string
    createdAt: string
    photoHash?: string | null
    litDistance?: number | null
  }>
}

export default function CourierPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const account = useActiveAccount()
  const [routeParams, setRouteParams] = useState<{ shipmentId: string } | null>(null)
  const [log, setLog] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState("")
  const [data, setData] = useState<ShipmentResponse | null>(null)

  useEffect(() => {
    if (account) {
      const address = account.address.toLowerCase()
      document.cookie = `wallet=${address}; path=/`
    }
  }, [account])

  useEffect(() => {
    params
      .then((resolved) => setRouteParams(resolved))
      .catch((error) => {
        console.error("Failed to resolve route params", error)
        setLog("Failed to resolve shipment id")
      })
  }, [params])

  useEffect(() => {
    if (!routeParams) return
    if (!account) {
      setLog("Connect your wallet to load the shipment")
      return
    }
    setLog("")
    async function load() {
      try {
        const res = await fetch(`/api/shipments/${routeParams.shipmentId}`)
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || "Failed to load shipment")
        }
        const json = (await res.json()) as ShipmentResponse
        setData(json)
      } catch (error) {
        setLog(error instanceof Error ? error.message : "Failed to load shipment")
      }
    }
    load().catch(console.error)
  }, [routeParams, account])

  async function send(kind: "pickup" | "drop") {
    if (!routeParams) {
      setLog("Shipment details unavailable")
      return
    }
    if (!account) {
      setLog("Connect your wallet before submitting a proof")
      return
    }
    if (!data) {
      setLog("Shipment details unavailable")
      return
    }
    if (!SHIPMENT_REGISTRY_ADDRESS || !SHIPMENT_CHAIN_ID) {
      setLog("Shipment registry configuration missing")
      return
    }

    const metadata = (data.shipment.metadata ?? {}) as Record<string, unknown>
    const chainOrderId = parseChainOrderId(metadata.chainOrderId ?? data.shipment.chainOrderId)
    if (!chainOrderId) {
      setLog("Missing on-chain order id for this shipment")
      return
    }

    const pickupLat = data.shipment.pickupLat
    const pickupLon = data.shipment.pickupLon
    const dropLat = data.shipment.dropLat
    const dropLon = data.shipment.dropLon

    if (
      kind === "drop" &&
      (typeof pickupLat !== "number" ||
        typeof pickupLon !== "number" ||
        typeof dropLat !== "number" ||
        typeof dropLon !== "number")
    ) {
      setLog("Shipment missing pickup/drop coordinates")
      return
    }

    setBusy(true)
    setLog("")
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: false }),
      )

      const claimedTs = Math.floor(Date.now() / 1000)
      const latitude = position.coords.latitude
      const longitude = position.coords.longitude
      const shipmentHash = keccak256(toUtf8Bytes(routeParams.shipmentId))
      const courierAddress = account.address

      let courierSignature = ""
      let locationHash = ""
      let distanceMeters: number | undefined

      if (kind === "pickup") {
        const typed = buildPickupTypedData({
          verifyingContract: SHIPMENT_REGISTRY_ADDRESS,
          chainId: SHIPMENT_CHAIN_ID,
          shipmentId: shipmentHash,
          orderId: chainOrderId.toString(),
          courier: courierAddress,
          supplier: data.shipment.supplier,
          claimedTs,
          latitude,
          longitude,
        })
        setLog("Awaiting courier signature…")
        courierSignature = await requestSignature(courierAddress, typed, account ?? undefined)
        locationHash = typed.locationHash

        setLog("Generating supplier signing link…")
        const createRes = await fetch(`/api/signing-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "pickup",
            shipmentId: routeParams.shipmentId,
            shipmentHash,
            chainOrderId: chainOrderId.toString(),
            claimedTs,
            currentLat: latitude,
            currentLon: longitude,
            locationHash,
            courierSignature,
            radiusM: undefined,
            notes,
          }),
        })
        const createJson = await createRes.json()
        if (!createRes.ok) {
          throw new Error(typeof createJson === "string" ? createJson : JSON.stringify(createJson))
        }
        const roleLabel = createJson.role ?? "supplier"
        const shareLink = typeof createJson.link === "string" ? createJson.link : createJson.supplierLink
        setLog(
          [
            "Courier signature captured.",
            `Share this link with the ${roleLabel} to countersign pickup`,
            shareLink,
          ].join("\n"),
        )
        return
      } else {
        const plannedDistance = Math.round(geodesicDistance(pickupLat!, pickupLon!, dropLat!, dropLon!))
        const typed = buildDropTypedData({
          verifyingContract: SHIPMENT_REGISTRY_ADDRESS,
          chainId: SHIPMENT_CHAIN_ID,
          shipmentId: shipmentHash,
          orderId: chainOrderId.toString(),
          courier: courierAddress,
          buyer: data.shipment.buyer,
          claimedTs,
          latitude,
          longitude,
          distanceMeters: plannedDistance,
        })
        setLog("Awaiting courier signature…")
        courierSignature = await requestSignature(courierAddress, typed, account ?? undefined)
        locationHash = typed.locationHash
        distanceMeters = plannedDistance

        setLog("Generating buyer signing link…")
        const createRes = await fetch(`/api/signing-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "drop",
            shipmentId: routeParams.shipmentId,
            shipmentHash,
            chainOrderId: chainOrderId.toString(),
            claimedTs,
            currentLat: latitude,
            currentLon: longitude,
            locationHash,
            courierSignature,
            distanceMeters,
            pickupLat,
            pickupLon,
            dropLat,
            dropLon,
            radiusM: undefined,
            notes,
          }),
        })
        const createJson = await createRes.json()
        if (!createRes.ok) {
          throw new Error(typeof createJson === "string" ? createJson : JSON.stringify(createJson))
        }
        const dropRoleLabel = createJson.role ?? "buyer"
        const dropShareLink = typeof createJson.link === "string" ? createJson.link : createJson.supplierLink
        setLog(
          [
            "Courier signature captured.",
            `Share this link with the ${dropRoleLabel} to countersign drop`,
            dropShareLink,
          ].join("\n"),
        )
        return
      }
    } catch (error) {
      setLog(error instanceof Error ? error.message : "Failed to submit proof")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-10 space-y-6">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold">Courier proof</h1>
          <p className="text-sm text-muted-foreground">Shipment ID: {routeParams?.shipmentId ?? "…"}</p>
          {!account && <p className="text-xs text-destructive">Connect your wallet to continue.</p>}
          {data && (
            <p className="text-xs text-muted-foreground">
              Supplier {data.shipment.supplier} → Buyer {data.shipment.buyer} • Status {data.shipment.status}
            </p>
          )}
        </header>

        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Notes (optional)</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Condition, references…" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={() => send("pickup")} disabled={busy}>
              {busy ? "Submitting…" : "I’m at pickup"}
            </Button>
            <Button variant="secondary" onClick={() => send("drop")} disabled={busy}>
              {busy ? "Submitting…" : "I’m at drop"}
            </Button>
          </div>

          {log && <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap break-words">{log}</pre>}
        </section>

        {data && data.proofs.length > 0 && (
          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-2 text-sm font-medium">Proof history</header>
            <ul className="divide-y divide-border text-xs">
              {data.proofs.map((proof) => (
                <li key={proof.id} className="px-4 py-3 space-y-1">
                  <div className="font-semibold uppercase">{proof.kind}</div>
                  <div className="text-muted-foreground">{new Date(proof.createdAt).toLocaleString()}</div>
                  {typeof proof.litDistance === "number" && (
                    <div className="text-muted-foreground">Geo-distance: {proof.litDistance}m</div>
                  )}
                  {proof.photoHash && <div className="font-mono break-all">{proof.photoHash}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

function parseChainOrderId(value: unknown): bigint | null {
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim())
    } catch (error) {
      console.warn("Invalid chain order id string", value)
      return null
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value))
  }
  if (typeof value === "bigint") return value
  return null
}

async function requestSignature<
  TMessage extends PickupTypedMessage | DropTypedMessage,
  TVerify extends PickupTypedMessageForVerify | DropTypedMessageForVerify,
>(expectedAddress: string, typed: ShipmentTypedDataWithVerify<TMessage, TVerify>, account?: Account | null): Promise<string> {
  const normalizedExpected = normaliseAddress(expectedAddress)
  if (!normalizedExpected) {
    throw new Error(`Invalid signer address ${expectedAddress}`)
  }

  if (typeof window !== "undefined") {
    window.__lastShipmentPayload = {
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
      verifyMessage: typed.verifyMessage,
      expectedAddress: normalizedExpected,
    }
    window.__lastShipmentSignature = null
  }

  let signature: string | null = null
  if (account && normaliseAddress(account.address) === normalizedExpected && account.signTypedData) {
    signature = (await account.signTypedData({
      domain: typed.domain,
      types: typed.types as typeof typed.types,
      primaryType: typed.primaryType as typeof typed.primaryType,
      message: typed.verifyMessage as TVerify,
    })) as string
  } else {
    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("Wallet provider unavailable for signature request")
    }
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[]
    const active = normaliseAddress(accounts?.[0])
    if (account?.address && normaliseAddress(account.address) !== normalizedExpected) {
      console.warn("Active thirdweb account differs from expected signer", {
        expected: normalizedExpected,
        active: normaliseAddress(account.address),
      })
    }
    if (active && active !== normalizedExpected) {
      throw new Error(`Connect wallet ${expectedAddress} to continue`)
    }

    const payload = JSON.stringify({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    })
    signature = (await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [expectedAddress, payload],
    })) as string
  }

  if (!signature || typeof signature !== "string") {
    throw new Error("Failed to obtain signature from wallet")
  }

  const recovered = await recoverSigner(normalizedExpected, signature, typed)
  if (recovered && normalizedExpected && recovered === normalizedExpected) {
    if (typeof window !== "undefined") {
      window.__lastShipmentSignature = signature
    }
    return signature
  }

  const contractMatch = normalizedExpected ? await isContractAddress(normalizedExpected) : false
  if (contractMatch) {
    console.warn("Skipping local signature match check for contract wallet", {
      expected: normalizedExpected,
      recovered,
    })
    if (typeof window !== "undefined") {
      window.__lastShipmentSignature = signature
    }
    return signature
  }

  console.error("Shipment proof signature mismatch", {
    expected: normalizedExpected,
    recovered,
  })
  throw new Error(
    `Signature did not match the expected signer (expected ${normalizedExpected}, got ${recovered ?? "unknown"})`,
  )
}

function normaliseAddress(input: string | undefined | null): string | null {
  if (!input) return null
  try {
    return getAddress(input)
  } catch (error) {
    return input.trim().toLowerCase()
  }
}

async function isContractAddress(address: string): Promise<boolean> {
  if (typeof window === "undefined" || !window.ethereum) return false
  try {
    const provider = new BrowserProvider(window.ethereum)
    const code = await provider.getCode(address)
    return Boolean(code && code !== "0x")
  } catch (error) {
    console.warn("Failed to determine if address is a contract", error)
    return false
  }
}

async function recoverSigner<
  TMessage extends PickupTypedMessage | DropTypedMessage,
  TVerify extends PickupTypedMessageForVerify | DropTypedMessageForVerify,
>(
  expected: string | null,
  signature: string,
  typed: ShipmentTypedDataWithVerify<TMessage, TVerify>,
): Promise<string | null> {
  if (!expected) return null
  try {
    return normaliseAddress(verifyTypedData(typed.domain, typed.types, typed.verifyMessage, signature))
  } catch (error) {
    console.warn("Failed to locally recover signer from signature", error)
    return null
  }
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    }
    __lastShipmentPayload?: {
      domain: ShipmentTypedDataWithVerify<any, any>["domain"]
      types: ShipmentTypedDataWithVerify<any, any>["types"]
      primaryType: ShipmentTypedDataWithVerify<any, any>["primaryType"]
      message: ShipmentTypedDataWithVerify<any, any>["message"]
      verifyMessage: ShipmentTypedDataWithVerify<any, any>["verifyMessage"]
      expectedAddress: string | null
    } | null
    __lastShipmentSignature?: string | null
  }
}
