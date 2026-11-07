/** Small fetch wrapper for the ASTO Office API (same-origin, JSON). */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = (type.includes("application/json") ? await res.json() : null) as any;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data?.details);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function pdfUrl(quoteId: number, revisionId: number, download = false) {
  return `/api/quotes/${quoteId}/revisions/${revisionId}/pdf${download ? "?download=1" : ""}`;
}
