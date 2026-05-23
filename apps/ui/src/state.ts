import type { StoredConnection } from "./types.js";

const storageKey = "mindory.ui.connection.v1";

export function defaultConnection(): StoredConnection {
  const configuredApiUrl = window.__MINDORY_UI_CONFIG__?.apiUrl;
  const apiUrl = configuredApiUrl && configuredApiUrl.length > 0
    ? configuredApiUrl
    : window.location.protocol === "file:"
      ? "http://localhost:3000"
      : `${window.location.origin}/api`;
  return {
    apiUrl,
    token: ""
  };
}

export function loadConnection(): StoredConnection {
  const fallback = defaultConnection();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<StoredConnection>;
    return {
      apiUrl: typeof parsed.apiUrl === "string" && parsed.apiUrl.length > 0 ? parsed.apiUrl : fallback.apiUrl,
      token: typeof parsed.token === "string" ? parsed.token : ""
    };
  } catch {
    return fallback;
  }
}

export function saveConnection(connection: StoredConnection): void {
  window.localStorage.setItem(storageKey, JSON.stringify(connection));
}

export function clearConnection(): StoredConnection {
  window.localStorage.removeItem(storageKey);
  return defaultConnection();
}

export function maskToken(token: string): string {
  if (token.length === 0) {
    return "No token";
  }
  if (token.length <= 8) {
    return "Stored token";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
