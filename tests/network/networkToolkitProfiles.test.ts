import { describe, expect, it, vi } from "vitest";
import { toolkitProxyProfile } from "../../src/utils/network/networkToolkitProfiles";
import type { SavedProxyProfile } from "../../src/types/settings/settings";
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: { getProfiles: () => [] },
}));
const profile = (
  patch: Partial<SavedProxyProfile["config"]> = {},
): SavedProxyProfile => ({
  id: "one",
  name: "Proxy",
  createdAt: "",
  updatedAt: "",
  config: {
    enabled: true,
    type: "http",
    host: "localhost",
    port: 8080,
    ...patch,
  },
});
describe("Toolkit proxy profile selection", () => {
  it("supports credential-free HTTP/HTTPS profiles including IPv6", () => {
    expect(toolkitProxyProfile(profile()).url).toBe("http://localhost:8080");
    expect(
      toolkitProxyProfile(profile({ type: "https", host: "::1" })).url,
    ).toBe("https://[::1]:8080");
    expect(
      toolkitProxyProfile(profile({ type: "http-connect" })).disabled,
    ).toBe(false);
  });
  it("does not silently discard credentials, policies or unsupported tunnel types", () => {
    for (const config of [
      { username: "alice", password: "secret" },
      { type: "ssh" as const },
      { enabled: false },
      { customHeaders: { Authorization: "secret" } },
      { host: "user@host" },
      { host: "host/path" },
      { port: 0 },
    ]) {
      const result = toolkitProxyProfile(profile(config));
      expect(result.disabled).toBe(true);
      expect(result.url).toBe("");
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
});
