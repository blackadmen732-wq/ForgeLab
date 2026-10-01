import { curveValue, findMaterialRecord, getMaterial } from "@forgelab/materials";

/**
 * Material properties at temperature, where the library tabulates them.
 *
 * A material with no curve for a property keeps its room-temperature value: no curve is
 * invented. Today that means carbon steels (A36, A572) lose strength and stiffness with
 * temperature per EN 1993-1-2, and copper's resistivity follows the CRC table; every
 * other material is temperature-independent until its data is sourced.
 */
export interface ThermalDerating {
  /** Yield strength at temperature ÷ room-temperature yield strength. */
  readonly yieldFactor: number;
  /** Young's modulus at temperature ÷ room-temperature modulus. */
  readonly modulusFactor: number;
}

const NONE: ThermalDerating = Object.freeze({ yieldFactor: 1, modulusFactor: 1 });

export function thermalDerating(materialId: string, temperatureK: number): ThermalDerating {
  const mechanical = findMaterialRecord(materialId)?.mechanical;
  const ky = mechanical?.yieldReduction;
  const kE = mechanical?.modulusReduction;
  if (ky === undefined && kE === undefined) return NONE;
  return {
    yieldFactor: ky === undefined ? 1 : curveValue(ky, temperatureK),
    modulusFactor: kE === undefined ? 1 : curveValue(kE, temperatureK),
  };
}

/** Electrical resistivity at temperature, Ω·m. */
export function resistivityAt(materialId: string, temperatureK: number): number {
  const curve = findMaterialRecord(materialId)?.electrical?.resistivityCurve;
  return curve === undefined
    ? getMaterial(materialId).electricalResistivityOhmM
    : curveValue(curve, temperatureK);
}

/** The sentence a failure explanation adds when heat has weakened the material. */
export function deratingNote(
  materialName: string,
  temperatureK: number,
  derating: ThermalDerating,
): string {
  if (derating.yieldFactor >= 1 && derating.modulusFactor >= 1) return "";
  const parts: string[] = [];
  if (derating.yieldFactor < 1)
    parts.push(`its yield strength to ${(100 * derating.yieldFactor).toFixed(0)} %`);
  if (derating.modulusFactor < 1)
    parts.push(`its stiffness to ${(100 * derating.modulusFactor).toFixed(0)} %`);
  return (
    ` At ${(temperatureK - 273.15).toFixed(0)} °C, heat has reduced ${materialName}'s ` +
    `${parts.join(" and ")} of the room-temperature value (EN 1993-1-2).`
  );
}
