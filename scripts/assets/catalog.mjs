/**
 * The 3D assets ForgeLab can load from its asset bucket (Cloudflare R2). Every entry is
 * CC0 from Poly Haven: no attribution is legally required, but the manifest records the
 * authors and source anyway (see docs/ASSETS.md for the credits list).
 *
 * `slot` is what the app asks for; swap an asset by changing the Poly Haven id here and
 * re-running fetch + upload. Presentation only: nothing here reaches the simulation.
 */
export const CATALOG = [
  {
    slot: "hall-hdri",
    kind: "hdri",
    polyhaven: "peppermint_powerplant",
    resolution: "2k",
    purpose: "Reflections in metal: a real power-plant interior instead of the procedural room.",
  },
  {
    slot: "floor",
    kind: "texture",
    polyhaven: "metal_plate_02",
    resolution: "2k",
    // Poly Haven map name → three.js material slot.
    maps: { Diffuse: "map", nor_gl: "normalMap", Rough: "roughnessMap" },
    purpose: "Welded steel deck plate for the hall floor.",
  },
];
