import { describe, expect, it, vi } from "vitest";
import {
  generateTotpCode,
  TOTP_MIN_REMAINING_MS,
  totpRemainingFailure,
  totpWindow,
  type TotpCodeParameters,
} from "../../src/utils/security/totpCode";

const config: TotpCodeParameters = {
  secret: "SYNTHETICSEEDAAAA",
  algorithm: "sha1",
  digits: 6,
  period: 30,
};
/** A clock `remaining` milliseconds before the end of a 30 second step. */
const clockAt = (remaining: number) => {
  const clock = { value: 1_800_000_030_000 - remaining };
  return { clock, now: () => clock.value };
};
const failing = async (work: Promise<unknown>) =>
  work.then(
    () => "resolved",
    (error: { code?: string }) => error.code,
  );

describe("one authenticator code rule", () => {
  it("bounds the time step that contains the clock", () => {
    expect(totpWindow(30, 60_000)).toEqual({ starts: 60_000, expires: 90_000 });
    expect(totpWindow(30, 89_999)).toEqual({ starts: 60_000, expires: 90_000 });
    expect(totpWindow(60, 90_000)).toEqual({
      starts: 60_000,
      expires: 120_000,
    });
  });
  it("names why a code may not be handed out", () => {
    expect(TOTP_MIN_REMAINING_MS).toBe(3000);
    expect(totpRemainingFailure(10_000, 6_999)).toBeNull();
    expect(totpRemainingFailure(10_000, 7_000)).toBeNull();
    expect(totpRemainingFailure(10_000, 7_001)).toBe("code-window-closing");
    expect(totpRemainingFailure(10_000, 9_999)).toBe("code-window-closing");
    expect(totpRemainingFailure(10_000, 10_000)).toBe("code-expired");
    expect(totpRemainingFailure(10_000, 9_999, 0)).toBeNull();
  });
  it.each(["sha1", "SHA1", "sha256", "SHA512"])(
    "generates with algorithm %s and reports the step bounds",
    async (algorithm) => {
      const { now } = clockAt(20_000);
      const computeCode = vi.fn(async () => "123456");
      const generated = await generateTotpCode(
        { ...config, algorithm },
        { now, computeCode },
      );
      expect(computeCode).toHaveBeenCalledExactlyOnceWith(
        config.secret,
        algorithm.toUpperCase(),
        6,
        30,
      );
      expect(generated).toMatchObject({
        code: "123456",
        starts: 1_800_000_000_000,
        expires: 1_800_000_030_000,
      });
    },
  );
  it.each([
    ["empty secret", { secret: "" }],
    ["oversized secret", { secret: "A".repeat(4097) }],
    ["unknown algorithm", { algorithm: "md5" }],
    ["non-text algorithm", { algorithm: 1 as never }],
    ["five digits", { digits: 5 }],
    ["nine digits", { digits: 9 }],
    ["zero period", { period: 0 }],
    ["fractional period", { period: 30.5 }],
    ["oversized period", { period: 3601 }],
  ])("refuses %s before asking the generator", async (_name, change) => {
    const computeCode = vi.fn(async () => "123456");
    expect(
      await failing(
        generateTotpCode({ ...config, ...change }, { computeCode }),
      ),
    ).toBe("authenticator-invalid");
    expect(computeCode).not.toHaveBeenCalled();
  });
  it("refuses a closing step before computing and accepts the exact margin", async () => {
    const computeCode = vi.fn(async () => "123456");
    expect(
      await failing(
        generateTotpCode(config, { ...clockAt(2999), computeCode }),
      ),
    ).toBe("code-window-closing");
    expect(computeCode).not.toHaveBeenCalled();
    await expect(
      generateTotpCode(config, { ...clockAt(3000), computeCode }),
    ).resolves.toMatchObject({ code: "123456" });
    // A display-only caller may show the code to the last millisecond.
    await expect(
      generateTotpCode(config, {
        ...clockAt(1),
        computeCode,
        minimumRemainingMs: 0,
      }),
    ).resolves.toMatchObject({ code: "123456" });
  });
  it.each([
    ["the step ending", 20_000, "code-expired"],
    ["the clock moving back", -40_000, "code-expired"],
    ["the margin being crossed", 17_500, "code-window-closing"],
  ])("rejects a code after %s while generating", async (_name, shift, code) => {
    const { clock, now } = clockAt(20_000);
    const computeCode = vi.fn(async () => {
      clock.value += shift;
      return "123456";
    });
    expect(await failing(generateTotpCode(config, { now, computeCode }))).toBe(
      code,
    );
  });
  it.each([
    ["a generator error", new Error("SYNTHETIC_SEED_DETAIL")],
    ["too few digits", "12345"],
    ["a line break", "123\n45"],
    ["a non-text reply", 123456],
  ])("reports %s without the generator's text", async (_name, reply) => {
    const computeCode = vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply as string;
    });
    const error = await generateTotpCode(config, {
      ...clockAt(20_000),
      computeCode,
    }).catch((caught: Error & { code?: string }) => caught);
    expect(error).toMatchObject({ code: "code-not-generated" });
    expect(String((error as Error).message)).not.toMatch(
      /SYNTHETIC|12345|SEED/,
    );
  });
  it("revokes the code at the end of its step and on a clock rollback", async () => {
    const { clock, now } = clockAt(20_000);
    const generated = await generateTotpCode(config, {
      now,
      computeCode: async () => "123456",
    });
    expect(generated.assertCurrent).not.toThrow();
    clock.value = generated.expires - 1;
    expect(generated.assertCurrent).not.toThrow();
    clock.value = generated.expires;
    expect(generated.assertCurrent).toThrow(/expired/);
    clock.value = generated.starts - 1;
    expect(generated.assertCurrent).toThrow(/expired/);
  });
});
