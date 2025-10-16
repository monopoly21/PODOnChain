"use client"

import { useEffect, useState } from "react"

export function Connect() {
  const [wallet, setWallet] = useState("")

  useEffect(() => {
    const stored = localStorage.getItem("wallet") || ""
    setWallet(stored)
    if (stored) {
      document.cookie = `wallet=${stored}; path=/`
    }
  }, [])

  function handleChange(value: string) {
    setWallet(value)
    localStorage.setItem("wallet", value)
    document.cookie = `wallet=${value}; path=/`
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={wallet}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="0xYourWallet (dev)"
        className="w-72 rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <span className="text-xs text-muted-foreground">Simulate thirdweb wallet connection</span>
    </div>
  )
}
