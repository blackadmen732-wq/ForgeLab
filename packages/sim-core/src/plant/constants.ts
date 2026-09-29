/**
 * Documented constants and operating assumptions of the V0.1 plant model.
 *
 * Nothing here is tuned to make a design succeed or fail. Where a value is a physical
 * constant or a published figure the source is given; where it is a modelling choice it
 * is labelled as one, and docs/ARCHITECTURE.md §12 repeats it.
 */

/** Natural-convection coefficient to still air, W/(m²·K). Typical range 2–25 (Incropera). */
export const AMBIENT_CONVECTION_W_M2K = 10;

/** Surface emissivity for radiative loss. Oxidised steel ~0.8, polished ~0.1; 0.3 between. */
export const SURFACE_EMISSIVITY = 0.3;

/**
 * e-folding length for fast-neutron energy deposition in steel/water blanket and shield
 * material, m. MODELLING CHOICE: an order-of-magnitude figure (~10–15 cm) used for simple
 * exponential attenuation. Real neutronics needs Monte Carlo transport, which ForgeLab
 * does not do; results that depend on it are labelled "approximate".
 */
export const NEUTRON_ATTENUATION_LENGTH_M = 0.12;

/** Average D–T ion mass for the confinement scaling, amu. */
export const DT_ION_MASS_AMU = 2.5;

/**
 * Particle confinement relative to energy confinement, τ_p = 5 τ_E. MODELLING CHOICE
 * following the ratio commonly assumed in ITER physics studies (ITER Physics Basis,
 * Nucl. Fusion 39 (1999) Chapter 1).
 */
export const PARTICLE_TO_ENERGY_CONFINEMENT_RATIO = 5;

/**
 * Discharge start conditions. OPERATIONAL ASSUMPTIONS representative of tokamak practice
 * (prefill 1e-3–1e-2 Pa into a field of order a tesla), not a breakdown calculation.
 */
export const BREAKDOWN_MAX_PRESSURE_PA = 1e-2;
export const BREAKDOWN_MIN_FIELD_TOKAMAK_T = 0.5;
export const BREAKDOWN_MIN_FIELD_LINEAR_T = 0.1;
/** Density and temperature at the end of breakdown, when the 0D model takes over. */
export const BREAKDOWN_DENSITY_M3 = 1e18;
export const BREAKDOWN_TEMPERATURE_KEV = 0.01;
/** Current at the end of breakdown, as a fraction of target. Limits apply from here on. */
export const BREAKDOWN_CURRENT_FRACTION = 0.1;

/** Neutral pressure above which a burning plasma is lost (MODELLING CHOICE). */
export const DISRUPTION_PRESSURE_PA = 1;

/**
 * During a controlled shutdown the plasma current is ramped down no faster than keeps
 * n ≤ 0.9 n_G, as plasma control systems do; falling current lowers the Greenwald limit,
 * so an unconstrained ramp-down would drive the plasma into its density limit.
 * (MODELLING CHOICE representing a density-aware ramp-down controller.)
 */
export const SHUTDOWN_GREENWALD_FRACTION = 0.9;

/** Feedback gain of the injector's density controller (MODELLING CHOICE). */
export const FUELING_FEEDBACK_GAIN = 2;

/**
 * Plasma substeps per fixed step (1/60 s → 1/600 s). Numerical, not physical: with the
 * shortest energy confinement times in the model (~50 ms at start-up) this keeps each
 * explicit substep below 4 % of τ_E.
 */
export const PLASMA_SUBSTEPS = 10;
/**
 * Thermal substeps per fixed step. Numerical, not physical: every pairwise heat flow is
 * limited so it cannot overshoot the two bodies' equilibrium within a substep, which keeps
 * the explicit update stable at the fixed step.
 */
export const THERMAL_SUBSTEPS = 1;

/**
 * An electrical or coolant link longer than the snapping tolerance is treated as a run of
 * flexible cable or hose with these properties (MODELLING CHOICE, stated in the inspector).
 */
export const IMPLICIT_CABLE_AREA_M2 = 500e-6;
export const COPPER_RESISTIVITY_OHM_M = 1.678e-8;
/** Bore of an implicit coolant run, sized like PWR main coolant piping (~0.7 m). */
export const IMPLICIT_HOSE_DIAMETER_M = 0.7;

/** Internal resistance of non-conductor electrical nodes, Ω. Numerical placeholder. */
export const NODE_RESISTANCE_OHM = 1e-5;

/** A loop below this fraction of its pumps' rated flow raises loss-of-flow. */
export const LOSS_OF_FLOW_FRACTION = 0.2;
/** An island supplying less than this fraction of demand raises a shortfall. */
export const SUPPLY_SHORTFALL_FRACTION = 0.98;
/** An island whose loads sit below this fraction of nominal voltage is flagged. */
export const UNDERVOLTAGE_FRACTION = 0.9;
