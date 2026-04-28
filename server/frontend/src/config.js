const rawEnv = import.meta.env;

function readClientEnv(name) {
  const value = rawEnv[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeApiBaseUrl(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("/")) {
    return value.replace(/\/+$/, "");
  }

  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeAbsoluteUrl(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function resolveApiBaseUrl() {
  const backendUrl = readClientEnv("VITE_BACKEND_URL");
  if (backendUrl) {
    const normalized = normalizeAbsoluteUrl(backendUrl);
    return normalized ? normalized.replace(/\/+$/, "") + "/api" : "";
  }
  return normalizeApiBaseUrl(readClientEnv("VITE_API_BASE_URL"));
}

const frontendConfig = {
  apiBaseUrl: resolveApiBaseUrl(),
  apiKey: readClientEnv("VITE_API_KEY"),
  supabaseUrl: normalizeAbsoluteUrl(readClientEnv("VITE_SUPABASE_URL")),
  supabasePublishableKey: readClientEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  adminUserId: readClientEnv("VITE_ADMIN_USER_ID"),
};

const missingConfigFields = [];
const invalidConfigFields = [];

if (!readClientEnv("VITE_BACKEND_URL") && !readClientEnv("VITE_API_BASE_URL")) {
  missingConfigFields.push("VITE_BACKEND_URL");
} else if (!frontendConfig.apiBaseUrl) {
  invalidConfigFields.push(readClientEnv("VITE_BACKEND_URL") ? "VITE_BACKEND_URL" : "VITE_API_BASE_URL");
}

if (!readClientEnv("VITE_SUPABASE_URL")) {
  missingConfigFields.push("VITE_SUPABASE_URL");
} else if (!frontendConfig.supabaseUrl) {
  invalidConfigFields.push("VITE_SUPABASE_URL");
}

if (!frontendConfig.supabasePublishableKey) {
  missingConfigFields.push("VITE_SUPABASE_PUBLISHABLE_KEY");
}

function buildConfigErrorMessage() {
  const messages = [];

  if (missingConfigFields.length > 0) {
    messages.push(`Missing required frontend environment variables: ${missingConfigFields.join(", ")}.`);
  }

  if (invalidConfigFields.length > 0) {
    messages.push(
      `Invalid frontend environment variable values: ${invalidConfigFields.join(", ")}.`,
    );
  }

  if (messages.length === 0) {
    return null;
  }

  return `${messages.join(" ")} Set them in the frontend build environment and rebuild the app.`;
}

const frontendConfigError = buildConfigErrorMessage();

export function getFrontendConfig() {
  return frontendConfig;
}

export function getFrontendConfigError() {
  return frontendConfigError;
}
