"use client"

import { useEffect, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ConnectButton,
  useActiveAccount,
  useActiveWallet,
  useActiveWalletChain,
  useActiveWalletConnectionStatus,
  useDisconnect,
} from "thirdweb/react"
import { createWallet } from "thirdweb/wallets"
import { sepolia } from "thirdweb/chains"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { client } from "@/lib/thirdweb"

const wallets = [createWallet("io.metamask"), createWallet("com.coinbase.wallet")]

const PRIMARY_NAV = [
  { href: "/dashboard", label: "Control Tower" },
  { href: "/shipments", label: "Shipments" },
  { href: "/settings/imports", label: "Catalog & Settings" },
]

function isNavActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === "/dashboard") {
    return pathname === href || pathname.startsWith("/dashboard")
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

type BrandSidebarProps = {
  onNavigate?: () => void
  variant?: "desktop" | "mobile"
}

export function BrandSidebar({ onNavigate, variant = "desktop" }: BrandSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const account = useActiveAccount()
  const chain = useActiveWalletChain()
  const wallet = useActiveWallet()
  const { disconnect } = useDisconnect()
  const connectionStatus = useActiveWalletConnectionStatus()

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
      pathname?.startsWith("/courier/") || pathname?.startsWith("/sign/") || pathname === "/login"
    if (!account && connectionStatus === "disconnected" && pathname !== "/" && !allowAnonymous) {
      router.replace("/")
    }
  }, [account, connectionStatus, pathname, router])

  const displayAddress = useMemo(() => {
    if (!account) return null
    return `${account.address.slice(0, 6)}…${account.address.slice(-4)}`
  }, [account])

  const sidebarClasses =
    variant === "mobile"
      ? "flex h-full w-full flex-col gap-10 px-6"
      : "flex h-full w-full flex-col gap-12"

  return (
    <div className={cn(sidebarClasses)}>
      <div className="space-y-6">
        <Link
          href="/"
          onClick={onNavigate}
          className="inline-block rounded-[1.75rem] border-[3px] border-border bg-card px-5 py-3 text-lg font-black uppercase tracking-[0.35em] [box-shadow:var(--shadow-hard)]"
        >
          PODx
        </Link>
        <p className="max-w-xs text-sm font-medium leading-relaxed text-muted-foreground">
          Wallet-native orchestration for trustless supply chains. Monitor orders, automate disputes, and release
          escrow with geo-proof.
        </p>

        <nav className="space-y-2">
          {PRIMARY_NAV.map((item) => {
            const active = isNavActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between rounded-[1.5rem] border-[3px] px-5 py-3 text-sm font-semibold uppercase tracking-wide transition-transform duration-200 ease-out hover:-translate-y-0.5",
                  active
                    ? "bg-primary text-primary-foreground [box-shadow:var(--shadow-hard)]"
                    : "bg-card text-foreground [box-shadow:var(--shadow-soft)]",
                )}
              >
                <span>{item.label}</span>
                <span aria-hidden>↗</span>
              </Link>
            )
          })}
        </nav>

        <div className="neo-pill inline-flex items-center gap-2 text-xs">
          <span className="size-2 rounded-full bg-emerald-500" />
          {account ? "Control tower linked" : "Guest mode"}
        </div>
      </div>

      <div className="space-y-4">
        <div className="neo-surface flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-sm font-semibold uppercase tracking-wide">
            <span>Status</span>
            <span>{chain?.name ?? "Unknown chain"}</span>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-mono text-base">{displayAddress ?? "Not connected"}</p>
            <p className="text-muted-foreground">
              {account ? "Wallet synced for attestation signing." : "Connect to access the control tower."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ConnectButton
              client={client}
              chain={sepolia}
              wallets={wallets}
              connectModal={{ size: "compact" }}
              onDisconnect={async () => {
                if (wallet) {
                  await disconnect(wallet)
                }
                onNavigate?.()
                router.replace("/")
              }}
            />
            {account ? (
              <Button
                variant="outline"
                size="sm"
                className="uppercase tracking-wide"
                onClick={async () => {
                  if (wallet) {
                    await disconnect(wallet)
                  }
                  onNavigate?.()
                  router.replace("/")
                }}
              >
                Sign out
              </Button>
            ) : null}
          </div>
        </div>

        <div className="rounded-[1.75rem] border-[3px] border-border bg-secondary px-5 py-4 text-xs font-semibold uppercase tracking-wide text-secondary-foreground [box-shadow:var(--shadow-soft)]">
          Escrow-ready • Geo-fenced verification • PYUSD on Sepolia
        </div>
      </div>
    </div>
  )
}
