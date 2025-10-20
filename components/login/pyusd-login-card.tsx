"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConnectButton, useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { createWallet } from "thirdweb/wallets"
import { sepolia } from "thirdweb/chains"

import { client } from "@/lib/thirdweb"

const wallets = [createWallet("io.metamask"), createWallet("com.coinbase.wallet")]

export function PYUSDLoginCard() {
  const account = useActiveAccount()
  const chain = useActiveWalletChain()

  return (
    <Card className="w-full max-w-md border-[3px] border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Connect Wallet
          <Badge variant="outline">PYUSD Testnet</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 px-6 pb-6">
        <p className="text-muted-foreground leading-relaxed">
          Connect with a thirdweb-supported wallet on Sepolia to simulate PYUSD escrow flows. Once connected we store the
          address locally and redirect you to the dashboard.
        </p>

        <div className="flex justify-center">
          <ConnectButton client={client} chain={sepolia} wallets={wallets} connectModal={{ size: "compact" }} />
        </div>

        <div className="text-center text-xs text-muted-foreground">
          {account ? (
            <span>
              Connected {account.address.slice(0, 6)}…{account.address.slice(-4)} on {chain?.name ?? "unknown chain"}
            </span>
          ) : (
            <span>Not connected</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
