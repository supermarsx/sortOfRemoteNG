import assert from "node:assert/strict";
import test from "node:test";
import {
  MAC_CENSUS_READY_WINDOW_MS,
  censusSlowKind,
  createCensusSlowPolicy,
  createRestartableCensus,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const timerWitness = {
  failureWitness: {
    first: { origin: "timer" },
    helperCode: "CENSUS_UNAVAILABLE",
  },
};
const worker = ({
  fail,
  failAt = 1,
  witness = timerWitness,
  clean = true,
  log,
}) => {
  let failed = false,
    calls = 0;
  return {
    async snapshot() {
      log.push("snapshot");
      if (fail && ++calls === failAt) {
        failed = true;
        throw fail;
      }
      return { rows: ["rows"] };
    },
    diagnostics: () => (failed ? witness : {}),
    cleanClose: () => clean,
    async close() {
      log.push("close");
      if (failed) throw fail;
    },
  };
};
const harness = (specs, { total, deadline = 100000 } = {}) => {
  const log = [],
    state = { poison: null, recovered: 0 },
    queue = [...specs];
  const open = async () => {
    const spec = queue.shift();
    log.push("open");
    if (spec.openFail) {
      state.poison = spec.openFail;
      throw spec.openFail;
    }
    const w = worker({ ...spec, log });
    const snapshot = w.snapshot;
    w.snapshot = async (o) => {
      try {
        return await snapshot(o);
      } catch (e) {
        state.poison = e;
        throw e;
      }
    };
    return w;
  };
  const recover = (error) => {
    assert.equal(state.poison, error);
    state.poison = null;
    state.recovered++;
  };
  return {
    log,
    state,
    make: () =>
      createRestartableCensus({
        open,
        recover,
        deadline,
        now: () => 0,
        policy: createCensusSlowPolicy(total === undefined ? {} : { total }),
      }),
  };
};
const slow = () => new Error("CENSUS_DEADLINE");

test("production ready window is sized for loaded runners", () => {
  assert(MAC_CENSUS_READY_WINDOW_MS >= 15000);
});

test("one slow snapshot restarts the worker and the failed request contributes nothing", async () => {
  const h = harness([{ fail: slow() }, {}]);
  const session = await h.make();
  assert.deepEqual(await session.snapshot({}), { rows: ["rows"] });
  assert.deepEqual(h.log, ["open", "snapshot", "close", "open", "snapshot"]);
  assert.equal(h.state.recovered, 1);
});

test("a second consecutive slow snapshot denies", async () => {
  const second = slow();
  const h = harness([{ fail: slow() }, { fail: second }]);
  const session = await h.make();
  await assert.rejects(session.snapshot({}), (e) => e === second);
  assert.equal(h.log.filter((x) => x === "open").length, 2);
});

test("aborts, other codes, unclean joins and low lease are never tolerated", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const [error, options, clean, deadline] of [
    [slow(), { signal: controller.signal }, true, 100000],
    [new Error("CENSUS_ABORT"), {}, true, 100000],
    [new Error("CENSUS_ROWS_BOUND"), {}, true, 100000],
    [slow(), {}, false, 100000],
    [slow(), {}, true, 3000],
  ]) {
    const h = harness([{ fail: error, clean }, {}], { deadline });
    const session = await h.make();
    await assert.rejects(session.snapshot(options), (e) => e === error);
    assert.equal(h.log.filter((x) => x === "open").length, 1);
    assert.equal(h.state.recovered, 0);
  }
});

test("a slow start is retried once and a second slow start denies", async () => {
  const ready = () => new Error("CENSUS_READY_DEADLINE");
  const ok = harness([{ openFail: ready() }, {}]);
  assert.deepEqual(await (await ok.make()).snapshot({}), { rows: ["rows"] });
  const second = ready();
  const bad = harness([{ openFail: ready() }, { openFail: second }]);
  await assert.rejects(bad.make(), (e) => e === second);
});

test("the total number of tolerated slow measurements is bounded", async () => {
  const h = harness([{ fail: slow() }, { fail: slow(), failAt: 2 }, {}], {
    total: 2,
  });
  const session = await h.make();
  await session.snapshot({});
  await session.snapshot({});
  assert.equal(h.state.recovered, 2);
  const last = slow();
  const h2 = harness([{ fail: slow() }, { fail: last, failAt: 2 }], {
    total: 1,
  });
  const s2 = await h2.make();
  await s2.snapshot({});
  await assert.rejects(s2.snapshot({}), (e) => e === last);
});

test("slow classification is closed over timer, late-frame and helper sysctl deadlines", () => {
  const remainingMs = 60000;
  const d = (first, helperCode = "CENSUS_UNAVAILABLE") => ({
    failureWitness: { first: { origin: first }, helperCode },
  });
  const eof = () => new Error("CENSUS_EOF");
  assert.equal(censusSlowKind(slow(), d("timer"), { remainingMs }), "snapshot");
  assert.equal(
    censusSlowKind(slow(), d("frame-deadline"), { remainingMs }),
    "snapshot",
  );
  assert.equal(
    censusSlowKind(eof(), d("helper-failure", "CENSUS_DEADLINE"), {
      remainingMs,
    }),
    "snapshot",
  );
  assert.equal(
    censusSlowKind(eof(), d("helper-failure", "CENSUS_ROOT"), { remainingMs }),
    null,
  );
  assert.equal(censusSlowKind(slow(), d("write-error"), { remainingMs }), null);
  assert.equal(censusSlowKind(slow(), {}, { remainingMs }), null);
  assert.equal(censusSlowKind(slow(), d("timer"), { remainingMs: 100 }), null);
  assert.equal(
    censusSlowKind("CENSUS_DEADLINE", d("timer"), { remainingMs }),
    null,
  );
});
