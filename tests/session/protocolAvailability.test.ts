import { describe, expect, it } from "vitest";
import {
  INTEGRATION_PROTOCOL_OPTIONS,
  PROTOCOL_OPTIONS,
} from "../../src/hooks/connection/useConnectionEditor";
import {
  isIntegrationConnectionProtocol,
  type BuiltInConnectionProtocol,
} from "../../src/types/connection/connection";
import {
  ADDITIONAL_AUDITED_PROTOCOLS,
  BUILT_IN_MANAGEMENT_PROTOCOLS,
  BUILT_IN_PROTOCOL_AVAILABILITY,
  PROTOCOL_AVAILABILITY,
  getDirectSessionUnavailableMessage,
  getProtocolAvailability,
} from "../../src/utils/session/protocolAvailability";

const BUILT_IN_PROTOCOLS = [
  "rdp",
  "ssh",
  "ard",
  "serial",
  "vnc",
  "anydesk",
  "http",
  "https",
  "telnet",
  "raw",
  "rlogin",
  "mysql",
  "postgresql",
  "spice",
  "xdmcp",
  "x2go",
  "nx",
  "ftp",
  "sftp",
  "scp",
  "winrm",
  "rustdesk",
  "smb",
  "gcp",
  "azure",
  "ibm-csp",
  "digital-ocean",
  "heroku",
  "scaleway",
  "linode",
  "ovhcloud",
  "ilo",
  "lenovo",
  "supermicro",
] as const satisfies readonly BuiltInConnectionProtocol[];

describe("protocol availability contract", () => {
  it("accounts for every persisted built-in protocol exactly once", () => {
    expect(Object.keys(BUILT_IN_PROTOCOL_AVAILABILITY).sort()).toEqual(
      [...BUILT_IN_PROTOCOLS].sort(),
    );
  });

  it("records truthful runtime availability for every primary editor option", () => {
    for (const option of PROTOCOL_OPTIONS) {
      const availability = getProtocolAvailability(option.value);
      expect(availability, option.value).toBeDefined();
      expect(availability?.sessionEntry, option.value).toBe("client-owned");
      expect(availability?.classification, option.value).not.toBe(
        "genuinely-unsupported",
      );
    }
  });

  it("exposes every direct built-in exactly once and no management identity", () => {
    const managementProtocols = new Set<string>(BUILT_IN_MANAGEMENT_PROTOCOLS);
    const expectedDirectProtocols = BUILT_IN_PROTOCOLS.filter(
      (protocol) => !managementProtocols.has(protocol),
    ).sort();
    const pickerProtocols = PROTOCOL_OPTIONS.map((option) => option.value);

    expect([...pickerProtocols].sort()).toEqual(expectedDirectProtocols);
    expect(new Set(pickerProtocols).size).toBe(pickerProtocols.length);

    for (const protocol of BUILT_IN_MANAGEMENT_PROTOCOLS) {
      const availability = getProtocolAvailability(protocol);
      expect(pickerProtocols, protocol).not.toContain(protocol);
      expect(availability?.classification, protocol).toBe("management-only");
      expect(availability?.sessionEntry, protocol).toBe("none");
      expect(availability?.detail, protocol).toMatch(
        /no saved-connection panel|no saved-connection management panel/i,
      );
    }
  });

  it("routes every visible integration option through the integration host contract", () => {
    for (const option of INTEGRATION_PROTOCOL_OPTIONS) {
      expect(isIntegrationConnectionProtocol(option.value), option.value).toBe(
        true,
      );
      expect(
        getDirectSessionUnavailableMessage(option.value),
        option.value,
      ).toBeNull();
    }
  });

  it("points RDP evidence at its dedicated client test", () => {
    expect(BUILT_IN_PROTOCOL_AVAILABILITY.rdp.testPath).toBe(
      "tests/rdp/RDPClient.test.tsx",
    );
  });

  it("routes every Quick Connect choice through a real client", () => {
    for (const protocol of ["rdp", "ssh", "vnc", "http", "https", "telnet"]) {
      expect(getProtocolAvailability(protocol)?.sessionEntry, protocol).toBe(
        "client-owned",
      );
    }
  });

  it("contains no advertised protocol that still uses the fake timer", () => {
    expect(
      Object.entries(PROTOCOL_AVAILABILITY).filter(
        ([, availability]) =>
          availability.sessionEntry === "legacy-generic-timer",
      ),
    ).toEqual([]);
  });

  it("fails closed for unsupported, management-only, and unknown sessions", () => {
    for (const protocol of ["ilo", "ipmi", "mac", "gcp", "k8s"]) {
      expect(getDirectSessionUnavailableMessage(protocol), protocol).toMatch(
        /management-only.*no registered interactive saved-connection route/i,
      );
    }
    expect(getDirectSessionUnavailableMessage("future-protocol")).toMatch(
      /no registered frontend session runtime/i,
    );
  });

  it("records every native display process handoff without claiming embedded pixels", () => {
    for (const protocol of ["spice", "xdmcp", "x2go", "nx"] as const) {
      const availability = getProtocolAvailability(protocol);
      expect(availability?.classification, protocol).toBe(
        "external-native-handoff",
      );
      expect(availability?.sessionEntry, protocol).toBe("client-owned");
      expect(availability?.frontendPath, protocol).toMatch(/Client\.tsx$/);
      expect(availability?.testPath, protocol).toMatch(/\.test\.tsx$/);
      expect(availability?.detail, protocol).toMatch(/local|native|installed/i);
      expect(getDirectSessionUnavailableMessage(protocol), protocol).toBeNull();
    }
  });

  it("records the bounded direct FTP and SCP file-transfer runtimes", () => {
    for (const protocol of ["ftp", "scp"]) {
      const availability = getProtocolAvailability(protocol);
      expect(availability?.classification, protocol).toBe("fully-interactive");
      expect(availability?.sessionEntry, protocol).toBe("client-owned");
      expect(availability?.frontendPath, protocol).toMatch(/Client\.tsx$/);
      expect(availability?.testPath, protocol).toMatch(/\.test\.tsx$/);
      expect(getDirectSessionUnavailableMessage(protocol), protocol).toBeNull();
    }
  });

  it("records the isolated direct PostgreSQL query runtime", () => {
    const availability = getProtocolAvailability("postgresql");
    expect(availability?.classification).toBe("fully-interactive");
    expect(availability?.sessionEntry).toBe("client-owned");
    expect(availability?.frontendPath).toBe(
      "src/components/protocol/PostgreSQLClient.tsx",
    );
    expect(availability?.testPath).toMatch(/usePostgreSQLClient\.test\.tsx$/);
    expect(getProtocolAvailability("postgres")).toBe(availability);
    expect(getDirectSessionUnavailableMessage("postgresql")).toBeNull();
  });

  it("keeps the non-persisted client audit list represented", () => {
    for (const protocol of ADDITIONAL_AUDITED_PROTOCOLS) {
      expect(PROTOCOL_AVAILABILITY[protocol], protocol).toBeDefined();
    }
  });
});
