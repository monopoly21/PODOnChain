"use client"

import { useEffect, useMemo, useState } from "react"
import type { Account } from "thirdweb"
import { ConnectButton, useActiveAccount } from "thirdweb/react"
import { getAddress, verifyTypedData } from "ethers"
import { createWallet } from "thirdweb/wallets"
import { sepolia } from "thirdweb/chains"

import { Button } from "@/components/ui/button"
import { client } from "@/lib/thirdweb"

type SessionResponse = {
  session: {
    shipmentId: string
    orderId: string
    courier: string
    supplier: string
    deadline: string
    payload: Record<string, unknown>
    role: "supplier" | "buyer"
    kind: "pickup" | "drop"
  }
  typedData: {
    domain: Record<string, unknown>
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: string
    message: Record<string, unknown>
  }
}

const CONNECT_WALLETS = [createWallet("io.metamask"), createWallet("com.coinbase.wallet")]

export default function SigningPage({
  params: paramsPromise,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const account = useActiveAccount()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [sessionData, setSessionData] = useState<SessionResponse | null>(null)

  const [resolvedParams, setResolvedParams] = useState<{ sessionId: string } | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    paramsPromise.then(setResolvedParams).catch(() => setResolvedParams(null))
    searchParamsPromise
      .then((value) => setToken(value.t ?? null))
      .catch(() => setToken(null))
  }, [paramsPromise, searchParamsPromise])

  const expectedSigner = useMemo(() => sessionData?.session.supplier ?? null, [sessionData])
  const sessionKind = sessionData?.session.kind ?? "pickup"
  const sessionRoleLabel = sessionData?.session.role ?? "supplier"
  const connectedAddressMatches = useMemo(() => {
    if (!account || !expectedSigner) return null
    try {
      return getAddress(account.address) === getAddress(expectedSigner)
    } catch {
      return false
    }
  }, [account, expectedSigner])

  useEffect(() => {
    if (!token || !resolvedParams) {
      setError("Signing link is missing or invalid.")
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/signing-sessions/${resolvedParams.sessionId}?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => null)
          throw new Error(detail?.error ?? "Unable to load signing session.")
        }
        return res.json()
      })
      .then((json: SessionResponse) => {
        setSessionData(json)
        setError(null)
      })
      .catch((err) => {
        setSessionData(null)
        setError(err instanceof Error ? err.message : "Unable to load signing session.")
      })
      .finally(() => setLoading(false))
  }, [resolvedParams, token])

  async function handleSign() {
    if (!sessionData || !token || !resolvedParams) return
    if (!account) {
      setError(`Connect the ${sessionRoleLabel} wallet before signing.`)
      return
    }

    const active = getAddress(account.address)
    const supplier = getAddress(sessionData.session.supplier)
    if (active !== supplier) {
      setError(`Connect wallet ${supplier} to countersign this ${sessionKind}.`)
      return
    }

    try {
      setError(null)
      setSuccess(null)
      const signature = await requestTypedSignature(account, sessionData.typedData)

      const res = await fetch(
        `/api/signing-sessions/${resolvedParams.sessionId}/sign?t=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        },
      )
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        if (json && typeof json === "object") {
          const detail =
            typeof json.error === "string" ? json.error : json?.message ?? "Failed to submit signature."
          const recovered = typeof json.recovered === "string" ? `Recovered ${json.recovered}` : null
          const expected =
            typeof json.expectedSigner === "string" ? `Expected ${json.expectedSigner}` : null
          const extra = [detail, expected, recovered].filter(Boolean).join(" – ")
          throw new Error(extra)
        }
        throw new Error(typeof json === "string" ? json : "Failed to submit signature.")
      }
      setSuccess(
        `${sessionKind === "drop" ? "Drop" : "Pickup"} countersigned successfully. Escrow release is now in motion.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.")
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-10 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">
            Countersign {sessionKind === "drop" ? "Delivery" : "Pickup"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Session ID: <span className="font-mono">{resolvedParams?.sessionId ?? "…"}</span>
          </p>
        </header>

        {loading && <p className="text-sm text-muted-foreground">Loading session…</p>}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
            {success}
          </div>
        )}

       {sessionData && !loading && (
          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="space-y-1 text-sm">
              <Detail label="Order ID" value={sessionData.session.orderId} />
              <Detail label="Courier" value={sessionData.session.courier} />
              <Detail
                label={sessionRoleLabel === "buyer" ? "Buyer" : "Supplier"}
                value={sessionData.session.supplier}
                highlight
              />
              <Detail
                label="Deadline"
                value={new Date(sessionData.session.deadline).toLocaleString()}
              />
            </div>

            <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p>
                By signing, you confirm {sessionKind === "drop" ? "delivery" : "pickup"} for shipment{" "}
                <span className="font-mono text-foreground">{sessionData.session.shipmentId}</span>. The
                transaction will proceed once both signatures are recorded.
              </p>
            </div>

            {!account ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Connect the {sessionRoleLabel} wallet to countersign.
                </p>
                <ConnectButton
                  client={client}
                  chain={sepolia}
                  wallets={CONNECT_WALLETS}
                  connectModal={{ size: "compact" }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                {connectedAddressMatches === false && expectedSigner ? (
                  <div className="rounded-md border border-amber-500/60 bg-amber-200/30 px-3 py-2 text-xs text-amber-900">
                    Connected wallet {account.address.slice(0, 6)}… does not match the required signer {expectedSigner}. Switch
                    accounts in your wallet to continue.
                  </div>
                ) : null}
              <Button onClick={handleSign} disabled={loading}>
                {loading ? "Signing…" : `Sign as ${expectedSigner ?? sessionRoleLabel}`}
              </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

function Detail({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm ${highlight ? "text-primary" : ""}`}>{value}</span>
    </div>
  )
}

async function requestTypedSignature(
  account: Account,
  typedData: SessionResponse["typedData"],
): Promise<string> {
  const { domain, types, primaryType, message } = typedData
  const normalized = getAddress(account.address)

  if (typeof account.signTypedData === "function") {
    try {
      const signature = (await account.signTypedData({
        domain,
        types: types as typeof types,
        primaryType: primaryType as typeof primaryType,
        message: message as typeof message,
      })) as string
      return await ensureSignatureMatches(signature, normalized, domain, types, message)
    } catch (error) {
      console.warn("Account signTypedData failed, falling back to provider request", error)
    }
  }

  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("Wallet provider unavailable for signature request")
  }

  try {
    await window.ethereum.request({ method: "eth_requestAccounts" })
  } catch (error) {
    console.warn("Failed to re-request accounts before signing", error)
  }

  const payload = JSON.stringify({ domain, types, primaryType, message })
  const signature = (await window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [normalized, payload],
  })) as string

  return await ensureSignatureMatches(signature, normalized, domain, types, message)
}

async function ensureSignatureMatches(
  signature: string,
  expected: string,
  domain: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  message: Record<string, unknown>,
): Promise<string> {
  try {
    const recovered = getAddress(verifyTypedData(domain as any, types as any, message, signature))
    if (recovered === expected) {
      return signature
    }
    console.warn("Recovered signer did not match expectation", { expected, recovered })
  } catch (error) {
    console.warn("Failed to locally recover signer from signature", error)
  }

  if (await isContractWallet(expected)) {
    return signature
  }

  throw new Error("Signature did not match the connected wallet. Please try again.")
}

async function isContractWallet(address: string): Promise<boolean> {
  if (typeof window === "undefined" || !window.ethereum) {
    return false
  }
  try {
    const code = (await window.ethereum.request({
      method: "eth_getCode",
      params: [address, "latest"],
    })) as string | null
    return typeof code === "string" && code !== "0x"
  } catch (error) {
    console.warn("Unable to determine wallet type during signature validation", error)
    return false
  }
}
