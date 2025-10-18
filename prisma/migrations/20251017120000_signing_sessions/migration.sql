-- CreateTable
CREATE TABLE "SigningSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionUid" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "chainOrderId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "deadline" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SUPPLIER',
    "courierNonce" TEXT NOT NULL,
    "supplierNonce" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "courierSignature" TEXT,
    "supplierSignature" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MagicLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    CONSTRAINT "MagicLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SigningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SigningSession_sessionUid_key" ON "SigningSession"("sessionUid");

-- CreateIndex
CREATE INDEX "SigningSession_shipmentId_idx" ON "SigningSession"("shipmentId");

-- CreateIndex
CREATE INDEX "SigningSession_orderId_idx" ON "SigningSession"("orderId");

-- CreateIndex
CREATE INDEX "SigningSession_status_idx" ON "SigningSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_tokenHash_key" ON "MagicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLink_sessionId_idx" ON "MagicLink"("sessionId");
