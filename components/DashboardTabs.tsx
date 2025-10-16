"use client"

import { useState } from "react"

const TABS: Array<{ id: "buyer" | "supplier" | "courier"; label: string }> = [
  { id: "buyer", label: "Buyer" },
  { id: "supplier", label: "Supplier" },
  { id: "courier", label: "Courier" },
]

export function DashboardTabs({
  value,
  onChange,
}: {
  value: "buyer" | "supplier" | "courier"
  onChange: (tab: "buyer" | "supplier" | "courier") => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-full border px-3 py-1 text-sm transition ${
            value === tab.id ? "border-primary bg-primary text-primary-foreground" : "border-border"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function useDashboardTab(initial: "buyer" | "supplier" | "courier" = "buyer") {
  return useState<"buyer" | "supplier" | "courier">(initial)
}
