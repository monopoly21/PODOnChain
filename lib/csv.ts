export type BuyerCsvRow = {
  recordType?: string
  skuId?: string
  name?: string
  unit?: string
  minThreshold?: string
  targetStock?: string
  locationId?: string
  locationName?: string
  line1?: string
  city?: string
  state?: string
  country?: string
  postal?: string
  timezone?: string
  lat?: string
  lon?: string
}

export type SupplierCsvRow = {
  recordType?: string
  skuId?: string
  unitPrice?: string
  currency?: string
  leadDays?: string
  minQty?: string
  courierWallet?: string
  courierName?: string
}

function sanitise(value: string) {
  return value.trim().replace(/^\ufeff/, "")
}

export function parseCsv<T = Record<string, string>>(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (!lines.length) {
    return [] as T[]
  }

  const headers = lines[0].split(",").map(sanitise)
  const rows: Record<string, string>[] = []

  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(",").map(sanitise)
    const entry: Record<string, string> = {}
    headers.forEach((header, headerIndex) => {
      entry[header] = cells[headerIndex] ?? ""
    })
    rows.push(entry)
  }

  return rows as unknown as T[]
}
