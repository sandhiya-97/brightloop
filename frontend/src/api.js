export async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include', body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Request failed (${response.status})`);
    error.status = response.status; error.code = payload.error; error.field = payload.field;
    throw error;
  }
  return payload;
}
export const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value || 0));
export const dateLabel = (value) => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
export const initials = (name='') => name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase() || 'B';
