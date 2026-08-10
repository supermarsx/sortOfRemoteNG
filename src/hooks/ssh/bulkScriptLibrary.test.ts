import { describe, expect, it } from "vitest";
import {
  DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG,
  inferBulkScriptType,
  isDestructiveBulkScript,
  sanitizeBulkScriptLibrary,
  shouldConfirmBulkScriptDelete,
  shouldConfirmBulkScriptRun,
} from "./bulkScriptLibrary";

const legacyScript = {
  id: "custom-1",
  name: "Restart web service",
  description: "Restart nginx",
  script: "systemctl restart nginx",
  category: "Services",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("Bulk SSH script library persistence", () => {
  it("migrates legacy arrays into active/trash/config state", () => {
    const result = sanitizeBulkScriptLibrary([legacyScript]);

    expect(result.changed).toBe(true);
    expect(result.value).toMatchObject({
      version: 2,
      trash: [],
      config: DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG,
    });
    expect(result.value.active).toEqual([
      expect.objectContaining({
        id: "custom-1",
        type: "service",
        risk: "destructive",
      }),
    ]);
  });

  it("drops malformed and credential-bearing entries and strips unknown fields", () => {
    const result = sanitizeBulkScriptLibrary({
      version: 2,
      active: [
        null,
        { ...legacyScript, id: "secret", script: "curl --token=literal-token" },
        { ...legacyScript, password: "must-not-survive" },
      ],
      trash: [{ ...legacyScript, deletedAt: "not-a-date" }],
      config: {
        runConfirmation: "invalid",
        deleteConfirmation: "invalid",
        credentialRef: "also-stripped",
      },
    });

    expect(result.changed).toBe(true);
    expect(result.value.active).toHaveLength(1);
    expect(result.value.active[0]).not.toHaveProperty("password");
    // Duplicate IDs cannot exist across active and trash generations.
    expect(result.value.trash).toEqual([]);
    expect(result.value.config).toEqual(DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG);
    expect(JSON.stringify(result.value)).not.toContain("literal-token");
    expect(JSON.stringify(result.value)).not.toContain("must-not-survive");
  });

  it("does not allow a standard label to override destructive content", () => {
    const result = sanitizeBulkScriptLibrary({
      version: 2,
      active: [{ ...legacyScript, type: "shell", risk: "standard" }],
      trash: [],
      config: DEFAULT_BULK_SCRIPT_LIBRARY_CONFIG,
    });

    expect(result.value.active[0].risk).toBe("destructive");
  });

  it("infers useful type/risk metadata and applies confirmation policies", () => {
    expect(inferBulkScriptType("Custom", "ss -tuln")).toBe("network");
    expect(inferBulkScriptType("Cisco IOS", "show version")).toBe("cisco-ios");
    expect(inferBulkScriptType("HPE Comware", "display version")).toBe("hpe");
    expect(inferBulkScriptType("Arista EOS", "show interfaces status")).toBe(
      "arista",
    );
    expect(inferBulkScriptType("Android", "adb shell getprop")).toBe("android");
    expect(isDestructiveBulkScript("rm -rf /tmp/build-output")).toBe(true);
    expect(
      isDestructiveBulkScript(
        "configure terminal\ninterface Ethernet1\nshutdown\nwrite memory",
      ),
    ).toBe(true);
    expect(
      isDestructiveBulkScript(
        "show running-config\n! CONFIRM_SAVE_REQUIRED\n! copy running-config startup-config",
      ),
    ).toBe(true);
    expect(
      isDestructiveBulkScript(
        "adb shell pm disable-user --user 0 com.vendor.bloatware",
      ),
    ).toBe(true);
    expect(isDestructiveBulkScript("pm trim-caches 1G")).toBe(true);
    for (const command of [
      "Restart-Computer -Force",
      "Restart-Service -Name sshd",
      "$adapter | Restart-NetAdapter -Confirm:$false",
      "Disable-NetAdapter -Name Ethernet -Confirm:$false",
      "$packages | Remove-AppxPackage -Confirm:$false",
      "choco upgrade all -y",
      "choco uninstall legacy-tool -y",
      "winget upgrade --all",
      "winget uninstall --id Vendor.LegacyTool",
      "brew update && brew upgrade",
    ]) {
      expect(isDestructiveBulkScript(command), command).toBe(true);
    }
    expect(isDestructiveBulkScript("uname -a")).toBe(false);

    expect(shouldConfirmBulkScriptRun("destructive-only", "standard")).toBe(
      false,
    );
    expect(shouldConfirmBulkScriptRun("destructive-only", "destructive")).toBe(
      true,
    );
    expect(shouldConfirmBulkScriptRun("always", "standard")).toBe(true);
    expect(shouldConfirmBulkScriptRun("never", "destructive")).toBe(false);

    expect(shouldConfirmBulkScriptDelete("permanent-only", false)).toBe(false);
    expect(shouldConfirmBulkScriptDelete("permanent-only", true)).toBe(true);
    expect(shouldConfirmBulkScriptDelete("always", false)).toBe(true);
    expect(shouldConfirmBulkScriptDelete("never", true)).toBe(false);
  });
});
