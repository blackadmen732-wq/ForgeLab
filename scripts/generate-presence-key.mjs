#!/usr/bin/env node
/**
 * Prints a new ECDSA P-256 private key (PKCS#8 PEM) for FORGELAB_PRESENCE_KEY.
 * The server signs presence tickets with it; clients only ever see the public half.
 *
 *   node scripts/generate-presence-key.mjs
 */
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
process.stdout.write(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
