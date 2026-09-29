import type { PlantRole } from "@forgelab/sim-core";
import {
  Activity,
  Box,
  Cable,
  CircleDot,
  Cpu,
  Droplets,
  Fan,
  Flame,
  Gauge,
  Magnet,
  Orbit,
  Power,
  ShieldHalf,
  Syringe,
  ToggleLeft,
  Waves,
  Wind,
  Zap,
} from "lucide-react";

const ICONS: Record<PlantRole, typeof Box> = {
  structure: Box,
  "vacuum-vessel": Orbit,
  "magnet-coil": Magnet,
  "fuel-injector": Syringe,
  "plasma-heater": Flame,
  "vacuum-pump": Wind,
  "power-supply": Power,
  conductor: Cable,
  switch: ToggleLeft,
  "coolant-pipe": Waves,
  "coolant-pump": Droplets,
  "heat-exchanger": Activity,
  blanket: ShieldHalf,
  turbine: Fan,
  generator: Zap,
  sensor: Gauge,
  controller: Cpu,
};

export function PartIcon({ role }: { role: PlantRole }) {
  const Icon = ICONS[role] ?? CircleDot;
  return (
    <span className="part__icon" aria-hidden="true">
      <Icon />
    </span>
  );
}
