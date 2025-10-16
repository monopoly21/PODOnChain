import fs from "fs/promises"
import path from "path"
import crypto from "crypto"

export const DATA_DIR = path.join(process.cwd(), "data")
export const IMPORT_ROOT = path.join(DATA_DIR, "imports")
export const REPORT_ROOT = path.join(DATA_DIR, "reports")

async function ensureDir(target: string) {
  await fs.mkdir(target, { recursive: true })
}

export async function saveCsv(owner: string, kind: "buyer" | "supplier", file: File) {
  const safeOwner = owner.toLowerCase()
  const targetDir = path.join(IMPORT_ROOT, safeOwner)
  await ensureDir(targetDir)

  const destination = path.join(targetDir, `${kind}.csv`)
  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(destination, buffer)

  const hash = crypto.createHash("sha256").update(buffer).digest("hex")
  return { destination, hash }
}

export async function readCsvPath(owner: string, kind: "buyer" | "supplier") {
  const safeOwner = owner.toLowerCase()
  return path.join(IMPORT_ROOT, safeOwner, `${kind}.csv`)
}

export async function writeProof(shipmentNo: number, kind: "pickup" | "drop", payload: unknown) {
  const dir = path.join(DATA_DIR, "proofs", String(shipmentNo))
  await ensureDir(dir)
  const destination = path.join(dir, `${kind}-${Date.now()}.json`)
  await fs.writeFile(destination, JSON.stringify(payload, null, 2), "utf8")
  return destination
}

export async function writeReport(owner: string, kind: "buyer" | "supplier", contents: string) {
  const dir = path.join(REPORT_ROOT, owner.toLowerCase())
  await ensureDir(dir)
  const target = path.join(dir, `${kind}-${Date.now()}.txt`)
  await fs.writeFile(target, contents, "utf8")
  return target
}
