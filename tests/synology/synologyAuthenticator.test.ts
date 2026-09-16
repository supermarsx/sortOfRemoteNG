import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { TOTPConfig } from "../../src/types/settings/settings";
import {
  clearSynologyOtpSubmissions,
  generateSynologyTotpCode,
  recordSynologyOtpSubmission,
  resolveLocalSynologyAuthenticator,
  SYNOLOGY_AUTHENTICATOR_UNAVAILABLE_MESSAGES,
  synologyOtpReplayKey,
  waitForSynologyTotpWindow,
} from "../../src/utils/synology/synologyAuthenticator";
import { totpApi } from "../../src/hooks/totp/useTOTP";

vi.mock("../../src/hooks/totp/useTOTP", () => ({
  totpApi: { computeCode: vi.fn() },
}));

const SEED = "JBSWY3DPEHPK3PXP";
/** A 30-second window boundary: every test time is relative to it. */
const WINDOW = 59_633_334 * 30_000;
const config = (patch: Partial<TOTPConfig> = {}): TOTPConfig => ({
  id: "totp-1",
  secret: SEED,
  issuer: "Synology DSM",
  account: "admin",
  digits: 6,
  period: 30,
  algorithm: "sha1",
  ...patch,
});
const connection = (
  patch: Partial<Connection> = {},
  totpConfigs: TOTPConfig[] = [config()],
): Partial<Connection> => ({
  totpConfigs,
  synologySettings: {
    version: 1,
    useHttps: true,
    accessMode: "native",
    otpAuthenticatorId: "totp-1",
  },
  ...patch,
});
/** A clock that only moves when the code under test sleeps. */
const fakeClock = (at: number) => {
  const clock = {
    at,
    now: () => clock.at,
    sleep: vi.fn(async (ms: number) => {
      clock.at += ms;
    }),
  };
  return clock;
};
const noSecretOrCode = (error: unknown, ...values: string[]) => {
  const text = error instanceof Error ? error.message : String(error);
  for (const value of values) expect(text).not.toContain(value);
};

beforeEach(() => {
  clearSynologyOtpSubmissions();
  vi.mocked(totpApi.computeCode).mockReset();
});

