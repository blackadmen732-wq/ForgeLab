import type { Quantity } from "@forgelab/materials";

/**
 * Display forms of library quantities. SI stays SI; only the prefix and the presentation
 * of temperatures (°C first, kelvin after) change. Pure.
 */
const sig = (x: number, digits = 4) => {
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-3) {
    const [m, e] = x.toExponential(digits - 1).split("e");
    return `${String(Number(m))} × 10${superscript(Number(e))}`;
  }
  return String(Number(x.toPrecision(digits)));
};

const SUP: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};
const superscript = (n: number) =>
  String(n)
    .split("")
    .map((c) => SUP[c] ?? c)
    .join("");

export function formatValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "—";
  switch (unit) {
    case "Pa":
      if (Math.abs(value) >= 1e9) return `${sig(value / 1e9)} GPa`;
      if (Math.abs(value) >= 1e6) return `${sig(value / 1e6)} MPa`;
      if (Math.abs(value) >= 1e3) return `${sig(value / 1e3)} kPa`;
      return `${sig(value)} Pa`;
    case "K":
      if (value < 120) return `${sig(value)} K`;
      return `${Math.round(value - 273.15)} °C (${sig(value, 5)} K)`;
    case "V/m":
      return `${sig(value / 1e6)} kV/mm`;
    case "Ω·m":
      return value < 1e-4 ? `${sig(value * 1e8)} µΩ·cm` : `${sig(value)} Ω·m`;
    case "1/K":
      return `${sig(value * 1e6)} × 10⁻⁶ /K`;
    case "J/kg":
      return value >= 1e6 ? `${sig(value / 1e6)} MJ/kg` : `${sig(value / 1e3)} kJ/kg`;
    case "s":
      return value > 3.15e7 ? `${sig(value / 3.15576e7)} years` : `${sig(value)} s`;
    case "":
      return sig(value);
    default:
      return `${sig(value)} ${unit}`;
  }
}

export function formatQuantity(q: Quantity): string {
  return formatValue(q.value, q.unit);
}

export function formatRange(q: Quantity): string | null {
  if (q.range === undefined) return null;
  return `${formatValue(q.range[0], q.unit)} – ${formatValue(q.range[1], q.unit)}`;
}

export const CONFIDENCE_LABELS: Readonly<Record<Quantity["confidence"], string>> = {
  specified: "Specified",
  handbook: "Handbook",
  typical: "Typical",
  approximate: "Approximate",
};

export const CONFIDENCE_TIPS: Readonly<Record<Quantity["confidence"], string>> = {
  specified: "A standard's minimum or maximum; real stock is usually better.",
  handbook: "A conventional reference value for a pure substance.",
  typical: "A datasheet typical for the grade; process-dependent.",
  approximate: "A wide spread between sources or processes, or derived — see the note.",
};
