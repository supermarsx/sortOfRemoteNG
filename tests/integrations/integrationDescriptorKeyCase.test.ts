import { describe, expect, it } from "vitest";

import type { Connection } from "../../src/types/connection/connection";
import { INTEGRATION_PROTOCOL_PREFIX } from "../../src/types/connection/connection";
import {
  findDescriptor,
  integrationRegistry,
} from "../../src/types/integrations/registry";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";

/**
 * Regression gate for the camelCase integration-key defect.
 *
 * `normalizeAdvancedProtocolConnection` runs at every connection persistence
 * boundary and used to lowercase the whole protocol string, so a saved
 * `integration:nginxProxyMgr` came back as `integration:nginxproxymgr` and
 * `findDescriptor()` missed — the session tab rendered "This integration is no
 * longer available." instead of the panel. Every lowercase-keyed integration
 * worked; every camelCase-keyed one (`nginxProxyMgr`, `vmwareDesktop`) did not.
 *
 * The fix has two halves and this file pins both:
 *  1. the normaliser only case-folds the protocol *scheme*, never the
 *     descriptor-key suffix, so new saves stay intact; and
 *  2. descriptor lookup falls back to a case-insensitive match, so records
 *     already persisted in the mangled form still resolve.
 */

const connection = (protocol: string) =>
  ({
    id: "connection-id",
    name: "Integration connection",
    protocol,
    hostname: "host.example.test",
    port: 443,
    isGroup: false,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  }) as Connection;

const descriptorKeyFromProtocol = (protocol: string) =>
  protocol.slice(INTEGRATION_PROTOCOL_PREFIX.length);

describe("integration descriptor key case", () => {
  it("keeps every registry key unique when compared case-insensitively", () => {
    // The case-insensitive lookup fallback is only unambiguous while this
    // holds. A future descriptor that collides case-insensitively with an
    // existing one must fail here rather than silently resolve to the wrong
    // panel.
    const folded = integrationRegistry.map((d) => d.key.toLowerCase());
    expect(new Set(folded).size).toBe(folded.length);
  });

  it.each(["nginxProxyMgr", "vmwareDesktop"])(
    "resolves the %s panel from both a freshly saved and a legacy protocol",
    (key) => {
      const descriptor = integrationRegistry.find((d) => d.key === key);
      expect(descriptor, `descriptor "${key}" must exist`).toBeDefined();

      // Half 1 — a save/load round trip must not mangle the key.
      const saved = normalizeAdvancedProtocolConnection(
        connection(`${INTEGRATION_PROTOCOL_PREFIX}${key}`),
      );
      expect(saved.protocol).toBe(`${INTEGRATION_PROTOCOL_PREFIX}${key}`);
      expect(
        findDescriptor(descriptorKeyFromProtocol(saved.protocol as string)),
      ).toBe(descriptor);

      // Half 2 — a record persisted by the old case-folding normaliser must
      // still open its panel.
      const legacyProtocol =
        `${INTEGRATION_PROTOCOL_PREFIX}${key}`.toLowerCase();
      expect(legacyProtocol).not.toBe(`${INTEGRATION_PROTOCOL_PREFIX}${key}`);
      expect(findDescriptor(descriptorKeyFromProtocol(legacyProtocol))).toBe(
        descriptor,
      );
      // Reloading a legacy record leaves it lookup-resolvable too.
      const reloaded = normalizeAdvancedProtocolConnection(
        connection(legacyProtocol),
      );
      expect(
        findDescriptor(descriptorKeyFromProtocol(reloaded.protocol as string)),
      ).toBe(descriptor);
    },
  );

  it("still returns undefined for a key that matches no descriptor", () => {
    expect(findDescriptor("definitelyNotAnIntegration")).toBeUndefined();
    expect(findDescriptor("")).toBeUndefined();
    expect(findDescriptor("   ")).toBeUndefined();
  });

  it("keeps the descriptor icon for a legacy lowercased integration key", () => {
    const descriptor = findDescriptor("nginxProxyMgr");
    expect(descriptor).toBeDefined();
    const legacy = connection(
      `${INTEGRATION_PROTOCOL_PREFIX}nginxproxymgr`,
    ) as Connection;

    expect(resolveEffectiveConnectionIcon(legacy, descriptor).source).toBe(
      "integration",
    );
  });
});
