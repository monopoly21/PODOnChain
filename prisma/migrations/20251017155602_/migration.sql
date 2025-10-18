-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SigningSession" (
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
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SigningSession" ("chainOrderId", "contextHash", "courier", "courierNonce", "courierSignature", "createdAt", "deadline", "id", "orderId", "payload", "sessionUid", "shipmentId", "status", "supplier", "supplierNonce", "supplierSignature", "updatedAt") SELECT "chainOrderId", "contextHash", "courier", "courierNonce", "courierSignature", "createdAt", "deadline", "id", "orderId", "payload", "sessionUid", "shipmentId", "status", "supplier", "supplierNonce", "supplierSignature", "updatedAt" FROM "SigningSession";
DROP TABLE "SigningSession";
ALTER TABLE "new_SigningSession" RENAME TO "SigningSession";
CREATE UNIQUE INDEX "SigningSession_sessionUid_key" ON "SigningSession"("sessionUid");
CREATE INDEX "SigningSession_shipmentId_idx" ON "SigningSession"("shipmentId");
CREATE INDEX "SigningSession_orderId_idx" ON "SigningSession"("orderId");
CREATE INDEX "SigningSession_status_idx" ON "SigningSession"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
