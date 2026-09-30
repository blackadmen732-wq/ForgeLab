/**
 * Named camera positions in the Main Reactor Hall. Presentation only — per viewer, never
 * saved with a design. The default sits 12 m up in a three-quarter view, so the hall's
 * scale reads and a placed machine looks grounded.
 */
export type HallCamera = "overview" | "floor" | "front" | "side" | "top" | "build-center";

export interface CameraPose {
  readonly label: string;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export const HALL_CAMERAS: Readonly<Record<HallCamera, CameraPose>> = Object.freeze({
  overview: { label: "Overview", position: [58, 30, 60], target: [-4, 4, -8] },
  floor: { label: "Floor level", position: [16, 1.7, 30], target: [0, 4, 0] },
  front: { label: "Front", position: [0, 12, 60], target: [0, 5, 0] },
  side: { label: "Side", position: [64, 12, 4], target: [0, 5, 0] },
  top: { label: "Top", position: [0, 130, 0.01], target: [0, 0, 0] },
  "build-center": { label: "Build center", position: [22, 10, 26], target: [0, 3, 0] },
});

export const HALL_CAMERA_ORDER: readonly HallCamera[] = [
  "overview",
  "floor",
  "front",
  "side",
  "top",
  "build-center",
];

/** Where the camera starts in a fresh session. */
export const DEFAULT_CAMERA: CameraPose = {
  label: "Default",
  position: [40, 12, 44],
  target: [0, 4, -2],
};
