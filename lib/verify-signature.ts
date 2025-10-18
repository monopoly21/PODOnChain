import { Contract, TypedDataEncoder, getAddress, verifyTypedData } from "ethers"

import { getProvider } from "@/lib/contracts"

const ERC1271_MAGIC_VALUE = "0x1626ba7e"
const ERC1271_ABI = ["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]

export async function verifyTypedSignature({
  expectedSigner,
  domain,
  types,
  message,
  signature,
}: {
  expectedSigner: string
  domain: Record<string, unknown>
  types: Record<string, Array<{ name: string; type: string }>>
  message: Record<string, unknown>
  signature: string
}): Promise<{ valid: boolean; recovered?: string }> {
  const normalized = getAddress(expectedSigner)

  try {
    const recovered = verifyTypedData(domain as any, types as any, message, signature)
    if (getAddress(recovered) === normalized) {
      return { valid: true, recovered }
    }
    return { valid: false, recovered }
  } catch {
    // ignored, fallback to ERC-1271 path
  }

  try {
    const provider = getProvider()
    const contract = new Contract(normalized, ERC1271_ABI, provider)
    const digest = TypedDataEncoder.hash(domain as any, types as any, message)
    const result = await contract.isValidSignature(digest, signature)
    return { valid: result === ERC1271_MAGIC_VALUE }
  } catch {
    return { valid: false }
  }
}
