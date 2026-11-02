import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as core from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import * as migration from "../../scripts/lib/cef-linux-producer-migration.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MODULE = path.join(ROOT, "scripts/lib/cef-linux-producer-migration.mjs");
const M = migration.LINUX_MIGRATION;
function withoutRecordNormalization(text) {
  for (const name of ["rehold", "normalization"]) {
    const first = `  ${name === "rehold" ? "  " : ""}// BEGIN exact source-record sentinel ${name}\n`;
    const last = `  ${name === "rehold" ? "  " : ""}// END exact source-record sentinel ${name}\n`;
    assert.equal(text.split(first).length, 2);
    assert.equal(text.split(last).length, 2);
    text = text.replace(
      text.slice(text.indexOf(first), text.indexOf(last) + last.length),
      "",
    );
  }
  const current = "      recorded.timing.hashedFiles <= recorded.entries,\n";
  assert.equal(text.split(current).length, 2);
  text = text.replace(
    current,
    "      recorded.timing.hashedFiles <= recorded.entries &&\n      recorded.timing.hashedBytes === recorded.bytes,\n",
  );
  assert.equal(Buffer.byteLength(text), 121802);
  assert.equal(
    core.sha(text),
    "1bc8994f15a9a54357046046ed7d9864ab2775375635651b16ea1ef206e1f311",
  );
  return text;
}
function withoutCliModuleDelta(text) {
  for (const name of [
    "closed migration CLI source delta",
    "closed migration CLI data and completion",
  ]) {
    const indent = name.endsWith("source delta") ? "  " : "";
    const start = `${indent}// BEGIN ${name}\n`;
    const end = `${indent}// END ${name}\n`;
    assert.equal(text.split(start).length, 2);
    assert.equal(text.split(end).length, 2);
    const block = text.slice(
      text.indexOf(start),
      text.indexOf(end) + end.length,
    );
    text = text.replace(block + (indent ? "" : "\n"), "");
  }
  return text;
}
function withoutMigrationDiagnostics(text) {
  text = withoutRecordNormalization(text);
  {
    const current =
        '    bytes: 209272,\n    sha256: "1a8388c61458686cd1afccba934bfb2a2d5ccedde5de33d2b0fd0f70b9db85c8",',
      previous =
        '    bytes: 208244,\n    sha256: "a41a4d3f42a46801d5114a450eb28b3331a95548783502333eab39e10c730e64",';
    assert.equal(text.split(current).length, 2);
    text = text.replace(current, previous);
    assert.equal(Buffer.byteLength(text), 121802);
    assert.equal(
      createHash("sha256").update(text).digest("hex"),
      "a465fd796f31a7f58cb45d48c39c4f8d646c73b6fc00cbf0892ed92cafa0ca65",
    );
  }

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

function withoutTransactionAdmission(text) {
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
      core.sha(text),
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
    core.sha(text),
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
    core.sha(text),
    "6105e6215636258128a77038ee8eb3e07f336a442cef5bfabaa2ed445bef5995",
  );
  return text;
}

test("closed transaction activation preserves the complete qualified pipeline and leaves standalone preparation closed", async () => {
  const text = (await fs.readFile(MODULE, "utf8")).replaceAll("\r\n", "\n");
  assert.equal(
    core.sha(
      withoutFinalHelperProofDelta(
        withoutCliModuleDelta(withoutTransactionAdmission(text)),
      ),
    ),
    "7c2533d579f789701bf4dbbd5fa17c314b7b3c57158ee738e499d2276ef96c2e",
  );
  assert(text.includes("const TRANSACTION_ADMITTED = true;"));
  assert(text.includes("const PREPARATION_ONLY = true;"));
  let reads = 0;
  const forged = new Proxy(
    {},
    {
      get() {
        reads++;
        throw Error("untrusted token");
      },
    },
  );
  await assert.rejects(
    migration.prepareLinuxMigrationRestore(forged, forged),
    /OPAQUE_CANDIDATE/,
  );
  await assert.rejects(
    migration.prepareLinuxMigrationRetirement(forged, forged),
    /OPAQUE_CREATOR/,
  );
  assert.equal(reads, 0);
  await assert.rejects(
    migration.readLinuxMigrationSelection({ policy: {} }),
    /SELECTION_ARGUMENTS/,
  );
});

test("CLI completion consumption is synchronous, context-bound and single-use across retired continuations", async () => {
  const completedMigrationTransactions = new WeakMap();
  const context = {},
    foreign = {};
  let live = {
    target: M.target,
    sourceLockIdentity: M.source,
    revalidationUsed: true,
    initialCohortQuietProven: true,
  };
  let retired = false;
  const primary = Error("original owner retired");
  const api = await privateFunctions(
    ["need", "transactionCompletionBinding", "consumeLinuxMigrationCompletion"],
    {
      canonical: core.canonical,
      completedMigrationTransactions,
      assertLiveLinuxSourceContext: (value) => {
        assert.equal(value, context);
        if (retired) throw primary;
        return live;
      },
    },
  );
  const issue = () => {
    const completion = Object.freeze({ authorizing: false });
    completedMigrationTransactions.set(completion, {
      context,
      sourceBinding: api.transactionCompletionBinding(live),
      result: Object.freeze({
        newCacheHeaderBinding: true,
        completeCacheStructureValidated: false,
      }),
    });
    return completion;
  };
  const completion = issue();
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, {}),
    /COMPLETION_CONTEXT/,
  );
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(foreign, completion),
    /COMPLETION_CONTEXT/,
  );
  assert(completedMigrationTransactions.has(completion));
  live = { ...live, revalidationUsed: false };
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, completion),
    /COMPLETION_CONTEXT/,
  );
  live = { ...live, revalidationUsed: true, initialCohortQuietProven: false };
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, completion),
    /COMPLETION_CONTEXT/,
  );
  live = {
    ...live,
    initialCohortQuietProven: true,
    canonicalRoot: "/replacement",
  };
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, completion),
    /COMPLETION_CONTEXT/,
  );
  delete live.canonicalRoot;
  retired = true;
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, completion),
    (error) => error === primary,
  );
  retired = false;
  const result = api.consumeLinuxMigrationCompletion(context, completion);
  assert(!(result instanceof Promise));
  assert(Object.isFrozen(result));
  assert.equal(result.completeCacheStructureValidated, false);
  assert(!completedMigrationTransactions.has(completion));
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, completion),
    /COMPLETION_CONTEXT/,
  );
  const late = issue();
  await Promise.resolve();
  retired = true;
  assert.throws(
    () => api.consumeLinuxMigrationCompletion(context, late),
    (error) => error === primary,
  );
});

test("CLI fixed selector reads actual committed capsule bytes and rejects missing, uncommitted and changed policy", async (t) => {
  const f = await fixture(t);
  const api = await privateFunctions(
    [
      "fixedLinuxMigrationSelection",
      "producer",
      "need",
      "exact",
      "tree",
      "git",
      "heldFile",
      "pin",
      "json",
    ],
    {
      fs,
      path,
      constants,
      createHash,
      Buffer,
      TextDecoder,
      process,
      execFileSync,
      LINUX_MIGRATION: M,
      WORKFLOW: core.WORKFLOW,
      LIMITS: core.LIMITS,
      SOURCE_METADATA_MAX_BYTES: core.SOURCE_METADATA_MAX_BYTES,
      sha: core.sha,
      canonical: core.canonical,
      codeTreeDigest: core.codeTreeDigest,
      noLinks: core.noLinks,
      positive: (value) => Number.isSafeInteger(value) && value > 0,
      hex: (value, length = 64) =>
        typeof value === "string" &&
        new RegExp("^[a-f0-9]{" + length + "}$").test(value),
      stamp: (s) =>
        [
          s.dev,
          s.ino,
          s.uid,
          s.mode,
          s.nlink,
          s.size,
          s.mtimeNs,
          s.ctimeNs,
        ].join(":"),
    },
  );
  const read = (producer = f.args.currentProducer) =>
    api.fixedLinuxMigrationSelection(f.repo, producer, () => {});
  const selected = await read();
  assert.equal(selected.authorizing, false);
  assert.equal(
    selected.checkpointProducer.runId,
    f.policy.from.checkpointProducer.runId,
  );
  assert(Object.isFrozen(selected.checkpointProducer));
  const named = path.join(f.repo, M.policyPath);
  const original = await fs.readFile(named);
  await fs.appendFile(named, " ");
  await assert.rejects(read(), /PIN_MISMATCH/);
  await fs.writeFile(named, original);
  await assert.rejects(
    read({ ...f.args.currentProducer, head: "e".repeat(40) }),
    /CURRENT_HEAD/,
  );
  git(f.repo, ["rm", "--", M.policyPath]);
  git(f.repo, ["commit", "--quiet", "-m", "no selected capsule"]);
  const producer = {
    ...f.args.currentProducer,
    head: git(f.repo, ["rev-parse", "HEAD"]).toString().trim(),
  };
  assert.equal(await read(producer), null);
  await fs.mkdir(path.dirname(named), { recursive: true });
  await fs.writeFile(named, original);
  await assert.rejects(read(producer), /POLICY_UNCOMMITTED/);
});

