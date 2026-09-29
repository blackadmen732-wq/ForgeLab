/**
 * DC electrical network, solved by nodal analysis.
 *
 * MODEL (documented):
 *  - Every electrical component is one node. Current returns through an ideal common
 *    return path (the "ground" reference), so a single link models a two-wire circuit.
 *  - Links are resistors. A conductor component contributes half its own resistance
 *    R = ρL/A to each link touching it; other components have negligible resistance.
 *  - Sources (grid connections, generators) are Thevenin sources: EMF V behind a source
 *    resistance R_s, entered as Norton equivalents V/R_s ∥ 1/R_s.
 *  - Loads draw constant current P/V_nominal. This linearises the constant-power loads
 *    real converters present; it is accurate while voltage drops stay small, and ForgeLab
 *    flags an island whose voltage sags by more than 10 %.
 *  - When an island's sources cannot cover its demand plus losses, every load on that
 *    island is curtailed by the same fraction (proportional load shedding).
 *
 * Solved with Gaussian elimination with partial pivoting, deterministic for a fixed node
 * order.
 */
export interface NetworkNode {
  readonly id: string;
  /** Demand of a load, W. 0 for non-loads. */
  readonly demandW: number;
  /** Source EMF, V. Undefined for non-sources. */
  readonly sourceVoltageV?: number;
  readonly sourceResistanceOhm?: number;
  /** Largest power this source can deliver, W. */
  readonly sourceCapacityW?: number;
  /** Generators are dispatched before grid imports. */
  readonly sourceKind?: "grid" | "generator";
}

export interface NetworkEdge {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly resistanceOhm: number;
}

export interface NodeResult {
  readonly voltageV: number;
  /** Magnitude of current into (load) or out of (source) the node, A. */
  readonly currentA: number;
  readonly deliveredW: number;
  readonly suppliedW: number;
}

export interface EdgeResult {
  readonly currentA: number;
  readonly lossW: number;
}

export interface IslandResult {
  readonly nodeIds: readonly string[];
  readonly nominalVoltageV: number;
  readonly demandW: number;
  readonly deliveredW: number;
  readonly lossW: number;
  readonly capacityW: number;
  readonly generationW: number;
  readonly gridImportW: number;
  readonly supplyFraction: number;
  readonly minVoltageV: number;
  readonly nodes: ReadonlyMap<string, NodeResult>;
  readonly edges: ReadonlyMap<string, EdgeResult>;
}

/** Conductance tied from every node to the reference so a floating island stays solvable. */
const LEAKAGE_CONDUCTANCE_S = 1e-9;

/** Splits a network into connected islands, each sorted by id. */
export function findIslands(nodeIds: readonly string[], edges: readonly NetworkEdge[]): string[][] {
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const edge of edges) {
    adjacency.get(edge.a)?.push(edge.b);
    adjacency.get(edge.b)?.push(edge.a);
  }
  const seen = new Set<string>();
  const islands: string[][] = [];
  for (const start of [...nodeIds].sort()) {
    if (seen.has(start)) continue;
    const island: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      island.push(id);
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    islands.push(island.sort());
  }
  return islands;
}

/**
 * Solves one connected island. `nodes` must all belong to the island and `edges` must only
 * join those nodes.
 */
