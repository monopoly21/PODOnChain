"use client"

import type { Order } from "@/lib/types"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export function PYUSDEscrowCard({
  order,
  onClose,
  onFunded,
}: {
  order: Order
  onClose: () => void
  onFunded: () => void
}) {
  const [loading, setLoading] = useState<"idle" | "approving" | "funding">("idle")

  async function simulateFund() {
    setLoading("approving")
    await new Promise((r) => setTimeout(r, 700))
    setLoading("funding")
    await new Promise((r) => setTimeout(r, 900))
    onFunded()
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-end md:items-center justify-center p-4">
      <Card className="w-full max-w-md border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <div className="font-medium">Fund PYUSD Escrow</div>
          <div className="text-sm text-muted-foreground">
            Order #{order.id} • Amount: ${order.unitPrice * order.qty}
          </div>
        </div>
        <div className="px-4 py-4 space-y-3 text-sm">
          <p>Wallet network: Sepolia (demo). Token: PYUSD (test).</p>
          <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
            <li>Permit or approve PYUSD</li>
            <li>Fund escrow in a single transaction</li>
          </ol>
          <div className="pt-1">
            <Button className="w-full" disabled={loading !== "idle"} onClick={simulateFund}>
              {loading === "idle" ? "Approve & Fund" : loading === "approving" ? "Approving…" : "Funding…"}
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </Card>
    </div>
  )
}
