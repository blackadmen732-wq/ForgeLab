import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.js";

describe("command shortcuts", () => {
  it("never bind one keystroke to two commands", () => {
    const keys = [
      ..."abcdefghijklmnopqrstuvwxyz0123456789?/[].,",
      "Escape",
      "Delete",
      "Backspace",
      "F2",
      " ",
    ];
    const clashes: string[] = [];
    for (const k of keys) {
      for (const shiftKey of [false, true]) {
        for (const mod of [false, true]) {
          const event = {
            key: shiftKey && k.length === 1 ? k.toUpperCase() : k,
            code: "",
            shiftKey,
            ctrlKey: mod,
            metaKey: false,
            altKey: false,
          } as unknown as KeyboardEvent;
          const hits = COMMANDS.filter((c) => c.match?.(event)).map((c) => c.id);
          if (hits.length > 1)
            clashes.push(
              `${mod ? "Ctrl " : ""}${shiftKey ? "Shift " : ""}${k}: ${hits.join(", ")}`,
            );
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});
