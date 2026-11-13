import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

// Closed test DATA history only. No SDK/source/ownership admission.
export const BEFORE_WITNESS_PRODUCER =
  "2ec4f0f98de64984cca59b97a44efacf3dba48ab0d6396bad072d5a302eb4333";
export const CURRENT_WITNESS_PRODUCER =
  "b4f9e38d5343a830da850ccd19f336553e210c8eb31443baa2c4d97eae224829";
export const BEFORE_WITNESS_CORE = Object.freeze({
  bytes: 250406,
  sha256: "12f7ac17a1668387b63fa5dca687415032444420387295effb9ba9c19ba54f36",
  blob: "857ba720d69d8f937b6925bc94881ca748af27a8",
});
export const CURRENT_WITNESS_CORE = Object.freeze({
  bytes: 257508,
  sha256: "59abab5a6fefe5ffdf06954fd38fa47c363679f2ec5cb38fa71e4e6ec9e813e8",
  blob: "501091e659e7ee23a50302c88848ea908776332b",
});
const PAIRS = [
  {
    before:
      "  return macCensusClient(child, { deadline });\n}\nfunction macCensusClient(\n  child,\n",
    after:
      '  return macCensusClient(child, { deadline });\n}\n// Bounded metadata only. This observer never admits a census or changes its failure.\nfunction macCensusFailureWitness() {\n  const clientFailureCodes = new Set([\n    "CENSUS_READY_DEADLINE",\n    "CENSUS_READY",\n    "CENSUS_ABI",\n    "CENSUS_UNSOLICITED",\n    "CENSUS_EOF",\n    "CENSUS_ABORT",\n    "CENSUS_REQUEST_BOUND",\n    "CENSUS_STDERR_BOUND",\n    "CENSUS_JOIN",\n  ]);\n  const errorCode = (error) => {\n    try {\n      if (error === false || error === null || error === undefined)\n        return "FALSY_PRIMARY";\n      if (utilTypes.isProxy(error)) return "HOSTILE_FAILURE";\n      if (!utilTypes.isNativeError(error)) return "OTHER_CLOSED_FAILURE";\n      const code = Object.getOwnPropertyDescriptor(error, "message")?.value;\n      return typeof code === "string" &&\n        (CENSUS_FAILURE_CODES.has(code) || clientFailureCodes.has(code))\n        ? code\n        : "OTHER_CLOSED_FAILURE";\n    } catch {\n      return "HOSTILE_FAILURE";\n    }\n  };\n  const state = {\n    first: null,\n    currentOrigin: "none",\n    request: 0,\n    requestAt: 0,\n    end: 0,\n    writeCallbackAt: null,\n    lastFrame: null,\n    rowsValid: false,\n    helperCode: "CENSUS_UNAVAILABLE",\n    lateFrames: 0,\n    lateBytes: 0,\n    lateTruncated: false,\n    lateLast: null,\n    observerFaults: 0,\n    events: [],\n  };\n  let late = Buffer.alloc(0);\n  const number = (n) =>\n    Number.isFinite(n)\n      ? Math.max(-1, Math.min(1e12, Math.floor(n * 1000) / 1000))\n      : -1;\n  const event = (kind, now, ...values) => {\n    state.events.push({ kind, atMs: number(now), values: values.map(number) });\n    if (state.events.length > 32) state.events.shift();\n  };\n  const note = (kind, now, a, b, c) => {\n    try {\n      if (kind === "request") {\n        state.request = a;\n        state.requestAt = now;\n        state.end = b;\n        state.rowsValid = false;\n        state.currentOrigin = "write";\n        state.writeCallbackAt = null;\n      }\n      if (kind === "write-callback") {\n        state.writeCallbackAt = now;\n        if (b) state.currentOrigin = "write-error";\n      }\n      if (kind === "write-error") state.currentOrigin = "write-error";\n      if (kind === "frame-start") {\n        state.rowsValid = false;\n        state.currentOrigin = "frame-parse";\n        state.lastFrame = { bytes: a, atMs: number(now) };\n      }\n      if (kind === "rows-valid") {\n        state.rowsValid = true;\n        state.lastFrame = {\n          ...state.lastFrame,\n          request: a,\n          collectMicros: b,\n          endMs: number(c),\n        };\n        state.currentOrigin = "frame-validated";\n      }\n      if (kind === "frame-error")\n        state.currentOrigin =\n          state.rowsValid && errorCode(a) === "CENSUS_DEADLINE"\n            ? "frame-deadline"\n            : "frame-validation";\n      if (kind === "helper-code")\n        state.helperCode =\n          typeof a === "string" && /^CENSUS_[A-Z_]+$/.test(a)\n            ? a\n            : "CENSUS_UNAVAILABLE";\n      if (kind === "child-close")\n        state.currentOrigin =\n          state.helperCode !== "CENSUS_UNAVAILABLE"\n            ? "helper-failure"\n            : "child-close";\n      if (kind === "timer") state.currentOrigin = "timer";\n      if (kind === "deny" && !state.first)\n        state.first = {\n          origin: state.currentOrigin,\n          code: errorCode(a),\n          request: state.request,\n          atMs: number(now),\n          requestAtMs: number(state.requestAt),\n          endMs: number(state.end),\n          timerDriftMs:\n            state.currentOrigin === "timer" ? number(now - state.end) : null,\n          writeCallbackAtMs:\n            state.writeCallbackAt === null\n              ? null\n              : number(state.writeCallbackAt),\n          lastFrame: state.lastFrame,\n        };\n      event(\n        kind,\n        now,\n        [\n          "request",\n          "write-callback",\n          "frame-start",\n          "rows-valid",\n          "chunk",\n          "child-close",\n          "close-finally",\n        ].includes(kind) && typeof a === "number"\n          ? a\n          : 0,\n        ["request", "write-callback", "rows-valid", "chunk"].includes(kind) &&\n          typeof b === "number"\n          ? b\n          : 0,\n        ["rows-valid", "chunk"].includes(kind) && typeof c === "number" ? c : 0,\n      );\n    } catch {\n      state.observerFaults = Math.min(1e12, state.observerFaults + 1);\n    }\n  };\n  const observeLate = (chunk, now) => {\n    try {\n      state.lateBytes = Math.min(1e12, state.lateBytes + chunk.length);\n      if (state.lateTruncated) return;\n      if (late.length + chunk.length > 65536) {\n        state.lateTruncated = true;\n        late = Buffer.alloc(0);\n        return;\n      }\n      late = Buffer.concat([late, chunk]);\n      for (;;) {\n        const n = late.indexOf(10);\n        if (n < 0) break;\n        const line = late.subarray(0, n);\n        late = late.subarray(n + 1);\n        try {\n          const v = JSON.parse(line.toString());\n          if (\n            Number.isSafeInteger(v.request) &&\n            v.request > 0 &&\n            Number.isSafeInteger(v.collectMicros) &&\n            v.collectMicros >= 0 &&\n            v.collectMicros < 30000000 &&\n            Array.isArray(v.rows) &&\n            v.rows.length <= 32768\n          ) {\n            state.lateFrames++;\n            state.lateLast = {\n              request: v.request,\n              collectMicros: v.collectMicros,\n              rowCount: v.rows.length,\n              atMs: number(now),\n            };\n          }\n        } catch {}\n      }\n    } catch {\n      state.observerFaults = Math.min(1e12, state.observerFaults + 1);\n    }\n  };\n  return {\n    note,\n    late: observeLate,\n    result: () => {\n      try {\n        return structuredClone(state);\n      } catch {\n        return { observerUnavailable: true };\n      }\n    },\n  };\n}\nfunction macCensusClient(\n  child,\n',
  },
  {
    before:
      "  } = {},\n) {\n  const readyDeadline = Math.min(\n    deadline,\n",
    after:
      "  } = {},\n) {\n  const failureWitness = macCensusFailureWitness();\n  const diagNote = failureWitness.note,\n    diagLate = failureWitness.late;\n  const readyDeadline = Math.min(\n    deadline,\n",
  },
  {
    before:
      "  });\n  const deny = (error) => {\n    if (!failed) {\n      failed = true;\n",
    after:
      '  });\n  const deny = (error) => {\n    diagNote("deny", performance.now(), error);\n    if (!failed) {\n      failed = true;\n',
  },
  {
    before:
      '  };\n  const frame = (line) => {\n    try {\n      const value = JSON.parse(line.toString("utf8"));\n',
    after:
      '  };\n  const frame = (line) => {\n    diagNote("frame-start", performance.now(), line.length);\n    try {\n      const value = JSON.parse(line.toString("utf8"));\n',
  },
  {
    before:
      '      assert(pending && !failed, "CENSUS_UNSOLICITED");\n      const rows = nativeCensusRows(value, pending.id);\n      assert(performance.now() < pending.end, "CENSUS_DEADLINE");\n      const current = pending;\n',
    after:
      '      assert(pending && !failed, "CENSUS_UNSOLICITED");\n      const rows = nativeCensusRows(value, pending.id);\n      diagNote(\n        "rows-valid",\n        performance.now(),\n        pending.id,\n        value.collectMicros,\n        pending.end,\n      );\n      assert(performance.now() < pending.end, "CENSUS_DEADLINE");\n      const current = pending;\n',
  },
  {
    before:
      '      });\n    } catch (error) {\n      deny(error);\n    }\n  };\n  child.stdout.on("data", (chunk) => {\n    if (failed) return;\n    if (buffer.length + chunk.length > 4 * 1024 ** 2) {\n      deny(new Error("CENSUS_OUTPUT_BOUND"));\n',
    after:
      '      });\n    } catch (error) {\n      diagNote("frame-error", performance.now(), error);\n      deny(error);\n    }\n  };\n  child.stdout.on("data", (chunk) => {\n    diagNote(\n      "chunk",\n      performance.now(),\n      chunk.length,\n      buffer.length,\n      failed ? 1 : 0,\n    );\n    if (failed) {\n      diagLate(chunk, performance.now());\n      return;\n    }\n    if (buffer.length + chunk.length > 4 * 1024 ** 2) {\n      deny(new Error("CENSUS_OUTPUT_BOUND"));\n',
  },
  {
    before:
      '  });\n  child.stdout.on("error", (error) => deny(error));\n  child.stdin.on("error", (error) => deny(error));\n  let stderrBytes = 0;\n  const stderrChunks = [];\n',
    after:
      '  });\n  child.stdout.on("error", (error) => deny(error));\n  child.stdin.on("error", (error) => {\n    diagNote("write-error", performance.now());\n    deny(error);\n  });\n  let stderrBytes = 0;\n  const stderrChunks = [];\n',
  },
  {
    before:
      '    stderrBytes += chunk.length;\n    if (stderrBytes <= 4096) stderrChunks.push(chunk);\n    if (stderrBytes > 4096) deny(new Error("CENSUS_STDERR_BOUND"));\n  });\n',
    after:
      '    stderrBytes += chunk.length;\n    if (stderrBytes <= 4096) stderrChunks.push(chunk);\n    diagNote(\n      "helper-code",\n      performance.now(),\n      censusFailureCode(Buffer.concat(stderrChunks).toString("utf8")),\n    );\n    if (stderrBytes > 4096) deny(new Error("CENSUS_STDERR_BOUND"));\n  });\n',
  },
  {
    before:
      '  child.once("error", (error) => deny(error));\n  child.once("close", (code, signal) => {\n    joined = true;\n    closedValue = { code, signal };\n',
    after:
      '  child.once("error", (error) => deny(error));\n  child.once("close", (code, signal) => {\n    diagNote("child-close", performance.now(), code);\n    joined = true;\n    closedValue = { code, signal };\n',
  },
  {
    before:
      '    ready,\n    diagnostics: () => ({\n      code: censusFailureCode(Buffer.concat(stderrChunks).toString("utf8")),\n      stderrBytes,\n',
    after:
      '    ready,\n    diagnostics: () => ({\n      ...(failed || (closing && (!joined || closedValue?.code !== 0))\n        ? { failureWitness: failureWitness.result() }\n        : {}),\n      code: censusFailureCode(Buffer.concat(stderrChunks).toString("utf8")),\n      stderrBytes,\n',
  },
  {
    before:
      "      return new Promise((resolve, reject) => {\n        const id = ++request;\n        pending = {\n          id,\n",
    after:
      '      return new Promise((resolve, reject) => {\n        const id = ++request;\n        diagNote("request", begin, id, end);\n        pending = {\n          id,\n',
  },
  {
    before:
      '          reject,\n          timer: setTimeout(\n            () => deny(new Error("CENSUS_DEADLINE")),\n            Math.max(1, Math.floor(end - begin)),\n          ),\n',
    after:
      '          reject,\n          timer: setTimeout(\n            () => {\n              diagNote("timer", performance.now());\n              return deny(new Error("CENSUS_DEADLINE"));\n            },\n            Math.max(1, Math.floor(end - begin)),\n          ),\n',
  },
  {
    before:
      '        try {\n          child.stdin.write(JSON.stringify({ request: id }) + "\\n", (error) => {\n            if (error) deny(error);\n          });\n',
    after:
      '        try {\n          child.stdin.write(JSON.stringify({ request: id }) + "\\n", (error) => {\n            diagNote("write-callback", performance.now(), id, error ? 1 : 0);\n            if (error) deny(error);\n          });\n',
  },
  {
    before:
      "        };\n      } finally {\n        clearTimeout(timer);\n        if (!joined) {\n",
    after:
      '        };\n      } finally {\n        diagNote("close-finally", performance.now(), joined ? 1 : 0);\n        clearTimeout(timer);\n        if (!joined) {\n',
  },
];
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
function pin(raw, expected) {
  assert.equal(Buffer.byteLength(raw), expected.bytes);
  assert.equal(hash(raw), expected.sha256);
  assert.equal(blob(Buffer.from(raw)), expected.blob);
}
function transform(text, forward) {
  pin(text, forward ? BEFORE_WITNESS_CORE : CURRENT_WITNESS_CORE);
  let result = text;
  for (const pair of forward ? PAIRS : [...PAIRS].reverse()) {
    const before = forward ? pair.before : pair.after;
    const after = forward ? pair.after : pair.before;
    assert.equal(result.split(before).length, 2);
    result = result.replace(before, () => after);
  }
  pin(result, forward ? CURRENT_WITNESS_CORE : BEFORE_WITNESS_CORE);
  return result;
}
export const withoutCensusFailureWitnessCore = (text) => transform(text, false);
export const withCensusFailureWitnessCore = (text) => transform(text, true);

