import { beforeAvfCompatDataForHistory } from "./cefAvfCompatibilityReviewedHistory.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

// Closed test DATA only: no source, process, graph, SDK or native authority.
// This outermost layer rewinds the one reviewed change to the production Mac
// census session (loaded-runner ready window and a bounded, restartable
// session that tolerates a transient slow start or slow snapshot) to the
// slow-snapshot producer reviewed before it. It never grants a runtime
// exception and every unreviewed byte, mode, path or row is refused.
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
const DATA = Object.freeze({
  after: {
    bytes: 282152,
    sha256: "447098a06fb8501eb213d54daee7202e2413b7900f878bf99d69f5ece036b591",
    blob: "7d4658c00133ad4b3098cfffbee4d860eb40e1c7",
  },
  before: {
    bytes: 277140,
    sha256: "0ec87c9956ce5d9a6367ba8935386472e216a78caef40f07501c29503818087b",
    blob: "d4053a931f55e0ba5884963f4ec6dcc95654169f",
  },
  pairs: [
    {
      previous:
        '}\nasync function openCensusSession(\n  factory,\n  { deadline, workMilliseconds, phase, startupDeadline = deadline },\n) {\n  const startupEnd = Math.min(\n    deadline,\n    startupDeadline,\n    performance.now() + 2000,\n  );\n  const binding = macCensusFactories.get(factory);\n  assert(\n    binding && !binding.failed && !binding.active && binding.sessions < 16,\n    "CENSUS_CAPABILITY",',
      current:
        '}\n// Production sessions run on loaded hosted runners where starting the pinned\n// Python helper can take well over 2 s; integration-proof sessions keep the\n// original 2 s window. A slow start is retried at most once (see below).\nexport const MAC_CENSUS_READY_WINDOW_MS = 20000;\nexport const MAC_CENSUS_READONLY_MS = 60000;\nexport const MAC_CENSUS_SLOW_TOTAL_BOUND = 3;\nexport const MAC_CENSUS_RESTART_MARGIN_MS = 5000;\nasync function openCensusWorker(\n  factory,\n  { deadline, workMilliseconds, phase, startupDeadline = deadline },\n) {\n  const binding = macCensusFactories.get(factory);\n  const startupEnd = Math.min(\n    deadline,\n    startupDeadline,\n    performance.now() +\n      (binding?.proofOnly ? 2000 : MAC_CENSUS_READY_WINDOW_MS),\n  );\n  assert(\n    binding &&\n      !binding.failed &&\n      !binding.active &&\n      binding.sessions < 16 + (binding.restarts ?? 0),\n    "CENSUS_CAPABILITY",',
    },
    {
      previous:
        "    let closed = false,\n      closingPromise;\n    const deny = (error) => {\n      binding.failed ??= error;\n      return binding.failed;\n    };\n    const session = {\n      diagnostics: () => Object.freeze(client.diagnostics()),",
      current:
        "    let closed = false,\n      cleanClose = false,\n      closingPromise;\n    const deny = (error) => {\n      binding.failed ??= error;\n      return binding.failed;\n    };\n    const session = {\n      cleanClose: () => cleanClose,\n      diagnostics: () => Object.freeze(client.diagnostics()),",
    },
    {
      previous:
        '            assert(performance.now() < closeDeadline, "CENSUS_DEADLINE");\n          } catch (error) {',
      current:
        '            assert(performance.now() < closeDeadline, "CENSUS_DEADLINE");\n            cleanClose = result.joined === true;\n          } catch (error) {',
    },
    {
      previous: "  }\n}",
      current:
        '  }\n}\n// One transient slow census measurement on a loaded runner is a hiccup, not\n// proof of a leaked process. A restartable session tolerates a bounded number\n// of them: the failed worker is joined and removed, a fresh worker is started\n// and the single failed request is repeated once. A failed request never\n// contributes rows; a second consecutive failure, an abort, any other failure\n// code or an unclean worker cleanup is denied exactly as before.\nexport function createCensusSlowPolicy({\n  total = MAC_CENSUS_SLOW_TOTAL_BOUND,\n} = {}) {\n  let tolerated = 0;\n  return Object.freeze({\n    take() {\n      if (tolerated >= total) return false;\n      tolerated++;\n      return true;\n    },\n    tolerated: () => tolerated,\n  });\n}\n// Closed classification of a failed census worker: only a start that missed\n// its ready window or a request that missed its 2 s bound (client timer, late\n// frame or the helper\'s own sysctl bound) is slowness; everything else is not.\nexport function censusSlowKind(error, diagnostics, { remainingMs } = {}) {\n  try {\n    if (utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n      return null;\n    const message = Object.getOwnPropertyDescriptor(error, "message")?.value;\n    if (\n      !Number.isFinite(remainingMs) ||\n      remainingMs < MAC_CENSUS_RESTART_MARGIN_MS\n    )\n      return null;\n    if (message === "CENSUS_READY_DEADLINE") return "ready";\n    const witness = diagnostics?.failureWitness;\n    const origin = witness?.first?.origin;\n    if (\n      message === "CENSUS_DEADLINE" &&\n      (origin === "timer" || origin === "frame-deadline")\n    )\n      return "snapshot";\n    if (\n      message === "CENSUS_EOF" &&\n      origin === "helper-failure" &&\n      witness.helperCode === "CENSUS_DEADLINE"\n    )\n      return "snapshot";\n  } catch {\n    /* Hostile or malformed failure: never slowness. */\n  }\n  return null;\n}\nexport async function createRestartableCensus({\n  open,\n  deadline,\n  policy = createCensusSlowPolicy(),\n  recover,\n  now = () => performance.now(),\n}) {\n  assert(\n    typeof open === "function" &&\n      typeof recover === "function" &&\n      Number.isFinite(deadline),\n    "CENSUS_CAPABILITY",\n  );\n  const startFresh = async () => {\n    try {\n      return await open();\n    } catch (error) {\n      if (\n        censusSlowKind(error, null, { remainingMs: deadline - now() }) !==\n          "ready" ||\n        !policy.take()\n      )\n        throw error;\n      recover(error); // Throws unless this exact failure is the only poison.\n    }\n    return open();\n  };\n  let current = await startFresh(),\n    restarting = null,\n    closed = false;\n  const session = {\n    diagnostics: () => current.diagnostics(),\n    async snapshot(options = {}) {\n      try {\n        return await current.snapshot(options);\n      } catch (error) {\n        if (\n          closed ||\n          options.signal?.aborted ||\n          censusSlowKind(error, current.diagnostics(), {\n            remainingMs: (options.deadline ?? deadline) - now(),\n          }) !== "snapshot" ||\n          !policy.take()\n        )\n          throw error;\n        restarting = (async () => {\n          try {\n            await current.close();\n          } catch {\n            /* The failed worker\'s own failure is the one being tolerated. */\n          }\n          // A worker that did not join cleanly is never tolerated.\n          if (current.cleanClose() !== true) throw error;\n          recover(error);\n          current = await open();\n        })();\n        try {\n          await restarting;\n        } finally {\n          restarting = null;\n        }\n        return current.snapshot(options);\n      }\n    },\n    async close(closeDeadline) {\n      closed = true;\n      if (restarting) await restarting.catch(() => {});\n      return current.close(closeDeadline);\n    },\n  };\n  return session;\n}\nasync function openCensusSession(factory, options) {\n  const binding = macCensusFactories.get(factory);\n  if (!binding || binding.proofOnly) return openCensusWorker(factory, options);\n  const session = await createRestartableCensus({\n    open: () => openCensusWorker(factory, options),\n    deadline: options.deadline,\n    recover: (error) => {\n      assert(binding.failed === error, "CENSUS_CAPABILITY");\n      binding.failed = null;\n      binding.restarts = (binding.restarts ?? 0) + 1;\n    },\n  });\n  macCensusSessions.add(session);\n  return session;\n}',
    },
    {
      previous:
        "      const deadline = Math.min(\n        options.deadline ?? performance.now() + COMPILE_CLEANUP_MS,\n        factory.deadline,",
      current:
        "      const deadline = Math.min(\n        options.deadline ?? performance.now() + MAC_CENSUS_READONLY_MS,\n        factory.deadline,",
    },
  ],
  currentProducer:
    "25da34d744501f1499a6a18aebc971a3790d94ffbbf98e7c7409179013252c1d",
  beforeProducer:
    "37507e5317fedd21bbd7eeec936d0c824c6645c0cf4dc151162d836b43d6868f",
});
export const CURRENT_CENSUS_RESTART_PRODUCER = DATA.currentProducer;
export const BEFORE_CENSUS_RESTART_PRODUCER = DATA.beforeProducer;
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
const digest = (rows) =>
  codeTreeDigest(rows.map((row) => ({ type: "blob", ...row })));
