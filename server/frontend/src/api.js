import { getFrontendConfig, getFrontendConfigError } from "./config";

const { apiBaseUrl, apiKey } = getFrontendConfig();
const configError = getFrontendConfigError();

async function fetchJson(path, options = {}) {
  if (configError) {
    throw new Error(configError);
  }

  const headers = {
    ...(options.headers || {}),
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (apiKey && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers,
    ...options,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const text = await response.text();
      if (text) {
        try {
          const body = JSON.parse(text);
          if (body?.detail) {
            message = body.detail;
          }
        } catch {
          message = text;
        }
      }
    } catch {
      // ignore — keep the default status message
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function getUserPortfolio(userId) {
  return fetchJson(`/users/${encodeURIComponent(userId)}/portfolio`);
}

export async function getUserAccountBalances(userId) {
  return fetchJson(`/users/${encodeURIComponent(userId)}/balance`);
}

export function getAssets() {
  return fetchJson("/assets");
}

export function getAssetCandles(assetId) {
  return fetchJson(`/assets/${encodeURIComponent(assetId)}/candles?interval_trades=5&limit=50`);
}

export function placeOrder(order) {
  return fetchJson("/orders/", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function createUser(userId, { username, email, initialCashCents = 500000 } = {}) {
  return fetchJson("/users/", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      username: username ?? undefined,
      email: email ?? undefined,
      initial_cash_cents: initialCashCents,
    }),
  });
}

export function updateAsset(assetId, payload) {
  return fetchJson(`/assets/${encodeURIComponent(assetId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteCurrentProfile(accessToken) {
  return fetchJson("/users/me", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
