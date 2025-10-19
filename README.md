# PODx v1 – wallet-native supply-chain control tower

PODx turns a single thirdweb wallet into three personas:

- **Buyer** – import `buyer.csv` (products + locations), raise purchase orders, mark escrow funded.
- **Supplier** – import `supplier.csv` (prices + courier allowlist), approve orders, create shipments, assign couriers.
- **Courier** – claim shipments, capture photo proof, and complete geofence-verified pickup/drop to unlock escrow.

Version 1 ships a full local-first stack:

- Prisma + SQLite (`data/podx.db`) scoped by wallet address.
- CSV ingestion stored under `data/imports/<wallet>/*.csv` and normalised into Prisma models.
- Next.js dashboard with Buyer/Supplier/Courier tabs (`/dashboard`).
- Courier QR flow at `/courier/[shipmentId]` with built-in geofence validation at pickup & drop.
- Solidity contracts (`contracts/`) ready for Sepolia deployment: Escrow, Order registry, Shipment registry.

## Getting started

```bash
# install deps (requires internet for Prisma packages)
pnpm install

# set up SQLite
echo "DATABASE_URL='file:./data/podx.db'" > .env
pnpm prisma migrate dev --name init

# run Next.js
pnpm dev
```

### Prepare sample data

1. Visit **`/settings/imports`**.
2. Use the dev `Connect` input to set a wallet address (e.g. `0xBuyer...`).
3. Upload `public/templates/buyer.csv` and ingest.
4. Switch to your supplier wallet, upload `public/templates/supplier.csv`.

Each wallet owns its own catalog; switch wallets (cookie/localStorage) to act as buyer/supplier/courier.

## Key routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/me/imports/[buyer|supplier]/upload` | POST multipart | Save CSV to `data/imports/<wallet>` and mark import as `STAGING`. |
| `/api/me/imports/[buyer|supplier]/ingest` | POST | Parse CSV, upsert Products/Locations (buyer) or Prices/Couriers (supplier), emit report. |
| `/api/me/catalog/products` | GET | Buyer’s product catalog. |
| `/api/me/catalog/locations` | GET | Buyer ship-to locations. |
| `/api/me/catalog/prices` | GET | Supplier price list (for current wallet). |
| `/api/me/catalog/couriers` | GET | Supplier courier allowlist. |
| `/api/catalog/prices?wallet=0x…` | GET | Public price list lookup for a supplier wallet. |
| `/api/me/orders` | GET/POST | List or create orders (buyer). |
| `/api/me/orders/:id/status` | POST | Transition order status (buyer/supplier). |
| `/api/me/shipments` | GET/POST | Supplier creates shipments; fetch shipments for supplier/buyer/courier via `scope` query. |
| `/api/me/shipments/:id/assign` | POST | Supplier assigns, or courier self-claims a shipment. |
| `/api/courier/shipments/:id/pickup` | POST | Courier photo + server-side geofence check at pickup (records proof, sets status `InTransit`). |
| `/api/courier/shipments/:id/drop` | POST | Courier photo + server-side geofence check at drop (records proof, marks shipment & order delivered). |
| `/api/shipments/:id` | GET | Fetch shipment + proof history (supplier/buyer/allowlisted/assigned couriers only). |

## Dashboard highlights (`/dashboard`)

- **Buyer tab**: load public supplier price list by wallet address, enter quantities, sign an on-chain `OrderRegistry.createOrder` transaction, and then mark escrow funded.
- **Supplier tab**: review incoming orders, approve, capture funded orders to create shipments (pickup/drop coords + optional assigned courier), escrow the courier incentive (distance × 0.00001 PYUSD) up front, and auto-pay a 1% platform fee, then view shipment roster and open courier links.
- **Courier tab**: list assigned or allowlisted shipments, claim open jobs, and jump into the `/courier/[shipmentId]` proof workflow.
- **Automated settlement**: drop confirmation (courier + buyer signatures) triggers on-chain escrow release via `releaseEscrowWithReward`, paying the supplier and courier, minting the platform fee on both sides, and emitting a `BillIssued` event for downstream indexing (Blockscout/Envio).

## Courier proof flow

1. Open `/courier/[shipmentId]` (via QR).
2. Capture photo & optional notes, click **I’m at pickup**. The route:
   - hashes photo, grabs browser geolocation,
   - hashes photo, grabs browser geolocation,
   - validates coordinates against the shipment pickup radius,
   - stores a `Proof` row + JSON blob under `data/proofs/<shipmentNo>/pickup-*.json`, and sets shipment status `InTransit`.
3. On delivery, click **I’m at drop**. The server re-checks location; if inside the radius, the backend records the proof and immediately calls `ShipmentRegistry.markDelivered` so escrow releases to the supplier.

## Contracts overview

Contracts live in `contracts/` (Hardhat):

- `EscrowPYUSD.sol` – holds PYUSD and only releases on calls from the order registry.
- `OrderRegistry.sol` – stores buyer/supplier, tracks status, and releases escrow when called by trusted actors.
- `ShipmentRegistry.sol` – logs milestones and, when invoked by the delivery oracle, triggers escrow release.
- `scripts/deploy.ts` – deploys all contracts on Sepolia and wires the delivery oracle.

```bash
cd contracts
pnpm install
# export RPC_URL, PYUSD_ADDRESS, DELIVERY_ORACLE_ADDRESS, DEPLOYER_PRIVATE_KEY
pnpm hardhat compile
pnpm hardhat run --network sepolia scripts/deploy.ts
```

Update `.env` with deployed addresses:

```bash
PYUSD_ADDRESS="0x..."
ESCROW_PYUSD_ADDRESS="0x..."
ORDER_REGISTRY_ADDRESS="0x..."
SHIPMENT_REGISTRY_ADDRESS="0x..."
DELIVERY_ORACLE_ADDRESS="0x..."
NEXT_PUBLIC_PYUSD_ADDRESS="0x..."
NEXT_PUBLIC_ESCROW_PYUSD_ADDRESS="0x..."
NEXT_PUBLIC_ORDER_REGISTRY_ADDRESS="0x..."
```

## Next steps

- Swap the cookie/header auth stub in `lib/thirdweb.ts` with official thirdweb Auth (SIWE).
- Extend the geofence checks with your preferred location oracle or proof service if you need stronger guarantees.
- Explore optional automation hooks (webhooks, serverless jobs) using the same REST APIs (`/api/me/...`).

The current repo is ready for hackathon demos: CSV ingestion, wallet-scoped data, dashboards, courier flow with geofence checks, and contracts ready to deploy.
