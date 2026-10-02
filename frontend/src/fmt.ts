// Formatting for live numeric readouts. Clocks are mm:ss so the seconds visibly
// tick during replay; everything else is kept to the precision the data supports.

export function hhmm(utc: string, offsetMin = 0): string {
  const d = new Date(new Date(utc).getTime() + offsetMin * 60000);
  return d.toISOString().slice(11, 16);
}

/** Minutes (fractional) → "MM:SS", or "H:MM:SS" past an hour. */
export function clock(minutes: number): string {
  const neg = minutes < 0;
  const total = Math.floor(Math.abs(minutes) * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  const body = h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  return neg ? `−${body}` : body;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;

export const one = (n: number) => n.toFixed(1);

export function lead(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}
