import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getUserAddress } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET() {
  const owner = await getUserAddress()
  const locations = await prisma.location.findMany({
    where: { owner },
    orderBy: { locationId: "asc" },
  })
  return NextResponse.json(locations.map(serializeLocation))
}

function serializeLocation(location: any) {
  const { addressRaw, ...rest } = location
  const parsed = addressRaw ? safeParse(addressRaw) : {}
  return {
    ...rest,
    address: parsed && typeof parsed === "object" ? parsed : {},
  }
}

function safeParse(value: string | null | undefined) {
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch (error) {
    return {}
  }
}
