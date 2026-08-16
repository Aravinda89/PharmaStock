/**
 * Thin fetch wrapper. Everything goes to /api on the same origin, so this
 * works identically under Vite's dev proxy and under the Node server in
 * production - no environment configuration for the pharmacy to get wrong.
 */

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      (isJson && (payload as { error?: string }).error) ||
      `Request failed (${res.status}). Please try again.`;
    throw new ApiError(message, res.status, isJson ? (payload as { details?: unknown }).details : null);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Build a querystring, skipping empty values so URLs stay readable. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

/**
 * Triggers a browser download for report exports and backups. The endpoints
 * are session-authenticated, so a plain navigation works and the browser
 * handles the Save dialog.
 */
export function downloadFile(path: string) {
  const link = document.createElement('a');
  link.href = `/api${path}`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Multipart upload used only by restore-from-file. */
export async function uploadFile<T>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData();
  form.append(field, file);

  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    throw new ApiError(
      (isJson && (payload as { error?: string }).error) || 'Upload failed.',
      res.status
    );
  }
  return payload as T;
}
