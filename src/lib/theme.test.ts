import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { resolveDark, THEME_BOOT_SCRIPT } from "./theme";

describe("theme", () => {
  it("resolves the choice against the system setting", () => {
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });

  it("boot script is valid JavaScript", () => {
    expect(() => new Script(THEME_BOOT_SCRIPT)).not.toThrow();
  });
});