describe("resolveLocalSynologyAuthenticator", () => {
  it("is none without a reference, and for vault credentials even with one", () => {
    expect(resolveLocalSynologyAuthenticator({})).toEqual({ kind: "none" });
    expect(
      resolveLocalSynologyAuthenticator({
        totpConfigs: [config()],
        synologySettings: { version: 1, useHttps: true },
      }),
    ).toEqual({ kind: "none" });
    expect(
      resolveLocalSynologyAuthenticator(
        connection({
          credentialSource: {
            kind: "vault",
            credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("is ready for exactly one usable config, with explicit or legacy local credentials", () => {
    for (const patch of [{}, { credentialSource: { kind: "local" as const } }])
      expect(resolveLocalSynologyAuthenticator(connection(patch))).toEqual({
        kind: "ready",
        config: config(),
      });
    for (const accepted of [
      { digits: 8 },
      { period: 15 },
      { period: 120 },
      { algorithm: "sha256" as const },
      { algorithm: "sha512" as const },
      { secret: "A".repeat(4096) },
    ])
      expect(
        resolveLocalSynologyAuthenticator(
          connection({}, [
            config({ id: "other", secret: "" }),
            config(accepted),
          ]),
        ).kind,
      ).toBe("ready");
  });

  it.each<[string, TOTPConfig[], string]>([
    ["no matching id", [config({ id: "other" })], "missing"],
    ["no configs", [], "missing"],
    ["a duplicated id", [config(), config()], "duplicate"],
    ["an empty secret", [config({ secret: "" })], "no-secret"],
    ["a blank secret", [config({ secret: "   " })], "no-secret"],
    [
      "a 4097-character secret",
      [config({ secret: "A".repeat(4097) })],
      "unsupported",
    ],
    ["7 digits", [config({ digits: 7 })], "unsupported"],
    ["period 0", [config({ period: 0 })], "unsupported"],
    ["period 3601", [config({ period: 3601 })], "unsupported"],
    ["period 14", [config({ period: 14 })], "unsupported"],
    ["period 121", [config({ period: 121 })], "unsupported"],
    ["period 30.5", [config({ period: 30.5 })], "unsupported"],
    [
      "algorithm md5",
      [config({ algorithm: "md5" as TOTPConfig["algorithm"] })],
      "unsupported",
    ],
  ])("is unavailable with %s", (_name, totpConfigs, reason) => {
    expect(
      resolveLocalSynologyAuthenticator(connection({}, totpConfigs)),
    ).toEqual({ kind: "unavailable", reason });
    expect(
      SYNOLOGY_AUTHENTICATOR_UNAVAILABLE_MESSAGES[
        reason as keyof typeof SYNOLOGY_AUTHENTICATOR_UNAVAILABLE_MESSAGES
      ],
    ).not.toContain(SEED);
  });

  it("treats a malformed saved reference as missing", () => {
    expect(
      resolveLocalSynologyAuthenticator({
        totpConfigs: [config({ id: "" })],
        synologySettings: {
          version: 1,
          useHttps: true,
          otpAuthenticatorId: "",
        },
      }),
    ).toEqual({ kind: "unavailable", reason: "missing" });
  });
});

describe("generateSynologyTotpCode", () => {
  const params = {
    secret: SEED,
    algorithm: "sha1",
    digits: 6,
    period: 30,
  } as const;

  it("computes one code natively with the saved parameters", async () => {
    vi.mocked(totpApi.computeCode).mockResolvedValue("123456");
    const clock = fakeClock(WINDOW + 1_000);
    const assertAttempt = vi.fn();
    const value = await generateSynologyTotpCode(params, assertAttempt, clock);
    expect(totpApi.computeCode).toHaveBeenCalledExactlyOnceWith(
      SEED,
      "SHA1",
      6,
      30,
    );
    expect(value.code).toBe("123456");
    expect(value.expires).toBe(WINDOW + 30_000);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(assertAttempt).toHaveBeenCalled();
    expect(() => value.assertCurrent()).not.toThrow();
  });

  it("passes SHA-256, 8 digits and a 60-second period unchanged", async () => {
    const computeCode = vi.fn().mockResolvedValue("12345678");
    const clock = fakeClock(WINDOW + 1_000);
    await expect(
      generateSynologyTotpCode(
        { secret: SEED, algorithm: "sha256", digits: 8, period: 60 },
        () => {},
        { ...clock, computeCode },
      ),
    ).resolves.toMatchObject({ code: "12345678" });
    expect(computeCode).toHaveBeenCalledExactlyOnceWith(SEED, "SHA256", 8, 60);
  });

  it("waits for the next window when 2.5 s are left, checking the attempt around the wait", async () => {
    const order: string[] = [];
    const clock = fakeClock(WINDOW + 27_500);
    clock.sleep.mockImplementation(async (ms: number) => {
      order.push(`sleep ${ms}`);
      clock.at += ms;
    });
    const assertAttempt = vi.fn(() => {
      order.push(`assert ${clock.at - WINDOW}`);
    });
    vi.mocked(totpApi.computeCode).mockImplementation(async () => {
      order.push(`compute ${clock.at - WINDOW}`);
      return "654321";
    });
    const value = await generateSynologyTotpCode(params, assertAttempt, clock);
    expect(value.expires).toBe(WINDOW + 60_000);
    expect(order[0]).toBe("assert 27500");
    expect(order.indexOf("sleep 500")).toBeGreaterThan(0);
    const compute = order.findIndex((entry) => entry.startsWith("compute"));
    expect(order[compute]).toBe("compute 30250");
    // Checked after every sleep slice and again right before computing.
    expect(order[compute - 1]).toBe("assert 30250");
    expect(
      order.filter((entry) => entry.startsWith("sleep")).length,
    ).toBeLessThanOrEqual(6);
    expect(clock.sleep.mock.calls.every(([ms]) => ms <= 500)).toBe(true);
  });

  it("does not wait with exactly the minimum time left", async () => {
    vi.mocked(totpApi.computeCode).mockResolvedValue("123456");
    const clock = fakeClock(WINDOW + 26_500);
    await generateSynologyTotpCode(params, () => {}, clock);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("stops without computing when the attempt is cancelled during the wait", async () => {
    const clock = fakeClock(WINDOW + 28_000);
    let cancelled = false;
    clock.sleep.mockImplementation(async (ms: number) => {
      clock.at += ms;
      cancelled = true;
    });
    const cancel = new Error("This NAS authentication attempt was cancelled.");
    await expect(
      generateSynologyTotpCode(
        params,
        () => {
          if (cancelled) throw cancel;
        },
        clock,
      ),
    ).rejects.toBe(cancel);
    expect(totpApi.computeCode).not.toHaveBeenCalled();
    expect(clock.sleep).toHaveBeenCalledOnce();
  });

  it("gives up after a bounded wait when the clock does not move", async () => {
    const clock = fakeClock(WINDOW + 29_000);
    clock.sleep.mockImplementation(async () => {});
    await expect(
      generateSynologyTotpCode(params, () => {}, clock),
    ).rejects.toThrow("The saved authenticator couldn't produce a code.");
    expect(clock.sleep.mock.calls.length).toBeLessThanOrEqual(10);
    expect(totpApi.computeCode).not.toHaveBeenCalled();
  });

  it.each(["12345", "1234567", "12345a", "", " 123456", 123456, null])(
    "refuses the computed value %j",
    async (code) => {
      vi.mocked(totpApi.computeCode).mockResolvedValue(code as string);
      const error = await generateSynologyTotpCode(
        params,
        () => {},
        fakeClock(WINDOW + 1_000),
      ).catch((reason: unknown) => reason);
      expect(error).toEqual(
        new Error("The saved authenticator couldn't produce a code."),
      );
    },
  );

  it("refuses a 6-digit code for an 8-digit authenticator", async () => {
    vi.mocked(totpApi.computeCode).mockResolvedValue("123456");
    await expect(
      generateSynologyTotpCode(
        { ...params, digits: 8 },
        () => {},
        fakeClock(WINDOW + 1_000),
      ),
    ).rejects.toThrow("couldn't produce a code");
  });

  it("never echoes the secret or the code from a native failure", async () => {
    vi.mocked(totpApi.computeCode).mockRejectedValue(
      new Error(`invalid base32 secret ${SEED} near 123456`),
    );
    const error = await generateSynologyTotpCode(
      params,
      () => {},
      fakeClock(WINDOW + 1_000),
    ).catch((reason: unknown) => reason);
    expect(error).toEqual(
      new Error("The saved authenticator couldn't produce a code."),
    );
    noSecretOrCode(error, SEED, "123456");
  });

  it("refuses a code that arrives with less than a second left", async () => {
    const clock = fakeClock(WINDOW + 20_000);
    vi.mocked(totpApi.computeCode).mockImplementation(async () => {
      clock.at = WINDOW + 29_200;
      return "123456";
    });
    await expect(
      generateSynologyTotpCode(params, () => {}, clock),
    ).rejects.toThrow("couldn't produce a code");
  });

  it("assertCurrent throws once the code's window has ended, without the code", async () => {
    vi.mocked(totpApi.computeCode).mockResolvedValue("123456");
    const clock = fakeClock(WINDOW + 1_000);
    const value = await generateSynologyTotpCode(params, () => {}, clock);
    clock.at = WINDOW + 29_999;
    expect(() => value.assertCurrent()).not.toThrow();
    clock.at = WINDOW + 30_000;
    expect(() => value.assertCurrent()).toThrow(
      "This authenticator code expired.",
    );
    noSecretOrCode(
      (() => {
        try {
          value.assertCurrent();
        } catch (error) {
          return error;
        }
      })(),
      SEED,
      "123456",
    );
  });

  it("stops after a cancellation reported once the native code returns", async () => {
    let computed = false;
    vi.mocked(totpApi.computeCode).mockImplementation(async () => {
      computed = true;
      return "123456";
    });
    await expect(
      generateSynologyTotpCode(
        params,
        () => {
          if (computed) throw new Error("cancelled");
        },
        fakeClock(WINDOW + 1_000),
      ),
    ).rejects.toThrow("cancelled");
  });

  it("refuses an unsupported period before any native call", async () => {
    for (const period of [0, 14, 121, 3601, 30.5])
      await expect(
        generateSynologyTotpCode(
          { ...params, period },
          () => {},
          fakeClock(WINDOW + 1_000),
        ),
      ).rejects.toThrow("couldn't produce a code");
    expect(totpApi.computeCode).not.toHaveBeenCalled();
  });
});

describe("same time-step guard", () => {
  const key = synologyOtpReplayKey("nas.example.test", 5001, "admin");
  const params = {
    secret: SEED,
    algorithm: "sha1",
    digits: 6,
    period: 30,
    replayKey: key,
  } as const;

  it("waits for the next step when this account already submitted a code in the current step", async () => {
    vi.mocked(totpApi.computeCode).mockResolvedValue("123456");
    recordSynologyOtpSubmission(key, WINDOW + 2_000);
    const clock = fakeClock(WINDOW + 10_000);
    const value = await generateSynologyTotpCode(params, () => {}, clock);
    expect(clock.sleep).toHaveBeenCalled();
    expect(clock.at).toBeGreaterThanOrEqual(WINDOW + 30_000);
    expect(clock.at - (WINDOW + 10_000)).toBeLessThanOrEqual(31_000);
    expect(value.expires).toBe(WINDOW + 60_000);
    expect(totpApi.computeCode).toHaveBeenCalledOnce();
  });

  it("does not wait once the step has changed, for another account, or without a key", async () => {
    vi.mocked(totpApi.computeCode).mockResolvedValue("123456");
    recordSynologyOtpSubmission(key, WINDOW - 1);
    recordSynologyOtpSubmission(
      synologyOtpReplayKey("nas.example.test", 5001, "operator"),
      WINDOW + 2_000,
    );
    for (const replayKey of [key, undefined]) {
      const clock = fakeClock(WINDOW + 10_000);
      await generateSynologyTotpCode({ ...params, replayKey }, () => {}, clock);
      expect(clock.sleep).not.toHaveBeenCalled();
    }
  });

  it("matches host and account case-insensitively but keeps ports apart", () => {
    expect(synologyOtpReplayKey("NAS.Example.test", 5001, "Admin")).toBe(key);
    expect(synologyOtpReplayKey("nas.example.test", 5000, "admin")).not.toBe(
      key,
    );
  });

  it("fails instead of reusing a step that is still taken after one wait", async () => {
    recordSynologyOtpSubmission(key, WINDOW + 2_000);
    const clock = fakeClock(WINDOW + 10_000);
    clock.sleep.mockImplementation(async (ms: number) => {
      clock.at += ms;
      // Another sign-in used the new step meanwhile.
      recordSynologyOtpSubmission(key, clock.at);
    });
    await expect(
      waitForSynologyTotpWindow(
        { period: 30, replayKey: key },
        () => {},
        clock,
      ),
    ).rejects.toThrow("couldn't produce a code");
    expect(totpApi.computeCode).not.toHaveBeenCalled();
  });

  it("keeps a bounded in-memory history", async () => {
    recordSynologyOtpSubmission(key, WINDOW + 1_000);
    for (let index = 0; index < 128; index++)
      recordSynologyOtpSubmission(`other-${index}`, WINDOW + 1_000);
    const clock = fakeClock(WINDOW + 5_000);
    await waitForSynologyTotpWindow(
      { period: 30, replayKey: key },
      () => {},
      clock,
    );
    expect(clock.sleep).not.toHaveBeenCalled();
    const recent = fakeClock(WINDOW + 5_000);
    await waitForSynologyTotpWindow(
      { period: 30, replayKey: "other-127" },
      () => {},
      recent,
    );
    expect(recent.sleep).toHaveBeenCalled();
  });
});