function withoutFinalHelperProofDelta(text) {
  assert.equal(
    core.sha(text),
    "3cb94d746b48fa030c3a8f300c65f043f83296849d281c5149c87c2eea45e275",
  );
  for (const [current, previous] of [
    [
      '  branch: "refs/heads/codex/linux-arm-final-helper-proof-20261102",',
      '  branch: "refs/heads/codex/linux-arm-3aa-producer-migration-20261102",',
    ],
    [
      '    bytes: 203191,\n    sha256: "3be8d4b159293e677d0d49ce7b6f09f661363481db655f936e436f694a9ef8b8",',
      '    bytes: 181586,\n    sha256: "839ed8a3be5f81dd7778bf7fb4d76209d7e64342ec9387dc323d5c280098165d",',
    ],
  ]) {
    assert.equal(
      text.split(current).length,
      2,
      "one exact final-helper proof inverse",
    );
    text = text.replace(current, previous);
  }
  assert.equal(Buffer.byteLength(text), 114830);
  assert.equal(
    core.sha(Buffer.from(text)),
    "7c2533d579f789701bf4dbbd5fa17c314b7b3c57158ee738e499d2276ef96c2e",
  );
  return text;
}
function withoutTransactionDelta(text) {
  text = withoutFinalHelperProofDelta(
    withoutCliModuleDelta(withoutTransactionAdmission(text)),
  );
  for (const [start, end] of [
    [
      "// BEGIN inactive fixed transaction imports\n",
      "// END inactive fixed transaction imports\n",
    ],
    [
      "    // BEGIN inactive fixed transaction policy pin\n",
      "    // END inactive fixed transaction policy pin\n",
    ],
    [
      "      // BEGIN inactive fixed transaction tool binding\n",
      "      // END inactive fixed transaction tool binding\n",
    ],
    [
      "// BEGIN inactive fixed migration transaction\n",
      "// END inactive fixed migration transaction\n",
    ],
  ]) {
    assert.equal(text.split(start).length, 2);
    assert.equal(text.split(end).length, 2);
    let block = text.slice(text.indexOf(start), text.indexOf(end) + end.length);
    if (start.startsWith("// BEGIN inactive fixed migration transaction"))
      block += "\n";
    assert.equal(text.split(block).length, 2);
    text = text.replace(block, "");
  }
  for (const [current, old] of [
    [
      "async function heldFile(\n  file,\n  maximum,\n  expected,\n  check,\n  observeFailureClose,\n  retainRaw = true,\n) {",
      "async function heldFile(file, maximum, expected, check, observeFailureClose) {",
    ],
    ["if (!expected && retainRaw) blocks.push", "if (!expected) blocks.push"],
    [
      "raw: expected || !retainRaw ? null : Buffer.concat(blocks)",
      "raw: expected ? null : Buffer.concat(blocks)",
    ],
  ]) {
    assert.equal(text.split(current).length, 2);
    text = text.replace(current, old);
  }
  return text;
}
// Historical seed for synthetic envelopes, never production run authority.
const SEED_RUN = 41378060040;
const selected = [
  "scripts",
  "native/cef-hosted-recipe.json",
  ".node-version",
  core.WORKFLOW,
];
const rawJson = (value) => Buffer.from(core.canonical(value) + "\n");
const pin = (raw) => ({ bytes: raw.length, sha256: core.sha(raw) });
async function privateFunctions(names, scope) {
  const source = await fs.readFile(MODULE, "utf8");
  const ast = ts.createSourceFile(
    MODULE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (
    names.some((name) =>
      [
        "transactionPhase",
        "transactionSourceMode",
        "runClosedLinuxMigrationTransaction",
        "prepareLinuxMigrationTransaction",
      ].includes(name),
    )
  )
    names = [
      ...new Set([
        ...names,
        "migrationDiagnostic",
        "migrationFailureDiagnostic",
      ]),
    ];
  const declarations = names
    .map((name) => {
      const node = ast.statements.find(
        (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
      );
      assert(node, name);
      return node.getText(ast).replace(/^export /, "");
    })
    .join("\n");
  return vm.runInNewContext(declarations + "\n({" + names.join(",") + "})", {
    assert,
    canonical: core.canonical,
    linuxMigrationFailureRecord: core.linuxMigrationFailureRecord,
    console: { log: () => {} },
    ...scope,
  });
}
function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], {
    input,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}
function parseRows(value) {
  return value
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      assert(match);
      return { mode: match[1], type: "blob", sha: match[2], path: match[3] };
    });
}
function rows(root, revision) {
  return parseRows(
    git(root, ["ls-tree", "-r", revision, "--", ...selected]).toString(),
  );
}
// Immutable test witness for the exact old 129-row producer. It is not a
// production capsule and does not require old ancestors in a shallow checkout.
const OLD_SOURCE_ROWS =
  parseRows(String.raw`100644 blob c953a63d0b1f334c93fd6ce32bff8206a090a9bd	.github/workflows/cef-engineering-checkpoint.yml
100644 blob 60ade1ae01e833a5c291c47883bf26fb031f7727	.node-version
100644 blob 77ba6488a6f092856b705c477e7cf4084ff5390f	native/cef-hosted-recipe.json
100644 blob 22e31d24ab9b4731b1e5ca5b22878d3084d6f248	scripts/automation-repository.mjs
100644 blob 1522b41ad8788f2f9188ef488e49eac26c429659	scripts/browser-app-build.mjs
100644 blob a5c0a5a32171b833094a6a133c8fbd4b3bc8478e	scripts/browser-client-network-probe.mjs
100644 blob 23c88fcf52529959b0a4f0ca32cf2a1e0cf53f9d	scripts/browser-live.mjs
100644 blob aa7b6a2e159312a3f500bd558647769e1d717b45	scripts/browser-readiness.mjs
100644 blob 5e0a21bd339d1101e0f323bccc1dc475b696fdc0	scripts/browser-runtime-native-ci.mjs
100644 blob 988ac8db981ffc8f9e05c1fc3cd9b193e4af0c8b	scripts/browser-runtime-package.mjs
100644 blob 30e1507084269bab38f6115107b45a225ef4b313	scripts/capture-login-page.mjs
100644 blob cc161259f4ff6293493e21fff4eacf2608613cf9	scripts/catalog-icon-contact-sheet.mjs
100644 blob f2785f6e944c6952d371106b80f7d6887152ecc0	scripts/cef-browser-acceptance.mjs
100644 blob 5720498c509aa86d2b4d22b0e96eac6fb17d3ed9	scripts/cef-custom-artifact-inventory.mjs
100644 blob 033118f8e2457f825af921cd6eb4ab5aaabdcb7a	scripts/cef-engineering-checkpoint.mjs
100644 blob 59ba20636a8c82e10016b660fbe5e2be748210cf	scripts/cef-hosted-bootstrap.mjs
100644 blob 2fb3903eb9bf9f582ccf1fd63cf7fbb5c558890b	scripts/cef-hosted-capacity.mjs
100644 blob 6109185591d332f32cb48a0b39e418082c2e28e7	scripts/cef-hosted-provision.mjs
100644 blob 9d5d5222b00a86d7e60c82da7a1d8eafd29e4376	scripts/cef-linux-package-fixture.mjs
100644 blob fae71b6b76c4a1ba4631809d1e5b10a3a40c5c81	scripts/cef-owned-sdk-handoff.mjs
100644 blob aa52f99b48d931a5735c4c03976b3f2cf1e4a4f7	scripts/cef-owned-sdk-import.mjs
100644 blob 8549327fb78fc51fe9c0ef32217ac6c232b5b9f6	scripts/cef-owned-sdk-publish.mjs
100644 blob 616e5cf87ec9a0325d905738749f185bc36515db	scripts/cef-patched-runtime.mjs
100644 blob 70e03a09eabacb4f39a87883fff3910f947b0de9	scripts/cef-runtime-acceptance-ci.mjs
100644 blob d71e216d98b7e39a5ab44e436ab0cda7884530a6	scripts/cef-runtime-ci.mjs
100644 blob 0046ae7e7674b0beefc2f25a48904d0d9098c251	scripts/cef-runtime-fetch.mjs
100644 blob 20b12544401b69495103a6864f5ce1cecfdf5133	scripts/ci/analyze-native-dependency-graph.mjs
100644 blob 579893859c71eba218b8d057c79050f32e608ca2	scripts/ci/audit_filter.py
100644 blob 07c99ba1ce84ea3d980b877c5ba27705e0b09823	scripts/ci/check-backend-coverage.mjs
100644 blob 1814e3307a87de501dff1c66b25996b87dd477be	scripts/ci/check-cargo-update-candidate.mjs
100644 blob c9d2022462126973263c328c1cd1fa2c9f3554a5	scripts/ci/check-docs-links.mjs
100644 blob 1226702dbaf18afeed1a8f3936c4880de017bcd2	scripts/ci/check-frontend-cold-bundle.mjs
100644 blob 8f002d7e4478a09a09c7fe523d490d715e144266	scripts/ci/check-gif-worker-export.mjs
100644 blob a7f2b69d8b804f8eb6672bcbdfa095b73b607695	scripts/ci/check-js-lock-parity.mjs
100644 blob e6a8a9ad733c94b8e29f0b0c13d4a5e60e7ad966	scripts/ci/check-npm-audit.mjs
100644 blob c54b69df1bd39591c6ddfdd135aa49864bb90da2	scripts/ci/check-release-runtime-catalog.mjs
100644 blob d830e025f60687fa5b1d3a6b6736eebfcac2c540	scripts/ci/check-release-version-floor.mjs
100644 blob 6c478768f06ac8ed663ce800a01c3cfaf2d4a042	scripts/ci/diagnose-macos-cef-tests.mjs
100644 blob 71f74176d81fb9e1f077bc29d55f305e58b47420	scripts/ci/e2e-http-fixtures.mjs
100644 blob 3638c1a6f3dcc889b58d015e9fad16f60e758f78	scripts/ci/e2e-npm-fixture.mjs
100644 blob e2fbf0b02f37f4d3f05969b16390e59a3667c6e8	scripts/ci/e2e-portainer-fixture.mjs
100644 blob c6898f29664586368c9c6cc9277b8d7f4b437dab	scripts/ci/lib/docs-search-validation.mjs
100644 blob 48b32403c8527f8d422991c420e06defc1d6e696	scripts/ci/resolve-release-version.mjs
100644 blob d6c02b3490303d27961d1a940883705f99a1d592	scripts/ci/run-release-native-build.mjs
100644 blob a42ba21a31d4d82efd6f1f9a2bfa065a09654f63	scripts/ci/semver.mjs
100644 blob 658b9b5e4bbaa28ea318c7e2229d91cfdf9e0dae	scripts/ci/summarize-native-build-timings.mjs
100644 blob 9ff38882ad2c68ba94f0fb398aeb3e1ea733810c	scripts/ci/update-npm-compatible.mjs
100644 blob abcc7f30998e186f362c779998301941e5af10f7	scripts/ci/validate-release-artifacts.mjs
100644 blob 264b762f10a6a54748e2a05bcc9974dc4cbb91e4	scripts/ci/validate-updater-feed.mjs
100644 blob 9667feb690df30492faea80da379d5a6a80f182b	scripts/ci/verify-published-release-assets.mjs
100644 blob d702ef59b0b71e18437f186e98c3e24b5191a676	scripts/ci/verify-release-snapshot.mjs
100644 blob c0e465f7e1f4e2047d36b9bce9a53ce730ea7623	scripts/ci/wait-for-release-readiness.mjs
100644 blob bea75fda8491a0df11a1fa76aa062a5eea7b8dbe	scripts/crypto/generate-database-eax-vectors.ps1
100644 blob 6db3eb880621234ff1d78fa41285b726f0e75ba4	scripts/database-ui-capture.mjs
100644 blob 755df5ea02747e526b3ecc92e8f574c29dfeb04e	scripts/dev-port.mjs
100644 blob ced531d4c9db02fbbf47c0280080da28356ee80b	scripts/dev-server.mjs
100644 blob b23555fe7903dfcb973e5d9cf31140f323012d8d	scripts/docs-app-capture.mjs
100644 blob 38b182cc3bafbaf5804e47c56ca7e1b1734e258c	scripts/docs-visual-capture.mjs
100644 blob 553db2a542fb5e57fb20a4a0d0e7003524cabbf0	scripts/e2e-build.mjs
100644 blob 348838a05d8fe3d4fd733c2a450a3fbb4de9fea0	scripts/e2e-isolation-selftest.mjs
100644 blob dc474484165bba46ec7f275c6209fc0f18610a69	scripts/folder-icon-contact-sheet.mjs
100644 blob cd1780bd4f2e5885d490ddd3c9e79acc05d85012	scripts/format-changed.mjs
100644 blob 3ef1b0f7d2185004f943d1b7892f1017bdecb253	scripts/generate-command-inventory.mjs
100644 blob 68d09236558e77dc1798bd644abe46dfa9bc928b	scripts/generate-native-login-catalog.mjs
100644 blob 00d1e401e7a7fc5d27268b7236e08690f1e6c31d	scripts/i18n-residual.mjs
100644 blob 9b421f1da96f4c8223f3f7b088204ad494fbf578	scripts/icon-ui-capture.mjs
100644 blob 3fb21b9fcd4d5e36deb6c206c3c2cf0d2be8c82a	scripts/lib/browser-build-route.mjs
100644 blob 12e5fe39389938587468849ac095b6c6493f8da0	scripts/lib/browser-client-imports.mjs
100644 blob 7207a4b2f420cd72505c504bc8da135386a87a6b	scripts/lib/browser-custom-runtime.mjs
100644 blob 806f4feb6a61e84c0a4426d7f1df51396bbe9f4b	scripts/lib/browser-dev-sdk-cache.mjs
100644 blob 57279a8dabf84605a9783f388210eed4554827e9	scripts/lib/browser-installer-bundles.mjs
100644 blob fe6fba4493b9265823a71a0a6445ad41cdccd708	scripts/lib/browser-local-runtime.mjs
100644 blob 0db85b14d4266af86c04eb27dab97359a416c879	scripts/lib/browser-runtime-bootstrap.mjs
100644 blob 4f5591f6400a1b84cdd2b4c07108ed9ccb59e4a9	scripts/lib/browser-runtime-release.mjs
100644 blob eb3a022a7a3c0ad0084f595a654929a4101983bc	scripts/lib/browser-sandbox-access.mjs
100644 blob f873960bf1613bc3ddefa1faa8f4d7ad04c2a4c8	scripts/lib/cef-checkpoint-archive.py
100644 blob 626c665f8ed3e17de6c91ae44aab35ceaf3541c0	scripts/lib/cef-engineering-checkpoint.mjs
100644 blob ab15eccc67c328920c0a101b893755edfc7fc170	scripts/lib/cef-mac-process-census.py
100644 blob 8e3e081cfe40fee9ff865b5699b47bfc9a6184ef	scripts/lib/cef-mac-sdk-inventory.mjs
100644 blob aed8a4b3f8fd5377700693bfa5014979192c68af	scripts/lib/cef-mac-source-metadata.mjs
100644 blob 4ded0956ee5732222a22c96df40bc40dbee62a30	scripts/lib/cef-native-crash-summary.mjs
100644 blob 3fb062fc081d9a974f841f22a28068059a2a8550	scripts/lib/cef-owned-sdk-handoff.mjs
100644 blob 369c93b265d65416934865d8a5f0b9c1f62e22d7	scripts/lib/cef-owned-sdk-import.mjs
100644 blob a53f9d122bf11263745de9f741a13dbbe51aba3c	scripts/lib/cef-owned-sdk-publish.mjs
100644 blob 9580b3fb662eb0b26e9bb2bf897d7c037c4c743c	scripts/lib/cef-storage-acceptance.mjs
100644 blob 5f368558a61b4d3b62be9bf18ef3622afca70ecf	scripts/lib/cef-windows-arm-sdk-origin.mjs
100644 blob a262d43203010c6feb1e28950040ecf1564b9248	scripts/lib/command-inventory.mjs
100644 blob d37431b0b46f82c1183f9cc52245cb2223de89c2	scripts/lib/core-command-groups.mjs
100644 blob fdc4c6673227cca6d9036d9842fac9891ce193e6	scripts/lib/dev-build-budget.mjs
100644 blob 9e6c3fa95f776b5e542bba35134d493ba98de3d7	scripts/lib/e2e-profile-isolation.d.mts
100644 blob 1ddca465468f9b6eb7550d5c6fa10ec1e8ea3844	scripts/lib/e2e-profile-isolation.mjs
100644 blob 95f02a1b2467bf726b083a309177c58aa8897c0f	scripts/lib/extract-custom-runtime.py
100644 blob 7c42e96ed0c50eb4b5dcbfc58d3cbf097f1ddee7	scripts/lib/linux-package-sandbox.mjs
100644 blob 8c70b2dda58d7841b1fb5444f88fa25be0d08d0a	scripts/lib/native-child-env.mjs
100644 blob 7a61eaf64f89ce5f6d824551fc541b9c8716a73b	scripts/lib/windows-native-crash-capture.mjs
100644 blob 0be899cc5030ef456be2e52f0d29a91c1aeb21c8	scripts/lib/windows-openssl-env.mjs
100644 blob 9c7500a5f973afc85aa1240be166426628587226	scripts/native-build-env.mjs
100644 blob adb8fdfcdaddac32a58a17ca637b67d213d2cf7a	scripts/native-target.mjs
100644 blob 37b729490bbc2d337217b17e529145756abda94b	scripts/native/browser-app-plist.py
100644 blob d1b82bdb1d8c88da48257e12dc22231983fac3be	scripts/native/browser-cargo-runner.rs
100644 blob 624444b6dbbd5b7b678429741f3040cd97c2e78c	scripts/native/repair-browser-sandbox-access.ps1
100644 blob 1af8438246326956c285ca721093cf4fcc8b73e8	scripts/provider-icons-capture.mjs
100644 blob 6ad9a56649aff470f4431a501421da2b914ce79d	scripts/readme-screenshot-validation.mjs
100644 blob fd113092504ee5c3440fe2fa39cbcd71ca15d810	scripts/readme-screenshot.mjs
100644 blob 2e129e26927037109abad8996f5e71ca0da7dbe5	scripts/softether-e2e-down.ps1
100644 blob 090f7e0ee6e2a4335dd1a5b77bb0e828b09ccee7	scripts/softether-e2e-down.sh
100644 blob 16114fc39008314fa34280bf8b6c67855cef559d	scripts/sort-core-command-groups.mjs
100644 blob b7b5717eded1d9f05bc9e02f9b9a01ffa7b0e24c	scripts/spreadsheet-ui-check.mjs
100644 blob e28b78e4d2bda5e5d8e24a8bc7a336bfdee1bf81	scripts/stage-file-viewer-host.mjs
100644 blob c529782fbb8b5915053f4ec0ff0b9954bfc216e1	scripts/stage-openh264-runtime.mjs
100644 blob ad986a3a438a6ab21d59957f7701cd029f8d8f58	scripts/stage-windows-native-runtime.mjs
100644 blob a2529556eae07dc2ae6192296fcbe56cceccfd92	scripts/styled-english-locales.mjs
100644 blob b169695faff2b8e34340b20362e886a4b3c08b6e	scripts/sync-brand-icons.mjs
100644 blob 0e0fbf1f73aa63bf8093cff34ba60ab5e9d92bd6	scripts/sync-js-deps.mjs
100644 blob af51e4437a6bb1d1e4e481a4a2be0ee11d3ae832	scripts/sync-version.mjs
100644 blob f81ddd2150198a8362ab5510e124dba7390dce7a	scripts/tauri-dev.mjs
100644 blob d4d7819293430603f3c46f2b3e7c14af54777cfe	scripts/tauri.mjs
100644 blob 3cabbaa847327de9ac8caa4c7cecb7cf0e9832aa	scripts/test-legacy-web-compat-browser.mjs
100644 blob 0169c0728bb49f4961a34732ae72e1051a386145	scripts/test-synology-login-browser.mjs
100644 blob 127af7cf77c86525bc6ad561145ca78e18348dad	scripts/test-vault-ssh-inline.mjs
100644 blob 580c5832a695bfc7f068d203d8b1ddb8eeff57cc	scripts/test-web-network-browser.mjs
100644 blob d1b6b5138e89f2215476f57cf432b018bdd942a0	scripts/test-website-dark-mode-browser.mjs
100644 blob 9c26ad336cc66c956eb4ea2e3815dffdbab264e4	scripts/test-yealink-login-browser.mjs
100644 blob e30f7ec547a03efbdcd448dc78a9c395721b1519	scripts/trace-provider-icons.mjs
100644 blob 062a26cdb05d692f347d28772c1613398df408b2	scripts/trust-ui-capture.mjs
100644 blob 19541ed4fff8d24537d059748ea0655173e67b7e	scripts/vendor-web-darkreader.mjs
100644 blob 303feb0be3a88e30c575be88157640621322e6e5	scripts/versioning.mjs
100644 blob 5d203492eb36a8b3354182b3e66fd7e0402d7e12	scripts/viewport-scroll-check.mjs
100644 blob 3f51e0714aae592fdcecf2b72af6fe8be9ac7211	scripts/web-automation-capture.mjs`);
async function scratch(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "cef-linux-migration-")),
  );
  t.after(async () => {
    assert.match(path.basename(root), /^cef-linux-migration-/);
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true });
  });
  return root;
}
function oldProducer(runId = SEED_RUN, attempt = 1) {
  return {
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: 1010282954,
    runId,
    attempt,
    head: M.head,
    branch: "main",
    workflow: core.WORKFLOW,
  };
}
function manifest(identity, inventory, selectedProducer = oldProducer()) {
  return {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-checkpoint",
    identity,
    identitySha256: core.validateIdentity(identity),
    producer: selectedProducer,
    archive: {
      complete: true,
      chunks: [
        { name: "checkpoint-00000.bin", bytes: 10, sha256: "f".repeat(64) },
      ],
      inventory: { name: "inventory.json", ...pin(inventory) },
      rawBytes: 100,
      compressedBytes: 10,
      entries: 1,
      linksIncluded: false,
    },
    compile: {
      outcome: "slice-ended",
      exitCode: null,
      quiescent: true,
      groupId: 123,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: 123, start: "Sun Nov 1 00:00:00 2026" }],
    },
    nativeAcceptance: false,
    runtimeReady: false,
  };
}
async function fixture(t, { oldRunId = SEED_RUN, oldAttempt = 1 } = {}) {
  const root = await scratch(t),
    repo = path.join(root, "repo");
  await fs.mkdir(repo);
  const oldRows = structuredClone(OLD_SOURCE_ROWS);
  const reachableRows = rows(ROOT, "HEAD");
  assert.equal(oldRows.length, 129);
  assert.equal(core.codeTreeDigest(oldRows), M.producer);
  // Read the candidate from the reachable current Git tree. The old row table
  // is only the exact from-identity witness; no old helper is executed.
  const data = git(
    ROOT,
    ["cat-file", "--batch"],
    reachableRows.map((row) => row.sha).join("\n") + "\n",
  );
  let offset = 0;
  for (const row of reachableRows) {
    const end = data.indexOf(10, offset),
      header = data.subarray(offset, end).toString();
    const match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
    assert.equal(match?.[1], row.sha);
    const start = end + 1,
      next = start + Number(match[2]);
    assert.equal(data[next], 10);
    await fs.mkdir(path.dirname(path.join(repo, row.path)), {
      recursive: true,
    });
    await fs.writeFile(path.join(repo, row.path), data.subarray(start, next));
    offset = next + 1;
  }
  assert.equal(offset, data.length);
  await fs.writeFile(
    path.join(repo, "scripts/lib/cef-linux-producer-migration.mjs"),
    await fs.readFile(MODULE),
  );
  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "Inactive fixture"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["add", "--", ...selected]);
  git(repo, ["commit", "--quiet", "-m", "canonical selected fixture"]);
  const currentRows = rows(repo, "HEAD"),
    digest = core.codeTreeDigest(currentRows);
  const identity = {
    target: M.target,
    source: M.source,
    producer: M.producer,
    canonicalRoot: path.join(root, "work"),
    image: "20261026.354.1",
    tools: "b".repeat(64),
    graph: "c".repeat(64),
    siso: "d".repeat(64),
  };
  const sidecar = rawJson({
    schemaVersion: 1,
    kind: "sorng-linuxarm-source-metadata",
    policy: M.metadataPolicy,
    sourceDateEpoch: M.epoch,
    identity,
    snapshot: {},
  });
  const inventory = rawJson({
    schemaVersion: 1,
    entries: [{ path: M.sidecar, kind: "file", stamp: [sidecar.length] }],
    files: [{ path: M.sidecar, sha256: core.sha(sidecar) }],
    generatedLinks: {},
  });
  const oldManifest = manifest(
      identity,
      inventory,
      oldProducer(oldRunId, oldAttempt),
    ),
    manifestBytes = rawJson(oldManifest);
  const seal = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-seal",
    producer: oldManifest.producer,
    identitySha256: oldManifest.identitySha256,
    release: {
      id: 15,
      tag: `cef-checkpoint-${M.target}-${oldManifest.identitySha256.slice(0, 16)}-${oldRunId}-${oldAttempt}`,
    },
    manifest: { name: "manifest.json", ...pin(manifestBytes) },
    assets: [
      { id: 1, name: "manifest.json", ...pin(manifestBytes) },
      { id: 2, name: "inventory.json", ...pin(inventory) },
      { id: 3, ...oldManifest.archive.chunks[0] },
    ],
  };
  const sealBytes = rawJson(seal),
    sealArtifact = { id: 17, bytes: 1234, sha256: "e".repeat(64) };
  const policy = {
    schemaVersion: 1,
    kind: "sorng-linuxarm-exact-producer-migration",
    target: M.target,
    source: M.source,
    linuxMetadata: {
      schemaVersion: 1,
      kind: "sorng-linuxarm-source-metadata",
      policy: M.metadataPolicy,
      sourceDateEpoch: M.epoch,
    },
    from: {
      producer: M.producer,
      checkpointProducer: structuredClone(oldManifest.producer),
      identitySha256: oldManifest.identitySha256,
      sealArtifact,
      seal: pin(sealBytes),
      manifest: pin(manifestBytes),
      inventory: pin(inventory),
      sidecar: pin(sidecar),
    },
    toProducer: digest,
    oldSourceTree: oldRows,
    changedSources: [
      ...new Set([...oldRows, ...currentRows].map((row) => row.path)),
    ]
      .sort()
      .flatMap((file) => {
        const prior = oldRows.find((row) => row.path === file),
          current = currentRows.find((row) => row.path === file);
        const before = prior ? { mode: prior.mode, sha: prior.sha } : null,
          after = current ? { mode: current.mode, sha: current.sha } : null;
        return core.canonical(before) === core.canonical(after)
          ? []
          : [{ path: file, before, after }];
      }),
  };
  async function writePolicy(value = policy, raw = rawJson(value)) {
    const file = path.join(repo, M.policyPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, raw);
    git(repo, ["add", "--", M.policyPath]);
    git(repo, [
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "inactive capsule fixture",
    ]);
    assert.equal(core.codeTreeDigest(rows(repo, "HEAD")), digest);
    return git(repo, ["rev-parse", "HEAD"]).toString().trim();
  }
  const args = {
    repositoryRoot: repo,
    restoreRun: oldRunId,
    currentProducer: {
      ...oldProducer(),
      runId: 41359999999,
      head: await writePolicy(),
    },
    freshIdentity: { ...identity, producer: digest },
    oldManifestBytes: manifestBytes,
    oldSealBytes: sealBytes,
    oldSealArtifact: sealArtifact,
    oldInventoryBytes: inventory,
  };
  return { root, repo, args, policy, writePolicy };
}

