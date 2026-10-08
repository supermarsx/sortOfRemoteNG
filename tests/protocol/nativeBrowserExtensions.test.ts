import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  changeNativeBrowserExtension,
  nativeBrowserExtensionSettings,
  persistNativeBrowserExtension,
} from "../../src/utils/connection/nativeBrowserExtensions";
import { normalizeHttpAutomation } from "../../src/utils/connection/sessionQuickActions";

const fixture = (): Connection => ({
  id: "website",
  name: "Website",
  protocol: "https",
  hostname: "site.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-10-08",
  updatedAt: "2026-10-08",
  httpAutoLogin: true,
  browserSession: { version: 1, cookiesEnabled: false },
  httpAutomation: {
    ...normalizeHttpAutomation(undefined),
    forceDark: true,
    items: [
      {
        kind: "script",
        id: "saved-script",
        scope: { kind: "database", databaseId: "a" },
      },
    ],
  },
});

describe("native extension saved settings", () => {
  it("persists off without changing consent, dark mode, favorites or other preferences", () => {
    const original = fixture();
    const changed = changeNativeBrowserExtension(original, {
      kind: "app",
      enabled: false,
    });
    const restored = JSON.parse(JSON.stringify(changed));
    expect(nativeBrowserExtensionSettings(restored)).toEqual({
      app: false,
      scripts: false,
      macros: false,
      login: true,
    });
    expect(changed.httpAutomation).toEqual(original.httpAutomation);
    expect(changed.httpAutoLogin).toBe(true);
    expect(changed.browserSession?.cookiesEnabled).toBe(false);
    expect(original.browserSession?.websiteExtensionsEnabled).toBeUndefined();
  });
  it("restores inheritance without materializing app defaults", () => {
    const changed = changeNativeBrowserExtension(
      {
        ...fixture(),
        browserSession: { version: 1, websiteExtensionsEnabled: false },
      },
      { kind: "app", enabled: undefined },
    );
    expect(changed.browserSession).toBeUndefined();
  });
  it("keeps script and macro consent separate", () => {
    const changed = changeNativeBrowserExtension(fixture(), {
      kind: "scripts",
      enabled: true,
    });
    expect(changed.httpAutomation).toMatchObject({
      scriptInjectionEnabled: true,
      interactionMacrosEnabled: false,
      forceDark: true,
    });
  });
  it("uses the authoritative application login mode and preserves credentials", () => {
    const original = {
      ...fixture(),
      password: "saved-secret",
      httpApplication: {
        version: 1 as const,
        id: "generic-form",
        loginMode: "form" as const,
      },
    };
    const off = changeNativeBrowserExtension(original, {
      kind: "login",
      enabled: false,
    });
    expect(off.httpApplication?.loginMode).toBe("manual");
    expect(off.httpAutoLogin).toBe(false);
    expect(off.password).toBe(original.password);
    expect(
      changeNativeBrowserExtension(off, { kind: "login", enabled: true })
        .httpApplication?.loginMode,
    ).toBe("form");
    expect(() =>
      changeNativeBrowserExtension(
        {
          ...original,
          httpApplication: { ...original.httpApplication, loginMode: "basic" },
        },
        { kind: "login", enabled: true },
      ),
    ).toThrow("login method");
  });
});

describe("native extension persistence", () => {
  function store() {
    let current = fixture(),
      saved = structuredClone(current),
      revoked = false;
    const port = {
      assertCurrent: () => {
        if (revoked) throw new Error("revoked");
      },
      current: () => current,
      read: vi.fn(async () => structuredClone(saved)),
      write: vi.fn(async (connection: Connection) => {
        current = connection;
        saved = structuredClone(connection);
      }),
    };
    return {
      port,
      revoke: () => {
        revoked = true;
      },
      edit: () => {
        saved.hostname = "changed.example.test";
      },
    };
  }
  it("requires durable readback and survives reload", async () => {
    const { port } = store();
    const saved = await persistNativeBrowserExtension(port, {
      kind: "scripts",
      enabled: true,
    });
    expect(port.read).toHaveBeenCalledTimes(2);
    expect(nativeBrowserExtensionSettings(saved).scripts).toBe(true);
  });
  it("does not write over an external connection edit", async () => {
    const { port, edit } = store();
    edit();
    await expect(
      persistNativeBrowserExtension(port, { kind: "app", enabled: false }),
    ).rejects.toThrow("changed");
    expect(port.write).not.toHaveBeenCalled();
  });
  it("does not write when the owner is revoked during a read", async () => {
    const { port, revoke } = store();
    port.read.mockImplementationOnce(async () => {
      revoke();
      return fixture();
    });
    await expect(
      persistNativeBrowserExtension(port, { kind: "app", enabled: false }),
    ).rejects.toThrow("revoked");
    expect(port.write).not.toHaveBeenCalled();
  });
  it("does not report optimistic UI state as persisted", async () => {
    const { port } = store();
    port.write.mockResolvedValue(undefined);
    await expect(
      persistNativeBrowserExtension(port, { kind: "app", enabled: false }),
    ).rejects.toThrow("confirmed");
  });
  it("does not report success after lock during save", async () => {
    const { port, revoke } = store();
    port.write.mockImplementationOnce(async () => revoke());
    await expect(
      persistNativeBrowserExtension(port, { kind: "app", enabled: false }),
    ).rejects.toThrow("revoked");
  });
});
