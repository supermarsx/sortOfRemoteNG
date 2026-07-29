import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../src/types/connection/connection";
import {
  iloRuntimeAdapter,
  lenovoRuntimeAdapter,
  supermicroRuntimeAdapter,
} from "../../src/utils/session/bmcRuntimeAdapters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

function connection(
  protocol: Connection["protocol"],
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id: `${protocol}-saved`,
    name: `${protocol} saved`,
    protocol,
    hostname: "bmc.example.test",
    port: 8443,
    username: "operator",
    password: "secret",
    ...overrides,
  } as Connection;
}

describe("BMC runtime command adapters", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("maps iLO to its flat command", async () => {
    await iloRuntimeAdapter.connect(
      connection("ilo", {
        iloSettings: {
          authMethod: "basic",
          protocol: "ribcl",
          insecure: false,
          timeoutSecs: 45,
          ipmiPort: 6623,
          generation: "ilo6",
        },
      }),
    );

    expect(invokeMock).toHaveBeenCalledWith("ilo_connect", {
      host: "bmc.example.test",
      port: 8443,
      username: "operator",
      password: "secret",
      authMethod: "basic",
      protocol: "ribcl",
      insecure: false,
      timeoutSecs: 45,
      ipmiPort: 6623,
      generation: "ilo6",
    });
  });

  it("maps Lenovo to flat args instead of a config wrapper", async () => {
    await lenovoRuntimeAdapter.connect(
      connection("lenovo", {
        lenovoSettings: {
          protocol: "legacyRest",
          insecure: false,
          timeoutSecs: 40,
          ipmiPort: 7623,
          generation: "xcc2",
        },
      }),
    );

    expect(invokeMock).toHaveBeenCalledWith("lenovo_connect", {
      host: "bmc.example.test",
      port: 8443,
      username: "operator",
      password: "secret",
      protocol: "legacyRest",
      insecure: false,
      timeoutSecs: 40,
      ipmiPort: 7623,
      generation: "xcc2",
    });
  });

  it("maps Supermicro to its nested config command", async () => {
    await supermicroRuntimeAdapter.connect(
      connection("supermicro", {
        supermicroSettings: {
          useSsl: true,
          verifyCert: true,
          platform: "x13",
          authMethod: "basic",
          timeoutSecs: 50,
        },
      }),
    );

    expect(invokeMock).toHaveBeenCalledWith("smc_connect", {
      config: {
        host: "bmc.example.test",
        port: 8443,
        username: "operator",
        password: "secret",
        useSsl: true,
        verifyCert: true,
        platform: "x13",
        authMethod: "basic",
        timeoutSecs: 50,
      },
    });
  });

  it("uses each exact disconnect command", async () => {
    await iloRuntimeAdapter.disconnect();
    await lenovoRuntimeAdapter.disconnect();
    await supermicroRuntimeAdapter.disconnect();

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "ilo_disconnect",
      "lenovo_disconnect",
      "smc_disconnect",
    ]);
  });
});
