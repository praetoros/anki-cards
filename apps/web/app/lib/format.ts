const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `2026-10-25 19:18` in local time. Locale-free so the server render and the browser agree;
 * `toLocaleString` differs between Node's default locale and the browser's and breaks hydration.
 */
export function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(iso)}`;
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
