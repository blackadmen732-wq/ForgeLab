/**
 * Display formatting for SI values. The engine speaks SI with unit-suffixed keys; this is
 * the only place the interface turns those numbers into text.
 */

const SI_PREFIXES: readonly [number, string][] = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
];

function trim(value: number, digits: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : value < 0 ? "−∞" : "—";
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? Math.max(0, digits - 2) : Math.max(0, digits - 1);
  return value.toFixed(decimals).replace("-", "−");
}

/** 1.23 MW, 450 kW, 12.0 MPa... */
export function si(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `${trim(value, digits)} ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  for (const [scale, prefix] of SI_PREFIXES) {
    if (abs >= scale * 0.9995) return `${trim(value / scale, digits)} ${prefix}${unit}`.trim();
  }
  return `${value.toExponential(1)} ${unit}`.trim();
}

export const watts = (w: number): string => si(w, "W");
export const pascals = (pa: number): string => si(pa, "Pa");
export const newtons = (n: number): string => si(n, "N");

export function megawatts(w: number, digits = 1): string {
  if (!Number.isFinite(w)) return "—";
  return `${(w / 1e6).toFixed(digits).replace("-", "−")} MW`;
}

export function mass(kg: number): string {
  if (!Number.isFinite(kg)) return "—";
  if (Math.abs(kg) >= 1000) return `${trim(kg / 1000, 3)} t`;
  return `${trim(kg, 3)} kg`;
}

export function kelvin(k: number): string {
  if (!Number.isFinite(k)) return "—";
  return `${Math.round(k)} K`;
}

export function percent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function metres(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (Math.abs(m) < 1) return `${Math.round(m * 1000)} mm`;
  return `${trim(m, 3)} m`;
}

export function gain(q: number): string {
  if (!Number.isFinite(q)) return q > 0 ? "∞" : "—";
  return q >= 100 ? q.toFixed(0) : q.toFixed(2);
}

export function duration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (iso === null) return "";
  const then = new Date(iso).getTime();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function titleCase(s: string): string {
  return s
    .replace(
      /(^|[-_ ])(\w)/g,
      (_m, sep: string, c: string) => (sep === "" ? "" : " ") + c.toUpperCase(),
    )
    .trim();
}

/** Shows a stored parameter value using its display scale and unit. */
export function displayParameter(value: number, display: { unit: string; scale: number }): string {
  const shown = value * display.scale;
  const abs = Math.abs(shown);
  const text =
    abs === 0
      ? "0"
      : abs >= 1000
        ? shown.toFixed(0)
        : abs >= 1
          ? String(Number(shown.toPrecision(4)))
          : String(Number(shown.toPrecision(3)));
  return `${text}${display.unit === "" ? "" : ` ${display.unit}`}`;
}
