import { describe, expect, it } from "vitest";
import { PROTOCOL_OPTIONS } from "../../src/hooks/connection/useConnectionEditor";
import type { BuiltInConnectionProtocol } from "../../src/types/connection/connection";
import {
  ADDITIONAL_AUDITED_PROTOCOLS,
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
    for (const protocol of ["spice", "x2go"]) {
      expect(getDirectSessionUnavailableMessage(protocol), protocol).toMatch(
        /does not have a wired direct session runtime/i,
      );
    }
    for (const protocol of ["ilo", "ipmi", "mac", "gcp", "k8s"]) {
      expect(getDirectSessionUnavailableMessage(protocol), protocol).toMatch(
        /management panel/i,
      );
    }
    expect(getDirectSessionUnavailableMessage("future-protocol")).toMatch(
      /no registered frontend session runtime/i,
    );
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

  it("keeps the non-persisted client audit list represented", () => {
    for (const protocol of ADDITIONAL_AUDITED_PROTOCOLS) {
      expect(PROTOCOL_AVAILABILITY[protocol], protocol).toBeDefined();
    }
  });
});
