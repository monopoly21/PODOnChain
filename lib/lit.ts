import { Wallet } from "ethers"
import { LitAbility } from "@lit-protocol/constants"
import {
  LitActionResource,
  LitAccessControlConditionResource,
  createSiweMessageWithRecaps,
  generateAuthSig,
} from "@lit-protocol/auth-helpers"

import { geodesicDistance } from "./geo"

export type GeoProofInput = {
  kind: "pickup" | "drop"
  targetLat: number
  targetLon: number
  currentLat: number
  currentLon: number
  radiusM?: number
  courier: string
  orderId: string
  shipmentNo: number
  claimedTs: number
  authSig: Record<string, unknown>
}

export type GeoProofResult = {
  ok: boolean
  dist?: number
  radius?: number
  kind?: "pickup" | "drop"
  target?: { lat: number; lon: number }
  current?: { lat: number; lon: number }
  meta?: { courier: string; orderId: string; shipmentNo: number; claimedTs: number }
  error?: string
  localDist?: number
}


type LitNodeClientType = {
  new (params?: Record<string, unknown>): {
    connect: () => Promise<void>
    executeJs: (args: Record<string, unknown>) => Promise<any>
  }
}

let LitNodeClientCtor: LitNodeClientType | null = null
let litClient: InstanceType<LitNodeClientType> | null = null
let sessionSigCache: { value: Record<string, unknown>; expiresAt: number } | null = null

const RAW_LIT_NETWORK = (process.env.LIT_NETWORK || "cayenne").toLowerCase()
const LIT_SESSION_CHAIN = process.env.LIT_SESSION_CHAIN || "baseSepolia"
const LIT_SESSION_DURATION_MS = Number(process.env.LIT_SESSION_DURATION_MS ?? 15 * 60 * 1000)
const LIT_SESSION_URI = process.env.LIT_SESSION_URI || "https://podx.local/lit"
const SERVER_WALLET_KEY = process.env.DELIVERY_ORACLE_PRIVATE_KEY || process.env.LIT_SESSION_PRIVATE_KEY || ""
const LIT_CONNECT_TIMEOUT_MS = Number(process.env.LIT_CONNECT_TIMEOUT_MS ?? 60_000)
const LIT_MIN_NODE_COUNT = Math.max(1, Number(process.env.LIT_MIN_NODE_COUNT ?? 1))
const LIT_BOOTSTRAP_URLS = (process.env.LIT_BOOTSTRAP_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0)
const LIT_DEBUG = (process.env.LIT_DEBUG || "false").toLowerCase() === "true"

async function loadLitConstructor() {
  if (LitNodeClientCtor) return LitNodeClientCtor
  try {
    const nodeModule = await import("@lit-protocol/lit-node-client-nodejs")
    LitNodeClientCtor = (nodeModule as any).LitNodeClient ?? (nodeModule as any).default
    if (LitNodeClientCtor) return LitNodeClientCtor
  } catch (error) {
    // Fallback to browser client; useful in dev builds where node module fails
  }
  const browserModule = await import("@lit-protocol/lit-node-client")
  LitNodeClientCtor = (browserModule as any).LitNodeClient ?? (browserModule as any).default
  return LitNodeClientCtor
}

function resolveNetwork() {
  if (RAW_LIT_NETWORK === "datil-dev" || RAW_LIT_NETWORK === "datil") {
    console.warn("LIT_NETWORK datil-dev is not supported by the installed SDK; falling back to cayenne")
    return "cayenne"
  }
  if (RAW_LIT_NETWORK === "naga-dev" || RAW_LIT_NETWORK === "naga") {
    console.warn("LIT_NETWORK naga-dev is not supported by the installed SDK; falling back to cayenne")
    return "cayenne"
  }
  return RAW_LIT_NETWORK
}

async function getClient() {
  if (litClient) return litClient

  const Ctor = await loadLitConstructor()
  const config: Record<string, unknown> = {
    litNetwork: resolveNetwork(),
    debug: LIT_DEBUG,
    connectTimeout: LIT_CONNECT_TIMEOUT_MS,
    minNodeCount: LIT_MIN_NODE_COUNT,
  }
  if (LIT_BOOTSTRAP_URLS.length > 0) {
    config.bootstrapUrls = LIT_BOOTSTRAP_URLS
  }
  const client = new Ctor(config)
  await client.connect()
  litClient = client
  return client
}

