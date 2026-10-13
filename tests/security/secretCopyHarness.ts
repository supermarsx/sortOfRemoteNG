import { act } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

/** What `secure_clip_copy` receives for one copy. */
export interface SecureCopyRequest {
  value: string;
  kind: string;
  field: string;
  connectionId: string | null;
  label: string | null;
  clearAfterSecs: number | null;
  maxPastes: number | null;
  oneTime: boolean;
}

export const lockedSentence =
  "Nothing was copied because the app is locked. Unlock it and try again.";
export const closingSentence =
  "The current code is about to expire. Wait for the next code, then try again.";
export const expiredSentence =
  "The code expired before it could be used. Try again for a fresh code.";
export const emptySentence = "There is nothing to copy.";

/** Seconds a copy asks the secure clipboard to keep each `field`, when no
 * one-time code expiry shortens it. Written out here on purpose, not imported:
 * the suites pin the decided table, not whatever the source says. */
export const clearSecondsByField: Record<string, number> = {
  username: 12,
  password: 12,
  totpCode: 30,
  apiKey: 30,
  recoveryCode: 30,
  secret: 30,
  export: 60,
};

/**
 * The desktop clipboard as a fake. Pass the mocked `getInvoke` of
 * `src/utils/tauri/invoke`: `secure_clip_copy` is recorded by `secureCopy`,
 * and the web clipboard and `execCommand` are spies that must stay unused.
 * Nothing here reads or writes a real clipboard.
 */
export function installSecureClipboard(getInvoke: Mock) {
  const secureCopy = vi
    .fn<(request: SecureCopyRequest) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  const webWrite = vi.fn().mockResolvedValue(undefined);
  const execCommand = vi.fn().mockReturnValue(true);
  getInvoke
    .mockReset()
    .mockResolvedValue(
      (command: string, args?: { request: SecureCopyRequest }) =>
        command === "secure_clip_copy" && args
          ? secureCopy(args.request)
          : Promise.reject(new Error(`unexpected command ${command}`)),
    );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: webWrite, write: webWrite },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  return {
    secureCopy,
    /** The one request made, with the policy fields a copy never sets. The
     * clear time defaults to the field's entry in `clearSecondsByField`. */
    expectOnlyCopy(request: {
      value: string;
      kind: string;
      field: string;
      clearAfterSecs?: number | null;
      connectionId?: string | null;
    }) {
      expect(clearSecondsByField).toHaveProperty(request.field);
      expect(secureCopy).toHaveBeenCalledExactlyOnceWith({
        clearAfterSecs: clearSecondsByField[request.field],
        connectionId: null,
        ...request,
        label: null,
        maxPastes: null,
        oneTime: false,
      });
    },
    expectNoRawClipboard() {
      expect(webWrite).not.toHaveBeenCalled();
      expect(execCommand).not.toHaveBeenCalled();
    },
    /** Keep the next native write pending until it is released or refused. */
    hold() {
      let settle!: {
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      };
      secureCopy.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settle = { resolve, reject };
          }),
      );
      return {
        release: () => settle.resolve(undefined),
        refuse: (code: string) => settle.reject(code),
      };
    },
  };
}

export type SecureClipboardFake = ReturnType<typeof installSecureClipboard>;

/** Let pending promises and zero-delay timers run under fake timers. */
export const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

/** Move the fake clock, running every timer that falls due on the way. */
export const advance = (milliseconds: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });

/** Console spies; `expectSilentAbout` fails if any call mentions a value. */
export function watchConsole() {
  const spies = (["log", "info", "debug", "warn", "error"] as const).map(
    (level) => vi.spyOn(console, level).mockImplementation(() => {}),
  );
  return {
    expectSilentAbout(...values: string[]) {
      const said = JSON.stringify(
        spies.flatMap((spy) => spy.mock.calls),
        (_key, value: unknown) =>
          value instanceof Error ? `${value.name}: ${value.message}` : value,
      );
      for (const value of values) expect(said).not.toContain(value);
    },
  };
}

/** The lucide tick that marks a finished copy inside a button. */
export const hasTick = (element: Element) =>
  element.querySelector("svg.lucide-check") !== null;
