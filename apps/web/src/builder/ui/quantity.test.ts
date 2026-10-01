import { describe, expect, it } from "vitest";
import { findMaterialRecord } from "@forgelab/materials";
import { materialLab } from "./materialLab.js";
import { formatQuantity, formatRange, formatValue } from "./quantity.js";

describe("library quantities on screen", () => {
  it("keeps SI and picks a readable prefix", () => {
    expect(formatValue(250e6, "Pa")).toBe("250 MPa");
    expect(formatValue(193e9, "Pa")).toBe("193 GPa");
    expect(formatValue(673.15, "K")).toBe("400 °C (673.15 K)");
    expect(formatValue(4.222, "K")).toBe("4.222 K");
    expect(formatValue(1.678e-8, "Ω·m")).toBe("1.678 µΩ·cm");
    expect(formatValue(12e-6, "1/K")).toBe("12 × 10⁻⁶ /K");
    expect(formatValue(3.374e14, "J/kg")).toBe("3.374 × 10⁸ MJ/kg");
    expect(formatValue(Infinity, "Ω·m")).toBe("∞");
  });

  it("shows a value's spread", () => {
    const steel = findMaterialRecord("structural-steel")!;
    expect(formatQuantity(steel.density)).toBe("7850 kg/m³");
    expect(formatRange(steel.mechanical!.ultimateStrength!)).toBe("400 MPa – 550 MPa");
    expect(formatRange(steel.density)).toBeNull();
  });
});

describe("Material Lab state", () => {
  it("opens on a material, compares with another, and never compares a material with itself", () => {
    materialLab.open("copper");
    expect(materialLab.get()).toMatchObject({ open: true, materialId: "copper" });
    materialLab.compare("aluminum");
    expect(materialLab.get().compareId).toBe("aluminum");
    materialLab.select("aluminum");
    expect(materialLab.get().compareId).toBeNull();
    materialLab.compare("aluminum");
    expect(materialLab.get().compareId).toBeNull();
    materialLab.close();
    expect(materialLab.get().open).toBe(false);
  });
});