export function solveIsland(
  nodes: readonly NetworkNode[],
  edges: readonly NetworkEdge[],
): IslandResult {
  const ordered = [...nodes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const index = new Map(ordered.map((node, i) => [node.id, i]));
  const sources = ordered.filter(
    (node) => node.sourceVoltageV !== undefined && (node.sourceCapacityW ?? 0) > 0,
  );
  const demandW = ordered.reduce((sum, node) => sum + Math.max(0, node.demandW), 0);
  const capacityW = sources.reduce((sum, node) => sum + (node.sourceCapacityW ?? 0), 0);
  const nominalVoltageV = sources.reduce((v, node) => Math.max(v, node.sourceVoltageV ?? 0), 0);

  const empty = (): IslandResult => ({
    nodeIds: ordered.map((n) => n.id),
    nominalVoltageV: 0,
    demandW,
    deliveredW: 0,
    lossW: 0,
    capacityW,
    generationW: 0,
    gridImportW: 0,
    supplyFraction: demandW > 0 ? 0 : 1,
    minVoltageV: 0,
    nodes: new Map(
      ordered.map((n) => [n.id, { voltageV: 0, currentA: 0, deliveredW: 0, suppliedW: 0 }]),
    ),
    edges: new Map(edges.map((e) => [e.id, { currentA: 0, lossW: 0 }])),
  });
  if (sources.length === 0 || !(nominalVoltageV > 0)) return empty();

  // Two passes: the first estimates losses, the second curtails demand to cover them.
  let fraction = demandW > 0 ? Math.min(1, capacityW / demandW) : 1;
  let solution = solveLinear(ordered, index, edges, fraction, nominalVoltageV);
  for (let pass = 0; pass < 2; pass += 1) {
    const lossW = totalLoss(solution, edges, index, ordered);
    fraction = demandW > 0 ? Math.max(0, Math.min(1, (capacityW - lossW) / demandW)) : 1;
    solution = solveLinear(ordered, index, edges, fraction, nominalVoltageV);
  }

  const edgeResults = new Map<string, EdgeResult>();
  let edgeLossW = 0;
  for (const edge of edges) {
    const va = solution[index.get(edge.a)!] ?? 0;
    const vb = solution[index.get(edge.b)!] ?? 0;
    const currentA = Math.abs(va - vb) / edge.resistanceOhm;
    const lossW = currentA * currentA * edge.resistanceOhm;
    edgeLossW += lossW;
    edgeResults.set(edge.id, { currentA, lossW });
  }

  let deliveredW = 0;
  let sourceLossW = 0;
  const sourceCurrents = new Map<string, number>();
  for (const source of sources) {
    const v = solution[index.get(source.id)!] ?? 0;
    const currentA = ((source.sourceVoltageV ?? 0) - v) / (source.sourceResistanceOhm ?? 1);
    sourceCurrents.set(source.id, Math.max(0, currentA));
    sourceLossW += Math.max(0, currentA) ** 2 * (source.sourceResistanceOhm ?? 0);
  }
  for (const node of ordered) deliveredW += Math.max(0, node.demandW) * fraction;
  const lossW = edgeLossW + sourceLossW;
  const totalDrawW = deliveredW + lossW;

  // Dispatch: generators first, in id order, then the grid.
  const generators = sources.filter((s) => s.sourceKind === "generator");
  const grids = sources.filter((s) => s.sourceKind !== "generator");
  const supplied = new Map<string, number>();
  let remaining = totalDrawW;
  let generationW = 0;
  for (const source of [...generators, ...grids]) {
    const take = Math.min(remaining, source.sourceCapacityW ?? 0);
    supplied.set(source.id, take);
    remaining -= take;
    if (source.sourceKind === "generator") generationW += take;
  }
  const gridImportW = totalDrawW - generationW - Math.max(0, remaining);

  const nodeResults = new Map<string, NodeResult>();
  let minVoltageV = Infinity;
  for (const node of ordered) {
    const voltageV = solution[index.get(node.id)!] ?? 0;
    const deliveredNodeW = Math.max(0, node.demandW) * fraction;
    if (node.demandW > 0) minVoltageV = Math.min(minVoltageV, voltageV);
    const isSource = supplied.has(node.id);
    nodeResults.set(node.id, {
      voltageV,
      currentA: isSource ? (sourceCurrents.get(node.id) ?? 0) : deliveredNodeW / nominalVoltageV,
      deliveredW: deliveredNodeW,
      suppliedW: supplied.get(node.id) ?? 0,
    });
  }

  return {
    nodeIds: ordered.map((n) => n.id),
    nominalVoltageV,
    demandW,
    deliveredW,
    lossW,
    capacityW,
    generationW,
    gridImportW,
    supplyFraction: demandW > 0 ? fraction : 1,
    minVoltageV: Number.isFinite(minVoltageV) ? minVoltageV : nominalVoltageV,
    nodes: nodeResults,
    edges: edgeResults,
  };
}

function solveLinear(
  nodes: readonly NetworkNode[],
  index: ReadonlyMap<string, number>,
  edges: readonly NetworkEdge[],
  fraction: number,
  nominalVoltageV: number,
): number[] {
  const n = nodes.length;
  const G: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const I = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i += 1) G[i]![i]! += LEAKAGE_CONDUCTANCE_S;
  for (const edge of edges) {
    const a = index.get(edge.a);
    const b = index.get(edge.b);
    if (a === undefined || b === undefined || a === b) continue;
    const g = 1 / Math.max(edge.resistanceOhm, 1e-12);
    G[a]![a]! += g;
    G[b]![b]! += g;
    G[a]![b]! -= g;
    G[b]![a]! -= g;
  }
  nodes.forEach((node, i) => {
    if (node.sourceVoltageV !== undefined && (node.sourceCapacityW ?? 0) > 0) {
      const g = 1 / Math.max(node.sourceResistanceOhm ?? 1e-3, 1e-9);
      G[i]![i]! += g;
      I[i]! += node.sourceVoltageV * g;
    }
    if (node.demandW > 0) I[i]! -= (node.demandW * fraction) / nominalVoltageV;
  });
  return gaussianSolve(G, I);
}

function totalLoss(
  solution: readonly number[],
  edges: readonly NetworkEdge[],
  index: ReadonlyMap<string, number>,
  nodes: readonly NetworkNode[],
): number {
  let loss = 0;
  for (const edge of edges) {
    const dv = (solution[index.get(edge.a)!] ?? 0) - (solution[index.get(edge.b)!] ?? 0);
    loss += (dv * dv) / Math.max(edge.resistanceOhm, 1e-12);
  }
  nodes.forEach((node, i) => {
    if (node.sourceVoltageV !== undefined && (node.sourceCapacityW ?? 0) > 0) {
      const current = (node.sourceVoltageV - (solution[i] ?? 0)) / (node.sourceResistanceOhm ?? 1);
      loss += current * current * (node.sourceResistanceOhm ?? 0);
    }
  });
  return loss;
}

/** Dense Gaussian elimination with partial pivoting. Returns zeros for a singular system. */
export function gaussianSolve(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] {
  const n = rhs.length;
  const a = matrix.map((row) => [...row]);
  const b = [...rhs];
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-300) return new Array<number>(n).fill(0);
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    const diag = a[col]![col]!;
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / diag;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) a[row]![k]! -= factor * a[col]![k]!;
      b[row]! -= factor * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}
