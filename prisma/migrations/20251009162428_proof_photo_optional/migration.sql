-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Proof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "photoHash" TEXT,
    "photoCid" TEXT,
    "signer" TEXT NOT NULL,
    "claimedTs" INTEGER NOT NULL,
    "litDistance" INTEGER,
    "litOk" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Proof" ("claimedTs", "createdAt", "id", "kind", "litDistance", "litOk", "photoCid", "photoHash", "shipmentNo", "signer") SELECT "claimedTs", "createdAt", "id", "kind", "litDistance", "litOk", "photoCid", "photoHash", "shipmentNo", "signer" FROM "Proof";
DROP TABLE "Proof";
ALTER TABLE "new_Proof" RENAME TO "Proof";
CREATE INDEX "Proof_shipmentNo_idx" ON "Proof"("shipmentNo");
CREATE INDEX "Proof_signer_idx" ON "Proof"("signer");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
