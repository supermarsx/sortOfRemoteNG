import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";
import { _resetInvokeCache } from "../../src/utils/tauri/invoke";

const root = process.cwd();

function sourceFile(relativePath: string): ts.SourceFile {
  const filename = path.join(root, relativePath);
  return ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function globalSettingsKeys(): string[] {
  const keys: string[] = [];
  const sf = sourceFile("src/types/settings/settings.ts");

  const visit = (node: ts.Node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text === "GlobalSettings"
    ) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
          keys.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return keys;
}

function objectLiteralKeys(
  relativePath: string,
  variableName: string,
): string[] {
  const keys: string[] = [];
  const sf = sourceFile(relativePath);

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
          keys.push(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return keys;
}

let fakeStoredSettings: Record<string, unknown> | null = null;

function installFakeTauri(): void {
  const invoke = async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_app_settings") return fakeStoredSettings;
    if (cmd === "write_app_settings") {
      fakeStoredSettings = {
        ...(fakeStoredSettings ?? {}),
        ...((args?.patch ?? {}) as Record<string, unknown>),
      };
      return null;
    }
    return null;
  };
  (globalThis as any).__TAURI__ = { core: { invoke } };
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function sampleValueFor(
  key: keyof GlobalSettings,
  current: unknown,
  defaults: GlobalSettings,
): unknown {
  const special: Partial<Record<keyof GlobalSettings, unknown>> = {
    language: "pt-PT",
    region: "GB",
    timeFormat: "24h",
    dateFormat: "long",
    timeZone: "UTC",
    calendarSystem: "islamic",
    numberingSystem: "arab",
    theme: "light",
    colorScheme: "green",
    primaryAccentColor: "#22c55e",
    customCss: "body { outline-color: rgb(34 197 94); }",
    welcomeScreenTitle: "Coverage welcome",
    welcomeScreenMessage: "Coverage message",
    quickConnectHistory: ["ssh://coverage.example"],
    treeRightClickAction: "quickConnect",
    mouseBackAction: "disconnect",
    mouseForwardAction: "reconnect",
    encryptionAlgorithm: "ChaCha20-Poly1305",
    blockCipherMode: "CBC",
    totpAlgorithm: "sha256",
    globalProxy: {
      enabled: true,
      type: "http",
      host: "proxy.coverage.test",
      port: 3128,
      username: "coverage",
      password: "secret",
    },
    globalProxyPresets: [
      {
        id: "preset-coverage",
        name: "Coverage proxy",
        config: {
          type: "http",
          host: "proxy.coverage.test",
          port: 3128,
        },
      },
    ],
    openvpn: {
      enabled: true,
      remoteHost: "vpn.coverage.test",
      remotePort: 1194,
      protocol: "udp",
    },
    vpnSettings: {
      openvpnBinaryPath: "C:\\Tools\\openvpn.exe",
      wireguardBinaryPath: "C:\\Tools\\wg.exe",
      autoConnectOnStartup: ["vpn-coverage"],
      statusPollingIntervalMs: 7000,
      defaultVpnType: "wireguard",
      dnsHandling: "both",
    },
    tabGrouping: "protocol",
    defaultTabLayout: "grid2",
    tabLayoutState: { mode: "customGrid", customCols: 3, customRows: 2 },
    defaultTabColor: "#123456",
    tabColorPresets: ["#123456", "#abcdef"],
    sidebarPosition: "right",
    statusCheckMethod: "http",
    logLevel: "debug",
    exportPassword: "coverage-export-password",
    trustPolicy: "strict",
    httpsTrustPolicy: "always-trust",
    certificateTrustPolicy: "strict",
    tlsTrustPolicy: "strict",
    sshTrustPolicy: "strict",
    rdpTrustPolicy: "strict",
    rdpSessionDisplayMode: "panel",
    rdpSessionThumbnailPolicy: "manual",
    rdpSessionClosePolicy: "disconnect",
    toolDisplayModes: { ...defaults.toolDisplayModes },
  };

  if (key in special) return clone(special[key]);
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1;
  if (typeof current === "string")
    return current ? `${current}-coverage` : `${String(key)}-coverage`;
  if (Array.isArray(current))
    return [...clone(current), `${String(key)}-coverage`];
  if (current && typeof current === "object") {
    return {
      ...(clone(current) as Record<string, unknown>),
      __settingsCoverageMarker: String(key),
    };
  }
  return `${String(key)}-coverage`;
}

function assertRoundTripped(
  key: keyof GlobalSettings,
  expected: unknown,
  actual: unknown,
): void {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    expect(actual, String(key)).toMatchObject(
      expected as Record<string, unknown>,
    );
    return;
  }
  expect(actual, String(key)).toEqual(expected);
}

describe("settings coverage matrix", () => {
  beforeEach(() => {
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
    _resetInvokeCache();
    fakeStoredSettings = null;
    installFakeTauri();
  });

  it("keeps SettingsManager defaults aligned with the GlobalSettings type surface", () => {
    const typeKeys = globalSettingsKeys();
    const managerDefaultKeys = objectLiteralKeys(
      "src/utils/settings/settingsManager.ts",
      "DEFAULT_SETTINGS",
    );

    expect(managerDefaultKeys).toHaveLength(typeKeys.length);
    expect(typeKeys.filter((key) => !managerDefaultKeys.includes(key))).toEqual(
      [],
    );
    expect(managerDefaultKeys.filter((key) => !typeKeys.includes(key))).toEqual(
      [],
    );
  });

  it("keeps SettingsContext defaults aligned with SettingsManager defaults", () => {
    const managerDefaultKeys = objectLiteralKeys(
      "src/utils/settings/settingsManager.ts",
      "DEFAULT_SETTINGS",
    );
    const contextDefaultKeys = objectLiteralKeys(
      "src/contexts/SettingsContext.tsx",
      "defaultSettings",
    );

    expect(contextDefaultKeys).toHaveLength(managerDefaultKeys.length);
    expect(
      managerDefaultKeys.filter((key) => !contextDefaultKeys.includes(key)),
    ).toEqual([]);
    expect(
      contextDefaultKeys.filter((key) => !managerDefaultKeys.includes(key)),
    ).toEqual([]);
  });

  it("round-trips every top-level setting through the desktop settings store", async () => {
    const manager = SettingsManager.getInstance();
    const defaults = await manager.loadSettings();
    const patch: Partial<Record<keyof GlobalSettings, unknown>> = {};

    for (const key of globalSettingsKeys() as Array<keyof GlobalSettings>) {
      patch[key] = sampleValueFor(key, defaults[key], defaults);
    }

    await manager.saveSettings(patch as Partial<GlobalSettings>);
    SettingsManager.resetInstance();

    const reloaded = await SettingsManager.getInstance().loadSettings();
    for (const key of globalSettingsKeys() as Array<keyof GlobalSettings>) {
      expect(Object.prototype.hasOwnProperty.call(reloaded, key), key).toBe(
        true,
      );
      assertRoundTripped(key, patch[key], reloaded[key]);
    }
  });

  it("merges partial tool display modes without accepting unknown display modes", async () => {
    fakeStoredSettings = {
      toolDisplayModes: {
        actionLog: "tab",
        settings: "floating",
        madeUpTool: "tab",
      },
    };

    const settings = await SettingsManager.getInstance().loadSettings();

    expect(settings.toolDisplayModes.actionLog).toBe("tab");
    expect(settings.toolDisplayModes.settings).toBe("tab");
    expect(settings.toolDisplayModes).not.toHaveProperty("madeUpTool");
    expect(Object.values(settings.toolDisplayModes)).toEqual(
      expect.arrayContaining(["tab"]),
    );
  });
});
