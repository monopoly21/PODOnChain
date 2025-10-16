import fs from "fs/promises"
import { NextResponse } from "next/server"

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { readCsvPath, writeReport } from "@/lib/storage"
import { parseCsv, type BuyerCsvRow, type SupplierCsvRow } from "@/lib/csv"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

const SUPPORTED = new Set(["buyer", "supplier"])

export async function POST(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const owner = await getUserAddress()
  const { kind: rawKind } = await context.params
  const kind = rawKind as "buyer" | "supplier"

  if (!SUPPORTED.has(kind)) {
    return NextResponse.json({ error: "Unsupported import kind" }, { status: 400 })
  }

  const csvPath = await readCsvPath(owner, kind)
  try {
    await fs.access(csvPath)
  } catch (error) {
    return NextResponse.json({ error: "Upload a CSV first" }, { status: 400 })
  }

  const raw = await fs.readFile(csvPath, "utf8")
  const rows = parseCsv(raw) as Array<BuyerCsvRow | SupplierCsvRow>

  let ok = 0
  let fail = 0
  const errors: string[] = []

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (kind === "buyer") {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as BuyerCsvRow
        const marker = `row ${index + 2}`

        try {
          if ((row.recordType || "").toLowerCase() === "product") {
            if (!row.skuId || !row.name) throw new Error(`${marker}: skuId and name required`)
            await tx.product.upsert({
              where: { owner_skuId: { owner, skuId: row.skuId } },
              update: {
                name: row.name,
                unit: row.unit || "unit",
                minThreshold: Number(row.minThreshold ?? 0),
                targetStock: Number(row.targetStock ?? 0),
                version: { increment: 1 },
              },
              create: {
                owner,
                skuId: row.skuId,
                name: row.name,
                unit: row.unit || "unit",
                minThreshold: Number(row.minThreshold ?? 0),
                targetStock: Number(row.targetStock ?? 0),
              },
            })
          } else if ((row.recordType || "").toLowerCase() === "location") {
            if (!row.locationId || !row.locationName || !row.timezone) {
              throw new Error(`${marker}: locationId, locationName, timezone required`)
            }
            const address = {
              line1: row.line1 ?? "",
              city: row.city ?? "",
              state: row.state ?? "",
              country: row.country ?? "",
              postal: row.postal ?? "",
            }
            const addressRaw = JSON.stringify(address)
            await tx.location.upsert({
              where: { owner_locationId: { owner, locationId: row.locationId } },
              update: {
                name: row.locationName,
                addressRaw,
                timezone: row.timezone,
                lat: row.lat ? Number(row.lat) : null,
                lon: row.lon ? Number(row.lon) : null,
                version: { increment: 1 },
              },
              create: {
                owner,
                locationId: row.locationId,
                name: row.locationName,
                addressRaw,
                timezone: row.timezone,
                lat: row.lat ? Number(row.lat) : null,
                lon: row.lon ? Number(row.lon) : null,
              },
            })
          } else if (!row.recordType) {
            // skip empty
            continue
          } else {
            throw new Error(`${marker}: unknown recordType "${row.recordType}"`)
          }

          ok += 1
        } catch (error) {
          fail += 1
          errors.push(error instanceof Error ? error.message : `${marker}: unknown error`)
        }
      }
    } else {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as SupplierCsvRow
        const marker = `row ${index + 2}`

        try {
          if ((row.recordType || "").toLowerCase() === "price") {
            if (!row.skuId || !row.unitPrice || !row.currency) {
              throw new Error(`${marker}: skuId, unitPrice, currency required`)
            }
            await tx.supplierPrice.upsert({
              where: { owner_skuId: { owner, skuId: row.skuId } },
              update: {
                unitPrice: row.unitPrice,
                currency: row.currency,
                leadDays: Number(row.leadDays ?? 0),
                minQty: Number(row.minQty ?? 1),
                version: { increment: 1 },
              },
              create: {
                owner,
                skuId: row.skuId,
                unitPrice: row.unitPrice,
                currency: row.currency,
                leadDays: Number(row.leadDays ?? 0),
                minQty: Number(row.minQty ?? 1),
              },
            })
          } else if ((row.recordType || "").toLowerCase() === "courier") {
            if (!row.courierWallet) {
              throw new Error(`${marker}: courierWallet required`)
            }
            const normalized = row.courierWallet.toLowerCase()
            await tx.courier.upsert({
              where: { owner_courierWallet: { owner, courierWallet: normalized } },
              update: {
                label: row.courierName ?? null,
                version: { increment: 1 },
              },
              create: {
                owner,
                courierWallet: normalized,
                label: row.courierName ?? null,
              },
            })
          } else if (!row.recordType) {
            continue
          } else {
            throw new Error(`${marker}: unknown recordType "${row.recordType}"`)
          }
          ok += 1
        } catch (error) {
          fail += 1
          errors.push(error instanceof Error ? error.message : `${marker}: unknown error`)
        }
      }
    }
  })

  await prisma.import.update({
    where: { id: `${owner}-${kind}` },
    data: {
      rowCount: rows.length,
      status: fail ? "FAILED" : "COMPLETED",
    },
  })

  const reportPath = await writeReport(owner, kind, [`ok=${ok}`, `fail=${fail}`, ...errors].join("\n"))

  return NextResponse.json({ ok, fail, errors, reportPath })
}
