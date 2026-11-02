import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { codeTreeDigest } from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  BRANCH,
  WORKFLOW,
  CODE_DIGEST,
  authority,
  budget,
  validateReport,
  selectSuccess,
  failureCode,
  verifySubjectBytes,
  main,
} from "../fixtures/cef/linux_migration_proof_carrier.mjs";

const root = new URL("../../", import.meta.url);
const carrierURL = new URL(
  "../fixtures/cef/linux_migration_proof_carrier.mjs",
  import.meta.url,
);
const qualified = () => ({
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  ImageOS: "ubuntu24",
  ImageVersion: "20261026.354.1",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: BRANCH,
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_REF: WORKFLOW,
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
  RUNNER_TEMP: "/home/runner/work/_temp",
});
function report() {
  return {
    schemaVersion: 1,
    kind: "sorng-linux-owned-migration-proof",
    attempt: "d43d92e0-5cd3-4f50-9021-f048a00d779f",
    head: "a".repeat(40),
    runId: 12345,
    runAttempt: 1,
    complete: true,
    failurePhase: null,
    codeDigest: CODE_DIGEST,
    syntheticFixtureIdentity: true,
    syntheticArchiveEnvelope: true,
    GNExecuted: false,
    oldSealValidated: false,
    productionToolchainVerified: false,
    productionReadinessIssued: false,
    sourceMigrationAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
    literalLinks: 5,
    oldApplies: 2,
    samePhysicalSource: true,
    cacheUnchangedDuringRetirement: true,
    newRecordHashedFiles: 8,
    newRecordReusedFiles: 0,
    newCacheBinding: true,
    newVerified: true,
    oldCacheRejected: true,
    oldCacheFallbackHashedFiles: 8,
    oldCachePostcheckReusedFiles: 8,
    newCacheReuseObserved: true,
    retired: true,
    retirementReadback: true,
    sourceInodeCas: false,
    childJoinKnown: true,
    proofScopeRetired: true,
    descriptorsClosed: true,
    closeFailures: 0,
    fixtureRootRemoved: true,
    originalArchiveUnchanged: true,
    modifiedSourceDenied: true,
    restoredSourceVerified: true,
  };
}
function evidence(value = Object.freeze(report())) {
  return { fulfilled: true, returned: value, observed: value, previous: null };
}
test("authority requires the exact private Linux x64 host, image, source and token-free run", () => {
  authority(qualified(), "linux", "x64");
  for (const key of Object.keys(qualified()))
    assert.throws(
      () => authority({ ...qualified(), [key]: "foreign" }, "linux", "x64"),
      key,
    );
  for (const [platform, architecture] of [
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["win32", "x64"],
  ])
    assert.throws(() => authority(qualified(), platform, architecture));
  for (const changes of [
    { GITHUB_REF: "refs/heads/main" },
    {
      GITHUB_REF: "refs/heads/codex/linux-arm-a148-producer-migration-20261101",
    },
    {
      GITHUB_REF: "refs/heads/codex/linux-arm-3aa-producer-migration-20261102",
    },
    { ImageVersion: "20261021.278.1" },
    { GH_TOKEN: "SECRET" },
    { GITHUB_TOKEN: "SECRET" },
    { GITHUB_RUN_ID: "0" },
    { GITHUB_RUN_ATTEMPT: "1000" },
    { GITHUB_WORKFLOW_SHA: "b".repeat(40) },
  ])
    assert.throws(() =>
      authority({ ...qualified(), ...changes }, "linux", "x64"),
    );
});

