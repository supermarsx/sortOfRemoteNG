import { describe, expect, it } from "vitest";
import { normalizeSynologyEndpoint } from "../../src/utils/connection/synologyEndpoint";
describe("NAS endpoint input", () => {
  it.each([
    ["nas.office.example.com", "nas.office.example.com", 5001, true],
    ["https://nas.office.example.com/", "nas.office.example.com", 443, true],
    ["https://nas.example.com:5443/", "nas.example.com", 5443, true],
    ["nas.example.com:5000", "nas.example.com", 5000, true],
    ["http://nas.example.com/", "nas.example.com", 80, false],
    ["nas.example.com:443", "nas.example.com", 443, true],
    ["10.1.2.3", "10.1.2.3", 5001, true],
    ["2001:db8::1", "2001:db8::1", 5001, true],
    ["[2001:db8::1]:5443", "2001:db8::1", 5443, true],
    ["https://[2001:db8::1]/", "2001:db8::1", 443, true],
  ])(
    "normalizes %s without losing its target",
    (input, host, port, useHttps) => {
      expect(normalizeSynologyEndpoint(input as string, 5001, true)).toEqual({
        host,
        port,
        useHttps,
      });
    },
  );
  it.each([
    "https://user:secret@nas.example/",
    "https://nas.example/app",
    "nas.example?token=secret",
    "nas.example#fragment",
    "nas.example:0",
    "ftp://nas.example",
    "nas example",
    "https://%65vil.example/",
    "https://nas.example\\@evil.example/",
  ])("rejects ambiguous or credential-bearing address %s", (input) => {
    expect(() => normalizeSynologyEndpoint(input, 5001, true)).toThrow();
  });
});
