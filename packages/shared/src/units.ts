/**
 * ForgeLab SI unit policy.
 *
 * Every quantity stored, computed or serialized anywhere in ForgeLab is expressed in
 * base SI units. There is no "display unit" layer inside the simulation: conversion to
 * anything else happens at the very edge of the UI and never flows back in.
 *
 * Enforcement in Milestone 0 is threefold:
 *
 *  1. **Naming.** Every field that carries a physical quantity ends in its unit suffix
 *     (`massKg`, `positionM`, `appliedStressPa`, `timestampSec`). A field without a unit
 *     suffix is not a physical quantity. This is the primary, always-on defence and it is
 *     checked by `unit-naming.test.ts` in `@forgelab/sim-core`.
 *  2. **Types.** The aliases below document intent at every API boundary. They are plain
 *     `number` aliases so that ordinary physics expressions (`F = m * g`) stay readable.
 *     `Branded<>` exists for the day we want nominal enforcement on a specific quantity.
 *  3. **Conversions.** The helpers at the bottom of this file are the only sanctioned way
 *     to cross a unit boundary. Inline magic factors (`x * 1000`) are a bug.
 */

/** Length. SI base unit: metre. */
export type Meters = number;
/** Mass. SI base unit: kilogram. */
export type Kilograms = number;
/** Time. SI base unit: second. */
export type Seconds = number;
/** Force. Derived SI unit: newton (kg·m·s⁻²). */
export type Newtons = number;
/** Energy. Derived SI unit: joule (N·m). */
export type Joules = number;
/** Power. Derived SI unit: watt (J·s⁻¹). */
export type Watts = number;
/** Pressure and stress. Derived SI unit: pascal (N·m⁻²). */
export type Pascals = number;
/** Thermodynamic temperature. SI base unit: kelvin. */
export type Kelvin = number;
/** Area. Derived SI unit: square metre. */
export type SquareMeters = number;
/** Volume. Derived SI unit: cubic metre. */
export type CubicMeters = number;
/** Density. Derived SI unit: kilogram per cubic metre. */
export type KgPerCubicMeter = number;
/** Linear velocity. Derived SI unit: metre per second. */
export type MetersPerSecond = number;
/** Linear acceleration. Derived SI unit: metre per second squared. */
export type MetersPerSecondSquared = number;
/** Angular velocity. Derived SI unit: radian per second. */
export type RadiansPerSecond = number;
/** Plane angle. SI unit: radian. */
export type Radians = number;
/** Thermal conductivity. Derived SI unit: watt per metre kelvin. */
export type WattsPerMeterKelvin = number;
/** Electrical resistivity. Derived SI unit: ohm metre. */
export type OhmMeters = number;
/** Specific heat capacity. Derived SI unit: joule per kilogram kelvin. */
export type JoulesPerKilogramKelvin = number;
/** Specific energy (latent heat, heat of combustion). Derived SI unit: joule per kilogram. */
export type JoulesPerKilogram = number;
/** Heat flux. Derived SI unit: watt per square metre. */
export type WattsPerSquareMeter = number;
/** Dimensionless ratio (utilization, efficiency, safety factor). */
export type Ratio = number;

declare const brandTag: unique symbol;

/**
 * Nominal wrapper for a quantity that must never be confused with another.
 *
 * Unused by Milestone 0 physics on purpose — hard brands make `m * g` a type error and
 * every formula a cast. It is exported so that a future subsystem (fuel accounting,
 * currency, tick indices) can opt into nominal typing without redesigning this module.
 */
export type Branded<TBase, TTag extends string> = TBase & { readonly [brandTag]: TTag };

/** Standard acceleration of gravity, CGPM (1901) defined exact value. m·s⁻². */
export const STANDARD_GRAVITY_MPS2: MetersPerSecondSquared = 9.80665;

/** 0 °C expressed in kelvin (exact by definition of the Celsius scale). */
export const ZERO_CELSIUS_IN_KELVIN: Kelvin = 273.15;

/* ------------------------------------------------------------------------------------ *
 * Sanctioned conversions. Nothing else may convert units.
 * ------------------------------------------------------------------------------------ */

export const millimetersToMeters = (mm: number): Meters => mm * 1e-3;
export const metersToMillimeters = (m: Meters): number => m * 1e3;
export const gramsToKilograms = (g: number): Kilograms => g * 1e-3;
export const kilogramsToGrams = (kg: Kilograms): number => kg * 1e3;
export const megapascalsToPascals = (mpa: number): Pascals => mpa * 1e6;
export const pascalsToMegapascals = (pa: Pascals): number => pa * 1e-6;
export const gigapascalsToPascals = (gpa: number): Pascals => gpa * 1e9;
export const barToPascals = (bar: number): Pascals => bar * 1e5;
export const kilowattsToWatts = (kw: number): Watts => kw * 1e3;
export const megawattsToWatts = (mw: number): Watts => mw * 1e6;
export const kilojoulesToJoules = (kj: number): Joules => kj * 1e3;
export const megajoulesToJoules = (mj: number): Joules => mj * 1e6;
export const kilowattHoursToJoules = (kwh: number): Joules => kwh * 3.6e6;
export const kilowattsPerM2ToWattsPerM2 = (kw: number): WattsPerSquareMeter => kw * 1e3;
export const hoursToSeconds = (h: number): Seconds => h * 3600;
export const litersToCubicMeters = (l: number): CubicMeters => l * 1e-3;
export const celsiusToKelvin = (c: number): Kelvin => c + ZERO_CELSIUS_IN_KELVIN;
export const kelvinToCelsius = (k: Kelvin): number => k - ZERO_CELSIUS_IN_KELVIN;
export const degreesToRadians = (deg: number): Radians => (deg * Math.PI) / 180;
export const radiansToDegrees = (rad: Radians): number => (rad * 180) / Math.PI;

/**
 * Grams per cubic centimetre — the unit most material datasheets publish density in —
 * converted to the SI kg·m⁻³ that ForgeLab stores.
 */
export const gramsPerCm3ToKgPerM3 = (gcm3: number): KgPerCubicMeter => gcm3 * 1000;

/**
 * Microhm-centimetres — the unit most resistivity tables publish — converted to Ω·m.
 * 1 µΩ·cm = 1e-8 Ω·m.
 */
export const microOhmCmToOhmMeters = (uohmcm: number): OhmMeters => uohmcm * 1e-8;
