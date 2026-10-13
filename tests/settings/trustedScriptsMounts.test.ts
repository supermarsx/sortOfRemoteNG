import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("trusted scripts integration", () => {
  it("mounts reconciliation once in the main app only", () => {
    expect(
      readFileSync("src/App.tsx", "utf8").match(
        /<ScriptTrustReconciler\s*\/>/g,
      ),
    ).toHaveLength(1);
    expect(
      readFileSync("app/detached/DetachedClient.tsx", "utf8"),
    ).not.toContain("ScriptTrustReconciler");
  });
  it("makes trust visible in macro settings and clears it before destructive recovery reloads", () => {
    expect(
      readFileSync(
        "src/components/SettingsDialog/sections/MacroSettings.tsx",
        "utf8",
      ),
    ).toContain("<TrustedScriptsSection />");
    const recovery = readFileSync(
      "src/hooks/settings/useRecoverySettings.ts",
      "utf8",
    );
    expect(recovery.match(/await revokeAllScriptTrust\(\);/g)).toHaveLength(2);
  });
});
