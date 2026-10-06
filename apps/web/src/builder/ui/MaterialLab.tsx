import {
  FLUID_LIBRARY,
  MATERIAL_LIBRARY,
  criticalTemperatureK,
  findFluid,
  findMaterial,
  findMaterialRecord,
  getSubstance,
  sourceCitation,
  type Curve,
  type FluidRecord,
  type MaterialCategory,
  type MaterialRecord,
  type Quantity,
  type ThermalResponse,
} from "@forgelab/materials";
import { FlaskConical, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CurveChart, type CurveSeries } from "./CurveChart.js";
import { materialLab, useMaterialLab } from "./materialLab.js";
import { CONFIDENCE_LABELS, CONFIDENCE_TIPS, formatQuantity, formatRange } from "./quantity.js";

/**
 * The Material Lab: the library behind every part, browsable and comparable. Every
 * number shows its conditions, confidence and source; a property the library has no
 * source for is shown as not catalogued rather than as zero. It reads the library only —
 * nothing here changes a design.
 */
const CATEGORY_LABELS: Readonly<Record<MaterialCategory, string>> = {
  "structural-metal": "Structural metals",
  conductor: "Conductors",
  "plasma-facing": "Plasma-facing & high temperature",
  superconductor: "Superconductors",
  "insulator-ceramic": "Insulators & ceramics",
  nuclear: "Nuclear & blanket",
  civil: "Civil",
  electrochemical: "Electrochemical cells",
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as MaterialCategory[];

const RESPONSE_TEXT: Readonly<Record<ThermalResponse, string>> = {
  steel:
    "Oxide temper colours (straw to blue) from about 200 °C, a dull red glow from about 525 °C (the Draper point), brighter as it heats. It does not burn.",
  copper:
    "Darkens and blackens as it oxidises; it glows only near its 1085 °C melting point. Electrical overheating shows first as discolouration.",
  "light-alloy": "Hardly changes colour; it softens and melts before it can glow visibly.",
  refractory: "Glows red, then orange-white, and stays solid far beyond other metals.",
  char: "Discolours, chars and smokes when overheated.",
  ceramic: "No oxide colours; it glows when hot.",
  superconductor:
    "No visible change. A quench shows as resistive heating inside the winding, not on the surface.",
};

/** Series colours: validated categorical slots 1–2 for the dark panel surface. */
const SERIES = ["#3987e5", "#d95926"] as const;

function Confidence({ q }: { q: Pick<Quantity, "confidence"> }) {
  return (
    <span className={`lab-conf lab-conf--${q.confidence}`} data-tip={CONFIDENCE_TIPS[q.confidence]}>
      {CONFIDENCE_LABELS[q.confidence]}
    </span>
  );
}

function Source({ source }: { source: string }) {
  return (
    <span className="lab-src mono" data-tip={sourceCitation(source)} tabIndex={0}>
      {source}
    </span>
  );
}

function PropRow({ label, q }: { label: string; q: Quantity | undefined }) {
  if (q === undefined) return null;
  const range = formatRange(q);
  return (
    <div className="lab-row">
      <span className="lab-row__label">{label}</span>
      <span className="lab-row__value mono">{formatQuantity(q)}</span>
      <span className="lab-row__meta">
        <Confidence q={q} /> <Source source={q.source} />
      </span>
      {(q.at !== undefined || range !== null || q.note !== undefined) && (
        <span className="lab-row__note dim">
          {[q.at && `at ${q.at}`, range && `range ${range}`, q.note].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lab-group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/** Every source key a record cites, in first-use order. */
function sourcesOf(value: unknown, out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "source" && typeof v === "string") out.add(v);
    else sourcesOf(v, out);
  }
  return out;
}

/** The key properties shown side by side when comparing. */
const COMPARE_ROWS: readonly (readonly [string, (r: MaterialRecord) => Quantity | undefined])[] = [
  ["Density", (r) => r.density],
  ["Yield strength", (r) => r.mechanical?.yieldStrength],
  ["Young's modulus", (r) => r.mechanical?.youngsModulus],
  ["Thermal conductivity", (r) => r.thermal?.conductivity],
  ["Specific heat", (r) => r.thermal?.specificHeat],
  ["Electrical resistivity", (r) => r.electrical?.resistivity],
  ["Melting / solidus", (r) => r.thermal?.melting ?? r.thermal?.decomposition],
  ["Max. service temperature", (r) => r.thermal?.maxService],
  ["Critical temperature Tc0", (r) => r.superconducting?.criticalTemperatureZeroField],
];

function Compare({ a, b }: { a: MaterialRecord; b: MaterialRecord }) {
  return (
    <table className="lab-compare">
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">
            <span className="curve__key" style={{ background: SERIES[0] }} aria-hidden /> {a.name}
          </th>
          <th scope="col">
            <span className="curve__key" style={{ background: SERIES[1] }} aria-hidden /> {b.name}
          </th>
        </tr>
      </thead>
      <tbody>
        {COMPARE_ROWS.map(([label, get]) => {
          const qa = get(a);
          const qb = get(b);
          if (qa === undefined && qb === undefined) return null;
          const cell = (q: Quantity | undefined) =>
            q === undefined ? (
              <td className="dim" data-tip="Not catalogued: no source yet">
                —
              </td>
            ) : (
              <td
                className="mono"
                data-tip={`${CONFIDENCE_LABELS[q.confidence]} · ${sourceCitation(q.source)}`}
              >
                {formatQuantity(q)}
              </td>
            );
          return (
            <tr key={label}>
              <th scope="row">{label}</th>
              {cell(qa)}
              {cell(qb)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function curves(
  record: MaterialRecord,
  other: MaterialRecord | null,
): { title: string; series: CurveSeries[] }[] {
  const out: { title: string; series: CurveSeries[] }[] = [];
  const add = (title: string, get: (r: MaterialRecord) => Curve | undefined) => {
    const mine = get(record);
    if (mine === undefined) return;
    const series: CurveSeries[] = [{ label: record.name, curve: mine, color: SERIES[0] }];
    const theirs = other === null ? undefined : get(other);
    if (other !== null && theirs !== undefined && theirs.unit === mine.unit)
      series.push({ label: other.name, curve: theirs, color: SERIES[1] });
    out.push({ title, series });
  };
  add("Yield strength factor", (r) => r.mechanical?.yieldReduction);
  add("Stiffness factor", (r) => r.mechanical?.modulusReduction);
  add("Electrical resistivity", (r) => r.electrical?.resistivityCurve);
  return out;
}

function SolidDetail({ record, other }: { record: MaterialRecord; other: MaterialRecord | null }) {
  const m = record.mechanical;
  const t = record.thermal;
  const e = record.electrical;
  const sc = record.superconducting;
  const placeable = findMaterial(record.id) !== undefined;
  const surface =
    sc?.criticalSurface !== null && sc !== undefined
      ? getSubstance(record.id).superconductor
      : undefined;
  const combustible = record.presentation.combustible;
  return (
    <>
      {other !== null && <Compare a={record} b={other} />}
      {curves(record, other).map((c) => (
        <CurveChart key={c.title} title={c.title} series={c.series} />
      ))}
      <Group title="Mechanical">
        <PropRow label="Density" q={record.density} />
        <PropRow label="Yield strength (0.2 %)" q={m?.yieldStrength} />
        <PropRow label="Ultimate strength" q={m?.ultimateStrength} />
        <PropRow label="Young's modulus" q={m?.youngsModulus} />
        <PropRow label="Poisson's ratio" q={m?.poissonsRatio} />
        <PropRow label="Flexural strength" q={m?.flexuralStrength} />
        <PropRow label="Compressive strength" q={m?.compressiveStrength} />
      </Group>
      {t !== undefined && (
        <Group title="Thermal">
          <PropRow label="Specific heat" q={t.specificHeat} />
          <PropRow label="Thermal conductivity" q={t.conductivity} />
          <PropRow label="Expansion coefficient" q={t.expansion} />
          <PropRow label="Melting (solidus)" q={t.melting} />
          <PropRow label="Sublimation / decomposition" q={t.decomposition} />
          <PropRow label="Max. service temperature" q={t.maxService} />
          <PropRow label="Min. service temperature" q={t.minService} />
        </Group>
      )}
      {e !== undefined && (
        <Group title="Electrical">
          {e.insulator && e.resistivity === undefined && (
            <p className="dim">Electrical insulator.</p>
          )}
          <PropRow label={e.insulator ? "Volume resistivity" : "Resistivity"} q={e.resistivity} />
          <PropRow label="Dielectric strength" q={e.dielectricStrength} />
        </Group>
      )}
      {record.magnetic !== undefined && (
        <Group title="Magnetic">
          <p>
            {record.magnetic.ferromagnetic ? "Ferromagnetic." : "Not ferromagnetic."}{" "}
            <span className="dim">{record.magnetic.note}</span>
          </p>
          <PropRow label="Curie temperature" q={record.magnetic.curieTemperature} />
        </Group>
      )}
      {sc !== undefined && (
        <Group title="Superconducting">
          <PropRow label="Critical temperature Tc0" q={sc.criticalTemperatureZeroField} />
          <PropRow label="Upper critical field Bc20" q={sc.upperCriticalFieldZeroTemperature} />
          {surface !== undefined ? (
            <table className="lab-tc">
              <caption>Critical temperature in field (the coil's quench limit)</caption>
              <thead>
                <tr>
                  {[0, 5, 10, 12, 15, 20].map((b) => (
                    <th key={b} scope="col">
                      {b} T
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {[0, 5, 10, 12, 15, 20].map((b) => {
                    const tc = criticalTemperatureK(surface, b);
                    return (
                      <td key={b} className="mono">
                        {tc > 0 ? `${tc.toFixed(1)} K` : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="dim">No field-dependent critical surface catalogued.</p>
          )}
          <p className="dim">{sc.note}</p>
        </Group>
      )}
      {record.nuclear !== undefined && (
        <Group title="Nuclear">
          <ul>
            {record.nuclear.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Group>
      )}
      {record.plasmaFacing !== undefined && (
        <Group title="Facing the plasma">
          <ul>
            {record.plasmaFacing.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Group>
      )}
      <Group title="When it is hot">
        <p>{RESPONSE_TEXT[record.presentation.thermalResponse]}</p>
        {combustible === false ? (
          <p className="dim">Not combustible.</p>
        ) : (
          <PropRow label={`Burns (${combustible.smoke} smoke) from`} q={combustible.ignition} />
        )}
      </Group>
      <Group title="Caveats">
        <ul>
          {record.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {!placeable && (
          <p className="lab-ref">
            Reference data: a value the solvers need is not catalogued yet, so this material appears
            inside finished machines but cannot be assigned to a placed part.
          </p>
        )}
      </Group>
    </>
  );
}

function FluidDetail({ fluid }: { fluid: FluidRecord }) {
  return (
    <>
      <Group title="Phase behaviour">
        <PropRow label="Molar mass" q={fluid.molarMass} />
        <PropRow label="Normal boiling point" q={fluid.normalBoilingPoint} />
        <PropRow label="Melting point" q={fluid.meltingPoint} />
        <PropRow label="Triple point" q={fluid.triplePoint} />
        <PropRow label="Critical temperature" q={fluid.criticalTemperature} />
        <PropRow label="Critical pressure" q={fluid.criticalPressure} />
        <PropRow label="Latent heat of vaporisation" q={fluid.latentHeatOfVaporization} />
        <PropRow label="Energy released (fuel)" q={fluid.specificEnergy} />
      </Group>
      {fluid.states.map((s) => (
        <Group key={s.label} title={s.label}>
          <PropRow label="Pressure" q={s.pressure} />
          <PropRow label="Temperature" q={s.temperature} />
          <PropRow label="Density" q={s.density} />
          <PropRow label="Specific heat" q={s.specificHeat} />
          <PropRow label="Thermal conductivity" q={s.conductivity} />
          <PropRow label="Viscosity" q={s.viscosity} />
        </Group>
      ))}
      {fluid.radioactive !== undefined && (
        <Group title="Radioactivity">
          <PropRow label="Half-life" q={fluid.radioactive.halfLife} />
          <PropRow label="Specific activity" q={fluid.radioactive.specificActivity} />
          <PropRow label="Decay heat" q={fluid.radioactive.decayHeat} />
        </Group>
      )}
      <Group title="Release and fire">
        <p>
          A release looks like: <strong>{fluid.release.replace(/-/g, " ")}</strong>.
        </p>
        {fluid.combustible === false ? (
          <p className="dim">Not combustible.</p>
        ) : (
          <>
            <p>{fluid.combustible.note}</p>
            <PropRow label="Flash point" q={fluid.combustible.flashPoint} />
          </>
        )}
      </Group>
      <Group title="Notes">
        <ul>
          {fluid.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Group>
    </>
  );
}

export function MaterialLab() {
  const { open, materialId, compareId } = useMaterialLab();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        materialLab.close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (s: string) => q === "" || s.toLowerCase().includes(q);
    return {
      solids: MATERIAL_LIBRARY.filter((m) => hit(`${m.name} ${m.grade} ${m.id}`)),
      fluids: FLUID_LIBRARY.filter((f) => hit(`${f.name} ${f.formula} ${f.id}`)),
    };
  }, [query]);

  if (!open) return null;
  const record = findMaterialRecord(materialId);
  const fluid = record === undefined ? findFluid(materialId) : undefined;
  const other = compareId === null ? null : (findMaterialRecord(compareId) ?? null);
  const sources = [...sourcesOf(record ?? fluid)];

  return (
    <section className="lab" role="dialog" aria-label="Material Lab">
      <header className="lab__head">
        <FlaskConical aria-hidden />
        <h2>Material Lab</h2>
        <label className="lab__search">
          <Search aria-hidden />
          <input
            type="search"
            placeholder="Find a material or grade"
            value={query}
            aria-label="Find a material"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Close Material Lab"
          onClick={() => materialLab.close()}
        >
          <X />
        </button>
      </header>
      <div className="lab__body">
        <nav className="lab__list" aria-label="Materials">
          {CATEGORY_ORDER.map((category) => {
            const items = matches.solids.filter((m) => m.category === category);
            if (items.length === 0) return null;
            return (
              <div key={category} className="lab__cat">
                <h3>{CATEGORY_LABELS[category]}</h3>
                {items.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="lab__item"
                    aria-current={m.id === materialId ? "true" : undefined}
                    onClick={() => materialLab.select(m.id)}
                  >
                    <span
                      className="insp-swatch"
                      style={{ background: m.presentation.color }}
                      aria-hidden
                    />
                    <span>
                      {m.name}
                      <small className="dim">{m.grade}</small>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          {matches.fluids.length > 0 && (
            <div className="lab__cat">
              <h3>Fluids & gases</h3>
              {matches.fluids.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="lab__item"
                  aria-current={f.id === materialId ? "true" : undefined}
                  onClick={() => materialLab.select(f.id)}
                >
                  <span className="insp-swatch insp-swatch--fluid" aria-hidden />
                  <span>
                    {f.name}
                    <small className="dim">{f.formula}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <article className="lab__detail">
          {record !== undefined && (
            <>
              <header className="lab__title">
                <span
                  className="lab__swatch"
                  style={{ background: record.presentation.color }}
                  aria-hidden
                />
                <div>
                  <h3>{record.name}</h3>
                  <p className="dim">{record.grade}</p>
                </div>
                <span className={`lab-chip${findMaterial(record.id) ? " lab-chip--ok" : ""}`}>
                  {findMaterial(record.id) ? "Placeable" : "Reference data"}
                </span>
              </header>
              <p>{record.summary}</p>
              <label className="lab__compare">
                Compare with{" "}
                <select
                  className="select"
                  value={compareId ?? ""}
                  onChange={(e) =>
                    materialLab.compare(e.target.value === "" ? null : e.target.value)
                  }
                >
                  <option value="">— nothing —</option>
                  {MATERIAL_LIBRARY.filter((m) => m.id !== record.id).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <SolidDetail record={record} other={other} />
            </>
          )}
          {fluid !== undefined && (
            <>
              <header className="lab__title">
                <span className="lab__swatch insp-swatch--fluid" aria-hidden />
                <div>
                  <h3>{fluid.name}</h3>
                  <p className="dim">{fluid.formula}</p>
                </div>
                <span className="lab-chip">Fluid</span>
              </header>
              <p>{fluid.summary}</p>
              <FluidDetail fluid={fluid} />
            </>
          )}
          <Group title="Sources">
            <ol className="lab-sources">
              {sources.map((s) => (
                <li key={s}>
                  <span className="mono">{s}</span> — {sourceCitation(s)}
                </li>
              ))}
            </ol>
            <p className="dim">
              Engineering-sandbox data transcribed from these documents; not certified design data.
              See docs/material-sources.md.
            </p>
          </Group>
        </article>
      </div>
    </section>
  );
}
