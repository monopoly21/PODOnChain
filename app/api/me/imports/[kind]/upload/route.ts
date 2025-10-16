import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { saveCsv } from "@/lib/storage"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

const SUPPORTED = new Set(["buyer", "supplier"])

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  const owner = await getUserAddress()
  const { kind: rawKind } = await context.params
  const kind = rawKind as "buyer" | "supplier"

  if (!SUPPORTED.has(kind)) {
    return NextResponse.json({ error: "Unsupported import kind" }, { status: 400 })
  }

  const form = await request.formData()
  const file = form.get("file")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing CSV file" }, { status: 400 })
  }

  const { destination, hash } = await saveCsv(owner, kind, file)

  await prisma.import.upsert({
    where: { id: `${owner}-${kind}` },
    update: {
      path: destination,
      sha256: hash,
      originalName: file.name,
      status: "STAGING",
      rowCount: null,
    },
    create: {
      id: `${owner}-${kind}`,
      owner,
      kind,
      path: destination,
      sha256: hash,
      originalName: file.name,
      status: "STAGING",
    },
  })

  return NextResponse.json({ ok: true, path: destination, sha256: hash })
}