// An explicit whole historical endpoint, before applying strict mutation negatives.
export function beforeCensusWitnessCoreForHistory(text) {
  if (
    Buffer.byteLength(text) === BEFORE_WITNESS_CORE.bytes &&
    hash(text) === BEFORE_WITNESS_CORE.sha256
  )
    return text;
  return withoutCensusFailureWitnessCore(text);
}
function digest(rows) {
  return codeTreeDigest(rows.map((row) => ({ type: "blob", ...row })));
}
function shape(rows) {
  assert(
    Array.isArray(rows) &&
      rows.length === 132 &&
      new Set(rows.map((row) => row.path)).size === 132,
  );
  const value = digest(rows);
  assert([BEFORE_WITNESS_PRODUCER, CURRENT_WITNESS_PRODUCER].includes(value));
  return value;
}
function rewindRows(rows) {
  const matches = rows.filter((row) => row.path === CORE);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].mode, "100644");
  assert.equal(matches[0].sha, CURRENT_WITNESS_CORE.blob);
  const before = rows.map((row) =>
    row.path === CORE ? { ...row, sha: BEFORE_WITNESS_CORE.blob } : row,
  );
  assert.equal(digest(before), BEFORE_WITNESS_PRODUCER);
  return before;
}
export function beforeCensusWitnessRowsForHistory(rows, root) {
  if (shape(rows) === BEFORE_WITNESS_PRODUCER) return rows;
  const raw = execFileSync("git", ["cat-file", "blob", "HEAD:" + CORE], {
    cwd: root,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1 << 20,
  });
  pin(raw, CURRENT_WITNESS_CORE);
  withoutCensusFailureWitnessCore(raw.toString("utf8"));
  return rewindRows(rows);
}
export function beforeCensusWitnessDataForHistory(rows, files) {
  const value = shape(rows);
  assert(files instanceof Map && files.size === rows.length);
  for (const row of rows)
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  if (value === BEFORE_WITNESS_PRODUCER) return { rows, files };
  const previous = new Map(files);
  previous.set(
    CORE,
    Buffer.from(
      withoutCensusFailureWitnessCore(files.get(CORE).toString("utf8")),
    ),
  );
  const previousRows = rewindRows(rows);
  for (const row of previousRows)
    assert.equal(blob(previous.get(row.path)), row.sha, row.path);
  return { rows: previousRows, files: previous };
}
