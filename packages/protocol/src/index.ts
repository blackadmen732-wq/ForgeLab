/**
 * `@forgelab/protocol` — the vocabulary shared by ForgeLab's collaboration layers.
 *
 * No dependencies and no runtime environment assumptions beyond WebCrypto, so the same
 * definitions are used by the browser, the server endpoints and the tests. It knows
 * nothing about the simulation, voice transport or database clients.
 */
export * from "./roles.js";
export * from "./limits.js";
export * from "./ids.js";
export * from "./presence.js";
export * from "./events.js";
export * from "./messages.js";
export * from "./signing.js";