test("closed transaction rejects foreign source contexts before opaque candidate getters and preserves the prior module", async () => {
  let getters = 0;
  const forged = new Proxy(
    {},
    {
      get() {
        getters++;
        return true;
      },
    },
  );
  await assert.rejects(
    migration.prepareLinuxMigrationTransaction(forged, forged, forged),
    /SOURCE_OWNER_REQUIRED/,
  );
  assert.equal(getters, 0);
  const raw = (await fs.readFile(MODULE, "utf8")).replaceAll("\r\n", "\n");
  assert.match(raw, /const TRANSACTION_ADMITTED = true;/);
  const previous = withoutTransactionDelta(raw);
  assert.equal(Buffer.byteLength(previous), 95128);
  assert.equal(
    core.sha(Buffer.from(previous)),
    "ea6610f85e36c57fd87736f682c8b58f2c536ed58beb103b88a0594bc73619f7",
  );
});

async function transactionModel({
  failAt,
  marker,
  retireAt,
  usedInitially = false,
  closeFault = false,
  ownerRemaining = 60000,
  checkRestoreBudget = false,
  diagnosticLog = () => {},
  diagnosticRecord = core.linuxMigrationFailureRecord,
} = {}) {
  // Execute the actual closed orchestration and guards in disjoint VM maps.
  // These staged command/FS outcomes are NOT genuine GN or production tokens.
  const events = [],
    context = {},
    candidate = {},
    toolsToken = {},
    gnReceipt = {};
  const candidates = new WeakMap(),
    toolContexts = new WeakMap(),
    creators = new WeakMap();
  const retirementReadiness = new WeakMap(),
    retirementReports = new WeakMap();
  const completedMigrationTransactions = new WeakMap(),
    activeMigrationTransactions = new WeakMap();
  const spentMigrationContexts = new WeakSet();
  let used = usedInitially,
    live = true,
    applies = 0;
  const restoreReached = new Error("MODEL_RESTORE_IO");
  const restoreBoundary = checkRestoreBudget
    ? await privateFunctions(["restorePreparedCommon", "need"], {
        positive: (value) => Number.isSafeInteger(value) && value > 0,
        LIMITS: core.LIMITS,
        path: path.posix,
        noLinks: async () => {
          throw restoreReached;
        },
      })
    : null;
  const selected = {
    freshIdentity: { canonicalRoot: "/owned", graph: "g" },
    currentProducer: { head: "h" },
  };
  const tools = {
    candidate,
    work: "/owned",
    python: "/reviewed/python",
    toolsRoot: "/reviewed",
    chromium: "/owned/source/src",
    out: "/owned/source/src/out/Release_GN_arm64",
    linuxRecipeJson: core.canonical({ pinned: true }),
    held: [{ tool: true }],
    remaining: () => 60000,
  };
  candidates.set(candidate, selected);
  toolContexts.set(toolsToken, tools);
  const view = () => {
    if (!live) throw new Error("MODEL_CONTEXT_RETIRED");
    return {
      target: M.target,
      sourceLockIdentity: M.source,
      canonicalRoot: tools.work,
      python: tools.python,
      toolsRoot: tools.toolsRoot,
      cef: tools.chromium + "/cef",
      depot: tools.work + "/source/depot_tools",
      cwd: tools.chromium,
      logs: "/owned/logs",
      initialCohortQuietProven: true,
      revalidationUsed: used,
      remainingMilliseconds: ownerRemaining,
    };
  };
  const stage = (name) => {
    events.push(name);
    if (failAt === name) throw marker;
    if (retireAt === name) live = false;
  };
  const api = await privateFunctions(
    [
      "need",
      "transactionSourceBinding",
      "transactionCompletionBinding",
      "transactionCheck",
      "transactionPhase",
      "runClosedLinuxMigrationTransaction",
      "prepareLinuxMigrationTransaction",
    ],
    {
      LINUX_MIGRATION: M,
      console: { log: diagnosticLog },
      linuxMigrationFailureRecord: diagnosticRecord,
      TRANSACTION_ADMITTED: false,
      ROOT: "/repo",
      path: path.posix,
      canonical: core.canonical,
      candidates,
      toolContexts,
      creators,
      retirementReadiness,
      retirementReports,
      completedMigrationTransactions,
      activeMigrationTransactions,
      spentMigrationContexts,
      assertLiveLinuxSourceContext: view,
      transactionControls: async (state) => {
        stage("controls");
        state.handles.push({ control: true });
      },
      transactionRecheck: async () => stage("recheck"),
      restoreOwnedCommon: async (s, t, o, ledger) => {
        stage("restore");
        assert.equal(ledger, creators);
        if (restoreBoundary)
          await restoreBoundary
            .restorePreparedCommon(s, { check: t.remaining })
            .then(
              () =>
                assert.fail("Restore boundary must stop before filesystem IO"),
              (error) => {
                if (error !== restoreReached) throw error;
              },
            );
        const token = {};
        creators.set(token, { handle: {}, rootHandle: {} });
        return token;
      },
      transactionSourceMode: async (s, mode, which) => {
        stage(mode === "source-apply" ? "old-apply" + ++applies : "new-record");
        assert.equal(which, mode === "source-apply" ? "old" : "new");
        return {};
      },
      revalidateLinuxSourceOwner: () => {
        assert.equal(used, false);
        used = true;
        stage("gn");
        return Promise.resolve(gnReceipt);
      },
      assertLinuxSourceOwnerReceipt: (c, r) => {
        assert.equal(c, context);
        assert.equal(r, gnReceipt);
        view();
        return { cohortQuietProven: true, commandCompleted: true };
      },
      verifyGraph: async () => stage("graph"),
      linuxArmRecipe: async () => {
        stage("recipe");
        return { pinned: true };
      },
      retireOwnedCommon: async (token, t, created, ledger) => {
        assert.equal(retirementReadiness.has(token), false);
        stage("retirement");
        ledger.delete(token);
        retirementReports.set(token, {
          accepted: true,
          childJoined: true,
          parentDescriptorsClosed: true,
          sourceInodeCas: false,
        });
      },
      transactionNewRecord: async () => stage("cache-binding"),
      closeHeld: async () => {
        assert.equal(activeMigrationTransactions.has(context), false);
        assert.equal(candidates.has(candidate), false);
        assert.equal(toolContexts.has(toolsToken), false);
        events.push("close");
        return closeFault ? [new Error("later close failure")] : [];
      },
      recordCleanup: () => {},
      git: () => Buffer.from("h"),
    },
  );
  return {
    api,
    context,
    candidate,
    toolsToken,
    events,
    completedMigrationTransactions,
    creators,
    retirementReadiness,
    activeMigrationTransactions,
    candidates,
    toolContexts,
    view,
  };
}

test("actual fractional hosted clock reaches restore through conservative whole-millisecond admission", async () => {
  const { createHostedBuildBudget } =
    await import("../../scripts/cef-runtime-ci.mjs");
  let elapsed = 0;
  const budget = createHostedBuildBudget(60000, () => elapsed);
  elapsed = 0.25;
  assert.equal(budget.remaining(), 59999.75);
  assert.equal(Number.isSafeInteger(budget.remaining()), false);
  const model = await transactionModel({
    ownerRemaining: budget.remaining(),
    checkRestoreBudget: true,
  });
  const completion = await model.api.runClosedLinuxMigrationTransaction(
    model.context,
    model.candidate,
    model.toolsToken,
  );
  assert.equal(completion.authorizing, false);
  assert(model.events.includes("new-record"));
  const expired = await transactionModel({
    ownerRemaining: 0.75,
    checkRestoreBudget: true,
  });
  await assert.rejects(
    expired.api.runClosedLinuxMigrationTransaction(
      expired.context,
      expired.candidate,
      expired.toolsToken,
    ),
    /ORIGINAL_LEASE/,
  );
  assert(!expired.events.includes("old-apply1"));
});

