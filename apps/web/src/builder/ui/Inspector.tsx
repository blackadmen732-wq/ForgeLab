import { MATERIAL_CATALOG, findFluid, findSubstance, getMaterial } from "@forgelab/materials";
import { materialColor } from "../scene/appearance.js";
import { findComponentDefinition, type ProductInfo } from "@forgelab/reactor-components";
import {
  ROLE_PARAMETERS,
  type ParameterSpec,
  type PlantSummary,
  type SimulationComponent,
  type SimulationSettings,
  type PortSpec,
} from "@forgelab/sim-core";
import { vec3 } from "@forgelab/shared";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FlaskConical,
  Focus,
  Pin,
  PinOff,
  Trash2,
  Unlink,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Euler, Quaternion } from "three";
import { ConfidenceBadge } from "../../components/ConfidenceBadge.js";
import {
  gain,
  kelvin,
  mass,
  megawatts,
  metres,
  pascals,
  percent,
  si,
  titleCase,
  watts,
} from "../../lib/format.js";
import { CONNECTION_LABELS } from "../scene/appearance.js";
import { useEditor, useEditorStore, useSim } from "../store/context.js";
import { regionHighlight, useRegionHighlight } from "../scene/regionHighlight.js";
import { materialLab } from "./materialLab.js";
import { PartIcon } from "./PartIcon.js";

/* ------------------------------------------------------------------------------------ *
 * Small controls
 * ------------------------------------------------------------------------------------ */

function Section({
  title,
  children,
  defaultOpen = true,
  aside,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="insp-section">
      <button
        type="button"
        className="insp-section__head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown /> : <ChevronRight />}
        <span>{title}</span>
        {aside !== undefined && <span className="insp-section__aside">{aside}</span>}
      </button>
      {open && <div className="insp-section__body">{children}</div>}
    </section>
  );
}

function Row({ label, children, tip }: { label: string; children: ReactNode; tip?: string }) {
  return (
    <div className="insp-row">
      <span className="insp-row__label" data-tip={tip}>
        {label}
      </span>
      <span className="insp-row__value">{children}</span>
    </div>
  );
}