test("actual carrier subject guard matches current committed bytes and rejects the historical size pin", async () => {
  const actual = Buffer.from(
    (
      await readFile(
        new URL("scripts/lib/cef-linux-producer-migration.mjs", root),
        "utf8",
      )
    ).replaceAll("\r\n", "\n"),
  );
  const committed = spawnSync(
    "git",
    ["show", "HEAD:scripts/lib/cef-linux-producer-migration.mjs"],
    {
      cwd: fileURLToPath(root),
      timeout: 10000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(committed.status, 0);
  assert.deepEqual(actual, committed.stdout);
  assert.equal(verifySubjectBytes(actual), undefined);
  assert.throws(() => verifySubjectBytes(Buffer.alloc(94129)), /SOURCE/);
  const changed = Buffer.from(actual);
  changed[0] ^= 1;
  assert.throws(() => verifySubjectBytes(changed), /SOURCE/);
  assert.throws(() => verifySubjectBytes({ length: actual.length }), /SOURCE/);
});
function historicalCarrierInverse(previous) {
  assert.equal(previous.split(CODE_DIGEST).length, 2);
  previous = previous.replace(
    CODE_DIGEST,
    "d060f671e8a784046f16cd50f8661da8c9883b623c376e23eccf2f4ccc4a9472",
  );
  const start = "// BEGIN current final-helper subject pin\n",
    end = "// END current final-helper subject pin\n";
  assert.equal(previous.split(start).length, 2);
  assert.equal(previous.split(end).length, 2);
  previous = previous.replace(
    previous.slice(previous.indexOf(start), previous.indexOf(end) + end.length),
    "",
  );
  const current = "      if (name === CORE) verifySubjectBytes(held.raw);\n";
  const original = String.raw`      if (name === CORE)
        need(
          held.raw.length === 94129 &&
            sha(held.raw) ===
              "5da6dd95dc4ad77d2822255880e27fc4052e00551a933e2cb1821c285043a8c3",
          "SOURCE",
        );
`;
  assert.equal(previous.split(current).length, 2);
  previous = previous.replace(current, original);
  assert.equal(Buffer.byteLength(previous), 18035);
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "5cc151384358108e6e46df52ba5c0c37770b77c44b22ec883486dda024d5001f",
  );
  return previous;
}
test("current composed carrier retarget preserves its complete historical pre-guard body", async () => {
  historicalCarrierInverse(
    (await readFile(carrierURL, "utf8")).replaceAll("\r\n", "\n"),
  );
});

function withoutMigrationDiagnostics(text) {
  const edits = [
    [
      "  installRestoredDirectory,\n  hostRemaining,\n  linuxArmRecipe,\n  linuxMigrationFailureRecord,\n  noLinks,\n  sha,\n  sourceMetadataResult,\n",
      "  installRestoredDirectory,\n  hostRemaining,\n  linuxArmRecipe,\n  noLinks,\n  sha,\n  sourceMetadataResult,\n",
    ],
    [
      '  need(live.revalidationUsed === state.gnUsed, "TRANSACTION_GN_ORDER");\n  return Math.min(live.remainingMilliseconds, state.originalTools.remaining());\n}\n// BEGIN closed Linux migration event output\nfunction migrationDiagnostic(record) {\n  try {\n    console.log(\n      "[cef-engineering-checkpoint] linux-migration " + canonical(record),\n    );\n  } catch {\n    /* Observer failures never replace the operation outcome. */\n  }\n}\nfunction migrationFailureDiagnostic(error, phase) {\n  try {\n    migrationDiagnostic(linuxMigrationFailureRecord(error, phase));\n  } catch {\n    /* Projection failure also cannot replace the first cause. */\n  }\n}\n// END closed Linux migration event output\n\nasync function transactionPhase(state, phase, action) {\n  state.diagnosticPhase = phase;\n  migrationDiagnostic({\n    kind: "sorng-linux-migration-phase",\n    phase,\n    event: "begin",\n  });\n  transactionCheck(state);\n  const result = await action();\n  transactionCheck(state); // Before any subsequent mutation/branding.\n  migrationDiagnostic({\n    kind: "sorng-linux-migration-phase",\n    phase,\n    event: "complete",\n  });\n  return result;\n}\nasync function transactionRecheck(state) {\n',
      '  need(live.revalidationUsed === state.gnUsed, "TRANSACTION_GN_ORDER");\n  return Math.min(live.remainingMilliseconds, state.originalTools.remaining());\n}\nasync function transactionPhase(state, action) {\n  transactionCheck(state);\n  const result = await action();\n  transactionCheck(state); // Before any subsequent mutation/branding.\n  return result;\n}\nasync function transactionRecheck(state) {\n',
    ],
    [
      '        "--seconds",\n        String(seconds),\n      ],\n      {\n        timeout,\n        observeFailure: (record) =>\n          migrationDiagnostic({\n            kind: "sorng-linux-migration-archive-failure",\n            phase: state.diagnosticPhase,\n            mode,\n            source: which,\n            record,\n          }),\n      },\n    ),\n    mode,\n  );\n',
      '        "--seconds",\n        String(seconds),\n      ],\n      { timeout },\n    ),\n    mode,\n  );\n',
    ],
    [
      '    }\n  };\n  try {\n    await transactionPhase(state, "controls", () => transactionControls(state));\n    await transactionPhase(state, "recheck-before-restore", () =>\n      transactionRecheck(state),\n    );\n    await transactionPhase(state, "restore-install", async () => {\n      state.creator = await restoreOwnedCommon(\n        selected,\n        tools,\n',
      "    }\n  };\n  try {\n    await transactionPhase(state, () => transactionControls(state));\n    await transactionPhase(state, () => transactionRecheck(state));\n    await transactionPhase(state, async () => {\n      state.creator = await restoreOwnedCommon(\n        selected,\n        tools,\n",
    ],
    [
      '        creators,\n      );\n    });\n    await transactionPhase(state, "recheck-before-apply-1", () =>\n      transactionRecheck(state),\n    );\n    await transactionPhase(state, "source-apply-1", () =>\n      transactionSourceMode(state, "source-apply", "old"),\n    );\n    await transactionPhase(state, "recheck-before-gn", () =>\n      transactionRecheck(state),\n    );\n    const receipt = await transactionPhase(\n      state,\n      "gn-revalidation",\n      async () => {\n        const pending = revalidateLinuxSourceOwner(context);\n        state.gnUsed = true;\n        return await pending;\n      },\n    );\n    const gn = assertLinuxSourceOwnerReceipt(context, receipt);\n    need(\n      gn.cohortQuietProven === true && gn.commandCompleted === true,\n      "TRANSACTION_GN_UNCONFIRMED",\n    );\n    await transactionPhase(state, "graph-verify", () =>\n      verifyGraph(originalTools.out, selected.freshIdentity.graph),\n    );\n    const recipe = await transactionPhase(state, "recipe-check", () =>\n      linuxArmRecipe(originalTools.chromium, originalTools.out),\n    );\n    need(\n      canonical(recipe) === originalTools.linuxRecipeJson,\n      "TRANSACTION_RECIPE_CHANGED",\n    );\n    await transactionPhase(state, "source-apply-2", () =>\n      transactionSourceMode(state, "source-apply", "old"),\n    );\n    await transactionPhase(state, "recheck-before-retirement", () =>\n      transactionRecheck(state),\n    );\n    transactionCheck(state);\n    assertLinuxSourceOwnerReceipt(context, receipt);\n    const created = creators.get(state.creator);\n',
      '        creators,\n      );\n    });\n    await transactionPhase(state, () => transactionRecheck(state));\n    await transactionPhase(state, () =>\n      transactionSourceMode(state, "source-apply", "old"),\n    );\n    await transactionPhase(state, () => transactionRecheck(state));\n    const receipt = await transactionPhase(state, async () => {\n      const pending = revalidateLinuxSourceOwner(context);\n      state.gnUsed = true;\n      return await pending;\n    });\n    const gn = assertLinuxSourceOwnerReceipt(context, receipt);\n    need(\n      gn.cohortQuietProven === true && gn.commandCompleted === true,\n      "TRANSACTION_GN_UNCONFIRMED",\n    );\n    await transactionPhase(state, () =>\n      verifyGraph(originalTools.out, selected.freshIdentity.graph),\n    );\n    const recipe = await transactionPhase(state, () =>\n      linuxArmRecipe(originalTools.chromium, originalTools.out),\n    );\n    need(\n      canonical(recipe) === originalTools.linuxRecipeJson,\n      "TRANSACTION_RECIPE_CHANGED",\n    );\n    await transactionPhase(state, () =>\n      transactionSourceMode(state, "source-apply", "old"),\n    );\n    await transactionPhase(state, () => transactionRecheck(state));\n    transactionCheck(state);\n    assertLinuxSourceOwnerReceipt(context, receipt);\n    const created = creators.get(state.creator);\n',
    ],
    [
      '      "TRANSACTION_READINESS",\n    );\n    retirementReadiness.delete(state.creator); // Consume BEFORE any retirement await.\n    await transactionPhase(state, "retirement", () =>\n      retireOwnedCommon(\n        state.creator,\n        tools,\n',
      '      "TRANSACTION_READINESS",\n    );\n    retirementReadiness.delete(state.creator); // Consume BEFORE any retirement await.\n    await transactionPhase(state, () =>\n      retireOwnedCommon(\n        state.creator,\n        tools,\n',
    ],
    [
      '        retired.sourceInodeCas === false,\n      "TRANSACTION_RETIREMENT_UNCONFIRMED",\n    );\n    await transactionPhase(state, "recheck-before-record", () =>\n      transactionRecheck(state),\n    );\n    const recorded = await transactionPhase(state, "source-record", () =>\n      transactionSourceMode(state, "source-record", "new"),\n    );\n    await transactionPhase(state, "record-check", () =>\n      transactionNewRecord(state, recorded),\n    );\n    await transactionPhase(state, "recheck-final", () =>\n      transactionRecheck(state),\n    );\n    result = {\n      sourceInputsRevalidated: true,\n      oldApplies: 2,\n',
      '        retired.sourceInodeCas === false,\n      "TRANSACTION_RETIREMENT_UNCONFIRMED",\n    );\n    await transactionPhase(state, () => transactionRecheck(state));\n    const recorded = await transactionPhase(state, () =>\n      transactionSourceMode(state, "source-record", "new"),\n    );\n    await transactionPhase(state, () => transactionNewRecord(state, recorded));\n    await transactionPhase(state, () => transactionRecheck(state));\n    result = {\n      sourceInputsRevalidated: true,\n      oldApplies: 2,\n',
    ],
    [
      "      completeCacheStructureValidated: false,\n    };\n  } catch (error) {\n    migrationFailureDiagnostic(error, state.diagnosticPhase);\n    remember(error);\n  }\n  // Revoke every authority synchronously before any awaited close/join. Retain\n",
      "      completeCacheStructureValidated: false,\n    };\n  } catch (error) {\n    remember(error);\n  }\n  // Revoke every authority synchronously before any awaited close/join. Retain\n",
    ],
    [
      '    try {\n      await closing;\n    } catch (error) {\n      migrationFailureDiagnostic(error, "cleanup");\n      remember(error);\n    }\n  if (!failed) {\n',
      "    try {\n      await closing;\n    } catch (error) {\n      remember(error);\n    }\n  if (!failed) {\n",
    ],
    [
      '    );\n    return completion; // No await after the final live/private-context check.\n  } catch (error) {\n    migrationFailureDiagnostic(error, "completion");\n    if (completion !== undefined)\n      completedMigrationTransactions.delete(completion);\n    throw error;\n',
      "    );\n    return completion; // No await after the final live/private-context check.\n  } catch (error) {\n    if (completion !== undefined)\n      completedMigrationTransactions.delete(completion);\n    throw error;\n",
    ],
  ];
  for (const [current, previous] of edits) {
    assert.equal(
      text.split(current).length,
      2,
      "one exact migration diagnostic inverse",
    );
    text = text.replace(current, previous);
  }
  assert.equal(Buffer.byteLength(text), 120138);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "e0f41bed510701a6461214cbf66971af25c131dde98fcff842957f20ba4abce3",
  );
  return text;
}

