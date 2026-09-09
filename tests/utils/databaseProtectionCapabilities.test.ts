import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseProtection } from "../../src/utils/connection/databaseProtection";
import type { DatabaseProtectionChangeRequest } from "../../src/types/encryption/databaseProtection";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), available: true }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (bridge.available ? bridge.invoke : null),
}));
function capabilities() {
  return {
    schemaVersion: 1,
    ciphers: [
      "aes-256-gcm",
      "chacha20-poly1305",
      "twofish-256-eax",
      "serpent-256-eax",
    ].map((id) => ({ id, available: true })),
    protectors: [
      {
        id: "password",
        available: true,
        deviceBound: false,
        requiresUserPresence: false,
      },
    ],
  };
}
beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.available = true;
});
describe("native database cipher capability boundary", () => {
  it("accepts the four exact native cipher IDs and their availability", async () => {
    const response = capabilities();
    response.ciphers[3].available = false;
    bridge.invoke.mockResolvedValue(response);
    expect(await databaseProtection.capabilities()).toEqual(response);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_capabilities",
    );
  });
  it.each([
    { ...capabilities(), schemaVersion: 2 },
    { ...capabilities(), ciphers: [{ id: "twofish-gcm", available: true }] },
    { ...capabilities(), ciphers: [{ id: "aes-256-gcm", available: "true" }] },
    { ...capabilities(), ciphers: [null] },
    {
      ...capabilities(),
      ciphers: [capabilities().ciphers[0], capabilities().ciphers[0]],
    },
  ])(
    "refuses unknown, duplicated, or malformed capabilities without a fallback",
    async (response) => {
      bridge.invoke.mockResolvedValue(response);
      await expect(databaseProtection.capabilities()).rejects.toThrow(
        "Unsupported or malformed",
      );
      expect(bridge.invoke).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["twofish-256-eax", "serpent-256-eax"])(
    "preserves an existing %s container's reported cipher",
    async (dataCipher) => {
      bridge.invoke.mockResolvedValue({
        kind: "managed",
        version: 1,
        dataCipher,
        securityRevision: "rev1",
        slots: [],
        unlocked: false,
      });
      expect(await databaseProtection.status("fixture")).toMatchObject({
        dataCipher,
      });
      expect(bridge.invoke).toHaveBeenCalledWith("database_protection_status", {
        databaseId: "fixture",
      });
    },
  );
  it.each([undefined, "twofish-gcm", "unknown-cipher"])(
    "refuses unknown or missing stored cipher %s instead of displaying AES",
    async (dataCipher) => {
      bridge.invoke.mockResolvedValue({
        kind: "managed",
        dataCipher,
        securityRevision: "rev1",
        slots: [],
        unlocked: false,
      });
      await expect(databaseProtection.status("fixture")).rejects.toThrow(
        "cannot be displayed as AES or downgraded",
      );
    },
  );
  it("does not invent native support in a browser", async () => {
    bridge.available = false;
    await expect(databaseProtection.capabilities()).rejects.toThrow(
      "requires the desktop app",
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
  it.each(["twofish-256-eax", "serpent-256-eax"] as const)(
    "forwards the exact %s target without changing independent unlock slots",
    async (dataCipher) => {
      const request: DatabaseProtectionChangeRequest = {
        databaseId: "fixture",
        expectedSecurityRevision: "r1",
        expectedData: "opaque-managed-container",
        sourceSessionId: "fixture-native-handle",
        target: {
          dataCipher,
          keepSlotIds: ["password-slot", "vault-slot"],
          newSlots: [],
        },
      };
      const outcome = {
        committed: true,
        cleanupPending: true,
        warnings: ["Cleanup pending"],
        securityRevision: "r2",
      };
      bridge.invoke.mockResolvedValue(outcome);
      expect(await databaseProtection.change(request)).toEqual(outcome);
      expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith(
        "database_protection_change",
        request,
      );
    },
  );
  it("refuses an unknown mutation cipher before issuing any IPC", async () => {
    const request = {
      databaseId: "fixture",
      expectedSecurityRevision: "r1",
      expectedData: {},
      target: { dataCipher: "unknown", keepSlotIds: [], newSlots: [] },
    } as unknown as DatabaseProtectionChangeRequest;
    await expect(databaseProtection.change(request)).rejects.toThrow(
      "no protection change was submitted",
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