/** A number field that commits on Enter or blur and rejects non-numbers. */
function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  unit,
  disabled,
  label,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  label: string;
}) {
  const format = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : "");
  // While the field is focused it holds the typed text; otherwise it shows the live value.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || text.trim() === "") return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <span className="numfield">
      <input
        className="input input--num"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? format(value)}
        disabled={disabled}
        step={step}
        onFocus={() => setDraft(format(value))}
        onBlur={() => {
          if (draft !== null) commit(draft);
          setDraft(null);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(format(value));
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
          e.stopPropagation();
        }}
      />
      {unit && <span className="numfield__unit">{unit}</span>}
    </span>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  const tone = value >= 1 ? "fail" : value >= 0.8 ? "stress" : "ok";
  return (
    <div
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`meter__fill meter__fill--${tone}`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
      <span className="meter__text num">{percent(value)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Parameters
 * ------------------------------------------------------------------------------------ */

function ParameterField({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: ParameterSpec;
  value: unknown;
  disabled: boolean;
  onChange: (v: number | boolean | string) => void;
}) {
  switch (spec.kind) {
    case "number": {
      const v = typeof value === "number" ? value : spec.defaultValue;
      return (
        <Row label={spec.label} tip={spec.description}>
          <NumberField
            label={spec.label}
            value={v * spec.display.scale}
            min={spec.min * spec.display.scale}
            max={spec.max * spec.display.scale}
            unit={spec.display.unit}
            disabled={disabled}
            onCommit={(shown) => onChange(shown / spec.display.scale)}
          />
        </Row>
      );
    }
    case "boolean":
      return (
        <Row label={spec.label} tip={spec.description}>
          <label className="switch">
            <input
              type="checkbox"
              checked={value === true}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="switch__track" aria-hidden="true" />
            <span className="visually-hidden">{spec.label}</span>
          </label>
        </Row>
      );
    case "enum":
      return (
        <Row label={spec.label} tip={spec.description}>
          <select
            className="select"
            value={String(value ?? spec.defaultValue)}
            disabled={disabled}
            aria-label={spec.label}
            onChange={(e) => onChange(e.target.value)}
          >
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      );
  }
}

/* ------------------------------------------------------------------------------------ *
 * Live readouts
 * ------------------------------------------------------------------------------------ */

function StateReadouts({ component }: { component: SimulationComponent }) {
  const s = component.state.structural;
  const p = component.state.plant;
  const role = component.role;
  const structural =
    role === "structure" ||
    component.connections.some((c) => c.type === "structural" || c.type === "mount") ||
    s.utilization > 0;
  return (
    <>
      {p.disabled && <p className="insp-alert">Knocked out by a failure this run.</p>}
      {p.warnings.length > 0 && (
        <ul className="insp-warnings">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {structural && (
        <Section
          title="Structure"
          aside={<span className={`num tone-${s.status}`}>{percent(s.utilization)}</span>}
        >
          <Row
            label="Member"
            tip="How the solver idealised this part: column (axial + buckling), beam (bending) or block (bearing)."
          >
            {titleCase(s.memberRole)} · governs: {s.governingMode}
          </Row>
          <Row label="Axial">
            <Meter value={s.axialUtilization} label="Axial utilization" />
          </Row>
          {s.memberRole === "beam" && (
            <Row
              label="Bending"
              tip={`M = ${si(s.bendingMomentNm, "N·m")}, σ = ${pascals(s.bendingStressPa)}`}
            >
              <Meter value={s.bendingUtilization} label="Bending utilization" />
            </Row>
          )}
          {s.memberRole === "column" && (
            <Row
              label="Buckling"
              tip={`P_cr = ${si(s.criticalBucklingLoadN, "N")}, KL/r = ${s.slendernessRatio.toFixed(0)}`}
            >
              <Meter value={s.bucklingUtilization} label="Buckling utilization" />
            </Row>
          )}
          <Row label="Stress">
            <span className="num">
              {pascals(s.appliedStressPa)} / {pascals(s.allowableStressPa)}
            </span>
          </Row>
        </Section>
      )}
      <Section
        title="Thermal"
        aside={<span className="num">{kelvin(p.thermal.temperatureK)}</span>}
      >
        <Row label="Temperature">
          <span className="num">
            {kelvin(p.thermal.temperatureK)}
            {Number.isFinite(p.thermal.limitTemperatureK) && (
              <span className="dim"> / limit {kelvin(p.thermal.limitTemperatureK)}</span>
            )}
          </span>
        </Row>
        {p.thermal.heatGeneratedW > 0 && (
          <Row label="Heat in">{watts(p.thermal.heatGeneratedW)}</Row>
        )}
        {p.thermal.heatToCoolantW > 0 && (
          <Row label="To coolant">{watts(p.thermal.heatToCoolantW)}</Row>
        )}
        <Row label="To surroundings">{watts(p.thermal.heatToAmbientW)}</Row>
      </Section>
      {p.electrical !== null && (
        <Section
          title="Electrical"
          aside={<span className="num">{percent(p.electrical.supplyFraction)}</span>}
        >
          {p.electrical.demandW > 0 && (
            <Row label="Supplied">
              <span className="num">
                {watts(p.electrical.deliveredW)} / {watts(p.electrical.demandW)}
              </span>
            </Row>
          )}
          {p.electrical.suppliedW > 0 && <Row label="Output">{watts(p.electrical.suppliedW)}</Row>}
          <Row label="Voltage">{si(p.electrical.voltageV, "V")}</Row>
          <Row label="Current">{si(p.electrical.currentA, "A")}</Row>
          {p.electrical.lossW > 0 && <Row label="Resistive loss">{watts(p.electrical.lossW)}</Row>}
          {p.electrical.islandId === null && (
            <p className="insp-note">Not connected to a powered network.</p>
          )}
        </Section>
      )}
      {p.coolant !== null && (
        <Section title="Coolant">
          <Row label="Flow">{si(p.coolant.massFlowKgS, "kg/s")}</Row>
          <Row label="Coolant temperature">{kelvin(p.coolant.coolantTemperatureK)}</Row>
          <Row label="Pressure drop">{pascals(p.coolant.pressureDropPa)}</Row>
        </Section>
      )}
      {p.magnet !== null && (
        <Section title="Magnet">
          <Row label="Current">{si(p.magnet.currentA, "A")}</Row>
          <Row label="Field at plasma">{si(p.magnet.fieldAtPlasmaT, "T")}</Row>
          <Row label="Peak field">{si(p.magnet.peakFieldT, "T")}</Row>
          <Row label="Coil stress" tip={pascals(p.magnet.hoopStressPa)}>
            <Meter value={p.magnet.hoopUtilization} label="Coil stress utilization" />
          </Row>
          <Row label="Power demand">{watts(p.magnet.powerDemandW)}</Row>
          {p.magnet.quenched && <p className="insp-alert">Quenched.</p>}
          {p.magnet.servesVesselId === null && (
            <p className="insp-note">Not around any vessel: produces no confining field.</p>
          )}
        </Section>
      )}
      {p.vessel !== null && (
        <Section
          title="Vessel & plasma"
          aside={
            <span className={`phase phase--${p.vessel.plasma.phase}`}>{p.vessel.plasma.phase}</span>
          }
        >
          <p className="insp-note">{p.vessel.plasma.statusText}</p>
          <Row label="Pressure">{pascals(p.vessel.pressurePa)}</Row>
          {p.vessel.plasma.phase !== "off" && (
            <>
              <Row label="Temperature">{p.vessel.plasma.temperatureKeV.toFixed(2)} keV</Row>
              <Row label="Density">{si(p.vessel.plasma.densityM3, "m⁻³")}</Row>
              <Row label="Fusion power">{megawatts(p.vessel.plasma.fusionPowerW)}</Row>
              <Row label="Heating">
                {megawatts(p.vessel.plasma.auxiliaryHeatingW + p.vessel.plasma.ohmicHeatingW)}
              </Row>
              <Row label="Gain Q">{gain(p.vessel.plasma.gainQ)}</Row>
              <Row label="τE" tip="Energy confinement time from the scaling law in use.">
                {p.vessel.plasma.confinementTimeS.toFixed(2)} s
              </Row>
              <Row label="βN" tip="Normalised beta; Troyon limit ≈ 2.8.">
                {p.vessel.plasma.normalisedBeta.toFixed(2)}
              </Row>
              <Row label="Greenwald fraction">{p.vessel.plasma.greenwaldFraction.toFixed(2)}</Row>
              <Row label="q95">{p.vessel.plasma.safetyFactorQ95.toFixed(2)}</Row>
            </>
          )}
          <Row label="Field">{si(p.vessel.plasma.fieldT, "T")}</Row>
        </Section>
      )}
      {Object.keys(p.outputs).length > 0 && (
        <Section title="Outputs" defaultOpen={false}>
          {Object.entries(p.outputs).map(([k, v]) => (
            <Row key={k} label={titleCase(k.replace(/(W|K|Pa|KgS|M3|T|A|V)$/, ""))}>
              <span className="num">{formatOutput(k, v)}</span>
            </Row>
          ))}
        </Section>
      )}
    </>
  );
}

function formatOutput(key: string, value: number): string {
  if (key.endsWith("W")) return watts(value);
  if (key.endsWith("K")) return kelvin(value);
  if (key.endsWith("Pa")) return pascals(value);
  if (key.endsWith("KgS")) return si(value, "kg/s");
  if (key.endsWith("T")) return si(value, "T");
  return Number(value.toPrecision(4)).toString();
}

/* ------------------------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------------------------ */

const DOMAIN_LABELS: Record<PortSpec["domain"], string> = {
  structural: "Mount",
  electrical: "Electrical",
  fluid: "Fluid",
  vacuum: "Vacuum",
  fuel: "Fuel",
  control: "Control",
  shaft: "Shaft",
  heating: "Heating",
};

export function portRating(port: PortSpec): string {
  switch (port.domain) {
    case "electrical":
      return `${si(port.nominalVoltageV, "V")} · ${si(port.ratedCurrentA, "A")}`;
    case "fluid":
      return `${port.fluid.replace(/-/g, " ")} · ⌀${(port.innerDiameterM * 1000).toFixed(0)} mm · ${si(port.ratedPressurePa, "Pa")}`;
    case "vacuum":
      return `DN${Math.round(port.flangeDiameterM * 1000)}`;
    case "shaft":
    case "heating":
      return si(port.ratedPowerW, "W");
    case "control":
      return port.signal;
    case "fuel":
      return port.medium;
    default:
      return "";
  }
}

/**
 * The finished-product sheet: what the machine is, what it is rated for, how it connects,
 * what is inside it, and how it can fail. The player places the whole machine; none of
 * these internals is something they build.
 */
function ProductPanel({
  component,
  product,
}: {
  component: SimulationComponent;
  product: ProductInfo;
}) {
  const store = useEditorStore();
  const highlight = useRegionHighlight();
  const ratings = product.ratings(component.parameters);
  const ports = component.connectionPoints.filter(
    (p) => p.port !== undefined && p.port.domain !== "structural",
  );
  const connected = new Set(
    component.connections.flatMap((c) => [
      c.from.componentId === component.id ? c.from.connectionPointId : "",
      c.to.componentId === component.id ? c.to.connectionPointId : "",
    ]),
  );
  return (
    <>
      <Section title="Product">
        <p className="insp-note">{product.summary}</p>
        {ratings.map((r) => (
          <Row key={r.label} label={r.label}>
            {r.value}
          </Row>
        ))}
      </Section>
      {ports.length > 0 && (
        <Section title={`Ports (${ports.length})`}>
          <ul className="insp-ports">
            {ports.map((p) => (
              <li key={p.id} className={connected.has(p.id) ? "is-connected" : ""}>
                <span className={`port-dot port-dot--${p.port!.domain}`} aria-hidden="true" />
                <span className="insp-ports__label">{p.port!.label}</span>
                <span className="dim insp-ports__spec">
                  {DOMAIN_LABELS[p.port!.domain]} · {portRating(p.port!)}
                </span>
                <span className="insp-ports__state dim">
                  {connected.has(p.id) ? "connected" : "open"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Inside" defaultOpen={false}>
        <ul className="insp-internals">
          {product.internals.map((i) => {
            const picked = highlight?.componentId === component.id && highlight.regionId === i.id;
            return (
              <li key={i.id} className={picked ? "is-picked" : ""}>
                <button
                  type="button"
                  className="insp-region"
                  aria-pressed={picked}
                  title="Show this region in the cutaway"
                  onClick={() => {
                    if (picked) {
                      regionHighlight.set(null);
                      return;
                    }
                    regionHighlight.set({ componentId: component.id, regionId: i.id });
                    store.toggleCutaway(true);
                  }}
                >
                  <span
                    className="insp-swatch"
                    style={{ background: `#${materialColor(i.substanceId).getHexString()}` }}
                    aria-hidden
                  />
                  <strong>{i.name}</strong>
                </button>
                <span className="dim">
                  {" · "}
                  <button
                    type="button"
                    className="link-btn"
                    title="Open in the Material Lab"
                    onClick={() => materialLab.open(i.substanceId)}
                  >
                    {findSubstance(i.substanceId)?.name ??
                      findFluid(i.substanceId)?.name ??
                      i.substanceId}
                  </button>
                  {i.volumeFraction !== undefined &&
                    ` · ${(i.volumeFraction * 100).toFixed(0)} % of volume`}
                </span>
                <p className="dim">{i.purpose}</p>
              </li>
            );
          })}
        </ul>
        {product.internals.length > 1 && (
          <p className="insp-note">
            Cutaway (X) shows these as a cross-section of this part, outermost first
            {product.internals.every((i) => i.volumeFraction !== undefined)
              ? ", sized by volume."
              : " — schematic: the order is known, the proportions are not, so bands are equal."}
          </p>
        )}
        {!product.internalsSetMass && (
          <p className="insp-note">
            Shown for inspection; this part&apos;s mass is its material × volume.
          </p>
        )}
      </Section>
      {product.failureModes.length > 0 && (
        <Section title="Can fail by" defaultOpen={false}>
          <ul className="insp-internals">
            {product.failureModes.map((f) => (
              <li key={f.id}>
                <strong>{f.name}</strong>
                <span className="dim"> · {f.system}</span>
                <p className="dim">{f.description}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function PartPanel({ component }: { component: SimulationComponent }) {
  const store = useEditorStore();
  const mode = useEditor((v) => v.mode);
  const advanced = useEditor((v) => v.advanced);
  const detail = useSim((s) => s.detail);
  const locked = mode !== "build";
  const live = locked && detail !== null && detail.id === component.id ? detail : component;
  const definition = findComponentDefinition(component.type);
  const specs = ROLE_PARAMETERS[component.role];
  const basic = specs.filter((s) => !s.advanced);
  const extra = specs.filter((s) => s.advanced);
  const dims = definition ? definition.dimensionsOf(component.geometry) : {};
  const material = getMaterial(component.materialId);
  const euler = useMemo(() => {
    const q = component.transform.rotation;
    const e = new Euler().setFromQuaternion(new Quaternion(q.x, q.y, q.z, q.w), "YXZ");
    const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 100) / 100;
    return { x: deg(e.x), y: deg(e.y), z: deg(e.z) };
  }, [component.transform.rotation]);
  const pos = component.transform.positionM;

  return (
    <div className="insp-panel">
      <header className="insp-head">
        <PartIcon role={component.role} />
        <div className="insp-head__text">
          <input
            key={component.id + component.label}
            className="insp-head__label"
            defaultValue={component.label}
            aria-label="Part label"
            disabled={locked}
            onBlur={(e) => store.setLabel(component.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
          />
          <span className="dim">
            {definition?.name ?? component.type} ·{" "}
            {definition?.category ?? titleCase(component.role)} ·{" "}
            <span className="mono">{component.id}</span>
          </span>
        </div>
      </header>
      <div className="insp-actions">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => store.focusComponent(component.id)}
          data-tip="Frame (F)"
        >
          <Focus />
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={locked}
          onClick={store.duplicateSelected}
          data-tip="Duplicate (Ctrl D)"
        >
          <Copy />
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={locked}
          onClick={() => store.setAnchored([component.id], !component.anchored)}
          data-tip={component.anchored ? "Release (P)" : "Pin in place (P)"}
        >
          {component.anchored ? <PinOff /> : <Pin />}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost btn--danger"
          disabled={locked}
          onClick={store.deleteSelected}
          data-tip="Delete (Del)"
        >
          <Trash2 />
        </button>
        <span className="insp-mass num" data-tip="Geometry × density + declared contents">
          {mass(component.massKg)}
        </span>
      </div>
      {locked && (
        <p className="insp-note insp-note--lock">
          Live values from the running simulation. Return to Build to edit.
        </p>
      )}

      <StateReadouts component={live} />

      {definition && <ProductPanel component={component} product={definition.product} />}

      <Section title={component.composition.length > 0 ? "Casing material" : "Material"}>
        <Row label="Material">
          <select
            className="select"
            value={component.materialId}
            disabled={locked}
            aria-label="Material"
            onChange={(e) => store.setMaterial([component.id], e.target.value)}
          >
            {MATERIAL_CATALOG.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Yield strength">{pascals(material.yieldStrengthPa)}</Row>
        <Row label="Density">{si(material.densityKgM3, "kg/m³")}</Row>
        <Row label="Max temperature">{kelvin(material.maxOperatingTemperatureK)}</Row>
        <button
          type="button"
          className="btn btn--sm btn--ghost insp-lab"
          onClick={() => materialLab.open(component.materialId)}
        >
          <FlaskConical /> {material.grade} · sources, curves, compare
        </button>
      </Section>

      {definition && definition.dimensions.length > 0 && (
        <Section title="Dimensions">
          {definition.dimensions.map((d) => (
            <Row key={d.key} label={d.label} tip={`${metres(d.minM)} – ${metres(d.maxM)}`}>
              <NumberField
                label={d.label}
                value={dims[d.key] ?? d.defaultM}
                min={d.minM}
                max={d.maxM}
                unit="m"
                disabled={locked}
                onCommit={(v) => store.setDimension(component.id, d.key, v)}
              />
            </Row>
          ))}
        </Section>
      )}

      {basic.length > 0 && (
        <Section title="Operation">
          {basic.map((spec) => (
            <ParameterField
              key={spec.key}
              spec={spec}
              value={component.parameters[spec.key]}
              disabled={locked}
              onChange={(v) => store.setParameter([component.id], spec.key, v)}
            />
          ))}
        </Section>
      )}

      <button
        type="button"
        className="insp-advanced-toggle"
        aria-expanded={advanced}
        onClick={() => store.setAdvanced(!advanced)}
      >
        {advanced ? <ChevronDown /> : <ChevronRight />} Advanced
      </button>
      {advanced && (
        <>
          {extra.length > 0 && (
            <Section title="Advanced parameters">
              {extra.map((spec) => (
                <ParameterField
                  key={spec.key}
                  spec={spec}
                  value={component.parameters[spec.key]}
                  disabled={locked}
                  onChange={(v) => store.setParameter([component.id], spec.key, v)}
                />
              ))}
            </Section>
          )}
          <Section title="Placement">
            {(["x", "y", "z"] as const).map((axis) => (
              <Row key={axis} label={`Position ${axis.toUpperCase()}`}>
                <NumberField
                  label={`Position ${axis}`}
                  value={pos[axis]}
                  unit="m"
                  disabled={locked}
                  onCommit={(v) =>
                    store.setPosition(
                      component.id,
                      vec3(
                        axis === "x" ? v : pos.x,
                        axis === "y" ? v : pos.y,
                        axis === "z" ? v : pos.z,
                      ),
                    )
                  }
                />
              </Row>
            ))}
            {(["x", "y", "z"] as const).map((axis) => (
              <Row key={`r${axis}`} label={`Rotation ${axis.toUpperCase()}`}>
                <NumberField
                  label={`Rotation ${axis}`}
                  value={euler[axis]}
                  unit="°"
                  disabled={locked}
                  onCommit={(v) =>
                    store.setRotationEuler(
                      component.id,
                      vec3(
                        axis === "x" ? v : euler.x,
                        axis === "y" ? v : euler.y,
                        axis === "z" ? v : euler.z,
                      ),
                    )
                  }
                />
              </Row>
            ))}
            <Row
              label="Contents mass"
              tip="Mass the geometry does not model: coolant inventory, internals, ballast."
            >
              <NumberField
                label="Contents mass"
                value={component.additionalMassKg / 1000}
                min={0}
                unit="t"
                disabled={locked}
                onCommit={(v) => store.setAdditionalMass(component.id, v * 1000)}
              />
            </Row>
          </Section>
          <Section title={`Sockets (${component.connectionPoints.length})`}>
            <ul className="sockets">
              {component.connectionPoints.map((p) => {
                const links = component.connections.filter(
                  (c) =>
                    (c.from.componentId === component.id && c.from.connectionPointId === p.id) ||
                    (c.to.componentId === component.id && c.to.connectionPointId === p.id),
                );
                return (
                  <li key={p.id}>
                    <span
                      className={`socket-dot socket-dot--${p.connectionType}`}
                      aria-hidden="true"
                    />
                    <span className="mono">{p.id}</span>
                    <span className="dim">{CONNECTION_LABELS[p.connectionType]}</span>
                    {p.maxLoadN !== undefined && (
                      <span className="dim num">{si(p.maxLoadN, "N")}</span>
                    )}
                    {links.map((c) => {
                      const other = c.from.componentId === component.id ? c.to : c.from;
                      return (
                        <span key={c.id} className="socket-link">
                          →{" "}
                          <button
                            type="button"
                            className="link"
                            onClick={() => store.focusComponent(other.componentId)}
                          >
                            {other.componentId}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--icon btn--sm"
                            aria-label="Disconnect"
                            data-tip="Disconnect"
                            disabled={locked}
                            onClick={() => store.disconnect(c.id)}
                          >
                            <Unlink />
                          </button>
                        </span>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

function MultiPanel({ components }: { components: readonly SimulationComponent[] }) {
  const store = useEditorStore();
  const locked = useEditor((v) => v.mode !== "build");
  const ids = components.map((c) => c.id);
  const total = components.reduce((sum, c) => sum + c.massKg, 0);
  const worst = Math.max(...components.map((c) => c.state.structural.utilization));
  const materials = new Set(components.map((c) => c.materialId));
  return (
    <div className="insp-panel">
      <header className="insp-head">
        <div className="insp-head__text">
          <strong>{components.length} parts selected</strong>
          <span className="dim">Shift-click to add or remove</span>
        </div>
      </header>
      <Section title="Selection">
        <Row label="Total mass">{mass(total)}</Row>
        <Row label="Worst utilization">
          <Meter value={worst} label="Worst utilization" />
        </Row>
        <Row label="Material">
          <select
            className="select"
            value={materials.size === 1 ? [...materials][0] : ""}
            disabled={locked}
            aria-label="Material"
            onChange={(e) => e.target.value && store.setMaterial(ids, e.target.value)}
          >
            {materials.size > 1 && <option value="">Mixed</option>}
            {MATERIAL_CATALOG.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <div className="insp-actions insp-actions--wide">
        <button
          type="button"
          className="btn btn--sm"
          disabled={locked}
          onClick={store.duplicateSelected}
        >
          <Copy /> Duplicate
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={locked}
          onClick={() => store.setAnchored(ids, !components.every((c) => c.anchored))}
        >
          <Pin /> Pin / release
        </button>
        <button
          type="button"
          className="btn btn--sm btn--danger"
          disabled={locked}
          onClick={store.deleteSelected}
        >
          <Trash2 /> Delete
        </button>
      </div>
      <ul className="insp-list">
        {components.map((c) => (
          <li key={c.id}>
            <button type="button" className="link" onClick={() => store.focusComponent(c.id)}>
              {c.label || c.id}
            </button>
            <span className="num dim">{percent(c.state.structural.utilization)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlantMetrics({ plant, live }: { plant: PlantSummary; live: boolean }) {
  const m = plant.metrics;
  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi__label">Net electric</span>
          <span
            className={`kpi__value num ${m.netElectricW > 0 ? "pos" : m.netElectricW < 0 ? "neg" : ""}`}
          >
            {megawatts(m.netElectricW)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Fusion</span>
          <span className="kpi__value num">{megawatts(m.fusionPowerW)}</span>
        </div>
        <div className="kpi">
          <span className="kpi__label">Q</span>
          <span className="kpi__value num">{gain(m.plasmaGainQ)}</span>
        </div>
      </div>
      <Row label="Gross electric">{megawatts(m.grossElectricW)}</Row>
      <Row label="House load" tip="Everything the plant consumes: loads plus resistive losses.">
        {megawatts(m.houseLoadW)}
      </Row>
      <Row label="Grid import">{megawatts(m.gridImportW)}</Row>
      <Row label="Peak temperature">{kelvin(m.peakTemperatureK)}</Row>
      {!live && (
        <p className="insp-note">Start-up state (t = 0). Press Simulate to run the plant.</p>
      )}
    </>
  );
}

function ConfidencePanel({ plant }: { plant: PlantSummary }) {
  const subsystems = plant.confidence.subsystems;
  return (
    <Section
      title="Model confidence"
      aside={<ConfidenceBadge level={plant.confidence.level} compact />}
      defaultOpen={false}
    >
      {subsystems.length === 0 && (
        <p className="insp-note">Only structural physics applies to this design.</p>
      )}
      {subsystems.map((s) => (
        <div key={s.subsystem} className="conf-row">
          <div className="insp-row">
            <span className="insp-row__label">{titleCase(s.subsystem)}</span>
            <ConfidenceBadge level={s.level} />
          </div>
          {s.reasons.length > 0 && (
            <ul className="insp-reasons">
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="insp-note">
        ForgeLab uses reduced, documented models. It does not validate real reactor designs.
      </p>
    </Section>
  );
}

function SettingsPanel() {
  const store = useEditorStore();
  const settings = useEditor((v) => v.snapshot.settings);
  const locked = useEditor((v) => v.mode !== "build");
  const advanced = useEditor((v) => v.advanced);
  const set = (changes: Partial<SimulationSettings>) => store.updateSettings(changes);
  return (
    <Section title="Simulation settings" defaultOpen={false}>
      <Row label="Gravity">
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.gravityMps2 > 0}
            disabled={locked}
            onChange={(e) => set({ gravityMps2: e.target.checked ? 9.80665 : 0 })}
          />
          <span className="switch__track" aria-hidden="true" />
          <span className="visually-hidden">Gravity</span>
        </label>
      </Row>
      <Row
        label="After a failure"
        tip="Report: failures are logged, the structure stays put. Detach: yielded members release what they hold."
      >
        <select
          className="select"
          value={settings.failurePropagation}
          disabled={locked}
          aria-label="Failure propagation"
          onChange={(e) =>
            set({ failurePropagation: e.target.value as SimulationSettings["failurePropagation"] })
          }
        >
          <option value="report">Report only</option>
          <option value="detach">Collapse (detach)</option>
        </select>
      </Row>
      <Row label="Start">
        <select
          className="select"
          value={settings.initialThermalState}
          disabled={locked}
          aria-label="Initial thermal state"
          onChange={(e) =>
            set({
              initialThermalState: e.target.value as SimulationSettings["initialThermalState"],
            })
          }
        >
          <option value="hot-standby">Hot standby</option>
          <option value="cold">Cold</option>
        </select>
      </Row>
      {advanced && (
        <>
          <Row
            label="Vessels start"
            tip="Pumped down, or at atmospheric pressure (the pumps must evacuate them first)."
          >
            <select
              className="select"
              value={settings.initialVacuumState}
              disabled={locked}
              aria-label="Initial vacuum state"
              onChange={(e) =>
                set({
                  initialVacuumState: e.target.value as SimulationSettings["initialVacuumState"],
                })
              }
            >
              <option value="pumped-down">Pumped down</option>
              <option value="atmospheric">Atmospheric</option>
            </select>
          </Row>
          <Row label="Design safety factor" tip="Allowable stress = yield / factor.">
            <NumberField
              label="Design safety factor"
              value={settings.designSafetyFactor}
              min={1}
              max={5}
              disabled={locked}
              onCommit={(v) => set({ designSafetyFactor: v })}
            />
          </Row>
          <Row
            label="Buckling K"
            tip="Effective length factor for every column: 0.5 fixed–fixed, 1 pinned–pinned, 2 cantilever."
          >
            <NumberField
              label="Buckling K"
              value={settings.bucklingEffectiveLengthFactor}
              min={0.5}
              max={2.5}
              disabled={locked}
              onCommit={(v) => set({ bucklingEffectiveLengthFactor: v })}
            />
          </Row>
          <Row label="Ambient">
            <NumberField
              label="Ambient temperature"
              value={settings.ambientTemperatureK}
              min={200}
              max={400}
              unit="K"
              disabled={locked}
              onCommit={(v) => set({ ambientTemperatureK: v })}
            />
          </Row>
        </>
      )}
    </Section>
  );
}

export function AssemblyPanel() {
  const snapshot = useEditor((v) => v.snapshot);
  const mode = useEditor((v) => v.mode);
  const simPlant = useSim((s) => s.plant);
  const live = mode === "simulate" && simPlant !== null;
  const plant = live ? simPlant : snapshot.plant;
  const hasPlant = snapshot.components.some((c) => c.role !== "structure");
  return (
    <div className="insp-panel">
      <header className="insp-head">
        <div className="insp-head__text">
          <strong>Design</strong>
          <span className="dim">Nothing selected — click a part to inspect it</span>
        </div>
      </header>
      <Section title="Assembly">
        <Row label="Parts">{snapshot.components.length}</Row>
        <Row label="Connections">{snapshot.connections.length}</Row>
        <Row label="Total mass">{mass(snapshot.assembly.totalMassKg)}</Row>
        {snapshot.assembly.totalMassKg > 0 && (
          <Row label="Centre of mass">
            <span className="num">
              {snapshot.assembly.centerOfMassM.x.toFixed(1)},{" "}
              {snapshot.assembly.centerOfMassM.y.toFixed(1)},{" "}
              {snapshot.assembly.centerOfMassM.z.toFixed(1)} m
            </span>
          </Row>
        )}
      </Section>
      {hasPlant && (
        <Section title={live ? "Plant (live)" : "Plant"}>
          <PlantMetrics plant={plant} live={live} />
        </Section>
      )}
      {hasPlant && <ConfidencePanel plant={plant} />}
      {snapshot.diagnostics.length > 0 && (
        <Section title={`Diagnostics (${snapshot.diagnostics.length})`}>
          <ul className="insp-warnings">
            {snapshot.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Section>
      )}
      <SettingsPanel />
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  const selected = useMemo(() => {
    const byId = new Map(components.map((c) => [c.id, c]));
    return selection.flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    });
  }, [selection, components]);
  return (
    <aside className="inspector" aria-label="Inspector">
      {selected.length === 0 ? (
        <AssemblyPanel />
      ) : selected.length === 1 ? (
        <PartPanel component={selected[0]!} />
      ) : (
        <MultiPanel components={selected} />
      )}
    </aside>
  );
}
