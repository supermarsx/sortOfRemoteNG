import { describe, expect, it } from "vitest";
import {
  Cloud,
  Database,
  Folder,
  Globe,
  HardDrive,
  Monitor,
  Server,
  Shield,
  Star,
  Terminal,
} from "lucide-react";
import type { Connection } from "../../src/types/connection/connection";
import { integrationRegistry } from "../../src/types/integrations/registry";
import {
  CONNECTION_ICON_CATALOG,
  CONNECTION_ICON_CATEGORIES,
  CONNECTION_ICON_REGISTRY,
  getConnectionIconDefinition,
  getConnectionIconsByCategory,
  isConnectionIconKey,
  normalizeConnectionIconKey,
  type ConnectionIconKey,
} from "../../src/utils/icons/connectionIconCatalog";
import {
  GENERIC_CONNECTION_ICON_KEY,
  PROTOCOL_ICON_DEFAULTS,
  getConnectionIntegrationKey,
  getProtocolDefaultIconKey,
  resolveEffectiveConnectionIcon,
} from "../../src/utils/icons/resolveConnectionIcon";
import {
  getConnectionIcon,
  getConnectionIconResolution,
  getProtocolIcon,
  iconRegistry,
} from "../../src/components/connection/connectionTree/helpers";

function makeConnection(
  protocol: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id: `connection-${protocol}`,
    name: protocol,
    protocol,
    hostname: "host.example.test",
    port: 22,
    isGroup: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  } as Connection;
}

const LEGACY_ICON_COMPONENTS = {
  monitor: Monitor,
  terminal: Terminal,
  globe: Globe,
  database: Database,
  server: Server,
  shield: Shield,
  cloud: Cloud,
  folder: Folder,
  star: Star,
  drive: HardDrive,
} as const;

describe("connection icon catalog", () => {
  it("preserves every legacy persisted key and component pairing", () => {
    Object.entries(LEGACY_ICON_COMPONENTS).forEach(([key, icon]) => {
      expect(isConnectionIconKey(key)).toBe(true);
      expect(getConnectionIconDefinition(key)?.icon).toBe(icon);
      expect(CONNECTION_ICON_REGISTRY[key as ConnectionIconKey]).toBe(icon);
      expect(iconRegistry[key as ConnectionIconKey]).toBe(icon);
    });
  });

  it("normalizes legacy casing and whitespace without changing stable keys", () => {
    expect(normalizeConnectionIconKey("  TeRmInAl ")).toBe("terminal");
    expect(isConnectionIconKey("  TeRmInAl ")).toBe(true);
    expect(getConnectionIconDefinition(" DRIVE ")?.key).toBe("drive");
  });

  it("has unique stable keys and useful entries in every requested category", () => {
    const keys = CONNECTION_ICON_CATALOG.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(80);

    CONNECTION_ICON_CATEGORIES.forEach((category) => {
      const entries = getConnectionIconsByCategory(category);
      expect(entries.length, `${category} should not be empty`).toBeGreaterThan(
        0,
      );
      expect(entries.every((entry) => entry.category === category)).toBe(true);
    });
  });

  it("provides accessible, searchable metadata for every entry", () => {
    CONNECTION_ICON_CATALOG.forEach((definition) => {
      expect(definition.label.trim()).not.toBe("");
      expect(definition.ariaLabel).toBe(`${definition.label} icon`);
      expect(definition.description.trim()).not.toBe("");
      expect(definition.keywords.length).toBeGreaterThan(0);
      expect(
        definition.keywords.every((keyword) => keyword.trim() !== ""),
      ).toBe(true);
      expect(typeof definition.icon).toBe("object");
    });
  });

  it("keeps persistence metadata string-only instead of serializing components", () => {
    const savedConnection = makeConnection("ssh", { icon: "terminal" });
    const serialized = JSON.parse(
      JSON.stringify(savedConnection),
    ) as Connection;

    expect(serialized.icon).toBe("terminal");
    expect(typeof serialized.icon).toBe("string");
    expect(serialized).not.toHaveProperty("iconComponent");
    integrationRegistry.forEach((descriptor) => {
      expect(typeof descriptor.defaultConnectionIconKey).toBe("string");
    });
  });
});