test("private transaction fixes both old applies around genuine GN and consumes readiness before retirement", async () => {
  const m = await transactionModel();
  await assert.rejects(
    m.api.prepareLinuxMigrationTransaction(
      m.context,
      m.candidate,
      m.toolsToken,
    ),
    /NOT_ACTIVATED/,
  );
  assert.deepEqual(m.events, []);
  const token = await m.api.runClosedLinuxMigrationTransaction(
    m.context,
    m.candidate,
    m.toolsToken,
  );
  assert.equal(token.authorizing, false);
  assert.equal(m.completedMigrationTransactions.get(token).context, m.context);
  assert.deepEqual(
    m.events.filter((event) => event !== "recheck" && event !== "close"),
    [
      "controls",
      "restore",
      "old-apply1",
      "gn",
      "graph",
      "recipe",
      "old-apply2",
      "retirement",
      "new-record",
      "cache-binding",
    ],
  );
  assert.equal(
    m.completedMigrationTransactions.get(token).result.sourceInputsRevalidated,
    true,
  );
  assert.equal(
    m.completedMigrationTransactions.get(token).result.newRecordReusedFiles,
    0,
  );
  assert.equal(
    m.completedMigrationTransactions.get(token).result.newCacheHeaderBinding,
    true,
  );
  assert.equal(
    m.completedMigrationTransactions.get(token).result
      .completeCacheStructureValidated,
    false,
  );
  assert.equal(m.activeMigrationTransactions.has(m.context), false);
  assert.equal(m.candidates.has(m.candidate), false);
  assert.equal(m.toolContexts.has(m.toolsToken), false);
});

test("used source revalidation rejects before any controls or restored-source mutation", async () => {
  const m = await transactionModel({ usedInitially: true });
  await assert.rejects(
    m.api.runClosedLinuxMigrationTransaction(
      m.context,
      m.candidate,
      m.toolsToken,
    ),
    /GN_ALREADY_USED/,
  );
  assert.deepEqual(m.events, []);
});

test("exported final-await boundary is causal: same-realm retirement, expiry and foreign completion deny and retire", async () => {
  const text = await fs.readFile(MODULE, "utf8"),
    ast = ts.createSourceFile(
      MODULE,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
  const declaration = (name) => {
    const node = ast.statements.find(
      (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
    );
    assert(node);
    return node.getText(ast).replace(/^export /, "");
  };
  const actual = declaration("prepareLinuxMigrationTransaction"),
    before = actual.indexOf("  let completion;");
  assert(before > 0);
  const unchecked =
    actual.slice(0, before) +
    "  return runClosedLinuxMigrationTransaction(context, candidate, toolsToken);\n}";
  for (const mode of ["retire", "expiry", "foreign", "binding", "success"]) {
    for (const guarded of [false, true]) {
      const model = vm.runInNewContext(
        `(()=>{
        const TRANSACTION_ADMITTED=true,completedMigrationTransactions=new WeakMap();
        const context={},foreign={},primary=mode==='retire'?false:new Error('ORIGINAL_LEASE_EXPIRED');
        let live=true,used=false,root='/owned',token;
        function need(value,message){if(!value)throw new Error(message);}
        function migrationDiagnostic(){}
        function migrationFailureDiagnostic(){}
        function linuxMigrationFailureRecord(){return {};}
        function assertLiveLinuxSourceContext(){if(!live)throw primary;return {
          target:'linux',sourceLockIdentity:'source',canonicalRoot:root,toolsRoot:'/tools',
          python:'/tools/python',cef:'/owned/cef',depot:'/owned/depot',cwd:'/owned/source',logs:'/owned/logs',
          initialCohortQuietProven:true,revalidationUsed:used};}
        ${declaration("transactionCompletionBinding")}
        function runClosedLinuxMigrationTransaction(){
          used=true;token=Object.freeze({kind:'closed-linux-migration-completion',authorizing:false});
          completedMigrationTransactions.set(token,{context:mode==='foreign'?foreign:context,
            sourceBinding:transactionCompletionBinding(assertLiveLinuxSourceContext()),result:Object.freeze({})});
          if(mode==='retire'||mode==='expiry')queueMicrotask(()=>{live=false;});
          if(mode==='binding')queueMicrotask(()=>{root='/rebound';});
          return Promise.resolve(token);
        }
        ${guarded ? actual : unchecked}
        return {context,primary,invoke:()=>prepareLinuxMigrationTransaction(context,{},{}),
          retained:()=>completedMigrationTransactions.has(token)};
      })()`,
        { mode, queueMicrotask, canonical: core.canonical },
      );
      const outcome = await model.invoke().then(
        (value) => ({ success: true, value }),
        (error) => ({ success: false, error }),
      );
      if (!guarded || mode === "success") {
        assert.equal(outcome.success, true);
        assert.equal(model.retained(), true);
      } else {
        assert.equal(outcome.success, false);
        assert.equal(model.retained(), false);
        if (mode === "retire" || mode === "expiry")
          assert.equal(outcome.error, model.primary);
        else
          assert.match(outcome.error.message, /TRANSACTION_COMPLETION_CONTEXT/);
      }
    }
  }
});

test("cache header binding also requires actual full-record counters and a held new sidecar pin", async () => {
  const next = { producer: "new", source: "fixed" },
    sha = "b".repeat(64);
  for (const mode of [
    "valid",
    "old-cache",
    "reused",
    "wrong-bytes",
    "wrong-owner",
  ]) {
    let holds = 0,
      cacheNoRaw = false,
      rechecks = 0;
    const encoded = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "sorng-linuxarm-source-stat-cache",
        sidecarSha256: sha,
        identity: mode === "old-cache" ? { producer: "old" } : next,
        entries: [],
      }),
    );
    const recorded = {
      entries: 3,
      bytes: 8,
      timing: {
        reusedFiles: mode === "reused" ? 1 : 0,
        hashedFiles: 2,
        hashedBytes: mode === "wrong-bytes" ? 7 : 8,
      },
      sidecar: { name: M.sidecar, bytes: 10, sha256: sha },
    };
    const state = {
      selected: { freshIdentity: next },
      source: "/owned/source",
      originalTools: { out: "/out" },
      handles: [],
    };
    const api = await privateFunctions(["need", "transactionNewRecord"], {
      transactionCheck: () => 60000,
      LINUX_MIGRATION: M,
      SOURCE_METADATA_MAX_BYTES: core.SOURCE_METADATA_MAX_BYTES,
      path: path.posix,
      Buffer,
      canonical: core.canonical,
      process: { getuid: () => 123 },
      heldFile: async (file, max, expected, check, observe, noRaw) => {
        holds++;
        if (expected) {
          assert.equal(expected.sha256, sha);
          return { owner: 123n, pin: expected };
        }
        cacheNoRaw = noRaw === false;
        assert.equal(max, 1024 ** 3);
        return {
          owner: mode === "wrong-owner" ? 124n : 123n,
          handle: {
            read: async (buffer) => {
              encoded.copy(buffer, 0, 0, buffer.length);
              return { bytesRead: Math.min(buffer.length, encoded.length) };
            },
          },
        };
      },
      revalidateHeldFile: async () => {
        rechecks++;
      },
    });
    if (mode === "valid") {
      await api.transactionNewRecord(state, recorded);
      assert(cacheNoRaw);
      assert.equal(holds, 2);
      assert.equal(rechecks, 2);
    } else {
      await assert.rejects(
        api.transactionNewRecord(state, recorded),
        /FULL_RECORD|CACHE_BINDING|CACHE_OWNER/,
      );
      if (mode === "reused" || mode === "wrong-bytes") assert.equal(holds, 0);
    }
  }
});

