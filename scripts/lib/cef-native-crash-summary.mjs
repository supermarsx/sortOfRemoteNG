/** Fixed-label native crash evidence. Never retain log lines, URLs or paths. */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_LINE = 64 * 1024;

function scanner() {
  const decoder = new StringDecoder("utf8");
  let tail = "",
    bytes = 0,
    lines = 0,
    oversizedLine = false,
    capped = false;
  const counts = { nativeFatal: 0, networkServiceCrashOrRestart: 0 };
  const line = (value) => {
    lines++;
    // Chromium's native severity prefix, not arbitrary page/console prose.
    if (/^\[(?:[^\]\r\n]*:)?FATAL:/i.test(value)) counts.nativeFatal++;
    // Pinned content/browser/network_service_instance_impl.cc logs this at
    // ERROR when a previously bound network service is launched again. Also
    // retain the older "crashed, restarting service" variant.
    if (
      /^\[(?:[^\]\r\n]*:)?(?:ERROR|WARNING|INFO):[^\]\r\n]*network_service_instance_impl\.cc(?::\d+|\(\d+\))?\]\s*Network service (?:crashed|was terminated|(?:is )?restarting|restarted)\b/i.test(
        value,
      )
    ) {
      counts.networkServiceCrashOrRestart++;
    }
  };
  const consume = (text) => {
    tail += text;
    let end;
    while ((end = tail.indexOf("\n")) !== -1) {
      const value = tail.slice(0, end);
      if (value.length > MAX_LINE) oversizedLine = true;
      line(value.slice(0, MAX_LINE));
      tail = tail.slice(end + 1);
    }
    if (tail.length > MAX_LINE) {
      // Any over-limit line invalidates the scan; never claim an omitted
      // suffix was clean. Keep its prefix for negative evidence only.
      oversizedLine = true;
      tail = tail.slice(0, MAX_LINE);
    }
  };
  return {
    push(buffer) {
      const remaining = Math.max(0, MAX_BYTES - bytes);
      const accepted = buffer.subarray(0, remaining);
      bytes += accepted.length;
      capped ||= buffer.length > remaining;
      consume(decoder.write(accepted));
    },
    finish(status = "readable", changed = false) {
      consume(decoder.end());
      const unterminated = tail.length > 0;
      if (unterminated) line(tail); // A truncated FATAL still remains a FATAL.
      const complete =
        status === "readable" &&
        !capped &&
        !oversizedLine &&
        !unterminated &&
        !changed;
      const failures = [];
      if (status !== "readable")
        failures.push(
          status === "missing" ? "native-log-missing" : "native-log-unreadable",
        );
      else if (!complete) failures.push("native-log-scan-incomplete");
      if (counts.nativeFatal > 0) failures.push("native-fatal");
      if (counts.networkServiceCrashOrRestart > 0)
        failures.push("network-service-crash-or-restart");
      return {
        schema: 1,
        source: "cef.log",
        ok: failures.length === 0,
        complete,
        bytesScanned: bytes,
        linesScanned: lines,
        capped,
        oversizedLine,
        unterminated,
        changedDuringScan: changed,
        counts,
        failures,
        limitation:
          "Logged native markers only; not an OS crash monitor. Empty readable logs contain no logged markers.",
      };
    },
  };
}

export function summarizeNativeCrashLog(source) {
  const scan = scanner();
  if (typeof source !== "string") return scan.finish("unreadable");
  scan.push(Buffer.from(source, "utf8"));
  return scan.finish();
}

export async function readNativeCrashSummary(file) {
  const scan = scanner();
  try {
    const before = await stat(file);
    if (!before.isFile()) return scan.finish("unreadable");
    // One extra byte detects truncation at the limit. The scan is streaming,
    // bounded, and never returns native error text or the file's path.
    for await (const chunk of createReadStream(file, {
      highWaterMark: 64 * 1024,
      start: 0,
      end: MAX_BYTES,
    }))
      scan.push(chunk);
    const after = await stat(file);
    return scan.finish(
      "readable",
      before.size !== after.size || before.mtimeMs !== after.mtimeMs,
    );
  } catch (error) {
    return scan.finish(error?.code === "ENOENT" ? "missing" : "unreadable");
  }
}

export function applyNativeCrashGate(assessment, crashSummary) {
  const failures = [...assessment.failures];
  // Re-derive the gate from fixed fields, not a supplied `ok: true` alone.
  if (
    crashSummary?.schema !== 1 ||
    crashSummary.source !== "cef.log" ||
    crashSummary.complete !== true ||
    !Array.isArray(crashSummary.failures) ||
    crashSummary.failures.length !== 0 ||
    crashSummary.counts?.nativeFatal !== 0 ||
    crashSummary.counts?.networkServiceCrashOrRestart !== 0
  ) {
    failures.push(
      "native crash log missing, incomplete or contains fatal/service-restart evidence",
    );
  }
  return { ...assessment, ok: failures.length === 0, failures };
}
