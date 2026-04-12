const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const body = await response.json();
      if (body?.detail) {
        message = body.detail;
      }
    } catch {
      const body = await response.text();
      if (body) {
        message = body;
      }
    }

    throw new Error(message);
  }
  return response.json();
}

export function getUserPortfolio(userId) {
  return fetchJson(`/users/${encodeURIComponent(userId)}/portfolio`);
}

export function getAssets() {
  return fetchJson(`/assets`);
}

export function getAssetCandles(assetId) {
  return fetchJson(`/assets/${encodeURIComponent(assetId)}/candles?interval_trades=5&limit=50`);
}