async function fullRecordFixture(t, when = "2026-11-02 15:00:00.123456") {
  const root = await scratch(t),
    source = path.join(root, "source"),
    out = path.join(root, "out"),
    name = path.join(
      source,
      "src/third_party/depot_tools/.disable_auto_update",
    ),
    cacheName = path.join(
      source,
      "acquisition-logs/.sorng-source-stat-cache.json",
    );
  await fs.mkdir(path.dirname(name), { recursive: true });
  await fs.mkdir(path.dirname(cacheName), { recursive: true });
  await fs.mkdir(out);
  const prefix = `Disabled by ${source}/src/third_party/depot_tools/update_depot_tools_toggle.py at `,
    raw = Buffer.from(prefix + when + "\n"),
    canonicalBytes = Buffer.byteLength(prefix + "<time>\n");
  await fs.writeFile(name, raw);
  const identity = { producer: "new", source: "fixed" },
    sidecar = Buffer.from("held synthetic sidecar\n");
  await fs.writeFile(path.join(out, M.sidecar), sidecar);
  await fs.writeFile(
    cacheName,
    JSON.stringify({
      schemaVersion: 1,
      kind: "sorng-linuxarm-source-stat-cache",
      sidecarSha256: core.sha(sidecar),
      identity,
      entries: [],
    }),
  );
  let retired = false;
  const state = {
      source,
      originalTools: { out },
      handles: [],
      selected: { freshIdentity: identity },
    },
    recorded = {
      entries: 3,
      bytes: 8 + canonicalBytes,
      timing: { reusedFiles: 0, hashedFiles: 2, hashedBytes: 8 + raw.length },
      sidecar: { name: M.sidecar, ...pin(sidecar) },
    },
    check = () => {
      if (retired) throw false;
      return 60000;
    },
    uid = (await fs.lstat(name, { bigint: true })).uid,
    scope = {
      fs,
      constants,
      Buffer,
      createHash,
      path,
      noLinks: core.noLinks,
      stamp: (s) =>
        [
          s.dev,
          s.ino,
          s.uid,
          s.mode,
          s.nlink,
          s.size,
          s.mtimeNs,
          s.ctimeNs,
        ].join(":"),
      process: { getuid: () => Number(uid) },
      LINUX_MIGRATION: M,
      SOURCE_METADATA_MAX_BYTES: core.SOURCE_METADATA_MAX_BYTES,
      transactionCheck: check,
    };
  const io = await privateFunctions(
    ["need", "heldFile", "revalidateHeldFile", "closeHeld"],
    scope,
  );
  const current = await privateFunctions(["need", "transactionNewRecord"], {
    ...scope,
    ...io,
  });
  const previousSource = withoutRecordNormalization(
      (await fs.readFile(MODULE, "utf8")).replaceAll("\r\n", "\n"),
    ),
    ast = ts.createSourceFile(
      MODULE,
      previousSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    previousBody = ast.statements
      .find(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          node.name?.text === "transactionNewRecord",
      )
      .getText(ast),
    previous = vm.runInNewContext(previousBody + "\ntransactionNewRecord", {
      ...scope,
      ...io,
      canonical: core.canonical,
    });
  t.after(async () => {
    assert.equal((await io.closeHeld(state.handles)).length, 0);
  });
  return {
    state,
    recorded,
    current: current.transactionNewRecord,
    previous,
    io,
    scope,
    name,
    raw,
    prefix,
    retire: () => {
      retired = true;
    },
  };
}

test("full-record exact physical byte normalization uses actual held sentinel and preserves old guard causally", async (t) => {
  for (const when of ["2026-11-02 15:00:00", "2026-11-02 15:00:00.123456"]) {
    const f = await fullRecordFixture(t, when);
    await assert.rejects(
      f.previous(f.state, f.recorded),
      /TRANSACTION_FULL_RECORD/,
    );
    assert.equal(f.state.handles.length, 0);
    await f.current(f.state, f.recorded);
    assert.equal(f.state.handles.length, 3);
    assert.equal(f.state.recordNormalization.path, f.name);
    assert.equal(f.state.recordNormalization.file.pin.sha256, core.sha(f.raw));
    await f.io.revalidateHeldFile(
      f.state.recordNormalization.file,
      f.name,
      () => 60000,
    );
    await fs.writeFile(
      f.name,
      f.raw.toString().replace("15:00:00", "15:00:01"),
    );
    await assert.rejects(
      f.io.revalidateHeldFile(
        f.state.recordNormalization.file,
        f.name,
        () => 60000,
      ),
      /FILE_CHANGED/,
    );
  }
});

test(
  "actual Linux Python full-record counters pass only the exact held normalization guard",
  {
    skip:
      process.platform !== "linux"
        ? "Actual POSIX owned-source helper and cache"
        : false,
  },
  async (t) => {
    const fixtureText = await fs.readFile(
        path.join(ROOT, "tests/tooling/cefEngineeringCheckpoint.node-test.mjs"),
        "utf8",
      ),
      fixtureAst = ts.createSourceFile(
        "fixture.mjs",
        fixtureText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      ),
      declaration = fixtureAst.statements
        .flatMap((node) =>
          ts.isVariableStatement(node)
            ? [...node.declarationList.declarations]
            : [],
        )
        .find(
          (node) => node.name.getText(fixtureAst) === "SOURCE_METADATA_PROOF",
        ),
      proof = vm.runInNewContext(declaration.initializer.getText(fixtureAst), {
        String,
      }),
      setup = proof.slice(0, proof.indexOf("class SourceMetadataProof"));
    for (const when of ["2026-11-02 15:00:00", "2026-11-02 15:00:00.123456"]) {
      const f = await fullRecordFixture(t),
        work = path.join(await scratch(t), "work");
      await fs.mkdir(work);
      const raw = execFileSync(
        "python3",
        [
          "-I",
          "-B",
          "-S",
          "-c",
          setup +
            String.raw`
@contextmanager
def owned_temp(**kwargs):yield sys.argv[2]
with patch.object(tempfile,'TemporaryDirectory',owned_temp),fixture(record=False) as (root,sidecar,identity):
 (root/'acquisition-logs').mkdir()
 p=root/'src/third_party/depot_tools/.disable_auto_update';p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text('Disabled by %s/src/third_party/depot_tools/update_depot_tools_toggle.py at %s\n'%(root,sys.argv[3]))
 identity=json.loads(json.dumps(identity,sort_keys=True)) # Actual canonical identity-file order.
 result=m.source_metadata('source-record',root,sidecar,identity,60)
 entries=json.loads(sidecar.read_bytes())['snapshot']['entries'];files=[r for r in entries if r['kind']=='file']
 assert result['timing']['reusedFiles']==0 and result['timing']['hashedFiles']==len(files)
 assert result['bytes']==sum(r['size']for r in files)
 assert result['timing']['hashedBytes']-result['bytes']==len(sys.argv[3])-len('<time>')
 print(json.dumps({'source':str(root),'sidecar':str(sidecar),'identity':identity,'result':result}))
`,
          path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
          work,
          when,
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          maxBuffer: 65536,
          env: { PATH: process.env.PATH },
        },
      );
      const value = JSON.parse(raw);
      assert.equal(value.source, path.join(work, "source"));
      f.state.source = value.source;
      f.state.originalTools.out = path.dirname(value.sidecar);
      f.state.selected.freshIdentity = value.identity;
      await assert.rejects(
        f.previous(f.state, value.result),
        /TRANSACTION_FULL_RECORD/,
      );
      await f.current(
        f.state,
        core.sourceMetadataResult(value.result, "source-record"),
      );
      assert.equal(f.state.handles.length, 3);
      assert.equal(
        f.state.recordNormalization.file.pin.bytes -
          Buffer.byteLength(
            `Disabled by ${value.source}/src/third_party/depot_tools/update_depot_tools_toggle.py at <time>\n`,
          ),
        when.length - "<time>".length,
      );
    }
  },
);

test("full-record sentinel rejects counter nearmisses, malformed same-size timestamps, owners and file substitution", async (t) => {
  for (const mode of [
    "counter",
    "counter-length",
    "reused",
    "prefix",
    "time",
    "newline",
    "growth",
    "directory",
    "hardlink",
    "owner",
    "race",
    "retired",
  ]) {
    const f = await fullRecordFixture(t);
    if (mode === "counter") f.recorded.timing.hashedBytes++;
    if (mode === "counter-length") f.recorded.timing.hashedBytes -= 7;
    if (mode === "reused") f.recorded.timing.reusedFiles = 1;
    if (mode === "prefix")
      await fs.writeFile(
        f.name,
        f.raw.toString().replace("Disabled", "Enabled!"),
      );
    if (mode === "time")
      await fs.writeFile(
        f.name,
        f.raw.toString().replace(".123456", ".12345x"),
      );
    if (mode === "newline")
      await fs.writeFile(f.name, f.raw.toString().slice(0, -1) + "x");
    if (mode === "growth") await fs.writeFile(f.name, Buffer.alloc(4097, 120));
    if (mode === "directory") {
      await fs.unlink(f.name);
      await fs.mkdir(f.name);
    }
    if (mode === "hardlink") await fs.link(f.name, f.name + ".alias");
    const api = await privateFunctions(["need", "transactionNewRecord"], {
      ...f.scope,
      ...f.io,
      ...(mode === "owner"
        ? { process: { getuid: () => f.scope.process.getuid() + 1 } }
        : {}),
      heldFile: async (...args) => {
        const held = await f.io.heldFile(...args);
        if (args[0] === f.name) {
          if (mode === "race")
            await fs.writeFile(
              f.name,
              f.raw.toString().replace("15:00:00", "15:00:01"),
            );
          if (mode === "retired") f.retire();
        }
        return held;
      },
    });
    await assert.rejects(
      api.transactionNewRecord(f.state, f.recorded),
      (error) =>
        mode === "retired"
          ? error === false
          : /FULL_RECORD|REGULAR_FILE|FILE_CHANGED/.test(error.message),
      mode,
    );
    assert.equal(
      f.state.handles.length <= 1,
      true,
      "No sidecar/cache acceptance on invalid normalization",
    );
  }
});

test("control-root replacement is causal: unguarded model writes foreign root, actual guard denies before second identity", async () => {
  for (const guarded of [false, true]) {
    const state = {
      originalTools: { work: "/owned" },
      selected: {
        manifest: { identity: { producer: "old" } },
        freshIdentity: { producer: "new" },
      },
      handles: [],
      identities: [],
      controlHandle: null,
    };
    const directories = new Map([
        ["/owned/source", 1n],
        ["/owned/logs", 2n],
      ]),
      files = new Map();
    let foreignNewOpens = 0,
      replaced = false;
    const info = (ino, directory = true, size = 0) => ({
      dev: 1n,
      ino,
      uid: 123n,
      mode: directory ? 0o40700n : 0o100600n,
      nlink: 1n,
      size: BigInt(size),
      mtimeNs: 1n,
      ctimeNs: 1n,
      isDirectory: () => directory,
      isFile: () => !directory,
    });
    const fsModel = {
      mkdir: async (name) => directories.set(name, 3n),
      lstat: async (name) =>
        directories.has(name)
          ? info(directories.get(name))
          : files.get(name).info(),
      open: async (name) => {
        if (directories.has(name)) {
          const ino = directories.get(name);
          return { stat: async () => info(ino), close: async () => {} };
        }
        if (name.endsWith("new.json") && replaced) foreignNewOpens++;
        let raw = Buffer.alloc(0);
        const row = {
          info: () =>
            info(name.endsWith("old.json") ? 4n : 5n, false, raw.length),
        };
        files.set(name, row);
        return {
          writeFile: async (bytes) => {
            raw = Buffer.from(bytes);
          },
          stat: async () => row.info(),
          close: async () => {},
          sync: async () => {
            if (name.endsWith("old.json")) {
              directories.set(state.control, 99n);
              replaced = true;
            }
          },
        };
      },
    };
    const api = await privateFunctions(
      [
        "need",
        "transactionControls",
        ...(guarded ? ["transactionControlDirectory"] : []),
      ],
      {
        transactionCheck: () => 60000,
        transactionControlDirectory: async () => {},
        fs: fsModel,
        path: path.posix,
        constants,
        Buffer,
        process: { getuid: () => 123 },
        randomUUID: () => "fixed",
        noLinks: async (value) => value,
        canonical: core.canonical,
        sha: core.sha,
        stamp: (row) =>
          [row.dev, row.ino, row.mode, row.uid, row.size].join(":"),
        directoryIdentity: (row) =>
          [row.dev, row.ino, row.mode, row.uid].join(":"),
      },
    );
    if (guarded) {
      await assert.rejects(api.transactionControls(state), /CONTROL_ROOT/);
      assert.equal(foreignNewOpens, 0);
    } else {
      await api.transactionControls(state);
      assert.equal(foreignNewOpens, 1);
    }
    assert.equal(replaced, true);
  }
});

test("every modeled phase failure preserves falsy first causes, retires maps and never rolls back unknown leaves", async () => {
  for (const phase of [
    "controls",
    "restore",
    "old-apply1",
    "gn",
    "graph",
    "recipe",
    "old-apply2",
    "retirement",
    "new-record",
    "cache-binding",
  ]) {
    const marker =
      phase === "old-apply1" ? undefined : phase === "retirement" ? 0 : false;
    const m = await transactionModel({
      failAt: phase,
      marker,
      closeFault: true,
    });
    await m.api
      .runClosedLinuxMigrationTransaction(m.context, m.candidate, m.toolsToken)
      .then(
        () => assert.fail("phase failed but transaction succeeded"),
        (error) => assert.equal(error, marker),
      );
    assert.equal(m.activeMigrationTransactions.has(m.context), false);
    assert.equal(m.candidates.has(m.candidate), false);
    assert.equal(m.toolContexts.has(m.toolsToken), false);
    assert(!m.events.includes("rollback") && !m.events.includes("unlink"));
    if (phase === "old-apply1" || phase === "gn")
      assert(!m.events.includes("retirement"));
  }
});

test("a source owner retired during an awaited apply cannot reach GN, readiness or new record", async () => {
  const m = await transactionModel({ retireAt: "old-apply1" });
  await assert.rejects(
    m.api.runClosedLinuxMigrationTransaction(
      m.context,
      m.candidate,
      m.toolsToken,
    ),
    /CONTEXT_RETIRED/,
  );
  assert(!m.events.includes("gn"));
  assert(!m.events.includes("retirement"));
  assert(!m.events.includes("new-record"));
});

test("fixed retarget binds the actual main3aa129-row producer and committed non-authorizing capsule", async () => {
  assert.equal(Object.hasOwn(M, "runId"), false);
  assert.equal(
    M.policyPath,
    "native/cef-checkpoint-migrations/linux-arm-a4f715ed-mac-source-v1.json",
  );
  assert.equal(M.head, "3aa7d04278d75d64c53ff0a6d5bf8d56c94e5d3c");
  assert.equal(
    M.producer,
    "a4f715ed5755b718210cafb2aacb9d4179c7e3f49e0961ce800cca8fa4098837",
  );
  assert.equal(M.sourceFiles, 129);
  const actual = structuredClone(OLD_SOURCE_ROWS);
  assert.equal(actual.length, 129);
  assert.equal(core.codeTreeDigest(actual), M.producer);
  assert.equal(
    actual.some(
      (row) => row.path === "scripts/lib/cef-windows-arm-sdk-origin.mjs",
    ),
    true,
  );
  assert.notEqual(M.sourceFiles, 128);
  assert.notEqual(
    M.producer,
    "a148be3d5dc98f075d1774bdfa2fcd270a362b8c9c20f2f4c542c26bc60b1507",
  );
  const capsuleRaw = git(ROOT, ["cat-file", "blob", "HEAD:" + M.policyPath]);
  const reader = await privateFunctions(["json", "need"], {
    Buffer,
    TextDecoder,
    canonical: core.canonical,
  });
  reader.json(capsuleRaw, 128 * 1024);
  const capsule = JSON.parse(capsuleRaw.toString());
  assert.throws(
    () =>
      reader.json(
        Buffer.from(JSON.stringify(capsule, null, 2) + "\n"),
        128 * 1024,
      ),
    /CANONICAL_JSON/,
  );
  assert.equal(capsule.from.producer, M.producer);
  assert.deepEqual(capsule.oldSourceTree, actual);
  assert.equal(capsule.toProducer, core.codeTreeDigest(rows(ROOT, "HEAD")));
  assert.equal(capsule.from.checkpointProducer.runId, 41388464567);
  await assert.rejects(
    migration.readLinuxMigrationSelection(capsule),
    /LINUX_MIGRATION_SELECTION_ARGUMENTS/,
  );
  const archive = "scripts/lib/cef-checkpoint-archive.py";
  const canonical = git(ROOT, [
    "-c",
    "core.longpaths=true",
    "cat-file",
    "blob",
    "HEAD:" + archive,
  ]);
  assert.equal(canonical.length, 209272);
  assert.equal(
    core.sha(canonical),
    "1a8388c61458686cd1afccba934bfb2a2d5ccedde5de33d2b0fd0f70b9db85c8",
  );
  const physical = await fs.readFile(path.join(ROOT, archive));
  assert.deepEqual(
    Buffer.from(physical.toString("utf8").replaceAll("\r\n", "\n")),
    canonical,
    "The new proof uses canonical reviewed post-CEF state; CRLF is only checkout encoding",
  );
  const inverseFixture =
    "tests/fixtures/cef/mac_nearby_production_metadata_test.py";
  const inverseBytes = await fs.readFile(path.join(ROOT, inverseFixture));
  assert.equal(
    core.sha(Buffer.from(inverseBytes.toString().replaceAll("\r\n", "\n"))),
    "aab6509bb49dd74e3459d32a65305a4240278820a07c3be7859fa8b522e478e1",
  );
  // This retained test performs diagnostic a41 -> public3be -> native5af -> old839
  // literal inverses and asserts both COMPLETE historical helper hashes.
  execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      inverseFixture,
      "PublicScope.test_twelve_native_qualified_filesystem_hash_and_timestamp_functions_are_byte_equivalent",
    ],
    { cwd: ROOT, timeout: 20000, windowsHide: true, maxBuffer: 128 * 1024 },
  );
  const source = await fs.readFile(MODULE, "utf8");
  const ast = ts.createSourceFile(
    MODULE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const proof = ast.statements
    .flatMap((n) =>
      ts.isVariableStatement(n) ? [...n.declarationList.declarations] : [],
    )
    .find((n) => n.name.getText(ast) === "PROOF");
  assert(proof);
  const closed = vm.runInNewContext(
    "(" + proof.initializer.getText(ast) + ")",
    { sha: core.sha },
  );
  assert.equal(closed.archivePin.bytes, canonical.length);
  assert.equal(closed.archivePin.sha256, core.sha(canonical));
  assert.equal(
    closed.branch,
    "refs/heads/codex/linux-arm-final-helper-proof-20261102",
  );
  assert.notEqual(
    closed.oldProducer,
    M.producer,
    "scratch identity is not production authority",
  );
  const helper = "scripts/lib/cef-linux-sidecar-retirement.py";
  const raw = await fs.readFile(path.join(ROOT, helper));
  assert.equal(raw.length, 8967);
  assert.equal(
    core.sha(raw),
    "a41c8291078052487beff04c7cd3482a38afca0823cbf7364e3e250387c77cf9",
  );
  assert.deepEqual(
    git(ROOT, ["check-attr", "-z", "text", "--", helper])
      .toString()
      .split("\0")
      .filter(Boolean),
    [helper, "text", "unset"],
  );
});

test("inactive current-run inspection rejects retired413501 and missing actual capsule or seal pins", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      restoreRun: 41350119295,
    }),
    /FIXED_RUN/,
  );
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      oldManifestBytes: null,
      oldSealBytes: null,
      oldSealArtifact: null,
      oldInventoryBytes: null,
    }),
  );
  git(f.repo, ["rm", "--", M.policyPath]);
  git(f.repo, ["commit", "--quiet", "-m", "missing capsule must deny"]);
  const head = git(f.repo, ["rev-parse", "HEAD"]).toString().trim();
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      currentProducer: { ...f.args.currentProducer, head },
    }),
    /POLICY_MISSING/,
  );
});

test("canonical fixed-run capsule inspection is read-only and cannot activate restore", async (t) => {
  const f = await fixture(t);
  const before = git(f.repo, ["status", "--porcelain"]).toString();
  const candidate = await migration.inspectLinuxMigrationCandidate(f.args);
  assert.equal(candidate.authorizing, false);
  assert.equal(candidate.activation, "not-implemented");
  assert.equal(candidate.toProducer, f.args.freshIdentity.producer);
  assert.equal(git(f.repo, ["status", "--porcelain"]).toString(), before);
  // Even genuine inspection cannot call a caller-provided restore function.
  let calls = 0;
  await assert.rejects(
    migration.prepareLinuxMigrationRestore(candidate, {
      restore() {
        calls++;
      },
    }),
    /NOT_ACTIVATED/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    migration.createVerifiedLinuxMigrationTools(candidate),
    /FIXED_CHECKOUT/,
  );
  await assert.rejects(
    migration.createVerifiedLinuxMigrationTools({ ...candidate }),
    /OPAQUE_CANDIDATE/,
  );
  await assert.rejects(
    migration.closeVerifiedLinuxMigrationTools({
      python: process.execPath,
      verified: true,
    }),
    /OPAQUE_TOOLS/,
  );
  await assert.rejects(
    migration.prepareLinuxMigrationRetirement(
      { ready: true },
      { python: process.execPath },
    ),
    /OPAQUE_CREATOR/,
  );
  await assert.rejects(
    migration.prepareLinuxMigrationRestore({ ...candidate }, {}),
    /OPAQUE_CANDIDATE/,
  );
  assert.throws(
    () =>
      migration.inspectSidecarRetirementContract({
        kind: "restored-sidecar-creation-observation",
      }),
    /OPAQUE_CREATOR/,
  );
  await assert.rejects(
    migration.closeSidecarCreationObservation({}),
    /OPAQUE_CREATOR/,
  );
});

