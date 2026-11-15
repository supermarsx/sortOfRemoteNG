import type { ManagedScript } from "../../components/recording/scriptManager/shared";
import type { TerminalMacro } from "../../types/recording/macroTypes";

/** One unit of text sent to the device, then a pause. */
export interface SerialPlaybackStep {
  /** Text to send. `\n` is mapped to the connection's line ending on send. */
  text: string;
  /** Milliseconds to wait after the step. */
  delayMs: number;
}

export const SERIAL_DEFAULT_LINE_DELAY_MS = 100;
export const SERIAL_MAX_STEP_DELAY_MS = 60_000;
export const SERIAL_MAX_PLAYBACK_STEPS = 5_000;

const clampDelay = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(SERIAL_MAX_STEP_DELAY_MS, Math.max(0, Math.round(value)))
    : fallback;

/**
 * A script plays as its literal lines, one send per line. Interpreter
 * directives (`#!`) are dropped: nothing interprets the text on a serial
 * console, the device does. The text returned is exactly what is sent, so it
 * can be shown for review before anything leaves the machine.
 */
export function serialScriptSteps(
  script: Pick<ManagedScript, "script">,
  lineDelayMs: number = SERIAL_DEFAULT_LINE_DELAY_MS,
): SerialPlaybackStep[] {
  const delayMs = clampDelay(lineDelayMs, SERIAL_DEFAULT_LINE_DELAY_MS);
  const lines = script.script
    .split(/\r\n|\r|\n/)
    .filter((line) => !line.startsWith("#!"));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines
    .slice(0, SERIAL_MAX_PLAYBACK_STEPS)
    .map((line) => ({ text: `${line}\n`, delayMs }));
}

export function serialMacroSteps(
  macro: Pick<TerminalMacro, "steps">,
): SerialPlaybackStep[] {
  return macro.steps.slice(0, SERIAL_MAX_PLAYBACK_STEPS).map((step) => ({
    text: `${step.command}${step.sendNewline ? "\n" : ""}`,
    delayMs: clampDelay(step.delayMs, 0),
  }));
}

/** The exact text a run will send, for the review prompt. */
export const serialPlaybackPreview = (
  steps: readonly SerialPlaybackStep[],
): string => steps.map((step) => step.text).join("");

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export interface SerialPlaybackResult {
  sent: number;
  total: number;
  aborted: boolean;
}

/** Sends steps strictly in order; an abort stops before the next step. */
export async function playSerialSteps(
  steps: readonly SerialPlaybackStep[],
  send: (text: string) => Promise<void>,
  signal: AbortSignal,
  onProgress?: (sent: number, total: number) => void,
): Promise<SerialPlaybackResult> {
  let sent = 0;
  for (const step of steps) {
    if (signal.aborted) break;
    if (step.text.length > 0) await send(step.text);
    sent += 1;
    onProgress?.(sent, steps.length);
    await wait(step.delayMs, signal);
  }
  return { sent, total: steps.length, aborted: signal.aborted };
}
