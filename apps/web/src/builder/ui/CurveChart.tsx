import { curveValue, type Curve } from "@forgelab/materials";
import { useId, useState } from "react";

/**
 * A tabulated property against temperature. One series, or two when comparing (then a
 * legend is shown). Only the tabulated points are data: the line joins them, and the
 * chart spans exactly the tabulated range. Hover reads the interpolated value.
 */
export interface CurveSeries {
  readonly label: string;
  readonly curve: Curve;
  /** CSS colour of the line (validated categorical slots). */
  readonly color: string;
}

/** How a curve's raw unit is shown on the axis. */
function display(unit: string): { scale: number; suffix: string } {
  if (unit === "") return { scale: 100, suffix: "%" };
  if (unit === "Ω·m") return { scale: 1e8, suffix: "µΩ·cm" };
  return { scale: 1, suffix: unit };
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    out.push(Number(v.toFixed(10)));
  return out;
}

const W = 520;
const H = 180;
const PAD = { left: 52, right: 16, top: 12, bottom: 30 };

export function CurveChart({ title, series }: { title: string; series: readonly CurveSeries[] }) {
  const id = useId();
  const [hoverK, setHoverK] = useState<number | null>(null);
  const unit = series[0]!.curve.unit;
  const { scale, suffix } = display(unit);
  const allPoints = series.flatMap((s) => s.curve.points);
  const tMin = Math.min(...allPoints.map((p) => p[0]));
  const tMax = Math.max(...allPoints.map((p) => p[0]));
  const yMax = Math.max(...allPoints.map((p) => p[1] * scale)) * 1.05;
  const yMin = Math.min(0, ...allPoints.map((p) => p[1] * scale));
  const x = (k: number) =>
    PAD.left + ((k - tMin) / (tMax - tMin || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    H - PAD.bottom - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const xTicks = niceTicks(tMin - 273.15, tMax - 273.15, 6);
  const yTicks = niceTicks(yMin, yMax, 4);
  const fmt = (v: number) =>
    Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(3)).toString();

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = PAD.left + ((e.clientX - rect.left) / rect.width) * (W - PAD.left - PAD.right);
    const k = tMin + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (tMax - tMin);
    setHoverK(Math.min(tMax, Math.max(tMin, k)));
  };

  return (
    <figure className="curve" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="curve__title">
        {title} <span className="dim">({suffix} vs temperature)</span>
      </figcaption>
      {series.length > 1 && (
        <ul className="curve__legend">
          {series.map((s) => (
            <li key={s.label}>
              <span className="curve__key" style={{ background: s.color }} aria-hidden /> {s.label}
            </li>
          ))}
        </ul>
      )}
      {series.length > 1 &&
        JSON.stringify(series[0]!.curve.points) === JSON.stringify(series[1]!.curve.points) && (
          <p className="curve__same dim">
            Both follow the same tabulated curve ({series[0]!.curve.source}), so the lines coincide.
          </p>
        )}
      <div className="curve__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} against temperature`}>
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line className="curve__grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="curve__tick" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          {xTicks.map((c) => (
            <text
              key={`x${c}`}
              className="curve__tick"
              x={x(c + 273.15)}
              y={H - PAD.bottom + 16}
              textAnchor="middle"
            >
              {fmt(c)}
            </text>
          ))}
          <text className="curve__tick" x={W - PAD.right} y={H - 2} textAnchor="end">
            °C
          </text>
          {series.map((s) => {
            const d = s.curve.points
              .map(
                ([k, v], i) =>
                  `${i === 0 ? "M" : "L"}${x(k).toFixed(1)},${y(v * scale).toFixed(1)}`,
              )
              .join(" ");
            const last = s.curve.points[s.curve.points.length - 1]!;
            return (
              <g key={s.label}>
                <path className="curve__line" d={d} style={{ stroke: s.color }} />
                <circle
                  className="curve__dot"
                  cx={x(last[0])}
                  cy={y(last[1] * scale)}
                  r={4}
                  style={{ fill: s.color }}
                />
              </g>
            );
          })}
          {hoverK !== null && (
            <g>
              <line
                className="curve__cross"
                x1={x(hoverK)}
                x2={x(hoverK)}
                y1={PAD.top}
                y2={H - PAD.bottom}
              />
              {series.map((s) => (
                <circle
                  key={s.label}
                  className="curve__dot"
                  cx={x(hoverK)}
                  cy={y(curveValue(s.curve, hoverK) * scale)}
                  r={4}
                  style={{ fill: s.color }}
                />
              ))}
            </g>
          )}
          <rect
            className="curve__hit"
            x={PAD.left}
            y={PAD.top}
            width={W - PAD.left - PAD.right}
            height={H - PAD.top - PAD.bottom}
            onPointerMove={onMove}
            onPointerLeave={() => setHoverK(null)}
          />
        </svg>
        {hoverK !== null && (
          <div
            className="curve__tip"
            style={{ left: `${((x(hoverK) / W) * 100).toFixed(1)}%` }}
            role="status"
          >
            <strong>{Math.round(hoverK - 273.15)} °C</strong>
            {series.map((s) => (
              <span key={s.label}>
                <span className="curve__key" style={{ background: s.color }} aria-hidden />{" "}
                {series.length > 1 ? `${s.label}: ` : ""}
                {fmt(curveValue(s.curve, hoverK) * scale)} {suffix}
              </span>
            ))}
          </div>
        )}
      </div>
      <details className="curve__table">
        <summary>Tabulated points</summary>
        {series.map((s) => (
          <table key={s.label}>
            <caption>{s.label}</caption>
            <thead>
              <tr>
                <th>°C</th>
                <th>{suffix}</th>
              </tr>
            </thead>
            <tbody>
              {s.curve.points.map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{Math.round(k - 273.15)}</td>
                  <td className="mono">{fmt(v * scale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </details>
    </figure>
  );
}
