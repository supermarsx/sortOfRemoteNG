import { describe, expect, it } from "vitest";
import {
  DEFAULT_SSH_RECONNECT_POLICY,
  getSshReconnectDelayMs,
  normalizeSshReconnectSettings,
  resolveSshReconnectPolicy,
} from "../../src/utils/ssh/sshReconnectPolicy";

describe("SSH reconnect policy", () => {
  it("ships a bounded reboot-tolerant exponential policy", () => {
    const policy = resolveSshReconnectPolicy({});

    expect(policy).toEqual({
      enabled: true,
      maxAttempts: 20,
      baseDelayMs: 2_000,
      backoff: "exponential",
      maxDelayMs: 30_000,
    });
    expect(DEFAULT_SSH_RECONNECT_POLICY.maxAttempts).toBeLessThanOrEqual(50);
  });

  it("backs off quickly and caps each delay", () => {
    const policy = resolveSshReconnectPolicy({});

    expect(
      Array.from({ length: 8 }, (_, attempt) =>
        getSshReconnectDelayMs(policy, attempt),
      ),
    ).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it("preserves explicit legacy choices and per-connection overrides", () => {
    const policy = resolveSshReconnectPolicy(
      {
        autoReconnectOnDisconnect: false,
        autoReconnectMaxAttempts: 7,
        autoReconnectDelaySecs: 5,
        autoReconnectBackoff: "fixed",
        autoReconnectMaxDelaySecs: 45,
      },
      { retryAttempts: 0, retryDelay: 750 },
    );

    expect(policy).toEqual({
      enabled: false,
      maxAttempts: 0,
      baseDelayMs: 750,
      backoff: "fixed",
      maxDelayMs: 45_000,
    });
  });

  it("normalizes malformed persisted values without creating retry storms", () => {
    const normalized = normalizeSshReconnectSettings({
      autoReconnectOnDisconnect: "yes" as never,
      autoReconnectMaxAttempts: Number.POSITIVE_INFINITY,
      autoReconnectDelaySecs: -20,
      autoReconnectBackoff: "instant" as never,
      autoReconnectMaxDelaySecs: 0,
    });

    expect(normalized).toEqual({
      autoReconnectOnDisconnect: true,
      autoReconnectMaxAttempts: 20,
      autoReconnectDelaySecs: 1,
      autoReconnectBackoff: "exponential",
      autoReconnectMaxDelaySecs: 1,
    });
  });
});
