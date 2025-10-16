"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { getAddress } from "viem"

import { CsvCard } from "@/components/CsvCard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { addCourierToAllowlist, fetchSupplierAllowlist, type CourierAllowRecord } from "@/lib/api-client"

export default function ImportsPage() {
  const account = useActiveAccount()
  const router = useRouter()

  const [walletInput, setWalletInput] = useState("")
  const [labelInput, setLabelInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [allowlist, setAllowlist] = useState<CourierAllowRecord[]>([])

  useEffect(() => {
    if (!account) {
      router.replace("/login")
    }
  }, [account, router])

  useEffect(() => {
    if (!account) return
    fetchSupplierAllowlist()
      .then(setAllowlist)
      .catch((error) => {
        console.error("Failed to load courier allowlist", error)
      })
  }, [account])

  if (!account) {
    return null
  }

  async function handleAddCourier(event: React.FormEvent) {
    event.preventDefault()
    const wallet = walletInput.trim()
    if (!wallet || wallet.length !== 42 || !wallet.startsWith("0x")) {
      toast({ title: "Invalid wallet", description: "Enter a 42-character 0x-address.", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const courier = await addCourierToAllowlist({ courierWallet: wallet, label: labelInput.trim() || undefined })
      setAllowlist((prev) => {
        const filtered = prev.filter((item) => item.courierWallet.toLowerCase() !== courier.courierWallet.toLowerCase())
        return [...filtered, courier].sort((a, b) => a.courierWallet.localeCompare(b.courierWallet))
      })
      setWalletInput("")
      setLabelInput("")
      toast({ title: "Courier allowlisted", description: `${wallet} can now claim shipments.` })
    } catch (error) {
      console.error("Failed to add courier", error)
      toast({
        title: "Failed to add courier",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Catalog & Courier Management</h1>
          <p className="text-sm text-muted-foreground">
            Upload CSVs or manually allowlist courier wallets. Files stay local under <code>data/imports/&lt;wallet&gt;</code>
            and feed your SQLite tenant.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <CsvCard
            kind="buyer"
            title="Buyer catalog (buyer.csv)"
            description="Products with reorder thresholds and ship-to locations."
          />
          <CsvCard
            kind="supplier"
            title="Supplier catalog (supplier.csv)"
            description="Price list and courier allowlist for this wallet."
          />
        </section>

        <section className="grid gap-6 md:grid-cols-[2fr_3fr] items-start">
          <form onSubmit={handleAddCourier} className="space-y-4 rounded-lg border border-border bg-card p-4">
            <header className="space-y-1">
              <h2 className="font-semibold">Manual courier allowlist</h2>
              <p className="text-xs text-muted-foreground">
                Add a courier wallet without re-importing <code>supplier.csv</code>.
              </p>
            </header>

            <div className="space-y-2">
              <Label htmlFor="courierWallet">Courier wallet</Label>
              <Input
                id="courierWallet"
                placeholder="0x..."
                value={walletInput}
                onChange={(event) => setWalletInput(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="courierLabel">Label (optional)</Label>
              <Input
                id="courierLabel"
                placeholder="Friendly name"
                value={labelInput}
                onChange={(event) => setLabelInput(event.target.value)}
              />
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Adding…" : "Add courier"}
            </Button>
          </form>

          <div className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="font-semibold">Current allowlist</h2>
            </header>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Wallet</th>
                  <th className="px-3 py-2 text-left">Label</th>
                </tr>
              </thead>
              <tbody>
                {allowlist.map((courier) => (
                  <tr key={courier.courierWallet} className="border-t border-border">
                    <td className="px-3 py-2 text-xs font-mono">{formatWallet(courier.courierWallet)}</td>
                    <td className="px-3 py-2 text-xs">{courier.label || "—"}</td>
                  </tr>
                ))}
                {allowlist.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={2}>
                      No couriers allowlisted yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
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
