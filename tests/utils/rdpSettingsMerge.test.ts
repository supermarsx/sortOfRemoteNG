import { describe, it, expect } from "vitest";
import { mergeRdpSettings } from "../../src/utils/rdp/rdpSettingsMerge";

describe("mergeRdpSettings", () => {
  it("returns default settings when no overrides", () => {
    const result = mergeRdpSettings(undefined, {});
    expect(result).toBeDefined();
    expect(result.display).toBeDefined();
    expect(result.audio).toBeDefined();
    expect(result.security).toBeDefined();
  });

  it("applies global defaults over base", () => {
    const result = mergeRdpSettings(undefined, {
      defaultWidth: 1920,
      defaultHeight: 1080,
    });
    expect(result.display?.width).toBe(1920);
    expect(result.display?.height).toBe(1080);
  });

  it("applies connection overrides over global defaults", () => {
    const result = mergeRdpSettings(
      { display: { width: 2560, height: 1440 } },
      { defaultWidth: 1920, defaultHeight: 1080 },
    );
    expect(result.display?.width).toBe(2560);
    expect(result.display?.height).toBe(1440);
  });

  it("merges security section from global defaults", () => {
    const result = mergeRdpSettings(undefined, {
      useCredSsp: false,
      enableTls: true,
      enableNla: false,
    });
    expect(result.security?.useCredSsp).toBe(false);
    expect(result.security?.enableTls).toBe(true);
    expect(result.security?.enableNla).toBe(false);
  });

  it("merges gateway settings from global defaults", () => {
    const result = mergeRdpSettings(undefined, {
      gatewayEnabled: true,
      gatewayHostname: "gw.example.com",
      gatewayPort: 443,
    });
    expect(result.gateway?.enabled).toBe(true);
    expect(result.gateway?.hostname).toBe("gw.example.com");
    expect(result.gateway?.port).toBe(443);
  });

  it("merges performance codecs section", () => {
    const result = mergeRdpSettings(undefined, {
      codecsEnabled: true,
      remoteFxEnabled: true,
      gfxEnabled: false,
    });
    expect(result.performance?.codecs?.enableCodecs).toBe(true);
    expect(result.performance?.codecs?.remoteFx).toBe(true);
    expect(result.performance?.codecs?.enableGfx).toBe(false);
  });

  it("connection performance codecs override global", () => {
    const result = mergeRdpSettings(
      { performance: { codecs: { enableCodecs: false } } },
      { codecsEnabled: true },
    );
    expect(result.performance?.codecs?.enableCodecs).toBe(false);
  });

  it("merges TCP settings", () => {
    const result = mergeRdpSettings(undefined, {
      tcpConnectTimeoutSecs: 10,
      tcpNodelay: true,
    });
    expect(result.tcp?.connectTimeoutSecs).toBe(10);
    expect(result.tcp?.nodelay).toBe(true);
  });

  it("merges negotiation settings", () => {
    const result = mergeRdpSettings(undefined, {
      autoDetect: false,
      negotiationStrategy: "tls",
      maxRetries: 5,
    });
    expect(result.negotiation?.autoDetect).toBe(false);
    expect(result.negotiation?.strategy).toBe("tls");
    expect(result.negotiation?.maxRetries).toBe(5);
  });

  it("merges hyperv settings", () => {
    const result = mergeRdpSettings(undefined, {
      enhancedSessionMode: true,
    });
    expect(result.hyperv?.enhancedSessionMode).toBe(true);
  });

  it("merges advanced settings", () => {
    const result = mergeRdpSettings(undefined, {
      fullFrameSyncInterval: 10,
      readTimeoutMs: 5000,
    });
    expect(result.advanced?.fullFrameSyncInterval).toBe(10);
    expect(result.advanced?.readTimeoutMs).toBe(5000);
  });

  it("preserves sections not mentioned in overrides", () => {
    const result = mergeRdpSettings(
      { display: { width: 1280 } },
      {},
    );
    // Other sections should still exist from defaults
    expect(result.audio).toBeDefined();
    expect(result.input).toBeDefined();
    expect(result.deviceRedirection).toBeDefined();
  });
});
