import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

import {
  buildPfsenseApiTargetUrl,
  startPfsenseApiProxy,
  validatePfsenseApiProxyResponse,
} from "./apiProxy";

const protectedResponse = {
  local_port: 43123,
  session_id: "proxy-session",
  proxy_url: "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
};

describe("pfSense API internal proxy", () => {
  beforeEach(() => invokeMock.mockReset());

  it("builds canonical HTTP/HTTPS appliance origins", () => {
    expect(
      buildPfsenseApiTargetUrl({
        host: "fw.example.test",
        port: 8443,
        useTls: true,
      }),
    ).toBe("https://fw.example.test:8443/");
    expect(
      buildPfsenseApiTargetUrl({
        host: "2001:db8::10",
        port: 80,
        useTls: false,
      }),
    ).toBe("http://[2001:db8::10]/");
    expect(() =>
      buildPfsenseApiTargetUrl({
        host: "fw.example.test?redirect=attacker.test",
        port: 443,
        useTls: true,
      }),
    ).toThrow(/must not contain/);
  });

  it("accepts only capability-protected loopback responses", () => {
    expect(validatePfsenseApiProxyResponse(protectedResponse)).toBe(
      protectedResponse.proxy_url,
    );
    for (const proxy_url of [
      "http://127.0.0.1:43123/",
      "http://p0123456789abcdef0123456789abcdef.localhost:43123/api/",
      "https://p0123456789abcdef0123456789abcdef.localhost:43123/",
    ]) {
      expect(() =>
        validatePfsenseApiProxyResponse({ ...protectedResponse, proxy_url }),
      ).toThrow(/unsafe/);
    }
  });

  it("starts the mediator with closed pfSense v1 auth and upstream proxying", async () => {
    invokeMock.mockResolvedValueOnce(protectedResponse);
    await expect(
      startPfsenseApiProxy({
        host: "fw.example.test",
        port: 443,
        useTls: true,
        acceptInvalidCerts: false,
        apiKey: "client-id",
        apiSecret: "client-secret",
        connectionId: "pfsense-api:one",
        upstreamProxyUrl: "http://proxy.example.test:3128",
      }),
    ).resolves.toMatchObject({
      session_id: "proxy-session",
      protectedProxyUrl: protectedResponse.proxy_url,
    });
    expect(invokeMock).toHaveBeenCalledWith("start_basic_auth_proxy", {
      config: expect.objectContaining({
        target_url: "https://fw.example.test/",
        username: "client-id",
        password: "client-secret",
        upstream_auth_mode: "pfSenseV1",
        upstream_proxy_url: "http://proxy.example.test:3128",
        verify_ssl: true,
        connection_id: "pfsense-api:one",
      }),
    });
  });

  it("stops a backend session whose returned URL is unsafe", async () => {
    invokeMock.mockResolvedValueOnce({
      ...protectedResponse,
      proxy_url: "http://127.0.0.1:43123/",
    });
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(
      startPfsenseApiProxy({
        host: "fw.example.test",
        port: 443,
        useTls: true,
        acceptInvalidCerts: false,
        apiKey: "id",
        apiSecret: "secret",
        connectionId: "pfsense-api:one",
      }),
    ).rejects.toThrow(/unsafe/);
    expect(invokeMock).toHaveBeenLastCalledWith("stop_basic_auth_proxy", {
      sessionId: "proxy-session",
    });
  });
});
