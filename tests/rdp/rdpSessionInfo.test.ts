import { describe, expect, it } from "vitest";
import {
  normalizeRdpSessionInfo,
  rdpResolutionLabel,
} from "../../src/utils/rdp/rdpSessionInfo";
import type { RDPSessionInfo } from "../../src/hooks/rdp/useRdpSessionPanel";
describe("RDP session metadata", () => {
  it("maps the native camelCase contract and marks a tunnel independently of its name", () => {
    const row = normalizeRdpSessionInfo({
      id: "backend",
      host: "127.0.0.1",
      port: 50001,
      connected: true,
      username: "user",
      connectionId: "saved-server",
      frontendSessionId: "tab",
      desktopWidth: 1600,
      desktopHeight: 900,
      targetIdentity: { host: "server.example", port: 3389 },
    } as unknown as RDPSessionInfo);
    expect(row.connection_id).toBe("saved-server");
    expect(row.frontend_session_id).toBe("tab");
    expect(row.target_identity?.host).toBe("server.example");
    expect(row.tunneled).toBe(true);
    expect(rdpResolutionLabel(row)).toBe("1600×900");
  });
  it("never formats absent or invalid dimensions as an actual resolution", () => {
    for (const width of [undefined, NaN, 0, -1]) {
      const row = normalizeRdpSessionInfo({
        host: "server",
        port: 3389,
        connected: true,
        desktopWidth: width,
        desktopHeight: 900,
      } as unknown as RDPSessionInfo);
      expect(rdpResolutionLabel(row)).toBe("Resolution pending");
    }
  });
});
