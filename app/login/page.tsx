"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { PYUSDLoginCard } from "@/components/login/pyusd-login-card"
import { useActiveAccount } from "thirdweb/react"

export default function LoginPage() {
  const router = useRouter()
  const account = useActiveAccount()

  useEffect(() => {
    if (!account) return

    const address = account.address.toLowerCase()
    if (typeof window !== "undefined") {
      localStorage.setItem("wallet", address)
      document.cookie = `wallet=${address}; path=/`
      router.replace("/dashboard")
    }
  }, [account, router])

  useEffect(() => {
    if (account) return
    if (typeof window === "undefined") return
    const stored = localStorage.getItem("wallet")
    if (stored && stored.startsWith("0x") && stored.length === 42) {
      document.cookie = `wallet=${stored}; path=/`
      router.replace("/dashboard")
    }
  }, [account, router])

  return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-4 py-12">
      <PYUSDLoginCard />
    </main>
  )
}
