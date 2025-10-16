const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")
const path = require("path")
const fsPromises = require("fs/promises")

dotenv.config()

const app = express()
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000"
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }))
app.use(express.json())

const GEO_PROOF_ACTION_CODE = String.raw`(async () => {
  const toRad = (degrees) => (degrees * Math.PI) / 180;

  const geodesicDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

  let params = null
  if (typeof Lit !== "undefined" && Lit.Actions && typeof Lit.Actions.getContext === "function") {
    try {
      const ctx = await Lit.Actions.getContext()
      params =
        ctx?.jsParams ??
        ctx?.params ??
        ctx?.args?.jsParams ??
        ctx?.args ??
        null
    } catch (contextError) {
      // ignore and fall back to globals below
    }
  }

  if (!params && typeof globalThis !== "undefined") {
    params =
      globalThis.jsParams ||
      globalThis.params ||
      (globalThis.args && (globalThis.args.jsParams || globalThis.args.params)) ||
      (Array.isArray(globalThis.args) ? globalThis.args[0] : null) ||
      null
  }

  if (!params) {
    Lit.Actions.setResponse({
      response: JSON.stringify({ ok: false, error: "Missing jsParams" }),
    });
    return;
  }

  const required = [
    { key: "targetLat", value: params.targetLat },
    { key: "targetLon", value: params.targetLon },
    { key: "currentLat", value: params.currentLat },
    { key: "currentLon", value: params.currentLon },
  ];

  const invalid = required.filter((entry) => !isNumber(entry.value)).map((entry) => entry.key);

  if (invalid.length > 0) {
    Lit.Actions.setResponse({
      response: JSON.stringify({
        ok: false,
        error: "Invalid or missing numeric parameters: " + invalid.join(", "),
      }),
    });
    return;
  }

  const radius = isNumber(params.radiusM) ? Math.max(0, params.radiusM) : 200;
  const distance = geodesicDistance(
    params.targetLat,
    params.targetLon,
    params.currentLat,
    params.currentLon,
  );

  const response = {
    ok: distance <= radius,
    dist: distance,
    radius,
    kind: params.kind === "pickup" || params.kind === "drop" ? params.kind : undefined,
    target: { lat: params.targetLat, lon: params.targetLon },
    current: { lat: params.currentLat, lon: params.currentLon },
    meta: {
      courier: typeof params.courier === "string" ? params.courier : undefined,
      orderId: typeof params.orderId === "string" ? params.orderId : undefined,
      shipmentNo: Number.isFinite(Number(params.shipmentNo)) ? Number(params.shipmentNo) : undefined,
      claimedTs: Number.isFinite(Number(params.claimedTs)) ? Number(params.claimedTs) : undefined,
    },
  };

  Lit.Actions.setResponse({
    response: JSON.stringify(response),
  });
})();`

app.get("/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() })
})

const PORT = Number(process.env.LIT_SERVER_PORT || 4001)
app.listen(PORT, () => {
  console.log(`Lit utility server listening on http://localhost:${PORT}`)
})
