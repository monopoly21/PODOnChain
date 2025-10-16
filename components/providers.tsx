"use client"

import type { PropsWithChildren } from "react"
import { ThirdwebProvider } from "thirdweb/react"

import { client } from "@/lib/thirdweb"

export function Providers({ children }: PropsWithChildren) {
  return <ThirdwebProvider client={client}>{children}</ThirdwebProvider>
}