describe("resolveEffectiveConnectionIcon", () => {
  it("covers every built-in protocol default with a valid catalog key", () => {
    Object.entries(PROTOCOL_ICON_DEFAULTS).forEach(([protocol, key]) => {
      expect(isConnectionIconKey(key)).toBe(true);
      expect(getProtocolDefaultIconKey(protocol)).toBe(key);

      const result = resolveEffectiveConnectionIcon(makeConnection(protocol));
      expect(result).toMatchObject({
        key,
        source: "protocol",
        overrideState: "unset",
      });
    });
  });

  it("uses a valid explicit override before integration and protocol defaults", () => {
    const descriptor = integrationRegistry[0];
    const connection = makeConnection(`integration:${descriptor.key}`, {
      icon: "star",
      integration: { descriptorKey: descriptor.key },
    });

    expect(
      resolveEffectiveConnectionIcon(connection, descriptor),
    ).toMatchObject({
      key: "star",
      source: "override",
      overrideState: "valid",
      integrationKey: descriptor.key,
    });
  });

  it("treats empty or whitespace icon values as a cleared manual override", () => {
    const descriptor = integrationRegistry[0];
    for (const icon of [undefined, "", "   "]) {
      const result = resolveEffectiveConnectionIcon(
        makeConnection(`integration:${descriptor.key}`, {
          icon,
          integration: { descriptorKey: descriptor.key },
        }),
        descriptor,
      );
      expect(result).toMatchObject({
        key: descriptor.defaultConnectionIconKey,
        source: "integration",
        overrideState: "unset",
      });
      expect(result.unknownOverrideKey).toBeUndefined();
    }
  });

  it("falls through safely when a saved override key is unknown", () => {
    const builtIn = resolveEffectiveConnectionIcon(
      makeConnection("ssh", { icon: "removed-plugin-icon" }),
    );
    expect(builtIn).toMatchObject({
      key: "terminal",
      source: "protocol",
      overrideState: "unknown",
      unknownOverrideKey: "removed-plugin-icon",
    });

    const descriptor = integrationRegistry[0];
    const integration = resolveEffectiveConnectionIcon(
      makeConnection(`integration:${descriptor.key}`, {
        icon: "removed-plugin-icon",
        integration: { descriptorKey: descriptor.key },
      }),
      descriptor,
    );
    expect(integration).toMatchObject({
      key: descriptor.defaultConnectionIconKey,
      source: "integration",
      overrideState: "unknown",
    });
  });

  it("uses the generic fallback for unknown protocols and missing descriptors", () => {
    const unknownProtocol = resolveEffectiveConnectionIcon(
      makeConnection("future-protocol"),
    );
    expect(unknownProtocol).toMatchObject({
      key: GENERIC_CONNECTION_ICON_KEY,
      source: "fallback",
    });

    const missingDescriptor = resolveEffectiveConnectionIcon(
      makeConnection("integration:not-registered", {
        integration: { descriptorKey: "not-registered" },
      }),
    );
    expect(missingDescriptor).toMatchObject({
      key: GENERIC_CONNECTION_ICON_KEY,
      source: "fallback",
      integrationKey: "not-registered",
    });
  });

  it("ignores mismatched or invalid descriptor defaults", () => {
    const connection = makeConnection("integration:expected", {
      integration: { descriptorKey: "expected" },
    });

    expect(
      resolveEffectiveConnectionIcon(connection, {
        key: "different",
        defaultConnectionIconKey: "mail",
      }),
    ).toMatchObject({ source: "fallback", key: "monitor" });
    expect(
      resolveEffectiveConnectionIcon(connection, {
        key: "expected",
        defaultConnectionIconKey: "not-a-catalog-key",
      }),
    ).toMatchObject({ source: "fallback", key: "monitor" });
  });

  it("derives integration keys from settings first and protocol second", () => {
    expect(
      getConnectionIntegrationKey(
        makeConnection("integration:protocol-key", {
          integration: { descriptorKey: "settings-key" },
        }),
      ),
    ).toBe("settings-key");
    expect(
      getConnectionIntegrationKey(makeConnection("integration:protocol-key")),
    ).toBe("protocol-key");
    expect(getConnectionIntegrationKey(makeConnection("ssh"))).toBeUndefined();
  });

  it("returns accessible metadata from the selected catalog entry", () => {
    const result = resolveEffectiveConnectionIcon(
      makeConnection("ssh", { icon: "shield-check" }),
    );
    const definition = getConnectionIconDefinition("shield-check");

    expect(result).toMatchObject({
      key: "shield-check",
      label: definition?.label,
      ariaLabel: definition?.ariaLabel,
      description: definition?.description,
      category: "security",
      keywords: definition?.keywords,
    });
  });
});

describe("integration and tree consistency", () => {
  it("requires a valid default string key for every registered integration", () => {
    expect(integrationRegistry.length).toBeGreaterThan(0);
    integrationRegistry.forEach((descriptor) => {
      expect(
        descriptor.defaultConnectionIconKey,
        `${descriptor.key} must declare a default connection icon key`,
      ).toBeTruthy();
      expect(
        isConnectionIconKey(descriptor.defaultConnectionIconKey),
        `${descriptor.key} default must exist in the icon catalog`,
      ).toBe(true);
      expect(
        getConnectionIconDefinition(descriptor.defaultConnectionIconKey)?.icon,
        `${descriptor.key} connection default should match its descriptor icon`,
      ).toBe(descriptor.icon);
    });
  });

  it("resolves every integration descriptor default in both pure and tree paths", () => {
    integrationRegistry.forEach((descriptor) => {
      const connection = makeConnection(`integration:${descriptor.key}`, {
        integration: {
          descriptorKey: descriptor.key,
          descriptorLabel: descriptor.label,
          category: descriptor.category,
        },
      });
      const pure = resolveEffectiveConnectionIcon(connection, descriptor);
      const tree = getConnectionIconResolution(connection);

      expect(pure).toMatchObject({
        key: descriptor.defaultConnectionIconKey,
        source: "integration",
        integrationKey: descriptor.key,
      });
      expect(tree.key).toBe(pure.key);
      expect(tree.icon).toBe(pure.icon);
      expect(getConnectionIcon(connection)).toBe(pure.icon);
    });
  });

  it("keeps legacy editor values and tree rendering on the same catalog entries", () => {
    Object.keys(LEGACY_ICON_COMPONENTS).forEach((key) => {
      const connection = makeConnection("ssh", { icon: key });
      const resolved = resolveEffectiveConnectionIcon(connection);

      expect(resolved.key).toBe(key);
      expect(getConnectionIconResolution(connection).key).toBe(key);
      expect(getConnectionIcon(connection)).toBe(
        getConnectionIconDefinition(key)?.icon,
      );
    });
  });

  it("keeps protocol helper components consistent with the pure resolver", () => {
    Object.entries(PROTOCOL_ICON_DEFAULTS).forEach(([protocol, key]) => {
      expect(getProtocolIcon(protocol)).toBe(
        getConnectionIconDefinition(key)?.icon,
      );
    });
    expect(getProtocolIcon("unknown-protocol")).toBe(
      getConnectionIconDefinition(GENERIC_CONNECTION_ICON_KEY)?.icon,
    );
  });
});
