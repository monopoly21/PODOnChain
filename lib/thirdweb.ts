import { createThirdwebClient } from "thirdweb"

const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID
if (!clientId) {
  console.warn("[PODx] Missing NEXT_PUBLIC_THIRDWEB_CLIENT_ID for thirdweb client")
}

export const client = createThirdwebClient({
  clientId: clientId || "NO_CLIENT_ID_SET",
})
