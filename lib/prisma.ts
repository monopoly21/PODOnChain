import { PrismaClient } from "@prisma/client"

type ExtendedPrismaClient = PrismaClient & { readonly _shutdown?: () => Promise<void> }

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: ExtendedPrismaClient | undefined
}

export const prisma: PrismaClient = global.__prismaClient ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma
}
