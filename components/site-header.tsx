"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  ConnectButton,
  useActiveAccount,
  useActiveWallet,
  useActiveWalletChain,
  useDisconnect,
  useActiveWalletConnectionStatus,
} from "thirdweb/react"
import { sepolia } from "thirdweb/chains"
import { createWallet } from "thirdweb/wallets"

import { client } from "@/lib/thirdweb"

const wallets = [createWallet("io.metamask"), createWallet("com.coinbase.wallet")]

export function BrandHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const account = useActiveAccount()
  const wallet = useActiveWallet()
  const chain = useActiveWalletChain()
  const { disconnect } = useDisconnect()
  const connectionStatus = useActiveWalletConnectionStatus()

  const navItems = account
    ? [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/settings/imports", label: "Settings" },
      ]
    : []

  useEffect(() => {
    if (account) {
      const address = account.address.toLowerCase()
      localStorage.setItem("wallet", address)
      document.cookie = `wallet=${address}; path=/`
    } else {
      localStorage.removeItem("wallet")
      document.cookie = "wallet=; Max-Age=0; path=/"
    }
  }, [account])

  useEffect(() => {
    if (!account) return
    if (pathname === "/login") {
      router.replace("/dashboard")
    }
  }, [account, pathname, router])

  useEffect(() => {
    const allowAnonymous =
      pathname?.startsWith("/courier/") ||
      pathname?.startsWith("/sign/") ||
      pathname === "/login"
    if (
      !account &&
      connectionStatus === "disconnected" &&
      pathname !== "/" &&
      !allowAnonymous
    ) {
      router.replace("/")
    }
  }, [account, connectionStatus, pathname, router])

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          PODx
        </Link>
        <nav className="flex items-center gap-3">
          {navItems.map((item) => {
            const isActive = pathname?.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}>
                <Button variant={isActive ? "default" : "ghost"}>{item.label}</Button>
              </Link>
            )
          })}
          {account ? (
            <div className="hidden text-xs text-muted-foreground sm:flex sm:flex-col sm:items-end">
              <span className="font-mono">
                {account.address.slice(0, 6)}…{account.address.slice(-4)}
              </span>
              <span>{chain?.name ?? "Unknown chain"}</span>
            </div>
          ) : null}
          <ConnectButton
            client={client}
            chain={sepolia}
            wallets={wallets}
            connectModal={{ size: "compact" }}
            onDisconnect={async () => {
              if (wallet) {
                disconnect(wallet)
              }
              router.replace("/")
            }}
          />
        </nav>
      </div>
    </header>
  )
}