test("a committed synthetic newer run and attempt are data-selectable but never authenticated or activated", async (t) => {
  const moduleBefore = await fs.readFile(MODULE);
  const f = await fixture(t, { oldRunId: 41390000001, oldAttempt: 2 });
  const candidate = await migration.inspectLinuxMigrationCandidate(f.args);
  assert.equal(candidate.fromRunId, 41390000001);
  assert.equal(candidate.fromAttempt, 2);
  assert.equal(candidate.authorizing, false);
  assert.equal(candidate.activation, "not-implemented");
  await assert.rejects(
    migration.prepareLinuxMigrationRestore(candidate, {}),
    /NOT_ACTIVATED/,
  );
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      restoreRun: SEED_RUN,
    }),
    /FIXED_RUN/,
  );
  for (const change of [
    (producer) => {
      producer.runId = SEED_RUN;
    },
    (producer) => {
      producer.attempt = 3;
    },
    (producer) => {
      producer.head = "b".repeat(40);
    },
    (producer) => {
      producer.repository = "foreign/repository";
    },
    (producer) => {
      producer.repositoryId++;
    },
    (producer) => {
      producer.branch = "foreign";
    },
    (producer) => {
      producer.workflow = ".github/workflows/foreign.yml";
    },
  ]) {
    const policy = structuredClone(f.policy);
    change(policy.from.checkpointProducer);
    const head = await f.writePolicy(policy);
    await assert.rejects(
      migration.inspectLinuxMigrationCandidate({
        ...f.args,
        restoreRun: policy.from.checkpointProducer.runId,
        currentProducer: { ...f.args.currentProducer, head },
      }),
      /PRODUCER/,
    );
  }
  assert.deepEqual(await fs.readFile(MODULE), moduleBefore);
});

test("an arbitrary alternate policy path or caller JSON cannot replace the fixed committed capsule", async (t) => {
  const f = await fixture(t);
  const alternate = "native/cef-checkpoint-migrations/arbitrary.json";
  git(f.repo, ["mv", "--", M.policyPath, alternate]);
  git(f.repo, [
    "commit",
    "--quiet",
    "-m",
    "alternate path is not an authority",
  ]);
  const head = git(f.repo, ["rev-parse", "HEAD"]).toString().trim();
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      policyPath: alternate,
      policy: f.policy,
      admitted: true,
      currentProducer: { ...f.args.currentProducer, head },
    }),
    /POLICY_MISSING/,
  );
});

test("a final current-Git change cannot be hidden by mutating the caller producer object", async (t) => {
  const f = await fixture(t);
  let expectedChecks = 0;
  await migration.inspectLinuxMigrationCandidate({
    ...f.args,
    check: () => expectedChecks++,
  });
  assert(expectedChecks > 1);
  let calls = 0,
    changed = false;
  const producer = { ...f.args.currentProducer };
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      currentProducer: producer,
      check() {
        if (++calls !== expectedChecks) return;
        git(f.repo, [
          "commit",
          "--allow-empty",
          "--quiet",
          "-m",
          "late Git head change",
        ]);
        producer.head = git(f.repo, ["rev-parse", "HEAD"]).toString().trim();
        changed = true;
      },
    }),
    /CURRENT_HEAD/,
  );
  assert.equal(changed, true);
});

test("bounded capsule inverse restores the complete frozen old5da module without ancestor Git reads", async () => {
  let text = withoutTransactionDelta(
    (await fs.readFile(MODULE, "utf8")).replaceAll("\r\n", "\n"),
  );
  function inverse(added, original) {
    assert.equal(text.split(added).length, 2, "one exact capsule delta");
    text = text.replace(added, original);
  }
  for (const name of ["head", "selector", "record binding", "final head"]) {
    const begin = `  // BEGIN fixed same-producer capsule ${name}\n`;
    const end = `  // END fixed same-producer capsule ${name}\n`;
    assert.equal(text.split(begin).length, 2);
    assert.equal(text.split(end).length, 2);
    inverse(
      text.slice(text.indexOf(begin), text.indexOf(end) + end.length),
      "",
    );
  }
  inverse(
    '  head: "3aa7d04278d75d64c53ff0a6d5bf8d56c94e5d3c",',
    '  runId: 41378060040,\n  head: "3aa7d04278d75d64c53ff0a6d5bf8d56c94e5d3c",',
  );
  inverse(
    "native/cef-checkpoint-migrations/linux-arm-a4f715ed-mac-source-v1.json",
    "native/cef-checkpoint-migrations/linux-arm-41378060040-mac-source-v1.json",
  );
  inverse('  "scripts/cef-runtime-ci.mjs",\n', "");
  inverse(
    '  if (old) need(value.head === LINUX_MIGRATION.head, "OLD_PRODUCER");',
    '  if (old)\n    need(\n      value.runId === LINUX_MIGRATION.runId &&\n        value.head === LINUX_MIGRATION.head,\n      "OLD_PRODUCER",\n    );',
  );
  inverse(
    '  need(positive(restoreRun), "FIXED_RUN");',
    '  need(restoreRun === LINUX_MIGRATION.runId, "FIXED_RUN");',
  );
  inverse('    "checkpointProducer",\n', "");
  inverse(
    "    fromRunId: policy.from.checkpointProducer.runId,\n    fromAttempt: policy.from.checkpointProducer.attempt,\n",
    "",
  );
  assert.equal(Buffer.byteLength(text), 94129);
  assert.equal(
    core.sha(Buffer.from(text)),
    "5da6dd95dc4ad77d2822255880e27fc4052e00551a933e2cb1821c285043a8c3",
  );
  assert.match(text, /const PREPARATION_ONLY = true;/);
  assert.equal((text.match(/retirementReadiness\.set\(/g) ?? []).length, 0);
});

test("original deadline failure survives without invoking Git or a restore callback", async () => {
  const primary = new Error("original lease expired");
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      restoreRun: SEED_RUN,
      currentProducer: oldProducer(),
      check() {
        throw primary;
      },
    }),
    (error) => error === primary,
  );
});

test("actual imported proof entry rejects caller grants, paths, Python and callbacks without reading them", async () => {
  let touched = 0;
  const hostile = new Proxy(
    {},
    {
      get() {
        touched++;
        throw new Error("caller value read");
      },
    },
  );
  for (const value of [
    hostile,
    () => {
      touched++;
    },
    process.execPath,
    true,
    undefined,
  ]) {
    await assert.rejects(
      migration.runLinuxMigrationOwnedProof(value),
      /PROOF_ARGUMENTS/,
    );
    assert.equal(migration.readLinuxMigrationProofObservation(), null);
  }
  assert.equal(touched, 0);
  assert.throws(
    () => migration.readLinuxMigrationProofObservation(hostile),
    /PROOF_ARGUMENTS/,
  );
  await assert.rejects(
    migration.prepareLinuxMigrationRestore(
      { syntheticFixtureIdentity: true },
      hostile,
    ),
    /OPAQUE_CANDIDATE/,
  );
  await assert.rejects(
    migration.prepareLinuxMigrationRetirement(
      { sourceMigrationAdmitted: false },
      hostile,
    ),
    /OPAQUE_CREATOR/,
  );
});

test("actual imported proof entry denies missing or wrong host facts before creating an observation", async () => {
  const previous = process.env.ImageVersion;
  try {
    for (const value of [undefined, "unreviewed-image"]) {
      if (value === undefined) delete process.env.ImageVersion;
      else process.env.ImageVersion = value;
      await assert.rejects(
        migration.runLinuxMigrationOwnedProof(),
        /PROOF_HOST|PROOF_AUTHORITY/,
      );
      assert.equal(migration.readLinuxMigrationProofObservation(), null);
    }
  } finally {
    if (previous === undefined) delete process.env.ImageVersion;
    else process.env.ImageVersion = previous;
  }
});

test("parser accepts the real Python ASCII writer and rejects duplicate keys", async () => {
  const raw = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-S",
      "-c",
      "import json;print(json.dumps({'name':'caf\\u00e9\\U0001f600'},sort_keys=True,separators=(',',':')))",
    ],
    { timeout: 15000, maxBuffer: 4096, windowsHide: true },
  );
  // Windows text stdout may translate LF; the actual binary metadata writer
  // always writes one LF, which is the envelope being checked here.
  const writerBytes = Buffer.from(raw.toString().replace(/\r\n$/, "\n"));
  const api = await privateFunctions(["need", "json"], {
    Buffer,
    TextDecoder,
    canonical: core.canonical,
  });
  assert.equal(api.json(writerBytes, 4096).name, "café😀");
  assert.throws(
    () => api.json(Buffer.from('{"name":"old","name":"new"}\n'), 4096),
    /CANONICAL_JSON/,
  );
});

