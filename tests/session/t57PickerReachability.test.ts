import { describe, expect, it } from "vitest";

import { PROTOCOL_OPTIONS } from "../../src/hooks/connection/useConnectionEditor";
import type { BuiltInConnectionProtocol } from "../../src/types/connection/connection";
import { findBuiltInCloudRuntime } from "../../src/utils/session/builtInCloudRuntimeRegistry";
import { findBuiltInManagementRuntime } from "../../src/utils/session/builtInManagementRuntimeRegistry";
import {
  BUILT_IN_HIDDEN_DIRECT_PROTOCOLS,
  BUILT_IN_MANAGEMENT_PROTOCOLS,
  getDirectSessionUnavailableMessage,
  getProtocolAvailability,
} from "../../src/utils/session/protocolAvailability";

const T57_PICKER_TARGETS = [
  {
    protocol: "idrac",
    category: "lights-out",
    registry: "management",
    classification: "fully-interactive",
  },
  {
    protocol: "ilo",
    category: "lights-out",
    registry: "management",
    classification: "read-only-management",
  },
  {
    protocol: "lenovo",
    category: "lights-out",
    registry: "management",
    classification: "read-only-management",
  },
  {
    protocol: "supermicro",
    category: "lights-out",
    registry: "management",
    classification: "read-only-management",
  },
  {
    protocol: "gcp",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "azure",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "ibm-csp",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "digital-ocean",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "heroku",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "scaleway",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "linode",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
  {
    protocol: "ovhcloud",
    category: "cloud",
    registry: "cloud",
    classification: "read-only-management",
  },
] as const satisfies readonly {
  protocol: BuiltInConnectionProtocol;
  category: "lights-out" | "cloud";
  registry: "management" | "cloud";
  classification: "fully-interactive" | "read-only-management";
}[];

describe("t57 picker reachability", () => {
  it("contains exactly the twelve promoted targets once", () => {
    for (const target of T57_PICKER_TARGETS) {
      expect(
        PROTOCOL_OPTIONS.filter((option) => option.value === target.protocol),
        target.protocol,
      ).toHaveLength(1);
    }
  });

  it.each(T57_PICKER_TARGETS)(
    "$protocol is selectable, available, categorized, and openable",
    async ({ protocol, category, registry, classification }) => {
      expect(PROTOCOL_OPTIONS).toContainEqual(
        expect.objectContaining({
          value: protocol,
          category,
        }),
      );
      expect(BUILT_IN_HIDDEN_DIRECT_PROTOCOLS).not.toContain(protocol);
      expect(BUILT_IN_MANAGEMENT_PROTOCOLS).not.toContain(protocol);
      expect(getProtocolAvailability(protocol)).toEqual(
        expect.objectContaining({
          classification,
          sessionEntry: "client-owned",
        }),
      );
      expect(getDirectSessionUnavailableMessage(protocol)).toBeNull();

      const descriptor =
        registry === "management"
          ? findBuiltInManagementRuntime(protocol)
          : findBuiltInCloudRuntime(protocol);
      expect(descriptor, protocol).toEqual(
        expect.objectContaining({ protocol, category }),
      );
      const panelModule = await descriptor!.importPanel();
      expect(panelModule.default, protocol).toBeTypeOf("function");
    },
  );
});

describe("t66 voip-phone picker reachability", () => {
  const protocol = "voip-phone" as const satisfies BuiltInConnectionProtocol;

  it("is selectable once under networking with a client-owned, fully-interactive runtime", async () => {
    expect(
      PROTOCOL_OPTIONS.filter((option) => option.value === protocol),
    ).toHaveLength(1);
    expect(PROTOCOL_OPTIONS).toContainEqual(
      expect.objectContaining({ value: protocol, category: "networking" }),
    );
    expect(BUILT_IN_HIDDEN_DIRECT_PROTOCOLS).not.toContain(protocol);
    expect(BUILT_IN_MANAGEMENT_PROTOCOLS).not.toContain(protocol);
    expect(getProtocolAvailability(protocol)).toEqual(
      expect.objectContaining({
        classification: "fully-interactive",
        sessionEntry: "client-owned",
      }),
    );
    expect(getDirectSessionUnavailableMessage(protocol)).toBeNull();

    // The management-runtime descriptor is registered by the session-panel
    // executor (t66-e4). Until it lands the picker entry is contract-only;
    // once present it must resolve to a real panel like every t57 target.
    const descriptor = findBuiltInManagementRuntime(protocol);
    if (descriptor) {
      expect(descriptor).toEqual(
        expect.objectContaining({ protocol, category: "networking" }),
      );
      const panelModule = await descriptor.importPanel();
      expect(panelModule.default).toBeTypeOf("function");
    }
  });
});
