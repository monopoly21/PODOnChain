"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AnimatedSteps } from "@/components/animated-steps"
import { TruckBackground } from "@/components/animations/truck-bg"
import { useActiveAccount } from "thirdweb/react"

export default function LandingPage() {
  const account = useActiveAccount()
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <section className="relative mx-auto max-w-6xl px-4 py-16 flex flex-col items-center text-center gap-8">
        {/* background truck animation */}
        <TruckBackground />
        <div className="space-y-4">
          <p className="inline-block rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground">
            Autonomous Supply Chain
          </p>
          <h1 className="text-3xl md:text-5xl font-semibold text-balance">
            PODx: Agent-driven supply, escrowed with PYUSD, verified delivery
          </h1>
          <p className="text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Request quotes, create POs, fund PYUSD escrow on testnet, ship with QR or Lit geofence proof, and
            auto-release on delivery. Fully auditable with explorer links.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {account && (
            <Link href="/dashboard">
              <Button variant={account ? "default" : "secondary"}>Open Dashboard</Button>
            </Link>
          )}
          
          {/* <Link href="/dashboard">
            <Button variant={account ? "default" : "secondary"}>Open Dashboard</Button>
          </Link> */}
        </div>

        <div className="w-full mt-8">
          <AnimatedSteps />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mt-4">
          <Feature
            title="Buyer workflow"
            items={["Import catalog", "Create PO & fund escrow", "Monitor shipments"]}
          />
          <Feature
            title="Supplier workflow"
            items={["Approve orders", "Assign couriers", "Create Lit-gated shipments"]}
          />
          <Feature
            title="Courier workflow"
            items={["Claim jobs", "Verify pickup", "Lit-verified delivery"]}
          />
        </div>
      </section>
    </main>
  )
}

function Feature({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-left">
      <h3 className="font-medium mb-2">{title}</h3>
      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}