test("actual committed Linux source/toolchain pins use hash-only lock and size-based installed records", async () => {
  const inputs = core.checkpointProfile(M.target).inputs;
  const source = JSON.parse(
    git(ROOT, ["cat-file", "blob", "HEAD:" + inputs + "/source-lock.json"]),
  );
  const build = source.builds.find((row) => row.target === M.target);
  assert.deepEqual(Object.keys(build.toolchainLock).sort(), ["path", "sha256"]);
  const raw = git(ROOT, [
    "cat-file",
    "blob",
    "HEAD:" + inputs + "/" + build.toolchainLock.path,
  ]);
  const api = await privateFunctions(
    ["need", "exact", "checkedToolchainLock", "installedToolPin"],
    {
      Buffer,
      sha: core.sha,
      hex: (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
      positive: (value) => Number.isSafeInteger(value) && value > 0,
    },
  );
  const lock = api.checkedToolchainLock(raw, build.toolchainLock, M.target);
  const python = lock.files.find((row) => row.path === "usr/bin/python3.12");
  const map = lock.files.find(
    (row) => row.path === `cef-ci-runner-${M.target}.json`,
  );
  assert.equal(python.bytes, undefined);
  assert.equal(map.bytes, undefined);
  assert.equal(api.installedToolPin(python, 256 * 1024 ** 2).bytes, 8020928);
  assert.equal(
    api.installedToolPin(python, 256 * 1024 ** 2).sha256,
    "e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f",
  );
  const mapRaw = git(ROOT, [
    "cat-file",
    "blob",
    "HEAD:" + inputs + "/" + map.path,
  ]);
  assert.equal(api.installedToolPin(map, 1024 ** 2).bytes, mapRaw.length);
  assert.equal(api.installedToolPin(map, 1024 ** 2).sha256, core.sha(mapRaw));
  assert.throws(
    () =>
      api.checkedToolchainLock(
        raw,
        { ...build.toolchainLock, bytes: raw.length },
        M.target,
      ),
    /SHAPE/,
  );
  assert.throws(
    () =>
      api.installedToolPin(
        { path: python.path, bytes: python.size, sha256: python.sha256 },
        256 * 1024 ** 2,
      ),
    /SHAPE/,
  );
});

test("creation observation is retired before close, both descriptors close, falsy primary survives", async () => {
  const creators = new WeakMap(),
    token = Object.freeze({}),
    calls = [];
  creators.set(token, {
    handle: {
      async close() {
        calls.push("file");
        throw 0;
      },
    },
    rootHandle: {
      async close() {
        calls.push("root");
        throw new Error("secondary");
      },
    },
  });
  const cleanupReports = new WeakMap();
  const api = await privateFunctions(
    [
      "need",
      "recordCleanup",
      "closeCreatedObservation",
      "closeSidecarCreationObservation",
    ],
    { creators, cleanupReports },
  );
  await assert.rejects(
    api.closeSidecarCreationObservation(token),
    (error) => error === 0,
  );
  assert.deepEqual(calls, ["file", "root"]);
  assert.equal(creators.has(token), false);
  assert.equal(cleanupReports.get(token).closeFailures, 2);
  assert.equal(cleanupReports.get(token).descriptorsClosed, false);
  await assert.rejects(
    api.closeSidecarCreationObservation(token),
    /OPAQUE_CREATOR/,
  );
});

test("held regular inputs reject same-length changes, replacement, hardlinks and original lease failure", async (t) => {
  const root = await scratch(t),
    name = path.join(root, "manifest.json"),
    cleanupReports = new WeakMap();
  const stamp = (s) =>
    [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(
      ":",
    );
  const api = await privateFunctions(
    ["need", "heldFile", "revalidateHeldFile", "closeHeld"],
    {
      fs,
      constants,
      Buffer,
      createHash,
      noLinks: core.noLinks,
      stamp,
      cleanupReports,
    },
  );
  const original = Buffer.from("canonical pinned input\n");
  const largeName = path.join(root, "streamed-cache.json"),
    largeRaw = Buffer.alloc(2 * 1024 ** 2, 120);
  await fs.writeFile(largeName, largeRaw);
  const streamed = await api.heldFile(
    largeName,
    largeRaw.length,
    null,
    () => 60000,
    undefined,
    false,
  );
  try {
    assert.equal(streamed.raw, null);
    assert.equal(streamed.pin.sha256, core.sha(largeRaw));
    await api.revalidateHeldFile(streamed, largeName, () => 60000);
  } finally {
    await streamed.handle.close();
  }
  const defaultRead = await api.heldFile(
    largeName,
    largeRaw.length,
    null,
    () => 60000,
  );
  try {
    assert.deepEqual(defaultRead.raw, largeRaw);
  } finally {
    await defaultRead.handle.close();
  }
  await fs.writeFile(name, original);
  const file = await api.heldFile(name, 4096, pin(original), () => 60000);
  t.after(() => file.handle.close());
  await api.revalidateHeldFile(file, name, () => 60000);
  await fs.writeFile(name, Buffer.alloc(original.length, 120));
  await assert.rejects(
    api.revalidateHeldFile(file, name, () => 60000),
    /FILE_CHANGED/,
  );
  await fs.rename(name, name + ".original");
  await fs.writeFile(name, original);
  await assert.rejects(
    api.revalidateHeldFile(file, name, () => 60000),
    /FILE_CHANGED/,
  );
  const replacement = await api.heldFile(
    name,
    4096,
    pin(original),
    () => 60000,
  );
  t.after(() => replacement.handle.close());
  await fs.link(name, name + ".hardlink");
  await assert.rejects(
    api.revalidateHeldFile(replacement, name, () => 60000),
    /FILE_CHANGED/,
  );
  await assert.rejects(
    api.heldFile(name, 4096, pin(original), () => 60000),
    /REGULAR_FILE/,
  );
  await assert.rejects(
    api.revalidateHeldFile(replacement, name, () => {
      throw 0;
    }),
    (error) => error === 0,
  );
});

test("private retirement readiness ignores caller booleans and never executes a callback", async () => {
  const token = Object.freeze({}),
    toolsToken = Object.freeze({}),
    creators = new WeakMap(),
    toolContexts = new WeakMap();
  let calls = 0;
  creators.set(token, {
    ready: true,
    genuineGn: true,
    afterOldApplies: true,
    execute() {
      calls++;
    },
  });
  toolContexts.set(toolsToken, { ready: true });
  const api = await privateFunctions(["need", "retireCreationOwnedSidecar"], {
    creators,
    toolContexts,
    retirementReadiness: new WeakMap(),
  });
  await assert.rejects(
    api.retireCreationOwnedSidecar(token, toolsToken),
    /GENUINE_GN_AND_APPLIES_REQUIRED/,
  );
  assert.equal(calls, 0);
  assert.equal(creators.has(token), true);
});

test("strict helper report keeps partial rename truth and denies invented authority or inconsistent closure", async () => {
  const api = await privateFunctions(["need", "exact", "retirementResult"], {
    Buffer,
  });
  const partial = {
    schemaVersion: 1,
    kind: "sorng-linux-owned-sidecar-retirement-result",
    complete: false,
    phase: "readback",
    renamed: true,
    readback: false,
    descriptorsClosed: true,
    closeFailures: 0,
    migrationAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
    error: "RETIRE_READBACK",
    errno: null,
  };
  assert.equal(api.retirementResult(rawJson(partial)).renamed, true);
  assert.equal(api.retirementResult(rawJson(partial)).readback, false);
  for (const patch of [
    { migrationAdmitted: true },
    { phase: "PRIVATE" },
    { error: "RETIRE_PRIVATE" },
    { descriptorsClosed: true, closeFailures: 1 },
    { renamed: false, readback: true },
  ])
    assert.throws(
      () => api.retirementResult(rawJson({ ...partial, ...patch })),
      /RETIREMENT_REPORT|SHAPE/,
    );
});

test("owned leaf model joins fixed FD child, preserves late falsy expiry and never signals an exited root", async () => {
  const helper = path.join(ROOT, "scripts/lib/cef-linux-sidecar-retirement.py");
  const helperPin = pin(await fs.readFile(helper));
  for (const mode of [
    "success",
    "late-expiry",
    "late-local-end",
    "partial-rename",
    "never-exits",
  ]) {
    const token = Object.freeze({}),
      retirementReports = new WeakMap();
    let expired = false,
      signals = 0,
      unrefs = 0,
      pipeUnrefs = 0,
      childHandle,
      observedInput;
    const info = {
      dev: 1n,
      ino: 2n,
      uid: 3n,
      mode: 33152n,
      nlink: 1n,
      size: 1n,
      mtimeNs: 1n,
      ctimeNs: 1n,
    };
    const partial = mode === "partial-rename";
    const report = {
      schemaVersion: 1,
      kind: "sorng-linux-owned-sidecar-retirement-result",
      complete: !partial,
      phase: partial ? "readback" : "complete",
      renamed: true,
      readback: !partial,
      descriptorsClosed: true,
      closeFailures: 0,
      migrationAdmitted: false,
      nativeAcceptance: false,
      runtimeReady: false,
      ...(partial ? { error: "RETIRE_READBACK", errno: null } : {}),
    };
    const spawn = (python, args, options) => {
      assert.equal(python, "/verified/python");
      assert.deepEqual(Array.from(args), ["-I", "-B", "-S", helper]);
      assert.deepEqual(Array.from(options.stdio), [
        "pipe",
        "pipe",
        "pipe",
        7,
        8,
        9,
      ]);
      assert.equal(options.shell, false);
      assert.equal(options.env.GITHUB_TOKEN, undefined);
      const child = new EventEmitter();
      childHandle = child;
      child.pid = 777;
      child.unref = () => {
        unrefs++;
      };
      for (const role of ["stdin", "stdout", "stderr"]) {
        child[role] = new EventEmitter();
        child[role].destroy = () => child[role].emit("close");
        child[role].unref = () => {
          pipeUnrefs++;
        };
      }
      child.kill = () => {
        signals++;
        return true;
      };
      child.stdin.end = (raw) => {
        observedInput = JSON.parse(raw);
        if (mode === "never-exits") return;
        queueMicrotask(() => {
          if (mode === "late-local-end") {
            // The production local timer already exists. Block this microtask
            // so late child-close beats its now-overdue timer callback.
            const began = performance.now();
            while (performance.now() - began < 80) {
              /* fixed bounded regression */
            }
          }
          child.stdout.emit("data", rawJson(report));
          child.emit("exit", partial ? 1 : 0);
          expired = mode === "late-expiry";
          for (const role of ["stdin", "stdout", "stderr"])
            child[role].emit("close");
          child.emit("close");
        });
      };
      return child;
    };
    const api = await privateFunctions(
      [
        "need",
        "exact",
        "fileStampObject",
        "directoryStampObject",
        "retirementResult",
        "runRetirementLeaf",
      ],
      {
        Buffer,
        path,
        spawn,
        performance,
        setTimeout,
        clearTimeout,
        retirementReports,
        RETIREMENT_HELPER: helper,
        RETIREMENT_HELPER_PIN: helperPin,
        LIMITS: core.LIMITS,
        canonical: core.canonical,
        revalidateHeldFile: async () => {},
      },
    );
    const tools = {
      python: "/verified/python",
      pythonFile: {},
      retirementFile: { pin: helperPin },
      originalEndMs: Date.now() + 1000,
      remaining() {
        if (expired) throw 0;
        return ["late-local-end", "never-exits"].includes(mode) ? 40 : 1000;
      },
    };
    const created = {
      handle: {
        fd: 8,
        async stat() {
          return info;
        },
      },
      rootHandle: {
        fd: 7,
        async stat() {
          return info;
        },
      },
      pin: { sha256: "a".repeat(64) },
    };
    const destination = {
      handle: {
        fd: 9,
        async stat() {
          return info;
        },
      },
    };
    const result = api.runRetirementLeaf(token, tools, created, destination);
    if (mode === "success") assert.equal((await result).complete, true);
    else if (mode === "late-expiry")
      await assert.rejects(result, (error) => error === 0);
    else if (mode === "late-local-end")
      await assert.rejects(result, /RETIREMENT_DEADLINE/);
    else if (mode === "never-exits")
      await assert.rejects(result, /RETIREMENT_DEADLINE/);
    else await assert.rejects(result, /RETIREMENT_FAILED/);
    if (mode === "never-exits") {
      assert(signals >= 1);
      assert.equal(unrefs, 1);
      assert.equal(pipeUnrefs, 3);
      assert.equal(retirementReports.get(token).childJoined, false);
      assert.equal(retirementReports.get(token).childHandleRetired, true);
      assert.equal(retirementReports.get(token).renamed, null);
      const beforeLateExit = signals;
      childHandle.emit("exit", 0);
      childHandle.emit("error", new Error("PRIVATE late error"));
      childHandle.emit("close");
      assert.equal(signals, beforeLateExit);
    } else {
      assert.equal(signals, 0);
      assert.equal(retirementReports.get(token).childJoined, true);
      assert.equal(retirementReports.get(token).renamed, true);
    }
    assert.equal(observedInput.kind, "sorng-linux-owned-sidecar-retirement");
    assert.equal("path" in observedInput, false);
    assert.equal(retirementReports.get(token).accepted, false);
    assert.equal(retirementReports.get(token).leafAccepted, mode === "success");
    assert.equal(retirementReports.get(token).sourceInodeCas, false);
  }
});

test("wrong run/head, all seven changed identity fields and mutated seal assets deny", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      restoreRun: 41323982797,
    }),
    /FIXED_RUN/,
  );
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      currentProducer: { ...f.args.currentProducer, head: "f".repeat(40) },
    }),
    /CURRENT_HEAD/,
  );
  for (const field of [
    "target",
    "source",
    "canonicalRoot",
    "image",
    "tools",
    "graph",
    "siso",
  ]) {
    const identity = {
      ...f.args.freshIdentity,
      [field]:
        field === "target"
          ? "x86_64-apple-darwin"
          : field === "canonicalRoot"
            ? path.join(f.root, "other")
            : field === "image"
              ? "other"
              : "f".repeat(64),
    };
    await assert.rejects(
      migration.inspectLinuxMigrationCandidate({
        ...f.args,
        freshIdentity: identity,
      }),
    );
  }
  for (const field of ["oldManifestBytes", "oldSealBytes", "oldInventoryBytes"])
    await assert.rejects(
      migration.inspectLinuxMigrationCandidate({
        ...f.args,
        [field]: Buffer.concat([f.args[field], Buffer.from(" ")]),
      }),
      /PIN_MISMATCH/,
    );
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      oldSealArtifact: { ...f.args.oldSealArtifact, id: 18 },
    }),
    /SEAL_ARTIFACT/,
  );
});

test("committed policy cannot relabel the source delta, Linux schema or to digest", async (t) => {
  const f = await fixture(t);
  for (const mutate of [
    (p) => {
      p.toProducer = "f".repeat(64);
    },
    (p) => {
      p.from.producer = "f".repeat(64);
    },
    (p) => {
      p.changedSources = [];
    },
    (p) => {
      p.oldSourceTree.pop();
    },
    (p) => {
      p.linuxMetadata.schemaVersion = 2;
    },
    (p) => {
      p.linuxMetadata.sourceDateEpoch = "1";
    },
  ]) {
    const policy = structuredClone(f.policy);
    mutate(policy);
    const head = await f.writePolicy(policy);
    await assert.rejects(
      migration.inspectLinuxMigrationCandidate({
        ...f.args,
        currentProducer: { ...f.args.currentProducer, head },
      }),
    );
  }
  const raw = Buffer.from(
    rawJson(f.policy)
      .toString()
      .replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
  );
  const head = await f.writePolicy(f.policy, raw);
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      currentProducer: { ...f.args.currentProducer, head },
    }),
    /CANONICAL_JSON/,
  );
  await f.writePolicy();
  await fs.writeFile(
    path.join(f.repo, "scripts/unreviewed-fixture.mjs"),
    "export const unexpected = true;\n",
  );
  git(f.repo, ["add", "--", "scripts/unreviewed-fixture.mjs"]);
  git(f.repo, ["commit", "--quiet", "-m", "unreviewed selected delta"]);
  const digest = core.codeTreeDigest(rows(f.repo, "HEAD"));
  const policy = structuredClone(f.policy);
  policy.toProducer = digest;
  await fs.writeFile(path.join(f.repo, M.policyPath), rawJson(policy));
  git(f.repo, ["add", "--", M.policyPath]);
  git(f.repo, [
    "commit",
    "--quiet",
    "-m",
    "candidate cannot broaden source allowlist",
  ]);
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      ...f.args,
      currentProducer: {
        ...f.args.currentProducer,
        head: git(f.repo, ["rev-parse", "HEAD"]).toString().trim(),
      },
      freshIdentity: { ...f.args.freshIdentity, producer: digest },
    }),
    /UNREVIEWED_SOURCE_DELTA/,
  );
});

test("dirty producer bytes and uncommitted replacement capsule cannot be witnesses", async (t) => {
  const f = await fixture(t);
  const script = path.join(
    f.repo,
    "scripts/lib/cef-linux-producer-migration.mjs",
  );
  const original = await fs.readFile(script);
  await fs.appendFile(script, "\n// changed\n");
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate(f.args),
    /PIN_MISMATCH/,
  );
  await fs.writeFile(script, original);
  await fs.appendFile(path.join(f.repo, M.policyPath), " ");
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate(f.args),
    /PIN_MISMATCH/,
  );
});

test("three-pass estimate preserves original 300m lease, 70m reserve and explicit slices", () => {
  const full = migration.inspectLinuxMigrationBudget({
    startedMs: 1,
    nowMs: 1,
  });
  assert.equal(full.authorizing, false);
  assert.equal(full.lowerBoundOnly, true);
  assert.equal(full.remainingMs, 300 * 60000);
  assert.equal(full.metadataPasses, 3);
  assert.equal(full.metadataMs, 120 * 60000);
  assert.equal(full.reserveMs, 70 * 60000);
  assert.equal(full.compileMs, 110 * 60000);
  assert.throws(
    () =>
      migration.inspectLinuxMigrationBudget({
        startedMs: 1,
        nowMs: 96 * 60000 + 1,
      }),
    /INSUFFICIENT_ORIGINAL_LEASE/,
  );
  assert.throws(
    () =>
      migration.inspectLinuxMigrationBudget({
        startedMs: 1,
        nowMs: 1,
        sliceMs: 120 * 60000,
      }),
    /REQUESTED_SLICE/,
  );
  const explicit = migration.inspectLinuxMigrationBudget({
    startedMs: 1,
    nowMs: 1,
    sliceMs: 15 * 60000,
  });
  assert.equal(explicit.compileMs, 15 * 60000);
  assert.equal(explicit.additionalStageBudgetMs, 95 * 60000);
  assert.throws(
    () => migration.inspectLinuxMigrationBudget({ startedMs: 2, nowMs: 1 }),
    /ORIGINAL_CLOCK/,
  );
});

