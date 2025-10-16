import { notFound } from "next/navigation"
import Link from "next/link"

import { getUserAddress } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatDistanceToNow } from "date-fns"

type OrderMetadata = {
  items?: Array<{ skuId?: string; qty?: number; unitPrice?: number; lineTotal?: number }>
  currency?: string
  chainOrderId?: string | number
  chainCreateTxHash?: string | null
  pickup?: { lat?: number; lon?: number }
  drop?: { lat?: number; lon?: number }
  escrow?: Record<string, unknown>
  [key: string]: unknown
}

function parseMetadata(raw: string | null | undefined): OrderMetadata {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      return parsed as OrderMetadata
    }
  } catch (error) {
    console.error("Failed to parse order metadata", error)
  }
  return {}
}

function formatCurrency(amount: number, currency: string | undefined) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency || "USD"}`
  }
}

function formatAddress(address: string) {
  if (!address) return ""
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

type PageProps = {
  params: Promise<{ orderId: string }>
}

export default async function OrderSummaryPage({ params }: PageProps) {
  const { orderId } = await params
  const currentWallet = await getUserAddress()
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      shipments: {
        orderBy: { createdAt: "asc" },
      },
      payments: {
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
    },
  })

  if (!order) {
    notFound()
  }

  const ownerLower = currentWallet.toLowerCase()
  if (order.buyer !== ownerLower && order.supplier !== ownerLower) {
    notFound()
  }

  const metadata = parseMetadata(order.metadataRaw)
  const currency = metadata.currency || "USD"
  const items = Array.isArray(metadata.items) ? metadata.items : []
  const totalLineItems = items.reduce((sum, item) => {
    const qty = typeof item.qty === "number" ? item.qty : Number(item.qty ?? 0)
    const price = typeof item.unitPrice === "number" ? item.unitPrice : Number(item.unitPrice ?? 0)
    return sum + qty * price
  }, 0)

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-4 py-8">
      <div>
        <Link href="/dashboard" className="text-sm text-muted-foreground">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Order summary</h1>
        <p className="break-all text-sm text-muted-foreground">Order ID: {order.id}</p>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <header className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-lg font-medium">{order.status}</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Total (metadata)</p>
            <p className="text-lg font-medium">{formatCurrency(order.totalAmount, currency)}</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="text-lg font-medium leading-snug">
              {new Date(order.createdAt).toLocaleString()} •{" "}
              {formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}
            </p>
          </div>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-border bg-background/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">Buyer</p>
            <p className="mt-1 break-all font-mono text-xs">{order.buyer}</p>
          </div>
          <div className="rounded-md border border-border bg-background/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">Supplier</p>
            <p className="mt-1 break-all font-mono text-xs">{order.supplier}</p>
          </div>
          {metadata.chainOrderId && (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">On-chain order</p>
              <p className="mt-1 font-mono text-xs break-all">{String(metadata.chainOrderId)}</p>
            </div>
          )}
          {metadata.chainCreateTxHash && (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">Create tx hash</p>
              <p className="mt-1 font-mono text-xs break-all">
                {metadata.chainCreateTxHash}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-2 text-sm font-medium">Line items</header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Quantity</th>
                <th className="px-3 py-2 text-left">Unit price</th>
                <th className="px-3 py-2 text-left">Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? (
                items.map((item, index) => {
                  const qty = typeof item.qty === "number" ? item.qty : Number(item.qty ?? 0)
                  const unitPrice =
                    typeof item.unitPrice === "number" ? item.unitPrice : Number(item.unitPrice ?? 0)
                  const lineTotal = typeof item.lineTotal === "number" ? item.lineTotal : qty * unitPrice
                  return (
                    <tr key={`${item.skuId ?? index}`} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{item.skuId ?? "Unknown SKU"}</td>
                      <td className="px-3 py-2">{qty}</td>
                      <td className="px-3 py-2">{formatCurrency(unitPrice, currency)}</td>
                      <td className="px-3 py-2">{formatCurrency(lineTotal, currency)}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={4}>
                    No line items recorded for this order.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={3} className="px-3 py-2 text-right font-medium">
                  Metadata total
                </td>
                <td className="px-3 py-2 font-semibold">{formatCurrency(totalLineItems, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-2 text-sm font-medium">Shipments</header>
          <ul className="divide-y divide-border text-sm">
            {order.shipments.length > 0 ? (
              order.shipments.map((shipment) => (
                <li key={shipment.id} className="space-y-2 px-4 py-3">
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>ID</span>
                    <span className="text-right break-all">{shipment.id}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>Status</span>
                    <span className="text-right break-all">{shipment.status}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>Courier</span>
                    <span className="text-right break-all">
                      {shipment.assignedCourier ? formatAddress(shipment.assignedCourier) : "Unassigned"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>Due</span>
                    <span className="text-right break-normal">{new Date(shipment.dueBy).toLocaleString()}</span>
                  </div>
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-center text-xs text-muted-foreground">No shipments created yet.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-2 text-sm font-medium">Recent payments</header>
          <ul className="divide-y divide-border text-sm">
            {order.payments.length > 0 ? (
              order.payments.map((payment) => (
                <li key={payment.id} className="space-y-2 px-4 py-3">
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>Status</span>
                    <span className="text-right break-all">{payment.status}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>Amount</span>
                    <span className="text-right break-all">{formatCurrency(payment.amount, payment.currency)}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>Updated</span>
                    <span className="text-right break-normal">
                      {formatDistanceToNow(new Date(payment.updatedAt), { addSuffix: true })}
                    </span>
                  </div>
                  {payment.escrowTx && (
                    <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                      <span>Escrow tx</span>
                      <span className="font-mono text-right break-all">{formatAddress(payment.escrowTx)}</span>
                    </div>
                  )}
                  {payment.releaseTx && (
                    <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                      <span>Release tx</span>
                      <span className="font-mono text-right break-all">{formatAddress(payment.releaseTx)}</span>
                    </div>
                  )}
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-center text-xs text-muted-foreground">No payment activity yet.</li>
            )}
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground space-y-1">
        <p>
          Pickup coordinates:{" "}
          {metadata.pickup?.lat && metadata.pickup?.lon
            ? `${metadata.pickup.lat}, ${metadata.pickup.lon}`
            : "Not provided"}
        </p>
        <p>
          Drop coordinates:{" "}
          {metadata.drop?.lat && metadata.drop?.lon ? `${metadata.drop.lat}, ${metadata.drop.lon}` : "Not provided"}
        </p>
        {metadata.escrow && (
          <p>
            Escrow metadata:{" "}
            <span className="font-mono">{JSON.stringify(metadata.escrow)}</span>
          </p>
        )}
      </section>
    </main>
  )
}
