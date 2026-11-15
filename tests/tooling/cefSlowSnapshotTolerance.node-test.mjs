import assert from "node:assert/strict";
import test from "node:test";
import {
  compileMonitorRecord,
  createSlowSnapshotTolerance,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const failure = (code) =>
  compileMonitorRecord(new Error("Ownership snapshot deadline"), code);

test("a single slow ownership snapshot is retried and does not deny", async () => {
  const take = createSlowSnapshotTolerance();
  let calls = 0;
  const rows = await take(async () => {
    if (++calls === 1) throw failure("PS_DEADLINE");
    return ["rows"];
  });
  assert.deepEqual(rows, ["rows"]);
  assert.equal(calls, 2);
});

test("two consecutive slow ownership snapshots still deny", async () => {
  const take = createSlowSnapshotTolerance();
  let calls = 0;
  const first = failure("PS_DEADLINE"),
    second = failure("PS_DEADLINE");
  await assert.rejects(
    take(async () => {
      throw ++calls === 1 ? first : second;
    }),
    (error) => error === second,
  );
  assert.equal(calls, 2);
});

test("aborts and non-deadline failures are never retried", async () => {
  for (const code of ["PS_ABORT", "PROC_READ", "OWN_SURVIVED_EXIT"]) {
    const take = createSlowSnapshotTolerance();
    let calls = 0;
    await assert.rejects(
      take(async () => {
        calls++;
        throw failure(code);
      }),
    );
    assert.equal(calls, 1, code);
  }
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    createSlowSnapshotTolerance()(
      async () => {
        calls++;
        throw failure("PS_DEADLINE");
      },
      { signal: controller.signal },
    ),
  );
  assert.equal(calls, 1);
});

test("repeated tolerated hiccups stay bounded in total", async () => {
  const take = createSlowSnapshotTolerance({ total: 2 });
  for (let i = 0; i < 2; i++) {
    let calls = 0;
    await take(async () => {
      if (++calls === 1) throw failure("PS_DEADLINE");
      return [];
    });
  }
  let calls = 0;
  await assert.rejects(
    take(async () => {
      calls++;
      throw failure("PS_DEADLINE");
    }),
  );
  assert.equal(calls, 1);
});
