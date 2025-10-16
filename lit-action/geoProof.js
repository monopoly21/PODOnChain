const toRad = (degrees) => (degrees * Math.PI) / 180;

const geodesicDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // metres
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
};

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

const required = [
  { key: "targetLat", value: jsParams.targetLat },
  { key: "targetLon", value: jsParams.targetLon },
  { key: "currentLat", value: jsParams.currentLat },
  { key: "currentLon", value: jsParams.currentLon },
];

const invalid = required.filter((entry) => !isNumber(entry.value)).map((entry) => entry.key);

if (invalid.length > 0) {
  Lit.Actions.setResponse({
    response: JSON.stringify({
      ok: false,
      error: `Invalid or missing numeric parameters: ${invalid.join(", ")}`,
    }),
  });
} else {
  const radius = isNumber(jsParams.radiusM) ? Math.max(0, jsParams.radiusM) : 200;
  const distance = geodesicDistance(
    jsParams.targetLat,
    jsParams.targetLon,
    jsParams.currentLat,
    jsParams.currentLon,
  );

  const response = {
    ok: distance <= radius,
    dist: distance,
    radius,
    kind: jsParams.kind === "pickup" || jsParams.kind === "drop" ? jsParams.kind : undefined,
    target: { lat: jsParams.targetLat, lon: jsParams.targetLon },
    current: { lat: jsParams.currentLat, lon: jsParams.currentLon },
    meta: {
      courier: typeof jsParams.courier === "string" ? jsParams.courier : undefined,
      orderId: typeof jsParams.orderId === "string" ? jsParams.orderId : undefined,
      shipmentNo: Number.isFinite(Number(jsParams.shipmentNo)) ? Number(jsParams.shipmentNo) : undefined,
      claimedTs: Number.isFinite(Number(jsParams.claimedTs)) ? Number(jsParams.claimedTs) : undefined,
    },
  };

  Lit.Actions.setResponse({
    response: JSON.stringify(response),
  });
}
