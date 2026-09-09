import { describe, expect, it } from "vitest";
import {
  getRuntimeProtocolOptions,
  getUnavailableCurrentProtocolOption,
  PROTOCOL_CATEGORY_ORDER,
} from "../../src/utils/connection/protocolOptionRegistry";
import {
  UNAVAILABLE_RUNTIME_CAPABILITIES,
  type RuntimeCapabilities,
} from "../../src/utils/runtime/runtimeCapabilities";
import {
  integrationRegistry,
  type ConnectionTypeCategory,
} from "../../src/types/integrations/registry";

interface TestOption {
  value: string;
  category: ConnectionTypeCategory;
}

const leanCapabilities: RuntimeCapabilities = {
  cloud: false,
  ops: false,
  rdp: false,
  serial: true,
  mysql: false,
  postgresql: false,
  mongodb: false,
  source: "native",
};

const builtInOptions: TestOption[] = [
  { value: "rdp", category: "remote-desktop" },
  { value: "ssh", category: "console" },
  { value: "serial", category: "console" },
  { value: "azure", category: "cloud" },
];

const integrationOptions: TestOption[] = [
  {
    value: "integration:netbox",
    category: "networking",
  },
  { value: "integration:proxmox", category: "virtualization" },
  { value: "integration:mssql", category: "database" },
  { value: "integration:keepass", category: "vault" },
];

describe("runtime protocol option registry", () => {
  it("filters gated built-ins and integrations while preserving available values and categories", () => {
    const options = getRuntimeProtocolOptions(
      builtInOptions,
      integrationOptions,
      leanCapabilities,
    );

    expect(options).toEqual([
      { value: "ssh", category: "console" },
      { value: "serial", category: "console" },
      {
        value: "integration:keepass",
        category: "vault",
      },
    ]);
    expect(PROTOCOL_CATEGORY_ORDER.indexOf("console")).toBeLessThan(
      PROTOCOL_CATEGORY_ORDER.indexOf("networking"),
    );
  });

  it("recovers only a saved canonical option omitted by this build", () => {
    const runtimeOptions = getRuntimeProtocolOptions(
      builtInOptions,
      integrationOptions,
      leanCapabilities,
    );
    const allOptions = [...builtInOptions, ...integrationOptions];

    expect(
      getUnavailableCurrentProtocolOption(runtimeOptions, allOptions, "rdp"),
    ).toEqual({ value: "rdp", category: "remote-desktop" });
    expect(
      getUnavailableCurrentProtocolOption(
        runtimeOptions,
        allOptions,
        "integration:netbox",
      ),
    ).toEqual({ value: "integration:netbox", category: "networking" });
    expect(
      getUnavailableCurrentProtocolOption(
        runtimeOptions,
        allOptions,
        "legacy-unknown",
      ),
    ).toBeNull();
  });

  it("covers all registered integrations in unavailable, lean, and full builds", () => {
    const registered = integrationRegistry.map(({ key, category }) => ({
      value: `integration:${key}`,
      category,
    }));
    expect(registered).toHaveLength(27);
    for (const capabilities of [
      UNAVAILABLE_RUNTIME_CAPABILITIES,
      leanCapabilities,
    ]) {
      expect(
        getRuntimeProtocolOptions([], registered, capabilities).map(
          ({ value }) => value,
        ),
      ).toEqual(["integration:keepass"]);
    }
    const full: RuntimeCapabilities = {
      ...leanCapabilities,
      ops: true,
      cloud: true,
      platform: true,
      collab: true,
      mssql: true,
    };
    expect(getRuntimeProtocolOptions([], registered, full)).toEqual(registered);
    expect(
      getRuntimeProtocolOptions([], registered, {
        ...leanCapabilities,
        mssql: true,
      }).map(({ value }) => value),
    ).toEqual(["integration:mssql", "integration:keepass"]);
  });
});
