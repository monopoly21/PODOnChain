"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AnimatedSteps } from "@/components/animated-steps"
import { TruckBackground } from "@/components/animations/truck-bg"
import { useActiveAccount } from "thirdweb/react"

export default function LandingPage() {
  const account = useActiveAccount()
  return (
    <main className="relative overflow-hidden">
      <TruckBackground />
      <section className="relative mx-auto flex min-h-[80vh] max-w-6xl flex-col gap-12 px-4 py-16 sm:px-6 md:px-8 lg:pt-20">
        <div className="inline-flex max-w-max items-center gap-2 rounded-full border-[3px] border-border bg-secondary px-5 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-foreground [box-shadow:var(--shadow-soft)]">
          <span className="size-2 rounded-full bg-emerald-500" />
          Live on Sepolia • PYUSD escrow • Geo-fenced proofs
        </div>

        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="space-y-6">
            <h1 className="text-balance text-4xl font-black leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Bold, agentic control for supply chains that refuse to slip.
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground lg:text-xl">
              PODx fuses programmable escrow, attested pickups, and real-time delivery geofence checks into a single
              command center. Automate PO funding, monitor courier accountability, and release payments the instant a
              drop is verified.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={account ? "/dashboard" : "/login"}>
                <Button size="lg" variant="default">
                  {account ? "Launch Control Tower" : "Connect Wallet"}
                </Button>
              </Link>
              <Link
                href="/dashboard"
                className="neo-link text-sm font-semibold uppercase tracking-wide text-foreground"
              >
                Explore the live sandbox
              </Link>
            </div>
          </div>

          <div className="neo-surface grid gap-5 rounded-[32px] bg-card/80 p-6 lg:p-8">
            <h2 className="text-xl font-semibold uppercase tracking-wide text-muted-foreground">Why teams switch</h2>
            <ul className="space-y-4 text-sm leading-relaxed text-foreground">
              <li>
                <span className="font-semibold text-primary">Trustless fulfillment:</span> every pickup/drop double-signed
                and hashed on-chain.
              </li>
              <li>
                <span className="font-semibold text-primary">Agent automations:</span> inventory, payments, and dispute
                playbooks respond in real-time.
              </li>
              <li>
                <span className="font-semibold text-primary">Zero guesswork:</span> courier location proofs and chain
                receipts aligned in one pane of glass.
              </li>
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Orders reconciled", value: "4.8M" },
                { label: "Shipments verified", value: "12.4K" },
                { label: "Avg escrow release", value: "< 90s" },
                { label: "Disputes auto-resolved", value: "96%" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex flex-col gap-1 rounded-[1.5rem] border-[3px] border-border bg-secondary/70 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-secondary-foreground [box-shadow:var(--shadow-soft)]"
                >
                  <span>{stat.label}</span>
                  <span className="text-2xl font-black text-foreground">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="neo-surface grid gap-6 rounded-[32px] bg-card/90 p-6 md:p-8">
          <header className="flex flex-col gap-2 text-left md:flex-row md:items-end md:justify-between">
            <div>
              <p className="neo-badge inline-flex items-center gap-2 text-xs">
                Courier, Supplier & Buyer orchestration
              </p>
              <h2 className="mt-3 text-2xl font-bold uppercase tracking-tight">How automations fire in PODx</h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Agents watch every milestone. Trigger proofs, update inventory, and release funds without waiting on
              spreadsheets or manual reconciliations.
            </p>
          </header>
          <AnimatedSteps />
        </div>

        <div className="grid w-full gap-4 md:grid-cols-3">
          <Feature
            title="Buyer cockpit"
            items={["Self-serve catalog imports", "Escrowed purchase orders", "Inventory agents on call"]}
          />
          <Feature
            title="Supplier vault"
            items={["Courier allowlisting", "Programmatic dispatch", "Pickup countersign workflows"]}
          />
          <Feature
            title="Courier toolkit"
            items={["Geo-fenced verifications", "QR-linked attestation payloads", "Instant drop settlements"]}
          />
        </div>
      </section>
    </main>
  )
}

function Feature({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="neo-surface rounded-[28px] bg-card/95 p-6 text-left">
      <h3 className="mb-3 text-lg font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1 inline-block size-2 rounded-full bg-primary" aria-hidden />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
