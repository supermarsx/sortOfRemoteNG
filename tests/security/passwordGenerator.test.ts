import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  validatePasswordOptions,
} from "../../src/utils/security/passwordGenerator";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("password generation", () => {
  it("defaults to 20 characters with every character type and no ambiguous characters", () => {
    for (let iteration = 0; iteration < 40; iteration++) {
      const password = generatePassword();
      expect(password).toHaveLength(20);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^a-zA-Z0-9]/);
      expect(password).not.toMatch(/[Il1O0o|]/);
    }
  });

  it("honors every nonempty combination of character types at the minimum length", () => {
    const groups = [
      ["lowercase", /[a-z]/],
      ["uppercase", /[A-Z]/],
      ["digits", /[0-9]/],
      ["symbols", /[^a-zA-Z0-9]/],
    ] as const;
    for (let mask = 1; mask < 16; mask++) {
      const options = { ...DEFAULT_PASSWORD_OPTIONS, length: 8 };
      groups.forEach(([name], index) => {
        options[name] = Boolean(mask & (1 << index));
      });
      for (let iteration = 0; iteration < 10; iteration++) {
        const password = generatePassword(options);
        expect(password).toHaveLength(8);
        groups.forEach(([name, pattern]) => {
          expect(pattern.test(password)).toBe(options[name]);
        });
      }
    }
  });

  it("supports the maximum length", () => {
    expect(
      generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 128 }),
    ).toHaveLength(128);
  });

  it.each([0, 7, 129, -1, 8.5, NaN, Infinity])(
    "rejects invalid length %s before requesting randomness",
    (length) => {
      const random = vi.spyOn(crypto, "getRandomValues");
      const options = { ...DEFAULT_PASSWORD_OPTIONS, length };
      expect(validatePasswordOptions(options)).toMatch(/whole-number length/);
      expect(() => generatePassword(options)).toThrow(/whole-number length/);
      expect(random).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty character selection", () => {
    expect(() =>
      generatePassword({
        ...DEFAULT_PASSWORD_OPTIONS,
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
      }),
    ).toThrow(/at least one/);
  });

  it("fails closed without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    const insecureRandom = vi.spyOn(Math, "random");
    expect(() => generatePassword()).toThrow(
      /Secure random generation is unavailable/,
    );
    expect(insecureRandom).not.toHaveBeenCalled();
  });

  it("discards out-of-range samples rather than biasing character selection", () => {
    let first = true;
    const random = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation((array) => {
        (array as Uint32Array)[0] = first ? 0xffffffff : 9;
        first = false;
        return array;
      });
    const password = generatePassword({
      ...DEFAULT_PASSWORD_OPTIONS,
      length: 8,
      lowercase: false,
      uppercase: false,
      symbols: false,
      excludeAmbiguous: false,
    });
    expect(password).toBe("99999999");
    expect(random).toHaveBeenCalledTimes(9);
  });

  it("can include ambiguous digits when their exclusion is disabled", () => {
    let value = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = value++ % 2;
      return array;
    });
    const options = {
      ...DEFAULT_PASSWORD_OPTIONS,
      length: 8,
      lowercase: false,
      uppercase: false,
      symbols: false,
    };
    expect(generatePassword({ ...options, excludeAmbiguous: false })).toBe(
      "01010101",
    );
    expect(generatePassword(options)).toBe("23232323");
  });
});
