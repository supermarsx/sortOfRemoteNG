import { describe, it, expect } from "vitest";
import {
  DEFAULT_PORTS,
  getDefaultPort,
} from "../../src/utils/discovery/defaultPorts";

describe("defaultPorts", () => {
  it("has correct port for RDP", () => {
    expect(DEFAULT_PORTS.rdp).toBe(3389);
  });

  it("has correct port for SSH", () => {
    expect(DEFAULT_PORTS.ssh).toBe(22);
  });

  it("has correct port for VNC", () => {
    expect(DEFAULT_PORTS.vnc).toBe(5900);
  });

  it("has correct ports for the extended saved protocol picker", () => {
    expect(DEFAULT_PORTS.ard).toBe(5900);
    expect(DEFAULT_PORTS.telnet).toBe(23);
    expect(DEFAULT_PORTS.ftp).toBe(21);
    expect(DEFAULT_PORTS.sftp).toBe(22);
    expect(DEFAULT_PORTS.scp).toBe(22);
    expect(DEFAULT_PORTS.mysql).toBe(3306);
    expect(DEFAULT_PORTS.smb).toBe(445);
    expect(DEFAULT_PORTS.rustdesk).toBe(21116);
  });

  it("has correct port for HTTP/HTTPS", () => {
    expect(DEFAULT_PORTS.http).toBe(80);
    expect(DEFAULT_PORTS.https).toBe(443);
  });

  describe("getDefaultPort", () => {
    it("returns the mapped port for known protocols", () => {
      expect(getDefaultPort("rdp")).toBe(3389);
      expect(getDefaultPort("ssh")).toBe(22);
      expect(getDefaultPort("vnc")).toBe(5900);
      expect(getDefaultPort("ard")).toBe(5900);
      expect(getDefaultPort("ftp")).toBe(21);
      expect(getDefaultPort("sftp")).toBe(22);
      expect(getDefaultPort("scp")).toBe(22);
      expect(getDefaultPort("mysql")).toBe(3306);
      expect(getDefaultPort("smb")).toBe(445);
    });

    it("falls back to 22 for unknown protocols", () => {
      expect(getDefaultPort("unknown-protocol")).toBe(22);
    });
  });
});
