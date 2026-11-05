/** Lớp gọi API thống nhất: cookie phiên httpOnly, header chống CSRF, chuẩn hóa lỗi tiếng Việt */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

function qs(params?: Record<string, unknown>) {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch('/api' + url, {
    method,
    credentials: 'include',
    headers: { 'X-Requested-With': 'wms', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (raw && res.ok) return res as unknown as T;
  let json: { success: boolean; data?: unknown; meta?: unknown; error?: { code: string; message: string; details?: unknown } } | null = null;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status, 'NETWORK', `Lỗi kết nối máy chủ (${res.status}). Kiểm tra mạng hoặc liên hệ quản trị.`);
  }
  if (!res.ok || !json?.success) {
    if (res.status === 401 && onUnauthorized && !url.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, json?.error?.code || 'ERROR', json?.error?.message || 'Có lỗi xảy ra', json?.error?.details);
  }
  return (json.meta ? { data: json.data, meta: json.meta } : json.data) as T;
}

export const api = {
  get: <T>(url: string, params?: Record<string, unknown>) => request<T>('GET', url + qs(params)),
  page: <T>(url: string, params?: Record<string, unknown>) => request<Paged<T>>('GET', url + qs(params)),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  /** Tải file (Excel/PDF) bằng fetch để giữ cookie, rồi lưu hoặc mở */
  async download(url: string, params?: Record<string, unknown>, opts: { open?: boolean; filename?: string } = {}) {
    const res = await fetch('/api' + url + qs(params), { credentials: 'include' });
    if (!res.ok) {
      let msg = 'Không tải được file';
      try { msg = (await res.json()).error.message; } catch { /* ignore */ }
      throw new ApiError(res.status, 'DOWNLOAD', msg);
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    if (opts.open) {
      window.open(href, '_blank');
    } else {
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const a = document.createElement('a');
      a.href = href;
      a.download = opts.filename || (m ? decodeURIComponent(m[1]) : 'download');
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },
  qs,
};

export const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
