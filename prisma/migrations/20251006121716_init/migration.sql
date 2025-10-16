-- CreateTable
CREATE TABLE "User" (
    "wallet" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "rowCount" INTEGER,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "owner" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "minThreshold" INTEGER NOT NULL DEFAULT 0,
    "targetStock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("owner", "skuId")
);

-- CreateTable
CREATE TABLE "Location" (
    "owner" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressRaw" TEXT NOT NULL,
    "lat" REAL,
    "lon" REAL,
    "timezone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("owner", "locationId")
);

-- CreateTable
CREATE TABLE "SupplierPrice" (
    "owner" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("owner", "skuId")
);

-- CreateTable
CREATE TABLE "Courier" (
    "owner" TEXT NOT NULL,
    "courierWallet" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("owner", "courierWallet")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyer" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "metadataRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
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
    "status" TEXT NOT NULL,
    "assignedCourier" TEXT,
    "metadataRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Proof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "photoHash" TEXT NOT NULL,
    "photoCid" TEXT,
    "signer" TEXT NOT NULL,
    "claimedTs" INTEGER NOT NULL,
    "litDistance" INTEGER,
    "litOk" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Import_owner_idx" ON "Import"("owner");

-- CreateIndex
CREATE INDEX "Product_owner_idx" ON "Product"("owner");

-- CreateIndex
CREATE INDEX "Location_owner_idx" ON "Location"("owner");

-- CreateIndex
CREATE INDEX "SupplierPrice_owner_idx" ON "SupplierPrice"("owner");

-- CreateIndex
CREATE INDEX "Courier_owner_idx" ON "Courier"("owner");

-- CreateIndex
CREATE INDEX "Courier_courierWallet_idx" ON "Courier"("courierWallet");

-- CreateIndex
CREATE INDEX "Order_buyer_idx" ON "Order"("buyer");

-- CreateIndex
CREATE INDEX "Order_supplier_idx" ON "Order"("supplier");

-- CreateIndex
CREATE INDEX "Shipment_supplier_idx" ON "Shipment"("supplier");

-- CreateIndex
CREATE INDEX "Shipment_buyer_idx" ON "Shipment"("buyer");

-- CreateIndex
CREATE INDEX "Shipment_assignedCourier_idx" ON "Shipment"("assignedCourier");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNo_supplier_key" ON "Shipment"("shipmentNo", "supplier");

-- CreateIndex
CREATE INDEX "Proof_shipmentNo_idx" ON "Proof"("shipmentNo");

-- CreateIndex
CREATE INDEX "Proof_signer_idx" ON "Proof"("signer");
