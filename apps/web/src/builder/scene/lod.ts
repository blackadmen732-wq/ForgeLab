/**
 * Level of detail for machine fittings. A part's fittings and fine trim (nozzles, flanges,
 * terminal boxes, glands, ribs) are drawn only within a distance that grows with the
 * part's size: a pump's flange bolts vanish past about 60 m, a cryostat's ribs never do
 * inside the hall. Silhouettes, bodies and service runs are always drawn.
 */
export const LOD_BASE_M = 45;
export const LOD_PER_SIZE = 14;

export function trimVisibleAt(distanceM: number, sizeRadiusM: number): boolean {
  return distanceM < LOD_BASE_M + LOD_PER_SIZE * sizeRadiusM;
}