function pin(raw, expected) {
  assert(Buffer.isBuffer(raw));
  assert.equal(raw.length, expected.bytes);
  assert.equal(sha(raw), expected.sha256);
  assert.equal(blob(raw), expected.blob);
}
export function inverseCensusRestartFile(raw, file) {
  assert.equal(file, CORE, "Unreviewed census-restart historical file");
  pin(raw, DATA.after);
  let text = raw.toString("utf8");
  for (const pair of [...DATA.pairs].reverse()) {
    assert.equal(text.split(pair.current).length, 2);
    text = text.replace(pair.current, () => pair.previous);
  }
  const previous = Buffer.from(text);
  pin(previous, DATA.before);
  return previous;
}
export function beforeCensusRestartFileForHistory(raw, file) {
  return file === CORE &&
    raw.length === DATA.after.bytes &&
    sha(raw) === DATA.after.sha256
    ? inverseCensusRestartFile(raw, file)
    : raw;
}
export function isCensusRestartProducer(rows) {
  return (
    Array.isArray(rows) &&
    rows.length === 132 &&
    digest(rows) === CURRENT_CENSUS_RESTART_PRODUCER
  );
}
export function rewindCensusRestartRows(rows) {
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  assert.equal(digest(rows), CURRENT_CENSUS_RESTART_PRODUCER);
  const result = rows.map((row) => {
    if (row.path !== CORE) return row;
    assert.equal(row.mode, "100644");
    assert.equal(row.sha, DATA.after.blob);
    return { ...row, sha: DATA.before.blob };
  });
  assert.equal(digest(result), BEFORE_CENSUS_RESTART_PRODUCER);
  return result;
}
// Rows and complete file bytes together; any other producer passes unchanged.
export function beforeCensusRestartDataForHistory(rows, files) {
  ({ rows, files } = beforeAvfCompatDataForHistory(rows, files));
  if (!isCensusRestartProducer(rows)) return { rows, files };
  assert(files instanceof Map && files.size === rows.length);
  for (const row of rows)
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  const previous = new Map(files);
  previous.set(CORE, inverseCensusRestartFile(files.get(CORE), CORE));
  const previousRows = rewindCensusRestartRows(rows);
  for (const row of previousRows)
    assert.equal(blob(previous.get(row.path)), row.sha, row.path);
  return { rows: previousRows, files: previous };
}