test(
  "private creator unit uses genuine Python restore and adjacent install, not JSON ownership",
  {
    skip:
      process.platform !== "linux" || process.arch !== "x64"
        ? "requires genuine Linux x64 ownership/FDs; ARM source metadata, not ARM native acceptance"
        : false,
  },
  async (t) => {
    const root = await scratch(t),
      work = path.join(root, "work"),
      fresh = path.join(work, "source/src/out/Release_GN_arm64"),
      input = path.join(root, "input"),
      bundle = path.join(root, "bundle");
    for (const directory of [fresh, input]) {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "build.ninja"), "reviewed graph");
      await fs.writeFile(path.join(directory, "args.gn"), 'target_cpu="arm64"');
    }
    const sidecar = rawJson({
      fixture: "actual restored bytes, not a report capability",
    });
    await fs.writeFile(path.join(input, M.sidecar), sidecar);
    const helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      python = await fs.realpath(
        execFileSync(
          "python3",
          ["-I", "-B", "-S", "-c", "import sys;print(sys.executable)"],
          {
            timeout: 15000,
            maxBuffer: 4096,
          },
        )
          .toString()
          .trim(),
      );
    const archive = await core.archiveCommand(python, helper, [
      "pack",
      "--input",
      input,
      "--output",
      bundle,
    ]);
    const inventory = await fs.readFile(path.join(bundle, "inventory.json"));
    const identity = {
      target: M.target,
      source: M.source,
      producer: M.producer,
      canonicalRoot: work,
      image: "20261026.354.1",
      tools: "b".repeat(64),
      graph: await core.graphDigest(fresh),
      siso: "d".repeat(64),
    };
    const full = manifest(identity, inventory);
    full.archive = archive;
    const manifestBytes = rawJson(full);
    await fs.writeFile(path.join(bundle, "manifest.json"), manifestBytes);
    const recipePath = path.join(work, "logs/generated-sdk-links.json");
    await fs.mkdir(path.dirname(recipePath), { recursive: true });
    await fs.writeFile(recipePath, "{}");
    const source = await fs.readFile(MODULE, "utf8"),
      ast = ts.createSourceFile(
        MODULE,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
    const names = [
      "need",
      "heldFile",
      "revalidateHeldFile",
      "closeHeld",
      "recordCleanup",
      "restoreAndInstallOwnedSidecar",
      "restoreOwnedCommon",
      "restorePreparedCommon",
      "closeCreatedObservation",
      "inspectSidecarRetirementContract",
      "closeSidecarCreationObservation",
      "closeVerifiedLinuxMigrationTools",
    ];
    const declarations = names
      .map((name) => {
        const node = ast.statements.find(
          (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
        );
        assert(node, name);
        return node.getText(ast).replace(/^export /, "");
      })
      .join("\n");
    const candidates = new WeakMap(),
      creators = new WeakMap(),
      toolContexts = new WeakMap(),
      cleanupReports = new WeakMap(),
      candidate = Object.freeze({});
    candidates.set(candidate, {
      freshIdentity: identity,
      sidecar: pin(sidecar),
      manifestPin: pin(manifestBytes),
      inventoryPin: pin(inventory),
    });
    // Only the private map is supplied by this unit harness. Restoration, graph
    // validation, file reads, rename and close all use the production functions.
    const api = vm.runInNewContext(
      declarations +
        "\n({ heldFile, restoreAndInstallOwnedSidecar, inspectSidecarRetirementContract, closeSidecarCreationObservation, closeVerifiedLinuxMigrationTools })",
      {
        assert,
        fs,
        path,
        constants,
        createHash,
        Buffer,
        process,
        candidates,
        creators,
        toolContexts,
        cleanupReports,
        LINUX_MIGRATION: M,
        LIMITS: core.LIMITS,
        SOURCE_METADATA_MAX_BYTES: core.SOURCE_METADATA_MAX_BYTES,
        HELPER: helper,
        noLinks: core.noLinks,
        archiveCommand: core.archiveCommand,
        verifyGraph: core.verifyGraph,
        installRestoredDirectory: core.installRestoredDirectory,
        positive: (n) => Number.isSafeInteger(n) && n > 0,
        directoryIdentity: (s) => [s.dev, s.ino, s.uid, s.mode].join(":"),
        stamp: (s) =>
          [
            s.dev,
            s.ino,
            s.uid,
            s.mode,
            s.nlink,
            s.size,
            s.mtimeNs,
            s.ctimeNs,
          ].join(":"),
      },
    );
    // A private unit context, not evidence for the production verified issuer.
    // The held files and child extraction/install themselves are real Linux IO.
    const toolsToken = Object.freeze({});
    const check = () => 60000;
    const pythonFile = await api.heldFile(
      python,
      256 * 1024 ** 2,
      pin(await fs.readFile(python)),
      check,
    );
    const archiveFile = await api.heldFile(
      helper,
      4 * 1024 ** 2,
      pin(await fs.readFile(helper)),
      check,
    );
    toolContexts.set(toolsToken, {
      candidate,
      python,
      pythonFile,
      archiveFile,
      held: [pythonFile, archiveFile],
      bundle,
      recipePath,
      recipePin: pin(Buffer.from("{}")),
      remaining: check,
    });
    t.after(async () => {
      if (toolContexts.has(toolsToken))
        await api.closeVerifiedLinuxMigrationTools(toolsToken);
    });
    const token = await api.restoreAndInstallOwnedSidecar(
      candidate,
      toolsToken,
    );
    assert.equal(
      api.inspectSidecarRetirementContract(token).executorAvailable,
      false,
    );
    assert.throws(
      () => api.inspectSidecarRetirementContract({ ...token }),
      /OPAQUE_CREATOR/,
    );
    assert.deepEqual(await fs.readFile(path.join(fresh, M.sidecar)), sidecar);
    assert.equal((await fs.lstat(fresh + ".fresh-gn")).isDirectory(), true);
    await api.closeSidecarCreationObservation(token);
    assert.throws(
      () => api.inspectSidecarRetirementContract(token),
      /OPAQUE_CREATOR/,
    );
    await assert.rejects(
      api.closeSidecarCreationObservation(token),
      /OPAQUE_CREATOR/,
    );
  },
);

test("migration diagnostics preserve the complete old a41 core and e0f transaction through exact inverses", async () => {
  const source = (await fs.readFile(MODULE, "utf8")).replaceAll("\r\n", "\n");
  withoutMigrationDiagnostics(source);
  let old = (
    await fs.readFile(
      path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
      "utf8",
    )
  ).replaceAll("\r\n", "\n");
  const first = "// BEGIN closed Linux migration diagnostics\n",
    last = "// END closed Linux migration diagnostics\n\n";
  assert.equal(old.split(first).length, 2);
  assert.equal(old.split(last).length, 2);
  old = old.replace(
    old.slice(old.indexOf(first), old.indexOf(last) + last.length),
    "",
  );
  const restoreFirst =
      "    // BEGIN restore-only fixed migration assertion projection\n",
    restoreLast =
      "    // END restore-only fixed migration assertion projection\n";
  assert.equal(old.split(restoreFirst).length, 2);
  assert.equal(old.split(restoreLast).length, 2);
  old = old.replace(
    old.slice(
      old.indexOf(restoreFirst),
      old.indexOf(restoreLast) + restoreLast.length,
    ),
    "",
  );
  const current = 'import { promisify, types as utilTypes } from "node:util";';
  assert.equal(old.split(current).length, 2);
  old = old.replace(current, 'import { promisify } from "node:util";');
  assert.equal(Buffer.byteLength(old), 236101);
  assert.equal(
    core.sha(old),
    "7d9ad013b3fa508162cba564de8a74cbbb01d833412a117fbc0578204a0b5a45",
  );
});
test("migration diagnostic native error classifier closes fixed codes without reading accessors, proxies or unknown text", () => {
  const phase = "recipe-check",
    label = "LINUX_MIGRATION_TRANSACTION_RECIPE_CHANGED";
  assert.equal(
    core.linuxMigrationFailureRecord(new Error(label), phase).code,
    label,
  );
  const io = new Error("PRIVATE_PATH_AND_VALUE");
  io.code = "ENOSPC";
  assert.equal(
    core.linuxMigrationFailureRecord(io, "source-record").code,
    "ENOSPC",
  );
  let reads = 0;
  const getter = new Error();
  Object.defineProperty(getter, "message", {
    get() {
      reads++;
      throw false;
    },
  });
  Object.defineProperty(getter, "code", {
    get() {
      reads++;
      throw 0;
    },
  });
  const proxy = new Proxy(new Error(label), {
    get() {
      reads++;
      throw false;
    },
    getOwnPropertyDescriptor() {
      reads++;
      throw false;
    },
  });
  for (const value of [
    undefined,
    null,
    false,
    0,
    "PRIVATE",
    { message: label },
    getter,
    proxy,
    new Error(label + " PRIVATE"),
  ]) {
    const record = core.linuxMigrationFailureRecord(value, phase);
    assert.equal(record.code, "UNKNOWN");
    assert(!JSON.stringify(record).includes("PRIVATE"));
  }
  assert.equal(reads, 0);
  assert.equal(
    core.linuxMigrationFailureRecord(new Error(label), "PRIVATE_PATH").phase,
    "entry",
  );
});
test(
  "migration actual source-mode adapter adds strict helper diagnostics for both old applies and new record without changing the first failure",
  { timeout: 15000 },
  async (t) => {
    const folder = await scratch(t),
      helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
    const python = execFileSync(
      process.platform === "win32" ? "python" : "python3",
      ["-I", "-B", "-c", "import sys;print(sys.executable)"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    for (const name of ["old", "new"])
      await fs.writeFile(path.join(folder, name + ".json"), Buffer.alloc(0));
    const source = await fs.readFile(MODULE, "utf8"),
      old = withoutMigrationDiagnostics(source.replaceAll("\r\n", "\n"));
    const declaration = (text) => {
      const ast = ts.createSourceFile(
        "adapter.mjs",
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      return ast.statements
        .find(
          (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name.text === "transactionSourceMode",
        )
        .getText(ast);
    };
    for (const [mode, which, phase] of [
      ["source-apply", "old", "source-apply-1"],
      ["source-apply", "old", "source-apply-2"],
      ["source-record", "new", "source-record"],
    ]) {
      for (const guarded of [false, true]) {
        const logs = [];
        let primary;
        const state = {
          source: folder,
          diagnosticPhase: phase,
          identities: [{ path: path.join(folder, which + ".json") }],
          originalTools: { python, out: path.join(folder, "out") },
        };
        const api = vm.runInNewContext(
          declaration(guarded ? source : old) + ";transactionSourceMode",
          {
            need: (condition, reason) => assert(condition, reason),
            transactionCheck: () => 6000,
            LIMITS: core.LIMITS,
            LINUX_MIGRATION: M,
            HELPER: helper,
            path,
            sourceMetadataResult: core.sourceMetadataResult,
            migrationDiagnostic: (record) => logs.push(record),
            archiveCommand: async (...args) => {
              try {
                return await core.archiveCommand(...args);
              } catch (error) {
                primary = error;
                throw error;
              }
            },
          },
        );
        await assert.rejects(
          api(state, mode, which),
          (error) =>
            error === primary &&
            error.message === "Checkpoint archive rejected",
        );
        assert.equal(logs.length, guarded ? 1 : 0);
        if (guarded) {
          const row = logs[0];
          assert.equal(row.phase, phase);
          assert.equal(row.source, which);
          assert.equal(row.mode, mode);
          assert.deepEqual(row.record, {
            error: "source-metadata-read-bound",
            sourceMetadataReadFailure: {
              mode,
              stage: "stat",
              phase: "start",
              predicate: "empty",
              size: 0,
              nlink: 1,
              kind: "regular",
              maximum: 16384,
              readBytes: null,
            },
            exitCode: 1,
          });
          assert(!JSON.stringify(row).includes(folder));
        }
      }
    }
  },
);
test("migration phase breadcrumbs keep actual orchestration order and preserve falsy primary when the diagnostic observer fails", async () => {
  for (const [stage, phase] of [
    ["recipe", "recipe-check"],
    ["old-apply2", "source-apply-2"],
    ["new-record", "source-record"],
  ]) {
    const rows = [],
      primary = new Error("LINUX_MIGRATION_TRANSACTION_RECIPE_CHANGED");
    const model = await transactionModel({
      failAt: stage,
      marker: primary,
      diagnosticLog: (line) =>
        rows.push(JSON.parse(line.slice(line.indexOf("{")))),
    });
    await assert.rejects(
      model.api.runClosedLinuxMigrationTransaction(
        model.context,
        model.candidate,
        model.toolsToken,
      ),
      (error) => error === primary,
    );
    const failure = rows.find(
      (row) => row.kind === "sorng-linux-migration-failure",
    );
    assert.equal(failure.phase, phase);
    assert.equal(failure.code, primary.message);
    assert.equal(model.activeMigrationTransactions.has(model.context), false);
  }
  const model = await transactionModel({
    failAt: "old-apply2",
    marker: false,
    diagnosticLog: () => {
      throw new Error("OBSERVER_FAILURE");
    },
  });
  await assert.rejects(
    model.api.runClosedLinuxMigrationTransaction(
      model.context,
      model.candidate,
      model.toolsToken,
    ),
    (error) => error === false,
  );
});

test("migration failure projector exceptions cannot replace an original false operation error", async () => {
  const model = await transactionModel({
    failAt: "old-apply2",
    marker: false,
    diagnosticRecord: () => {
      throw undefined;
    },
  });
  await assert.rejects(
    model.api.runClosedLinuxMigrationTransaction(
      model.context,
      model.candidate,
      model.toolsToken,
    ),
    (error) => error === false,
  );
});

test("outer restore-only migration assertions retain strict native codes before transaction entry without replacing first errors", async () => {
  const code = "LINUX_MIGRATION_FROM_DIGEST",
    primary = new Error(code);
  const source = await fs.readFile(
    path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const ast = ts.createSourceFile(
      "core.mjs",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    bindings = {};
  for (const name of [
    "AFTER_GN_PHASES",
    "AFTER_GN_CODES",
    "LINUX_DEPENDENCY_ROLES",
  ]) {
    const node = ast.statements
      .flatMap((item) =>
        ts.isVariableStatement(item)
          ? [...item.declarationList.declarations]
          : [],
      )
      .find((item) => item.name.getText(ast) === name);
    assert(node);
    bindings[name] = vm.runInNewContext(
      "(" + node.initializer.getText(ast) + ")",
      { Set },
    );
  }
  let old = core.afterGnPhase.toString().replace(/\r\n/g, "\n");
  const first =
      "    // BEGIN restore-only fixed migration assertion projection\n",
    last = "    // END restore-only fixed migration assertion projection\n";
  assert.equal(old.split(first).length, 2);
  assert.equal(old.split(last).length, 2);
  old = old.replace(
    old.slice(old.indexOf(first), old.indexOf(last) + last.length),
    "",
  );
  const previous = vm.runInNewContext("(" + old + ")", {
    assert,
    ...bindings,
    GRAPH_LIMITS: core.GRAPH_LIMITS,
  });
  const oldLines = [];
  await assert.rejects(
    previous(
      "restore",
      async () => {
        throw primary;
      },
      (line) => oldLines.push(line),
    ),
    (error) => error === primary,
  );
  assert.equal(oldLines.length, 2);
  assert(!oldLines.some((line) => line.includes(code)));
  for (const phase of ["restore", "identity"]) {
    const lines = [];
    await assert.rejects(
      core.afterGnPhase(
        phase,
        async () => {
          throw primary;
        },
        (line) => lines.push(line),
      ),
      (error) => error === primary,
    );
    const records = lines
      .filter((line) => line.includes("linux-migration "))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
    assert.equal(records.length, phase === "restore" ? 1 : 0);
    if (records.length)
      assert.deepEqual(records[0], {
        kind: "sorng-linux-migration-failure",
        schemaVersion: 1,
        phase: "entry",
        code,
      });
  }
  let reads = 0;
  const accessor = new Error();
  Object.defineProperty(accessor, "message", {
    get() {
      reads++;
      throw new Error("PRIVATE");
    },
  });
  for (const error of [
    false,
    0,
    undefined,
    new Error("PRIVATE"),
    { message: code },
    accessor,
  ]) {
    const lines = [];
    await assert.rejects(
      core.afterGnPhase(
        "restore",
        async () => {
          throw error;
        },
        (line) => lines.push(line),
      ),
      (value) => value === error,
    );
    assert.equal(lines.length, 2);
    assert(!JSON.stringify(lines).includes("PRIVATE"));
  }
  assert.equal(reads, 0);
  await assert.rejects(
    core.afterGnPhase(
      "restore",
      async () => {
        throw primary;
      },
      (line) => {
        if (line.includes("linux-migration ")) throw false;
      },
    ),
    (error) => error === primary,
  );
});