async function ensureSessionSigs(client: InstanceType<LitNodeClientType>) {
  if (!SERVER_WALLET_KEY) {
    throw new Error("LIT_SESSION_PRIVATE_KEY or DELIVERY_ORACLE_PRIVATE_KEY env var is required")
  }

  const now = Date.now()
  if (sessionSigCache && sessionSigCache.expiresAt - 60_000 > now) {
    return sessionSigCache.value
  }

  const wallet = new Wallet(SERVER_WALLET_KEY)
  const resourceAbilityRequests = [
    {
      resource: new LitActionResource("*"),
      ability: LitAbility.LitActionExecution,
    },
    {
      resource: new LitAccessControlConditionResource("*"),
      ability: LitAbility.AccessControlConditionDecryption,
    },
  ]

  const expiration = new Date(now + LIT_SESSION_DURATION_MS).toISOString()

  const sessionSigs = await client.getSessionSigs({
    chain: LIT_SESSION_CHAIN,
    resourceAbilityRequests,
    authNeededCallback: async (params: {
      uri?: string
      expiration?: string
      resourceAbilityRequests?: typeof resourceAbilityRequests
    }) => {
      const latestBlockhash = await client.getLatestBlockhash()
      const toSign = await createSiweMessageWithRecaps({
        uri: params.uri || LIT_SESSION_URI,
        expiration: params.expiration || expiration,
        resources: params.resourceAbilityRequests || resourceAbilityRequests,
        walletAddress: wallet.address,
        nonce: latestBlockhash,
        litNodeClient: client,
      })
      return generateAuthSig({ signer: wallet, toSign })
    },
  })

  sessionSigCache = {
    value: sessionSigs,
    expiresAt: now + LIT_SESSION_DURATION_MS,
  }

  return sessionSigs
}

async function getActionCode() {
  return GEO_PROOF_ACTION_CODE
}

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
      // ignore
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

export async function runLitGeoProof(input: GeoProofInput): Promise<GeoProofResult> {
  if (!input.authSig) {
    throw new Error("authSig is required to execute Lit actions")
  }

  const defaultRadius = Number.isFinite(Number(process.env.MAX_DISTANCE_IN_METERS))
    ? Number(process.env.MAX_DISTANCE_IN_METERS)
    : 2000
  const radius = Number.isFinite(Number(input.radiusM)) ? Number(input.radiusM) : defaultRadius
  const localDistance = geodesicDistance(
    input.targetLat,
    input.targetLon,
    input.currentLat,
    input.currentLon,
  )

  const buildFallback = (error: unknown): GeoProofResult => {
    if (error) {
      console.warn("Lit geoproof falling back to local distance", error)
    }
    const ok = Number.isFinite(localDistance) ? localDistance <= radius : false
    return {
      ok,
      dist: Number.isFinite(localDistance) ? localDistance : undefined,
      radius,
      kind: input.kind,
      target: { lat: input.targetLat, lon: input.targetLon },
      current: { lat: input.currentLat, lon: input.currentLon },
      meta: {
        courier: input.courier,
        orderId: input.orderId,
        shipmentNo: input.shipmentNo,
        claimedTs: Number(input.claimedTs),
      },
      error: error instanceof Error ? `lit_fallback: ${error.message}` : error ? "lit_fallback" : undefined,
      localDist: Number.isFinite(localDistance) ? localDistance : undefined,
    }
  }

  try {
    const client = await getClient()
    const code = await getActionCode()
    const sessionSigs = await ensureSessionSigs(client)

    const execution = await client.executeJs({
      code,
      sessionSigs,
      authSig: input.authSig,
      jsParams: {
        kind: input.kind,
        targetLat: input.targetLat,
        targetLon: input.targetLon,
        currentLat: input.currentLat,
        currentLon: input.currentLon,
        radiusM: radius,
        courier: input.courier,
        orderId: input.orderId,
        shipmentNo: input.shipmentNo,
        claimedTs: input.claimedTs,
      },
    })

    const response = typeof execution.response === "string" ? execution.response : execution.response?.response
    if (!response) {
      throw new Error("Lit action returned no response")
    }

    let parsed: { ok: boolean; dist?: number }
    try {
      parsed = JSON.parse(response)
    } catch (error) {
      throw new Error(`Failed to parse Lit response: ${response}`)
    }

    return {
      ok: Boolean(parsed.ok),
      dist: typeof parsed.dist === "number" ? parsed.dist : undefined,
      radius: typeof parsed.radius === "number" ? parsed.radius : radius,
      kind: parsed.kind === "pickup" || parsed.kind === "drop" ? parsed.kind : input.kind,
      target:
        parsed.target && typeof parsed.target.lat === "number" && typeof parsed.target.lon === "number"
          ? { lat: parsed.target.lat, lon: parsed.target.lon }
          : { lat: input.targetLat, lon: input.targetLon },
      current:
        parsed.current && typeof parsed.current.lat === "number" && typeof parsed.current.lon === "number"
          ? { lat: parsed.current.lat, lon: parsed.current.lon }
          : { lat: input.currentLat, lon: input.currentLon },
      meta:
        parsed.meta && typeof parsed.meta === "object"
          ? {
              courier: typeof parsed.meta.courier === "string" ? parsed.meta.courier : input.courier,
              orderId: typeof parsed.meta.orderId === "string" ? parsed.meta.orderId : input.orderId,
              shipmentNo:
                typeof parsed.meta.shipmentNo === "number" ? parsed.meta.shipmentNo : input.shipmentNo,
              claimedTs:
                typeof parsed.meta.claimedTs === "number"
                  ? parsed.meta.claimedTs
                  : Number(input.claimedTs),
            }
          : {
              courier: input.courier,
              orderId: input.orderId,
              shipmentNo: input.shipmentNo,
              claimedTs: Number(input.claimedTs),
            },
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      localDist: Number.isFinite(localDistance) ? localDistance : undefined,
    }
  } catch (error) {
    return buildFallback(error)
  }
}
