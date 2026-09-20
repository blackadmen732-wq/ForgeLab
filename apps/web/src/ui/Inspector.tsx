import { getMaterial } from "@forgelab/materials";
import { geometryVolumeM3 } from "@forgelab/sim-core";
import { MATERIAL_OPTIONS } from "../state/store.js";
import { useStore, useUiState } from "../state/useStore.js";
import { STATUS_COLORS, STATUS_LABELS } from "../scene/theme.js";
import {
  formatArea,
  formatForce,
  formatMass,
  formatRatio,
  formatStress,
  formatVec3,
} from "./format.js";

/**
 * The inspector.
 *
 * Everything shown here is read straight out of the simulation snapshot. The only things
 * the interface can change are authoring inputs — material, contents, anchoring — and
 * each of those goes back to the world as a command. No number on this panel is computed
 * in React.
 */
export function Inspector() {
  const store = useStore();
  const ui = useUiState();
  const selected = ui.components.find((component) => component.id === ui.selectedId);

  return (
    <section className="panel panel--right">
      <h2 className="panel__title">Assembly</h2>
      <dl className="readout">
        <Row label="Total mass" value={formatMass(ui.assembly.totalMassKg)} />
        <Row label="Components" value={String(ui.assembly.componentCount)} />
        <Row label="Centre of mass" value={formatVec3(ui.assembly.centerOfMassM)} />
        <Row
          label="Peak utilization"
          value={formatRatio(ui.maxUtilization)}
          color={STATUS_COLORS[bandOf(ui.maxUtilization)]}
        />
      </dl>

      <h2 className="panel__title">Selected component</h2>
      {selected === undefined ? (
        <p className="panel__hint">Click a component in the workspace to inspect it.</p>
      ) : (
        <>
          <dl className="readout">
            <Row label="Id" value={selected.id} />
            <Row label="Type" value={selected.type} />
            <Row label="Position" value={formatVec3(selected.state.physical.positionM)} />
            <Row label="Support" value={selected.state.support.mode} />
          </dl>

          <label className="field">
            <span className="field__label">Material</span>
            <select
              className="select"
              value={selected.materialId}
              onChange={(event) => store.setMaterial(selected.id, event.target.value)}
            >
              {MATERIAL_OPTIONS.map((id) => {
                const material = getMaterial(id);
                return (
                  <option key={id} value={id}>
                    {material.name} — {material.grade}
                  </option>
                );
              })}
            </select>
          </label>
          <p className="panel__note">
            {getMaterial(selected.materialId).densityKgM3} kg/m³ ·{" "}
            {formatStress(getMaterial(selected.materialId).yieldStrengthPa)} yield
          </p>

          <dl className="readout">
            <Row
              label="Structure mass"
              value={formatMass(selected.massKg - selected.additionalMassKg)}
            />
            <Row label="Volume" value={`${geometryVolumeM3(selected.geometry).toFixed(4)} m³`} />
            <Row label="Total mass" value={formatMass(selected.massKg)} strong />
          </dl>

          <label className="field">
            <span className="field__label">Contents (kg)</span>
            <input
              className="input"
              type="number"
              min={0}
              step={100}
              value={selected.additionalMassKg}
              onChange={(event) => store.setAdditionalMass(selected.id, Number(event.target.value))}
            />
          </label>
          <p className="panel__note">
            Mass the geometry does not describe: inventory, internals, ballast. Raise it to load the
            structure deliberately.
          </p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={selected.anchored}
              onChange={(event) => store.setAnchored(selected.id, event.target.checked)}
            />
            <span>Anchored (pinned, absorbs unlimited load)</span>
          </label>

          <h3 className="panel__subtitle">Structural</h3>
          <dl className="readout">
            <Row label="Own weight" value={formatForce(selected.state.support.ownWeightN)} />
            <Row label="Carried load" value={formatForce(selected.state.support.carriedLoadN)} />
            <Row
              label="Total through section"
              value={formatForce(selected.state.support.totalLoadN)}
            />
            <Row
              label="Load-bearing area"
              value={formatArea(selected.state.structural.loadBearingAreaM2)}
            />
            <Row
              label="Applied stress"
              value={formatStress(selected.state.structural.appliedStressPa)}
            />
            <Row
              label="Allowable stress"
              value={formatStress(selected.state.structural.allowableStressPa)}
            />
            <Row
              label="Utilization"
              value={`${formatRatio(selected.state.structural.utilization)} · ${
                STATUS_LABELS[selected.state.structural.status]
              }`}
              color={STATUS_COLORS[selected.state.structural.status]}
              strong
            />
          </dl>

          <UtilizationBar utilization={selected.state.structural.utilization} />

          {selected.state.support.reactions.length > 0 && (
            <>
              <h3 className="panel__subtitle">Reactions into supports</h3>
              <dl className="readout">
                {selected.state.support.reactions.map((reaction) => (
                  <Row
                    key={reaction.connectionId}
                    label={`→ ${reaction.otherComponentId}`}
                    value={
                      reaction.capacityN === undefined
                        ? formatForce(reaction.loadN)
                        : `${formatForce(reaction.loadN)} of ${formatForce(reaction.capacityN)}`
                    }
                    color={
                      reaction.capacityN !== undefined && reaction.loadN > reaction.capacityN
                        ? STATUS_COLORS.failed
                        : undefined
                    }
                  />
                ))}
              </dl>
            </>
          )}
        </>
      )}
    </section>
  );
}

function UtilizationBar({ utilization }: { readonly utilization: number }) {
  const clamped = Math.min(utilization, 1.5);
  return (
    <div className="bar" title="0.70 stressed · 1.00 failed">
      <div
        className="bar__fill"
        style={{
          width: `${(clamped / 1.5) * 100}%`,
          background: STATUS_COLORS[bandOf(utilization)],
        }}
      />
      <div className="bar__tick" style={{ left: `${(0.7 / 1.5) * 100}%` }} />
      <div className="bar__tick bar__tick--limit" style={{ left: `${(1 / 1.5) * 100}%` }} />
    </div>
  );
}

function bandOf(utilization: number): "normal" | "stressed" | "failed" {
  if (utilization > 1) return "failed";
  if (utilization >= 0.7) return "stressed";
  return "normal";
}

function Row({
  label,
  value,
  color,
  strong,
}: {
  readonly label: string;
  readonly value: string;
  readonly color?: string | undefined;
  readonly strong?: boolean;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd
        style={{
          ...(color === undefined ? {} : { color }),
          ...(strong === true ? { fontWeight: 600 } : {}),
        }}
      >
        {value}
      </dd>
    </>
  );
}
