import { HAZARD_SCALE } from "../scene/theme.js";
import { useUiState } from "../state/useStore.js";

/** What the hazard view's colour scale means, channel by channel. Display only. */
const LEGEND: Record<string, { title: string; top: string; note: string }> = {
  radiant: {
    title: "Radiant heat",
    top: "50 kW/m²",
    note: "Contours: 12.5 kW/m² (bold) and 4 kW/m² reference levels.",
  },
  "hot-gas": {
    title: "Hot gas",
    top: "+800 K above ambient",
    note: "Gas temperature reaching each part from plumes and jets.",
  },
  fire: { title: "Fire area", top: "burning", note: "Burning, in flame contact, or decomposing." },
  "gas-cloud": {
    title: "Gas cloud",
    top: "lower flammability limit",
    note: "Flammable gas in the enclosure, as a fraction of its LFL.",
  },
  pressure: {
    title: "Pressure release",
    top: "20 kPa / 5 kN jet",
    note: "Overpressure from deflagrations and jet loads from breaches.",
  },
  debris: {
    title: "Hot debris",
    top: "5 kJ of impacts",
    note: "Accumulated impact energy from fragments and molten metal.",
  },
  electrical: {
    title: "Electrical faults",
    top: "arcing",
    note: "Arcing, receiving arc energy, or open-circuited.",
  },
};

export function HazardLegend() {
  const ui = useUiState();
  const entry = LEGEND[ui.hazardView];
  if (ui.hazardView === "off" || entry === undefined) return null;
  return (
    <div className="legend">
      <div className="legend__title">Hazard view · {entry.title}</div>
      <div className="legend__scale">
        {HAZARD_SCALE.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="legend__ends">
        <span>none</span>
        <span>{entry.top}</span>
      </div>
      <p className="legend__note">{entry.note} Engineering visualization of solver output.</p>
    </div>
  );
}