function qualifiedFinalHelperModule(text) {
  text = withoutMigrationDiagnostics(text);
  {
    const current =
      '    bytes: 208244,\n    sha256: "a41a4d3f42a46801d5114a450eb28b3331a95548783502333eab39e10c730e64",';
    const previous =
      '    bytes: 203191,\n    sha256: "3be8d4b159293e677d0d49ce7b6f09f661363481db655f936e436f694a9ef8b8",';
    assert.equal(text.split(current).length, 2);
    text = text.replace(current, previous);
    assert.equal(Buffer.byteLength(text), 120138);
    assert.equal(
      createHash("sha256").update(text).digest("hex"),
      "a7ddc2e84df50128cefa69d4a4a57613f45b8f06fea3b2fbf78b491b65dd8d4f",
    );
  }
  const clock = `  const tools = {
    ...originalTools,
    remaining: () => Math.floor(transactionCheck(state)),
  };`;
  assert.equal(text.split(clock).length, 2);
  text = text.replace(
    clock,
    "  const tools = { ...originalTools, remaining: () => transactionCheck(state) };",
  );
  assert.equal(Buffer.byteLength(text), 120115);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "f79bc80ac6ed697ab7115d19b636f6fec6118e8a2e69fe80b7218eb955aebe45",
  );
  const current =
    "// Fixed Linux migration: only the context-bound complete transaction can execute.\n// Standalone preparation APIs stay closed; matching JSON grants no authority.\n";
  const previous =
    "// Inactive preparation only. No API in this module authorizes a migration,\n// retires a sidecar, weakens validateManifest, or creates a compile proof.\n";
  assert.equal(text.split(current).length, 2);
  assert.equal(text.split("const TRANSACTION_ADMITTED = true;").length, 2);
  text = text
    .replace(current, previous)
    .replace(
      "const TRANSACTION_ADMITTED = true;",
      "const TRANSACTION_ADMITTED = false;",
    );
  assert.equal(Buffer.byteLength(text), 120106);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "6105e6215636258128a77038ee8eb3e07f336a442cef5bfabaa2ed445bef5995",
  );
  for (const name of [
    "closed migration CLI source delta",
    "closed migration CLI data and completion",
  ]) {
    const indent = name.endsWith("source delta") ? "  " : "";
    const begin = indent + "// BEGIN " + name + "\n",
      end = indent + "// END " + name + "\n";
    assert.equal(text.split(begin).length, 2);
    assert.equal(text.split(end).length, 2);
    const block = text.slice(
      text.indexOf(begin),
      text.indexOf(end) + end.length,
    );
    text = text.replace(block + (indent ? "" : "\n"), "");
  }
  assert.equal(Buffer.byteLength(text), 114826);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "3cb94d746b48fa030c3a8f300c65f043f83296849d281c5149c87c2eea45e275",
  );
  return text;
}

