const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function getToken() {
  return localStorage.getItem('tf_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('tf_token', token);
  else localStorage.removeItem('tf_token');
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''))}` : '';
  const res = await fetch(`${BASE}/api${path}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && getToken()) {
      setToken(null);
      window.location.assign('/login');
    }
    throw new ApiError(res.status, data.error ?? 'Request failed', data.details);
  }
  return data;
}

export const SOCKET_URL = BASE || undefined;
