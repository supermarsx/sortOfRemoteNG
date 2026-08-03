import { describe, expect, it } from "vitest";
import {
  getRuntimeProtocolOptions,
  getUnavailableCurrentProtocolOption,
  PROTOCOL_CATEGORY_ORDER,
} from "../../src/utils/connection/protocolOptionRegistry";
import type { RuntimeCapabilities } from "../../src/utils/runtime/runtimeCapabilities";
import type { ConnectionTypeCategory } from "../../src/types/integrations/registry";

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
];

describe("runtime protocol option registry", () => {
  it("filters gated built-ins while retaining integration values and categories", () => {
    const options = getRuntimeProtocolOptions(
      builtInOptions,
      integrationOptions,
      leanCapabilities,
    );

    expect(options).toEqual([
      { value: "ssh", category: "console" },
      { value: "serial", category: "console" },
      {
        value: "integration:netbox",
        category: "networking",
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
    ).toBeNull();
    expect(
      getUnavailableCurrentProtocolOption(
        runtimeOptions,
        allOptions,
        "legacy-unknown",
      ),
    ).toBeNull();
  });
});
