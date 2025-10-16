import { cookies } from "next/headers"

/**
 * Resolve the active wallet for server routes. Replace with thirdweb Auth / SIWE in production.
 */
export async function getUserAddress() {
  const cookieStore = await cookies()
  const cookieAddress = normaliseAddress(cookieStore.get("wallet")?.value)

  if (cookieAddress) {
    return cookieAddress
  }

  const fallbackAddress = [
    process.env.NEXT_PUBLIC_DEFAULT_WALLET,
    process.env.DEFAULT_WALLET,
    process.env.DEV_WALLET,
  ].map(normaliseAddress).find(Boolean)

  if (fallbackAddress) {
    return fallbackAddress
  }

  throw new Error("UNAUTHENTICATED")
}

function normaliseAddress(value: string | undefined | null) {
  const candidate = (value || "").trim().toLowerCase()

  if (!candidate || !candidate.startsWith("0x") || candidate.length !== 42) {
    return null
  }

  return candidate
}
