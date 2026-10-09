import { useCracks, type Crack } from "./cracks.js";

/**
 * Cracks in the camera's protective glass, drawn over the viewport. Each one is the
 * result of a simulated fragment hitting the camera guard; see cracks.ts.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function crackPaths(crack: Crack, w: number, h: number): string[] {
  const random = mulberry32(crack.seed);
  const cx = crack.x * w;
  const cy = crack.y * h;
  const reach = 90 + 260 * crack.strength;
  const radials = 7 + Math.round(6 * crack.strength);
  const paths: string[] = [];
  const tips: Array<Array<[number, number]>> = [];
  for (let i = 0; i < radials; i += 1) {
    const angle = (i / radials) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const length = reach * (0.45 + random() * 0.8);
    const points: Array<[number, number]> = [[cx, cy]];
    let a = angle;
    const steps = 6 + Math.floor(random() * 5);
    for (let k = 1; k <= steps; k += 1) {
      a += (random() - 0.5) * 0.5;
      const r = (length * k) / steps;
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    tips.push(points);
    paths.push(`M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`);
  }
  // Concentric fractures joining neighbouring radials.
  for (const ring of [0.2, 0.45]) {
    for (let i = 0; i < tips.length; i += 1) {
      if (random() < 0.3) continue;
      const a = tips[i]!;
      const b = tips[(i + 1) % tips.length]!;
      const pa = a[Math.max(1, Math.round(a.length * ring))] ?? a[1]!;
      const pb = b[Math.max(1, Math.round(b.length * ring))] ?? b[1]!;
      const mx = (pa[0] + pb[0]) / 2 + (random() - 0.5) * 12;
      const my = (pa[1] + pb[1]) / 2 + (random() - 0.5) * 12;
      paths.push(
        `M${pa[0].toFixed(1)},${pa[1].toFixed(1)}Q${mx.toFixed(1)},${my.toFixed(1)} ${pb[0].toFixed(1)},${pb[1].toFixed(1)}`,
      );
    }
  }
  return paths;
}

export function ScreenCracks() {
  const cracks = useCracks();
  if (cracks.length === 0) return null;
  const w = 1000;
  const h = 1000;
  return (
    <svg
      className="screen-cracks"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-label="The camera's protective glass is cracked"
      role="img"
    >
      {cracks.map((crack) => {
        const paths = crackPaths(crack, w, h);
        return (
          <g key={crack.id}>
            <circle
              cx={crack.x * w}
              cy={crack.y * h}
              r={6 + 10 * crack.strength}
              className="screen-cracks__impact"
            />
            {paths.map((d, i) => (
              <g key={i}>
                <path d={d} className="screen-cracks__shadow" />
                <path d={d} className="screen-cracks__line" />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
