"use client"

import { MenuIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { BrandSidebar } from "@/components/site-header"

const BARE_LAYOUT_ROUTES = [
  "/",
  "/login",
]

const BARE_PREFIXES = ["/sign/", "/courier/"]

type AppShellProps = {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const shouldUseBareLayout = (() => {
    if (!pathname) return false
    if (BARE_LAYOUT_ROUTES.includes(pathname)) return true
    return BARE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  })()

  if (shouldUseBareLayout) {
    return <div className="min-h-dvh bg-background text-foreground">{children}</div>
  }

  return (
    <div className="relative flex min-h-dvh bg-background text-foreground">
      <aside className="hidden lg:flex lg:w-80 2xl:w-96 shrink-0 border-r-[3px] border-border bg-sidebar px-6 py-10 [box-shadow:var(--shadow-hard)]">
        <BrandSidebar onNavigate={() => setMobileNavOpen(false)} />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs border-l-[3px] border-border bg-sidebar px-0 py-10">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Application navigation for small screens.</SheetDescription>
          </SheetHeader>
          <BrandSidebar onNavigate={() => setMobileNavOpen(false)} variant="mobile" />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-dvh flex-1 flex-col">
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b-[3px] border-border bg-background/95 px-4 py-4 backdrop-blur lg:hidden">
          <Button
            variant="outline"
            size="sm"
            className="border-[3px] border-border bg-secondary text-foreground uppercase tracking-wide"
            onClick={() => setMobileNavOpen(true)}
          >
            <MenuIcon className="size-4" />
            Menu
          </Button>
          <Link href="/" className={cn("font-black uppercase tracking-[0.2em] text-sm")}>
            PODOnChain Control Tower
          </Link>
        </div>

        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">{children}</div>
        </main>
      </div>
    </div>
  )
}
