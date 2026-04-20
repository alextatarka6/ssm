import { supabase } from "./utils/supabase";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

async function fetchJson(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });

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
  const { data, error } = await supabase
    .from("user_accounts")
    .select("cash_cents, reserved_cash_cents")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
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

export function createUser(userId, initialCashCents = 500000) {
  return fetchJson("/users/", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
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
