"use client"

import { cn } from "@/lib/utils"

const STEPS = [
  { k: "inventory", title: "Inventory", desc: "Thresholds trigger RFQs/POs" },
  { k: "escrow", title: "Escrow (PYUSD)", desc: "Fund on testnet for safety" },
  { k: "ship", title: "Ship", desc: "Master QR and courier tooling" },
  { k: "verify", title: "Verify", desc: "Signed milestones with geofence checks" },
  { k: "release", title: "Release", desc: "Auto-pay supplier on Delivered" },
]

export function AnimatedSteps() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      {STEPS.map((s, i) => (
        <div
          key={s.k}
          className={cn(
            "neo-surface p-5 text-left",
            "animate-in fade-in slide-in-from-bottom duration-700",
          )}
          style={{ animationDelay: `${i * 120}ms` }}
        >
          <div className="text-sm text-muted-foreground">Step {i + 1}</div>
          <div className="text-lg font-medium">{s.title}</div>
          <p className="text-muted-foreground leading-relaxed mt-1">{s.desc}</p>
        </div>
      ))}
    </div>
  )
}
