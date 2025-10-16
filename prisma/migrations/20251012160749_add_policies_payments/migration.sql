-- CreateTable
CREATE TABLE "InventoryPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyer" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "preferredSupplier" TEXT,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 0,
    "targetQuantity" INTEGER NOT NULL DEFAULT 0,
    "minReorderQty" INTEGER NOT NULL DEFAULT 0,
    "maxReorderQty" INTEGER,
    "maxUnitPrice" DECIMAL,
    "currency" TEXT,
    "metadataRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "escrowTx" TEXT,
    "releaseTx" TEXT,
    "metadataRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyer" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "approvedAt" DATETIME,
    "fundedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "metadataRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Order" ("buyer", "createdAt", "id", "metadataRaw", "status", "supplier", "totalAmount", "updatedAt") SELECT "buyer", "createdAt", "id", "metadataRaw", "status", "supplier", "totalAmount", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX "Order_buyer_idx" ON "Order"("buyer");
CREATE INDEX "Order_supplier_idx" ON "Order"("supplier");
CREATE TABLE "new_Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "shipmentNo" INTEGER NOT NULL,
    "supplier" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "pickupLat" REAL,
    "pickupLon" REAL,
    "dropLat" REAL,
    "dropLon" REAL,
    "dueBy" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Created',
    "assignedCourier" TEXT,
    "metadataRaw" TEXT,
    "readyAt" DATETIME,
    "pickedUpAt" DATETIME,
    "deliveredAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Shipment" ("assignedCourier", "buyer", "createdAt", "dropLat", "dropLon", "dueBy", "id", "metadataRaw", "orderId", "pickupLat", "pickupLon", "shipmentNo", "status", "supplier", "updatedAt") SELECT "assignedCourier", "buyer", "createdAt", "dropLat", "dropLon", "dueBy", "id", "metadataRaw", "orderId", "pickupLat", "pickupLon", "shipmentNo", "status", "supplier", "updatedAt" FROM "Shipment";
DROP TABLE "Shipment";
ALTER TABLE "new_Shipment" RENAME TO "Shipment";
CREATE INDEX "Shipment_supplier_idx" ON "Shipment"("supplier");
CREATE INDEX "Shipment_buyer_idx" ON "Shipment"("buyer");
CREATE INDEX "Shipment_assignedCourier_idx" ON "Shipment"("assignedCourier");
CREATE UNIQUE INDEX "Shipment_shipmentNo_supplier_key" ON "Shipment"("shipmentNo", "supplier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "InventoryPolicy_buyer_idx" ON "InventoryPolicy"("buyer");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPolicy_buyer_skuId_key" ON "InventoryPolicy"("buyer", "skuId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_payer_idx" ON "Payment"("payer");

-- CreateIndex
CREATE INDEX "Payment_payee_idx" ON "Payment"("payee");