test("final-helper retarget restores the complete2dbe core through exactly three pins without ancestor lookup", async () => {
  assert.equal(
    BRANCH,
    "refs/heads/codex/linux-arm-final-helper-proof-20261102",
  );
  assert.equal(
    CODE_DIGEST,
    "0ebae8f031b3d8900efdd752abaa8520634a53e7abc4ac58bdec935d27ce0d79",
  );
  const physical = await readFile(
    new URL("scripts/lib/cef-linux-producer-migration.mjs", root),
  );
  let previous = qualifiedFinalHelperModule(
    physical.toString().replaceAll("\r\n", "\n"),
  );
  for (const [current, old] of [
    [
      '  branch: "refs/heads/codex/linux-arm-final-helper-proof-20261102",',
      '  branch: "refs/heads/codex/linux-arm-3aa-producer-migration-20261102",',
    ],
    ["    bytes: 203191,", "    bytes: 181586,"],
    [
      '    sha256: "3be8d4b159293e677d0d49ce7b6f09f661363481db655f936e436f694a9ef8b8",',
      '    sha256: "839ed8a3be5f81dd7778bf7fb4d76209d7e64342ec9387dc323d5c280098165d",',
    ],
  ]) {
    assert.equal(previous.split(current).length, 2);
    previous = previous.replace(current, old);
  }
  assert.equal(Buffer.byteLength(previous), 114830);
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "7c2533d579f789701bf4dbbd5fa17c314b7b3c57158ee738e499d2276ef96c2e",
  );
});
test("the final producer digest binds all actual131 committed selected rows", async () => {
  const listed = spawnSync(
    "git",
    [
      "ls-tree",
      "-r",
      "HEAD",
      "--",
      "scripts",
      "native/cef-hosted-recipe.json",
      ".node-version",
      ".github/workflows/cef-engineering-checkpoint.yml",
    ],
    {
      cwd: fileURLToPath(root),
      timeout: 10000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(listed.status, 0);
  const rows = [];
  for (const line of listed.stdout.toString().trim().split("\n")) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    assert(match);
    const [, mode, committed, path] = match;
    const raw = await readFile(new URL(path, root));
    const canonical = Buffer.from(raw.toString().replaceAll("\r\n", "\n"));
    const sha = createHash("sha1")
      .update(Buffer.from(`blob ${canonical.length}\0`))
      .update(canonical)
      .digest("hex");
    assert.equal(sha, committed, path);
    rows.push({ type: "blob", mode, sha, path });
  }
  assert.equal(rows.length, 131);
  assert.equal(codeTreeDigest(rows), CODE_DIGEST);
});
test("the unchanged original five-minute start reserves cleanup and never resets the core lease", () => {
  assert.deepEqual(budget(100000, 100000), {
    wholeJobRemaining: 300000,
    coreMaximum: 160000,
  });
  assert.deepEqual(budget(100000, 300000), {
    wholeJobRemaining: 100000,
    coreMaximum: 70000,
  });
  assert.deepEqual(budget(100000, 369999), {
    wholeJobRemaining: 30001,
    coreMaximum: 1,
  });
  for (const pair of [
    [100000, 370000],
    [100000, 99999],
    [0, 100000],
    [NaN, 1],
    [1, Infinity],
  ])
    assert.throws(() => budget(...pair));
});
test("success needs this fulfilled run and the fresh frozen observation pointer", () => {
  const value = Object.freeze(report());
  assert.equal(
    selectSuccess(evidence(value), qualified()).attempt,
    value.attempt,
  );
  for (const changes of [
    { fulfilled: false },
    { fulfilled: undefined },
    { returned: { ...value } },
    { observed: Object.freeze({ ...value }) },
    { previous: value },
  ])
    assert.throws(() =>
      selectSuccess({ ...evidence(value), ...changes }, qualified()),
    );
  assert.throws(
    () => selectSuccess(evidence(report()), qualified()),
    /STALE_REPORT/,
  );
  // A complete diagnostic after a rejected promise cannot rescue the run.
  assert.throws(
    () => selectSuccess({ ...evidence(value), fulfilled: false }, qualified()),
    /RUN_REJECTED/,
  );
});
test("every proof fact and no-admission claim is required, with exact counters and identities", () => {
  for (const [key, value] of Object.entries(report())) {
    let changed;
    if (typeof value === "boolean") changed = !value;
    else if (typeof value === "number") changed = value + 1;
    else changed = value === null ? "cleanup" : "foreign";
    const row = Object.freeze({ ...report(), [key]: changed });
    assert.throws(() => selectSuccess(evidence(row), qualified()), key);
  }
  for (const changes of [
    {
      newRecordHashedFiles: 0,
      oldCacheFallbackHashedFiles: 0,
      oldCachePostcheckReusedFiles: 0,
    },
    {
      newRecordHashedFiles: 3000001,
      oldCacheFallbackHashedFiles: 3000001,
      oldCachePostcheckReusedFiles: 3000001,
    },
    { newRecordHashedFiles: 1.5 },
    { newRecordReusedFiles: null },
    { retired: null },
    { head: "b".repeat(40) },
    { codeDigest: null },
    { extra: "SECRET" },
  ])
    assert.throws(() =>
      selectSuccess(
        evidence(Object.freeze({ ...report(), ...changes })),
        qualified(),
      ),
    );
});
test("a failed partial observation remains bounded diagnostic data and never becomes success", () => {
  const value = Object.freeze({
    ...report(),
    complete: false,
    failurePhase: "restore",
    codeDigest: null,
    newRecordReusedFiles: null,
    retired: null,
    fixtureRootRemoved: false,
  });
  assert.equal(validateReport(value, qualified()).failurePhase, "restore");
  assert.throws(
    () => selectSuccess(evidence(value), qualified()),
    /INCOMPLETE/,
  );
  for (const changes of [
    { failurePhase: "SECRET /private/path" },
    { closeFailures: -1 },
    { GNExecuted: true },
    { syntheticFixtureIdentity: false },
    { attempt: "../outside" },
  ])
    assert.throws(() => validateReport({ ...value, ...changes }, qualified()));
});
test("schema accessors are rejected without reading them; failures never inspect thrown text", () => {
  const value = report();
  Object.defineProperty(value, "head", {
    enumerable: true,
    get() {
      throw Error("SECRET");
    },
  });
  assert.throws(() => validateReport(value, qualified()), /REPORT_SCHEMA/);
  const hostile = Object.create(null, {
    message: {
      get() {
        throw Error("SECRET");
      },
    },
  });
  for (const thrown of [
    hostile,
    new Error("SECRET /private/path"),
    "SECRET",
    null,
    undefined,
    false,
    0,
  ])
    assert.equal(failureCode(thrown), "OPERATION");
  try {
    authority(qualified(), "linux", "arm64");
  } catch (error) {
    assert.equal(failureCode(error), "HOST");
  }
});
test("extra arguments reject before the entry can perform host, Git, import or filesystem work", async () => {
  await assert.rejects(main("foreign"), /ARGUMENTS/);
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(carrierURL), "foreign"],
    {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: "SECRET", GITHUB_TOKEN: "SECRET" },
      timeout: 5000,
    },
  );
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.equal(
    child.stderr.trim(),
    "LINUX_MIGRATION_PRIVATE_PROOF_DENIED ARGUMENTS",
  );
  assert(!child.stderr.includes("SECRET"));
});
test("actual carrier awaits the real entry, seals its own Git bytes, and writes only owned bounded reports", async () => {
  const source = await readFile(carrierURL, "utf8");
  assert.match(
    source,
    /returned = await core\.runLinuxMigrationOwnedProof\(\);\s+fulfilled = true;/,
  );
  assert.match(
    source,
    /observed = core\.readLinuxMigrationProofObservation\(\);\s+proof = selectSuccess/,
  );
  assert.match(source, /held\.raw\.equals\(git\(\["show", "HEAD:" \+ name\]/);
  assert.match(source, /\[SELF, CORE\]/);
  assert.match(source, /if \(name === CORE\) verifySubjectBytes\(held\.raw\)/);
  assert(
    source.indexOf("authority(process.env") <
      source.indexOf('git(["rev-parse"'),
  );
  assert(
    source.indexOf('git(["rev-parse"') < source.indexOf("await fs.mkdir(root"),
  );
  assert(
    source.indexOf("held.raw.equals") < source.indexOf("core = await import"),
  );
  assert.match(
    source,
    /O_CREAT\s*\|\s*constants\.O_EXCL\s*\|\s*constants\.O_RDWR\s*\|\s*constants\.O_NOFOLLOW/,
  );
  assert.match(source, /total <= MAX_REPORT/);
  assert.match(source, /carrier\.json,proof\.json/);
  assert.match(source, /readback\.equals\(raw\)/);
  assert.match(source, /reportWriterClosureRequiresSuccessfulStep: true/);
  assert.match(source, /if \(failed\) throw primary;/);
  assert.doesNotMatch(
    source,
    /Promise\.race|exec\(|shell:|readLinuxMigrationProofObservation\([^)]\S[^)]*\)/,
  );
});
test("workflow registration is inert on main and preserves the first clock, fixed actions and exact two files", async () => {
  const source = await readFile(
    new URL(".github/workflows/cef-linux-producer-migration-proof.yml", root),
    "utf8",
  );
  const workflow = YAML.parse(source);
  assert.deepEqual(workflow.on, { workflow_dispatch: null });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.proof;
  for (const literal of [
    BRANCH,
    "workflow_dispatch",
    "supermarsx/sortOfRemoteNG",
    "1010282954",
    "public",
  ])
    assert(job.if.includes(literal));
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 5);
  assert.match(
    job.steps[0].run,
    /^echo "CEF_LINUX_MIGRATION_PROOF_STARTED_MS=/,
  );
  assert.equal(
    job.steps[1].uses,
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
  );
  assert.deepEqual(job.steps[1].with, {
    ref: "${{ github.sha }}",
    "persist-credentials": false,
  });
  assert.equal(
    job.steps[2].uses,
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  );
  assert.deepEqual(job.steps[2].with, {
    "node-version-file": ".node-version",
    "package-manager-cache": false,
  });
  assert.equal(
    job.steps[3].run,
    "node tests/fixtures/cef/linux_migration_proof_carrier.mjs",
  );
  assert.equal(job.steps[3]["timeout-minutes"], 4);
  assert.equal(
    job.steps[4].uses,
    "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  );
  assert.equal(
    job.steps[4].with.path.trim(),
    "${{ steps.proof.outputs.root }}/proof.json\n${{ steps.proof.outputs.root }}/carrier.json",
  );
  assert.equal(job.steps[4].if, "always() && steps.proof.outputs.root != ''");
  assert.doesNotMatch(
    source,
    /npm|GH_TOKEN|GITHUB_TOKEN|contents: write|actions: write|restore_run|\*\.json/,
  );
  const ci = YAML.parse(
    await readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
  );
  const checks = Object.values(ci.jobs)
    .flatMap((entry) => entry.steps ?? [])
    .filter(
      (step) =>
        step.name === "Runtime package layout and whole-matrix contract",
    );
  assert.equal(checks.length, 1);
  for (const name of [
    "cefLinuxProducerMigration.node-test.mjs",
    "cefLinuxMigrationProof.node-test.mjs",
  ])
    assert.equal(
      checks[0].run
        .split(" ")
        .filter((word) => word === "tests/tooling/" + name).length,
      1,
    );
});
