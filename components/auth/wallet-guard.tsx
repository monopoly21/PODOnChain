"use client"

import { type ReactNode, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"

export function WalletGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const account = useActiveAccount()

  useEffect(() => {
    if (!account) {
      router.replace("/login")
    }
  }, [account, router])

  if (!account) {
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">Redirecting to login…</div>
  }

  return <>{children}</>
}
