import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WORKFLOW_CLOCK_ENV,
  WORKFLOW_WHOLE_MS,
  FIRST_WORKFLOW_CLOCK_STEP,
  readWorkflowClock,
  intersectWorkflowClock,
} from "../../native/windows-arm-full-sdk/workflow-clock.mjs";

// BEGIN EXACT CLOCK FAILURE ENUM INVERSE
const CLOCK_FAILURE_INVERSE = {
  block:
    '// BEGIN FIXED WORKFLOW CLOCK FAILURE CODES\nconst STARTUP_CLOCK_ERRORS = new Set([\n  "FULL_SDK_WORKFLOW_CLOCK_RAW",\n  "FULL_SDK_WORKFLOW_CLOCK_FIELDS",\n  "FULL_SDK_WORKFLOW_CLOCK_KIND",\n  "FULL_SDK_WORKFLOW_CLOCK_INTEGER",\n  "FULL_SDK_WORKFLOW_CLOCK_WALL_DEADLINE",\n  "FULL_SDK_WORKFLOW_CLOCK_SCOPE",\n  "FULL_SDK_WORKFLOW_CLOCK_EXECUTION",\n  "FULL_SDK_WORKFLOW_CLOCK_HOST",\n  "FULL_SDK_WORKFLOW_CLOCK_TICK_DEADLINE",\n  "FULL_SDK_WORKFLOW_CLOCK_PROJECTION",\n  "FULL_SDK_WORKFLOW_CLOCK_EXPIRED",\n]);\n// END FIXED WORKFLOW CLOCK FAILURE CODES\n',
  blockSha256:
    "a1da21bcb09f13c39300d1781fcc6bb09945f335d0e4842e3683b80a72ba5902",
  newPredicate:
    "    (/^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message) ||\n      STARTUP_CLOCK_ERRORS.has(message))\n",
  oldPredicate: "    /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message)\n",
  bytes: 165012,
  sha256: "5a36ad235d7bbf55a1a9680d557c2ce907709d227c5b591630f4f77c5b6dcc58",
};
const PRODUCER_METRIC_INVERSE = {
  bytes: 165597,
  sha256: "2cc73bfe26fa61b66d4820e2f1522501954b6bb198bfcfa69d15c07bfe32292f",
  rows: [
    {
      oldRaw:
        "    throw fail(state, error);\n  }\n}\nasync function createControl(sourceReceipt, leaseToken) {\n  const source = sourceState(sourceReceipt, leaseToken);\n  checkLease(leaseToken);\n",
      newRaw:
        '    throw fail(state, error);\n  }\n}\n// BEGIN CHECKED INPUT CLOSURE DATA\n// Only actual completed held-input rechecks issue these private observations.\n// Their copied records describe this finite checked closure, never all Chromium.\nconst checkedInputObservations = new WeakMap();\nfunction checkedInputRow(records, relative, actual) {\n  need(\n    actual &&\n      actual.pin &&\n      Number.isSafeInteger(actual.pin.bytes) &&\n      actual.pin.bytes >= 0 &&\n      /^[a-f0-9]{64}$/.test(actual.pin.sha256),\n    "INPUT_CLOSURE_PIN",\n  );\n  records.push(\n    Object.freeze({\n      relative,\n      bytes: actual.pin.bytes,\n      sha256: actual.pin.sha256,\n    }),\n  );\n}\nfunction issueCheckedInputObservation(\n  sourceReceipt,\n  leaseToken,\n  state,\n  records,\n) {\n  sourceState(sourceReceipt, leaseToken);\n  operationState(state.operationToken, true);\n  const unique = new Map();\n  for (const row of records) {\n    need(\n      !unique.has(row.relative) ||\n        canonical(unique.get(row.relative)) === canonical(row),\n      "INPUT_CLOSURE_DUPLICATE",\n    );\n    unique.set(row.relative, row);\n  }\n  const context = unique.get("context.json");\n  need(\n    context &&\n      state.metadataSnapshot &&\n      /^[a-f0-9]{64}$/.test(state.metadataSnapshot.projectionSha256) &&\n      unique.size <= 256,\n    "INPUT_CLOSURE_SCOPE",\n  );\n  const inputs = state.plan.producerInputs\n    .map((row) => ({ ...row }))\n    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));\n  const content = Object.freeze({\n    schemaVersion: 1,\n    kind: "windows-arm-checked-input-closure",\n    sourceContextSha256: context.sha256,\n    image: state.plan.image,\n    sourceId: state.plan.sourceId,\n    producerSha256: hashBytes(Buffer.from(canonical(inputs))),\n    metadataProjectionSha256: state.metadataSnapshot.projectionSha256,\n    records: Object.freeze(\n      [...unique.values()].sort((a, b) =>\n        a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,\n      ),\n    ),\n  });\n  const observation = Object.freeze({\n    kind: "private-checked-input-observation",\n  });\n  checkedInputObservations.set(observation, {\n    sourceReceipt,\n    leaseToken,\n    operation: state,\n    content,\n  });\n  return observation;\n}\nfunction consumeCheckedInputObservation(token, state, observation, boundary) {\n  retained(token, state);\n  const actual = checkedInputObservations.get(observation);\n  checkedInputObservations.delete(observation);\n  need(\n    actual &&\n      actual.sourceReceipt === state.sourceReceipt &&\n      actual.leaseToken === state.leaseToken &&\n      operationState(state.source.operationToken, true) === actual.operation &&\n      sourceState(state.sourceReceipt, state.leaseToken) === state.source &&\n      ["before-probe-clang", "after-package-before-sdk-seal"].includes(\n        boundary,\n      ),\n    "INPUT_CLOSURE_BRAND",\n  );\n  return Object.freeze({\n    boundary,\n    sha256: hashBytes(Buffer.from(canonical(actual.content))),\n    content: actual.content,\n  });\n}\n// END CHECKED INPUT CLOSURE DATA\n\nasync function createControl(sourceReceipt, leaseToken) {\n  const source = sourceState(sourceReceipt, leaseToken);\n  checkLease(leaseToken);\n',
      oldSha256:
        "dfed1167795b491ba7ddba9ebf2e9312021c46d267123cb2f96016cd054a9c21",
      newSha256:
        "6cfd98911baae0e7dabeab6732e02f97daae95bccf4dd3a6f5121c146880b395",
    },
    {
      oldRaw:
        "    }\n    await work(token, state, () => custom.sourceGitEnvironment(gitToken, {}));\n    await currentRoot(token, state);\n    if (state.source.operationToken)\n      await work(token, state, () =>\n        recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n      );\n    retained(token, state);\n    state.helperValidated = true;\n    state.gitToken = gitToken; // Private; never returned/exported or serialized.\n    return Object.freeze({\n",
      newRaw:
        '    }\n    await work(token, state, () => custom.sourceGitEnvironment(gitToken, {}));\n    await currentRoot(token, state);\n    let beforeObservation;\n    if (state.source.operationToken)\n      beforeObservation = await work(token, state, () =>\n        recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n      );\n    retained(token, state);\n    if (state.source.operationToken) {\n      need(!state.checkedInputsBefore, "INPUT_CLOSURE_REUSE");\n      state.checkedInputsBefore = consumeCheckedInputObservation(\n        token,\n        state,\n        beforeObservation,\n        "before-probe-clang",\n      );\n    }\n    state.helperValidated = true;\n    state.gitToken = gitToken; // Private; never returned/exported or serialized.\n    return Object.freeze({\n',
      oldSha256:
        "3c80d9c33a6bdfe08c6cddc51889fcde48182d878930f1b3018c2265dd7d22ee",
      newSha256:
        "3e608ecd2b337ec26998984beb073ce7fdcff552a11664a3c677a3661b429f0a",
    },
    {
      oldRaw:
        '      binding.policySha256 === fact.binding.policySha256,\n    "SOURCE_DEFAULTS_BINDING_CHANGED",\n  );\n  for (const row of snapshot.records) {\n    const actual = await heldOperationFile(\n      token,\n',
      newRaw:
        '      binding.policySha256 === fact.binding.policySha256,\n    "SOURCE_DEFAULTS_BINDING_CHANGED",\n  );\n  const checked = [];\n  for (const row of snapshot.records) {\n    const actual = await heldOperationFile(\n      token,\n',
      oldSha256:
        "be1c6baa59be3618000c323bafbbd307a323a3db9570091072471a2455da8a9f",
      newSha256:
        "053c8e39c51892e645f404e498c571a80e78e69f848f2b679697e23626285378",
    },
    {
      oldRaw:
        '    );\n    operationState(token, joinedAllowed);\n    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");\n  }\n  await operationFence(token, joinedAllowed);\n}\n// END PRIVATE PARENT METADATA VERIFICATION\n\n',
      newRaw:
        '    );\n    operationState(token, joinedAllowed);\n    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");\n    checkedInputRow(checked, row.relative, actual);\n  }\n  await operationFence(token, joinedAllowed);\n  operationState(token, joinedAllowed);\n  return checked;\n}\n// END PRIVATE PARENT METADATA VERIFICATION\n\n',
      oldSha256:
        "e17e5e5a53bfd4c68b49268f2ccabd2b1a47198400254bd6ef2feace5fb3ff91",
      newSha256:
        "28dbfdd260e5528219005b71978f42da0fd1a8b8bc0bccab9a39f96f1bd6caa9",
    },
    {
      oldRaw:
        "}\nasync function verifySourceSnapshot(token, joinedAllowed = false) {\n  const state = operationState(token, joinedAllowed);\n  for (const row of state.plan.rootPins)\n    await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum ?? 2 * 1024 ** 2,\n      row,\n      joinedAllowed,\n    );\n  for (const row of state.originalRecords ?? []) {\n    const actual = await heldOperationFile(\n      token,\n",
      newRaw:
        "}\nasync function verifySourceSnapshot(token, joinedAllowed = false) {\n  const state = operationState(token, joinedAllowed);\n  const checked = [];\n  for (const row of state.plan.rootPins) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum ?? 2 * 1024 ** 2,\n      row,\n      joinedAllowed,\n    );\n    checkedInputRow(checked, row.relative, actual);\n  }\n  for (const row of state.originalRecords ?? []) {\n    const actual = await heldOperationFile(\n      token,\n",
      oldSha256:
        "6d047b7fffa2824d3ab9b256964fef8c50a157b6d764bb4734724e2ad598ebf5",
      newSha256:
        "5d84587a924d09240fdb4756278a03d98b58f2795128dfebb270cf45e6c2acba",
    },
    {
      oldRaw:
        '      joinedAllowed,\n    );\n    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");\n  }\n  const graphRecord = await heldOperationFile(\n    token,\n',
      newRaw:
        '      joinedAllowed,\n    );\n    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");\n    checkedInputRow(checked, row.relative, actual);\n  }\n  const graphRecord = await heldOperationFile(\n    token,\n',
      oldSha256:
        "cdc5a1dd2d7705bf5162899423497b32259bfb7f9213c8bc9f3d5741e63e34c8",
      newSha256:
        "0acd86dd98b16f21d20ce082acd0252f43f2059f358dadfa47f147c7071b9adb",
    },
    {
      oldRaw:
        "    undefined,\n    joinedAllowed,\n  );\n  const expected = parseRecord(graphRecord);\n  let snapshot,\n    callbackFailed = false,\n",
      newRaw:
        '    undefined,\n    joinedAllowed,\n  );\n  checkedInputRow(checked, "source-gn-logs/fresh-graph-pins.json", graphRecord);\n  const expected = parseRecord(graphRecord);\n  let snapshot,\n    callbackFailed = false,\n',
      oldSha256:
        "8aac06ace07b454359fb4740d5d4733b4e1b9e62c2b4622dd125a76e2806bdcd",
      newSha256:
        "6a780c59a670ae18de14fbfac7fc7755b8087da6cc59a8c14a58bd8f146a9f93",
    },
    {
      oldRaw:
        '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}\n// BEGIN PRIVATE INSTALLED TOOL PROOF\nconst TOOL_PROOF_ROOTS = Object.freeze([\n',
      newRaw:
        '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  const metadata = await recheckSourceMetadata(token, joinedAllowed);\n  if (metadata) checked.push(...metadata);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n  return checked;\n}\n// BEGIN PRIVATE INSTALLED TOOL PROOF\nconst TOOL_PROOF_ROOTS = Object.freeze([\n',
      oldSha256:
        "ce3ff08b2090ed3fd53bf4e7bbb9565ec18daf6b87a24276ca572b21ee36253f",
      newSha256:
        "21b91253b1213d99b78ba496e1063fe3eff3bd388af9c3c36478bc43ac03b502",
    },
    {
      oldRaw:
        '      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,\n    "TOOL_PROOF_BINDING",\n  );\n  for (const row of [snapshot.record, snapshot.base]) {\n    const actual = await heldOperationFile(\n      token,\n',
      newRaw:
        '      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,\n    "TOOL_PROOF_BINDING",\n  );\n  const checked = [];\n  for (const row of [snapshot.record, snapshot.base]) {\n    const actual = await heldOperationFile(\n      token,\n',
      oldSha256:
        "d0ed157f1f5e9d3adf1da28766fe45b9e8bef1db7ef61431ba02e628c94b461a",
      newSha256:
        "fc152f6cf85009ba868e0fc58e187b6166c3712b7690afb4a6da52454c631b12",
    },
    {
      oldRaw:
        '    );\n    operationState(token, true);\n    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");\n  }\n}\n// END PRIVATE INSTALLED TOOL PROOF\n\n',
      newRaw:
        '    );\n    operationState(token, true);\n    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");\n    checkedInputRow(checked, row.relative, actual);\n  }\n  return checked;\n}\n// END PRIVATE INSTALLED TOOL PROOF\n\n',
      oldSha256:
        "d2a7cfc1103c1298140f323eb34ee48de043e5dcf4c55fe9bbc65a618b700055",
      newSha256:
        "87085e883bf0638aa02ae39677b8e66efe5685dc6f8a1b4b2bdcee1f9f4162e4",
    },
    {
      oldRaw:
        '      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n  await recheckSourceToolProof(source.operationToken);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n',
      newRaw:
        '      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  const checked = await verifySourceSnapshot(source.operationToken, true);\n  const tools = await recheckSourceToolProof(source.operationToken);\n  operationState(source.operationToken, true);\n  return issueCheckedInputObservation(receipt, leaseToken, state, [\n    ...checked,\n    ...tools,\n  ]);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n',
      oldSha256:
        "9a93bd6e025308046985a8ee47e73d774631e4d5be196f99c1c32dfe67546b1a",
      newSha256:
        "b8af41b68194b741c3f6f21b73ed89f3c20d8e07060df96335340c3b45ba4c56",
    },
    {
      oldRaw:
        '      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  if (role === "cef-engine" && job.success === false) {\n    inspectNativeSlice(job, closed.jobSeconds);\n    need(\n',
      newRaw:
        '      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  need(\n    Number.isSafeInteger(closed.jobSeconds) &&\n      closed.jobSeconds > 0 &&\n      closed.jobSeconds <=\n        (role === "checkpoint-seal"\n          ? 3600\n          : ENGINE_CAPS_MS[ENGINE_ROLES.indexOf(role)] / 1000) &&\n      Number.isSafeInteger(job.elapsedMs) &&\n      job.elapsedMs >= 0 &&\n      job.elapsedMs <= closed.jobSeconds * 1000 + CLEANUP_MS,\n    "ENGINE_ASSIGNED_SECONDS",\n  );\n  if (role === "cef-engine" && job.success === false) {\n    inspectNativeSlice(job, closed.jobSeconds);\n    need(\n',
      oldSha256:
        "160d03c046fab040d67ed9b79e42eba07f994be6e2b47f02599ca7e9b53bbc89",
      newSha256:
        "a18125fc0ead8656ee4b0d28e48feaeaea659d3346147c93791fc249471f5574",
    },
    {
      oldRaw:
        '    const current = await sealSdkAsset(token, asset.name, asset);\n    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");\n  }\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n',
      newRaw:
        '    const current = await sealSdkAsset(token, asset.name, asset);\n    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");\n  }\n  const afterObservation = await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n',
      oldSha256:
        "c39b274ad1ccb4097bf39fd67a632653688cb0dd2f461e89ecf4771c8f524d0d",
      newSha256:
        "2b98e85bd66ea893d7bb78ce4ef9879966a34a4e1837842616bc92154df42e09",
    },
    {
      oldRaw:
        '      operation.logFds.size === 0,\n    "SDK_FD_JOIN",\n  );\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-produced",\n    sourceId: state.source.sourceId,\n',
      newRaw:
        '      operation.logFds.size === 0,\n    "SDK_FD_JOIN",\n  );\n  const after = consumeCheckedInputObservation(\n    token,\n    state,\n    afterObservation,\n    "after-package-before-sdk-seal",\n  );\n  need(\n    state.checkedInputsBefore &&\n      state.checkedInputsBefore.sha256 === after.sha256 &&\n      canonical(state.checkedInputsBefore.content) === canonical(after.content),\n    "INPUT_CLOSURE_CHANGED",\n  );\n  const checkedInputs = Object.freeze({\n    schemaVersion: 1,\n    kind: "windows-arm-checked-input-closure-pair",\n    before: state.checkedInputsBefore,\n    after,\n  });\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-produced",\n    sourceId: state.source.sourceId,\n',
      oldSha256:
        "27eca937f5b5ba683ec03565a4423b9c982ed959c1169972be4e323d4ca9574b",
      newSha256:
        "ab9859b770b8f138b088b5182453bebae08bb20b5f82378652cfc766a13faf84",
    },
    {
      oldRaw:
        '    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-package/bundle",\n    assets: Object.freeze(assets),\n  });\n  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.\n',
      newRaw:
        '    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-package/bundle",\n    checkedInputs,\n    assets: Object.freeze(assets),\n  });\n  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.\n',
      oldSha256:
        "42b8b35d57c9d5b9c23f25aa03af45066b5173ea17cb8caa8296394a8178a5c2",
      newSha256:
        "d882638238de7e34860e2deee7894d5e41b635918e73c0b79cf8bebeaffb784d",
    },
  ],
};
// BEGIN EXACT SOURCE PARENT INVERSE
const SOURCE_PARENT_INVERSE = {
  bytes: 170568,
  sha256: "4dd1213e005bd2c873e48854fc4a158efbf123837b977f214fcc818797717da4",
  rows: [
    {
      newRaw:
        '// BEGIN CHECKED SOURCE ARTIFACTS PARENT\nasync function recheckSourceCreationParents(token, parents) {\n  const state = operationState(token);\n  need(\n    path.dirname(state.root) === path.join(CONTROLLER_REPO, ".artifacts"),\n    "SOURCE_PARENT_SCOPE",\n  );\n  for (const row of parents) {\n    const info = await operationWork(token, () =>\n      fs.lstat(row.path, { bigint: true }),\n    );\n    need(operationDirectoryId(info) === row.identity, "SOURCE_PARENT_CHANGED");\n    need(\n      (await operationWork(token, () => fs.realpath(row.path))) === row.path,\n      "SOURCE_PARENT_ALIAS",\n    );\n  }\n  operationState(token);\n}\nasync function prepareSourceArtifactsParent(token) {\n  const state = operationState(token),\n    parent = path.dirname(state.root);\n  need(\n    parent === path.join(CONTROLLER_REPO, ".artifacts"),\n    "SOURCE_PARENT_SCOPE",\n  );\n  const parents = [];\n  for (let current = CONTROLLER_REPO; ; current = path.dirname(current)) {\n    const info = await operationWork(token, () =>\n      fs.lstat(current, { bigint: true }),\n    );\n    parents.push(\n      Object.freeze({ path: current, identity: operationDirectoryId(info) }),\n    );\n    if (current === path.dirname(current)) break;\n  }\n  await recheckSourceCreationParents(token, parents);\n  const before = await operationWork(token, async () => {\n    try {\n      return await fs.lstat(parent, { bigint: true });\n    } catch (error) {\n      if (error?.code === "ENOENT") return null;\n      throw error;\n    }\n  });\n  if (before)\n    parents.push(\n      Object.freeze({ path: parent, identity: operationDirectoryId(before) }),\n    );\n  await recheckSourceCreationParents(token, parents);\n  operationState(token);\n  await operationWork(token, async () => {\n    try {\n      await fs.mkdir(parent, { mode: 0o700 });\n    } catch (error) {\n      if (error?.code !== "EEXIST" || !before) throw error;\n    }\n  });\n  if (!before) {\n    const info = await operationWork(token, () =>\n      fs.lstat(parent, { bigint: true }),\n    );\n    parents.push(\n      Object.freeze({ path: parent, identity: operationDirectoryId(info) }),\n    );\n  }\n  await recheckSourceCreationParents(token, parents);\n  return Object.freeze(parents);\n}\n// END CHECKED SOURCE ARTIFACTS PARENT\n\n',
      oldRaw: "",
      newSha256:
        "21214d320a7d895f031cb22b15103944e8c208a3206cecd227f379bbff567768",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        "    // BEGIN SOURCE ROOT PARENT CREATION\n    const creationParents = await prepareSourceArtifactsParent(token);\n    await recheckSourceCreationParents(token, creationParents);\n    operationState(token);\n    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));\n    await recheckSourceCreationParents(token, creationParents);\n    // END SOURCE ROOT PARENT CREATION\n",
      oldRaw:
        "    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));\n",
      newSha256:
        "fa0c503739efca2e087c4c8254dfb8672c8885c035d96b5e57e66d80dacdab93",
      oldSha256:
        "f6bf507f714bbf2779ed1930bf55ba7739b75a4044a061376c5ca98feb75daae",
    },
    {
      newRaw:
        '      // BEGIN SOURCE CREATION PARENT LEDGER CHECK\n      const expectedParent = creationParents.find(\n        (row) => row.path === current,\n      );\n      if (expectedParent)\n        need(\n          operationDirectoryId(info) === expectedParent.identity,\n          "SOURCE_PARENT_CHANGED",\n        );\n      // END SOURCE CREATION PARENT LEDGER CHECK\n',
      oldRaw: "",
      newSha256:
        "7da9f392a576026aea8f8b3a521e7bb556b538a6c360d77bb4f0ca88de9b958d",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        "    // BEGIN SOURCE OWNER OPEN FENCE\n    await operationFence(token);\n    operationState(token);\n    // END SOURCE OWNER OPEN FENCE\n",
      oldRaw: "",
      newSha256:
        "b0b1a3ab1fd698c1afcd3deaa48cd63cf4a59c2e7353a1c890ec902f5ff24bc4",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw: '  "spawn",\n  "mkdir",\n]);\n',
      oldRaw: '  "spawn",\n]);\n',
      newSha256:
        "5a609af6fb2139b7872a242ac6e4ce06baed14a17e1c59b12f3d008d0ff828ea",
      oldSha256:
        "23153886e10735d0405d87d4b8b5e1773cb342e47cb3ec91d4f6afacca6d1a10",
    },
  ],
};
// BEGIN EXACT SOURCE FAILURE DATA INVERSE
const SOURCE_FAILURE_INVERSE = {
  rows: [
    {
      newRaw:
        "    // BEGIN SAFE SOURCE CHILD FAILURE CAPTURE\n    captureSourceChildFailure(error, state);\n    // END SAFE SOURCE CHILD FAILURE CAPTURE\n",
      oldRaw: "",
      newSha256:
        "6dc18d387df80488ff800f5f4c083dbc6668eaa057365a3bc2329550f6375103",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        '// BEGIN SAFE SOURCE CHILD FAILURE DATA\nconst sourceChildFailures = new WeakMap();\nfunction captureSourceChildFailure(error, state) {\n  // Copied observations only. Never read caller error fields, logs or paths,\n  // and never let diagnostic preparation change the original failure.\n  try {\n    if (\n      utilTypes.isProxy(error) ||\n      !utilTypes.isNativeError(error) ||\n      sourceChildFailures.has(error) ||\n      !(state.child instanceof ChildProcess) ||\n      !state.childEvents\n    )\n      return;\n    const e = state.childEvents;\n    const exitCode = (value) =>\n      Number.isSafeInteger(value) && value >= -2147483648 && value <= 4294967295\n        ? value\n        : null;\n    const signal = (value) =>\n      ["SIGTERM", "SIGKILL", "SIGABRT", "SIGINT"].includes(value)\n        ? value\n        : null;\n    const observed = {\n      phase: "source-launch",\n      spawned: e.spawn === true,\n      exited: e.exit === true,\n      closed: e.close === true,\n      stdoutClosed: e.stdout === true,\n      stderrClosed: e.stderr === true,\n      exitCode: exitCode(e.code),\n      closeCode: exitCode(e.closeCode),\n      exitSignal: signal(e.signal),\n      closeSignal: signal(e.closeSignal),\n      capturedBytes:\n        Number.isSafeInteger(state.outputBytes) && state.outputBytes >= 0\n          ? Math.min(state.outputBytes, SOURCE_LOG_CAP)\n          : null,\n    };\n    sourceChildFailures.set(error, Object.freeze(observed));\n  } catch {\n    /* Diagnostic failure cannot replace a primary, including false. */\n  }\n}\n// END SAFE SOURCE CHILD FAILURE DATA\n',
      oldRaw: "",
      newSha256:
        "4282bbee73e81be418d4f4712892869856bb9cd125e8078d4365886fb0044273",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      newRaw:
        "  // BEGIN SAFE SOURCE CHILD FAILURE PROJECTION\n  const sourceChild = native ? sourceChildFailures.get(error) : undefined;\n  if (sourceChild) diagnostic.sourceChild = sourceChild;\n  // END SAFE SOURCE CHILD FAILURE PROJECTION\n",
      oldRaw: "",
      newSha256:
        "dd8b135bc6b6cae12bbf2458b94e13f3017fedd7946bce0dfcf4c0403e87476d",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
  ],
  bytes: 173595,
  sha256: "45df5ab874c3d1a7d9191ea3be9f8cbf1c9d43110092f592abb0d7eb9cbc3cc5",
};

// BEGIN EXACT FULL SOURCE ACQUISITION INVERSE
const SOURCE_ACQUISITION_HISTORY = {
  controller: {
    path: "native/windows-arm-full-sdk/full_sdk_control.mjs",
    bytes: 175516,
    sha256: "097a828c6d26648690c5fff05c7e59dfaa8de553262b2fca0a6fcb119c2d0659",
    newBytes: 175570,
    newSha256:
      "c15c97aa6e9e14b4b52f633e44419045273ca9645ba4cbcd3641396c95946012",
    rows: [
      {
        oldRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\nconst DATA_ROLES = Object.freeze([\n  "sdk-data",\n  "llvm-data",\n',
        newRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 10800000;\nconst ACQUISITION_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\nconst DATA_ROLES = Object.freeze([\n  "sdk-data",\n  "llvm-data",\n',
        oldSha256:
          "59bc4818dbd747a4969cf6fec8acea23d38fe475f345989fa0143a1740844670",
        newSha256:
          "d57bb706ff323933b2c22605f6468e22b7c464729e89079ba3a94175e387a955",
      },
      {
        oldRaw:
          '      state.sourceMonoEnd - performance.now(),\n    ) / 1000;\n  const acquisitionRemaining =\n    Math.min(\n      4500000 - (Date.now() - owner.wallStart),\n      4500000 - (performance.now() - owner.monoStart),\n      sourceRemaining * 1000,\n    ) / 1000;\n  const c = {\n    kind: "windows-arm-full-sdk-context",\n',
        newRaw:
          '      state.sourceMonoEnd - performance.now(),\n    ) / 1000;\n  const acquisitionRemaining =\n    Math.min(\n      ACQUISITION_MS - (Date.now() - owner.wallStart),\n      ACQUISITION_MS - (performance.now() - owner.monoStart),\n      sourceRemaining * 1000,\n    ) / 1000;\n  const c = {\n    kind: "windows-arm-full-sdk-context",\n',
        oldSha256:
          "d086e4a470813746ffc40f61e50d90cee2c94aab3cf89ccf8b258b29924270fc",
        newSha256:
          "cc47d02b196dbe63bf6a4e1b525485103c92a7f824cc3a0090454f41cd125127",
      },
      {
        oldRaw:
          "    monotonicWholeEnd: sample.monotonic + wholeRemaining,\n    wallWorkEnd: state.sourceWallEnd / 1000,\n    monotonicWorkEnd: sample.monotonic + sourceRemaining,\n    wallAcquisitionEnd:\n      Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n  };\n  need(\n    sourceRemaining > 150 && acquisitionRemaining > 150,\n",
        newRaw:
          "    monotonicWholeEnd: sample.monotonic + wholeRemaining,\n    wallWorkEnd: state.sourceWallEnd / 1000,\n    monotonicWorkEnd: sample.monotonic + sourceRemaining,\n    wallAcquisitionEnd:\n      Math.min(state.sourceWallEnd, owner.wallStart + ACQUISITION_MS) / 1000,\n    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n  };\n  need(\n    sourceRemaining > 150 && acquisitionRemaining > 150,\n",
        oldSha256:
          "15eb5c4144c038ca4155db70e8d4079c504ae9259a8951e0a5575735ee32351f",
        newSha256:
          "c249b742fd964d7164995c252bfbe4b3cbc9eacd105333fb6e654cc1e9e94e51",
      },
    ],
  },
};
// BEGIN EXACT FULL BOOTSTRAP CACHE INVERSE
const FULL_BOOTSTRAP_CACHE_HISTORY = {
  controller: {
    path: "native/windows-arm-full-sdk/full_sdk_control.mjs",
    bytes: 175570,
    sha256: "c15c97aa6e9e14b4b52f633e44419045273ca9645ba4cbcd3641396c95946012",
    newBytes: 175570,
    newSha256:
      "97cb6430200bee3880651d6b597d2ee4f4886dfe6377b484c900a4e727edc294",
    rows: [
      {
        oldRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "71edb9a3e285226d6015d833586ba2dafedaa5fbff8ad5b9a4b53d3a6d1844eb";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\n',
        newRaw:
          '// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\n',
        oldSha256:
          "804b0eacf23d470d16906c8f7b81c08fa5610a991998b9b08680af341950e23d",
        newSha256:
          "b25479d0281e8d164381caab15ece3c0dd0b4dac079a8af9989d8f8061182153",
      },
    ],
  },
};
function fullSourceEnvironmentInverse(text, name) {
  if (name !== "sourcepy" && name !== "python") return text;
  const spec = {
    begin: "# BEGIN OWNED FULL SOURCE ENVIRONMENT\n",
    end: "# END OWNED FULL SOURCE ENVIRONMENT\n\n\n",
    blockBytes: 6814,
    blockSha256:
      "5a49d5b5e6adac97655b9587fd31c639a54baf9a9ddd5977652ced3d7df7db3b",
    bytes: 28553,
    sha256: "6da8be5749d21ee22e4fb4a0ae464b7ff161d354c0177b86a98f96157759601a",
  };
  assert.equal(text.split(spec.begin).length, 2, "ENVIRONMENT_INVERSE_COUNT");
  assert.equal(text.split(spec.end).length, 2, "ENVIRONMENT_INVERSE_COUNT");
  const start = text.indexOf(spec.begin);
  const finish = text.indexOf(spec.end, start) + spec.end.length;
  const block = text.slice(start, finish);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(
    Buffer.byteLength(block),
    spec.blockBytes,
    "ENVIRONMENT_INVERSE_BLOCK",
  );
  assert.equal(hash(block), spec.blockSha256, "ENVIRONMENT_INVERSE_BLOCK");
  text = text.slice(0, start) + text.slice(finish);
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ENVIRONMENT_INVERSE_WHOLE",
  );
  assert.equal(hash(text), spec.sha256, "ENVIRONMENT_INVERSE_WHOLE");
  return text;
}
const FULL_GN_SHELL_TRANSPORT_INVERSE = {
  bytes: 289624,
  sha256: "e9ed9951089d9b44b1b614bb3b1d56be8c78fc8e026f714927fed3645fac04ea",
  rows: [
    {
      old: "",
      new: '  // c101 subprocess2 uses cmd on Windows; transport the unchanged body on one\n  // physical line, with safe whitespace forcing list2cmdline argument quoting.\n  const runnerTransport = `exec( bytes.fromhex(\'${Buffer.from(runner, "utf8").toString("hex")}\') )`;\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "f066cfd37df3fa678ea0c6ba91ea01fe2094788b4d7034ad6f583f54c8837e6a",
    },
    {
      old: "original=gclient_util.RunAction\n",
      new: "original=gclient_util.RunAction\nimport subprocess\n",
      oldSha256:
        "80746afb059fdab6f8dc4e2492328068d7df00960d31c2ca9f6102d227c15978",
      newSha256:
        "c74d004da81dec98663d5172d8e9fa8d00d9175f0acab1aea0f86fd0b2e70b80",
    },
    {
      old: "  command=[sys.executable,'-B','-c',${JSON.stringify(runner)},gn,expected,size,digest,*command[1:]]\n",
      new: "  command=[sys.executable,'-B','-c',${JSON.stringify(runnerTransport)},gn,expected,size,digest,*command[1:]]\n  if len(subprocess.list2cmdline(command))+64>8191:raise RuntimeError('FULL_GN_COMMAND_BOUND')\n",
      oldSha256:
        "807f7b4be8ed706024f6acdc96c83200653816fd6d4daefef6cf98d797fb1563",
      newSha256:
        "2b3565a2f7423a7586e9acc485d14a869754094a3b18b2358484c108817e9cfb",
    },
  ],
};
const FULL_GN_PROJECTION_DIGEST_INVERSE = {
  bytes: 290006,
  sha256: "27e6c073dab2b956c65aee7cd063e7114005077fe611fd99eb7a82326677e6e5",
  rows: [
    {
      old: "for name,digest in [('MergeDicts'",
      new: "for name,gn_projection_digest in [('MergeDicts'",
      oldSha256:
        "cb87b02fbb4713fb9afa918266b3267df97613761dbe9a572459fc33fee33421",
      newSha256:
        "67521573c8a1674cb8eec2f43ddf5794aa49f13d18a90640dc6234c1333411cf",
    },
    {
      old: "hashlib.sha256(inspect.getsource(function).encode('utf8')).hexdigest()!=digest:raise RuntimeError('FULL_GN_PROJECTION_FUNCTION')",
      new: "hashlib.sha256(inspect.getsource(function).encode('utf8')).hexdigest()!=gn_projection_digest:raise RuntimeError('FULL_GN_PROJECTION_FUNCTION')",
      oldSha256:
        "e19606c2c9ef51543d1b45fad14aedb8c19c16b137d784f1e5d4693530374774",
      newSha256:
        "e6b2f8527570716018b2f83f9e7fa8ef4f411190216b2d9195ca5949d253d04b",
    },
  ],
};
const FULL_HOOKS_3600_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
    rows: [
      {
        old: '"hooksSeconds": 2700',
        new: '"hooksSeconds": 3600',
        oldSha256:
          "e1295960e6724068f957bf7d2cc298f18a4e39d20890cb938f6c20d0281e8313",
        newSha256:
          "f9a082d2224b79d4b6491cc86260da7efddf5761901ab66889df6c2089aa06b7",
      },
    ],
  },
  driver: {
    bytes: 290034,
    sha256: "c204154a9a1ee9ad9fde6cb44d9a14c54d1491c60badcb8ebbb07497a07d104d",
    rows: [
      {
        old: 'stage === "source-hooks-gn" && maximumSeconds === 2700',
        new: 'stage === "source-hooks-gn" && maximumSeconds === 3600',
        oldSha256:
          "f1e3c9e04b5c87ef7e02a6e2f18edb8a19bf76f81df0a2d9be34cae004b0f6f7",
        newSha256:
          "ab823a3efa59ea09fcca8d67eb2f7891e3b4f87f4ef620eceeddfc8403e7942c",
      },
      {
        old: "limits.hooksSeconds === 2700",
        new: "limits.hooksSeconds === 3600",
        oldSha256:
          "ef03e51dc1df6a0932172ab6d4982193e7399b10ac1bef48a2454accfe78e8bc",
        newSha256:
          "2873474eb3737c287592c5194d69bfd530131c8730b801fc08a0b4ae499a4c82",
      },
      {
        old: 'await fullSourceStage(root, budget, "source-hooks-gn", 2700, async () => {',
        new: 'await fullSourceStage(root, budget, "source-hooks-gn", 3600, async () => {',
        oldSha256:
          "221b341a72b2425ff16bb9f2cd176d68be51a250860a3ca9d729c9d09242daca",
        newSha256:
          "a31f1d431befeb2772bcc32cbc2c4ce3fe591fdbee55f8de5f6f72f97b45a614",
      },
      {
        old: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
        new: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
        oldSha256:
          "caa4db5200edd8946f3023d997e5529ce53552c43453f0d717d9543c6e34ddb0",
        newSha256:
          "b948d8065300b2551c703862b8d1f24a0eb653c41dd573d8d77aeacbd255f6b3",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "6188878262519d72bcfbcb121ca100a341eee0121093f0caab3216ecf4020038",
    rows: [
      {
        old: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
        new: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
        oldSha256:
          "caa4db5200edd8946f3023d997e5529ce53552c43453f0d717d9543c6e34ddb0",
        newSha256:
          "b948d8065300b2551c703862b8d1f24a0eb653c41dd573d8d77aeacbd255f6b3",
      },
      {
        old: "# Node body debits data time and retains the fixed2700s hook cap.",
        new: "# Node body debits data time and retains the fixed3600s hook cap.",
        oldSha256:
          "ca05583192bd821c615365b66f9bc67bbf8e36a2adbf097993e1ff9ca8d739b0",
        newSha256:
          "d6b0d4f52a5048a17c2ac0f9989999b15c218583523903bfb94fb6e6636a965a",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "97cb6430200bee3880651d6b597d2ee4f4886dfe6377b484c900a4e727edc294",
    rows: [
      {
        old: "e742067edf74e0f71d78f02ec381a757da4761c5a0ee31f2d458e492f22fb32e",
        new: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
        oldSha256:
          "caa4db5200edd8946f3023d997e5529ce53552c43453f0d717d9543c6e34ddb0",
        newSha256:
          "b948d8065300b2551c703862b8d1f24a0eb653c41dd573d8d77aeacbd255f6b3",
      },
    ],
  },
};
const FULL_GRAPH_SNAPSHOT_HISTORY = {
  driver: {
    bytes: 306717,
    sha256: "d017aff0b8eeebe1451af7872c0563386a141af3ab7297ab4e8c8cd71c3ecb99",
    rows: [
      {
        old: "      const snapshot = capture.diagnostic;\n",
        new: "      // `diagnostic` is the canonical JSON text of the pin snapshot; the sealed\n      // fresh-graph-pins.json must hold that object, not a JSON string of it.\n      const snapshot = JSON.parse(capture.diagnostic);\n",
        oldSha256:
          "9765905a0166cff17d36a4205539a39156c3800d2d8c42dbfde67358adc54eb2",
        newSha256:
          "eaca1e95e93ad0fdc5c702cf724ae89649fd7b558b86b4c0e98bda595ba385fa",
      },
    ],
  },
};
function fullGraphSnapshotInverse(text, name) {
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_SNAPSHOT_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_SNAPSHOT_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_SNAPSHOT_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_SNAPSHOT_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_SNAPSHOT_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_SNAPSHOT_WHOLE");
  return text;
}
const FULL_GRAPH_GRAPHDIAG_HISTORY = {
  controller: {
    bytes: 178530,
    sha256: "55404f6fb1860cc49ceef1f23220e2efb04afee71d07517e816e3a0d2d4a6d48",
    rows: [
      {
        old: "  need(\n",
        new: "  if (!(\n",
        oldSha256:
          "0e0bd2c8c9c672e76e815ab70e68342b1d2c307c658589c09e7ce93980fe4235",
        newSha256:
          "dad2412ae8a16a0fb56348c01bac7e11211e045969b0e0f816cb585128881e04",
      },
      {
        old: '      snapshot &&\n      canonical(snapshot) === canonical(expected) &&\n      summary.sha256 === expected.sha256 &&\n      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n',
        new: '    snapshot &&\n    canonical(snapshot) === canonical(expected) &&\n    summary.sha256 === expected.sha256 &&\n    state.sourceResult.graph.sha256 === expected.sha256\n  )) {\n    console.error(\n      JSON.stringify({\n        kind: "windows-arm-full-sdk-graph-mismatch",\n        graphMismatch: graphMismatchSummary(\n          snapshot,\n          expected,\n          summary,\n          state.sourceResult?.graph?.sha256,\n          calls,\n        ),\n      }),\n    );\n    throw new Error("FULL_SDK_CONTROL_SOURCE_GRAPH_CHANGED");\n  }\n',
        oldSha256:
          "d955cef492542b3fb918e8560f343e97664e7c4e4ae46a7bfb710245dafb6136",
        newSha256:
          "48308b4a4c8572599daa0c45ebc06fc711f91c162e13c416b7d65619bbc983f7",
      },
      {
        old: "",
        new: '\n// Bounded description of how a recomputed graph differs from the sealed one:\n// counts, hex digests and at most one differing in-tree relative path; printed to\n// stderr (the step log) when the controller denies SOURCE_GRAPH_CHANGED.\nfunction graphMismatchSummary(snapshot, expected, summary, resultSha, calls) {\n  const rows = (value) =>\n    Array.isArray(value?.pins) && value.pins.length <= 50001 ? value.pins : [];\n  const hex = (value) =>\n    typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;\n  const now = new Map(),\n    before = new Map();\n  for (const row of rows(snapshot)) now.set(row?.path, row);\n  for (const row of rows(expected)) before.set(row?.path, row);\n  let missing = 0,\n    extra = 0,\n    changed = 0,\n    first = null;\n  const note = (kind, name, detail) => {\n    first ??= {\n      kind,\n      path:\n        typeof name === "string"\n          ? name.replace(/[^\\x20-\\x7e]/g, "?").slice(0, 160)\n          : null,\n      detail,\n    };\n  };\n  for (const [name, row] of before) {\n    const other = now.get(name);\n    if (!other) {\n      missing++;\n      note("missing", name, null);\n    } else if (other.sha256 !== row.sha256 || other.bytes !== row.bytes) {\n      changed++;\n      note("changed", name, [row.bytes, other.bytes]);\n    }\n  }\n  for (const name of now.keys())\n    if (!before.has(name)) {\n      extra++;\n      note("extra", name, null);\n    }\n  return {\n    calls,\n    snapshotFiles: rows(snapshot).length,\n    expectedFiles: rows(expected).length,\n    missing,\n    extra,\n    changed,\n    first,\n    snapshotSha: hex(snapshot?.sha256),\n    expectedSha: hex(expected?.sha256),\n    summarySha: hex(summary?.sha256),\n    resultSha: hex(resultSha),\n  };\n}\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "36003186c8a29c2eb3d52d9b9cf3277d1a008655e3c125a26c1d629fff43d118",
      },
    ],
  },
};
function fullGraphGraphdiagInverse(text, name) {
  text = fullGraphSnapshotInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_GRAPHDIAG_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_GRAPHDIAG_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_GRAPHDIAG_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_GRAPHDIAG_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_GRAPHDIAG_WHOLE",
  );
  assert.equal(
    sha(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_GRAPH_GRAPHDIAG_WHOLE",
  );
  return text;
}
const FULL_GRAPH_STAGE_HISTORY = {
  producer: {
    bytes: 61403,
    sha256: "6c8f2ae7057b18850368dbd23c47f524c08f58d9a85f52b880c26487abd42625",
    rows: [
      {
        old: "              value['stage']=='graph-inventory' and value['firstFailure'] is None and\n",
        new: "              value['stage'] in ('graph-inventory','complete') and value['firstFailure'] is None and\n",
        oldSha256:
          "6032e858d9ff81793b46e7f7baa7d805b6201eb4e6a4788bf8b9dcd6ad964568",
        newSha256:
          "398731cb4f01b834cdda851603e64bf72638c6ae322702ef515ff61037bace5a",
      },
    ],
  },
};
function fullGraphStageInverse(text, name) {
  text = fullGraphGraphdiagInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_STAGE_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_STAGE_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_STAGE_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_STAGE_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_STAGE_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_STAGE_WHOLE");
  return text;
}
const FULL_GRAPH_SOURCES_HISTORY = {
  driver: {
    bytes: 307180,
    sha256: "b86d90091f656e54f7cc60bb340671493bf7ab6071f5a33252a6338f03a5b3f9",
    rows: [
      {
        old: "",
        new: "  // The full flow binds the producer inputs exactly as the control issued them\n  // (policy.producerInputs rows: path, bytes, sha256; no canonical or encoding\n  // fields), so each row must equal its source row.\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "1f34e01fca094dbeddfcf77d22b6c6dc3d43832a9409ff4b4732750d89107d50",
      },
      {
        old: '      row,\n      [\n        "path",\n        "bytes",\n        "sha256",\n        "canonicalBytes",\n        "canonicalSha256",\n        "encoding",\n      ],\n',
        new: '      row,\n      ["path", "bytes", "sha256"],\n',
        oldSha256:
          "9edc6c2b4bdc07c6aa93a2f0803529757f2e1d2208a3fd130d6f6fdbcfbf20c7",
        newSha256:
          "a64ea1eceeb22ce7a46d74d70d2df3a2dd1f95e4f33480c04729fba146f8f408",
      },
      {
        old: '    for (const key of ["bytes", "canonicalBytes"])\n      qualificationInteger(row[key], 1, 2 * 1024 ** 2, "PRIVATE_SOURCE_BOUND");\n    for (const key of ["sha256", "canonicalSha256"])\n      need(\n        typeof row[key] === "string" && /^[a-f0-9]{64}$/.test(row[key]),\n        "PRIVATE_SOURCE_HASH",\n      );\n',
        new: '    qualificationInteger(row.bytes, 1, 2 * 1024 ** 2, "PRIVATE_SOURCE_BOUND");\n',
        oldSha256:
          "43e0f5143a321d0535ab7c9248d3e0763d96f3c550de02abd698ddd9901507eb",
        newSha256:
          "c79626fca4535c9c06a673c2056cb1d0b6de59e3b6b93cd0a278bd084ad21588",
      },
      {
        old: '      row.encoding === "exact" ||\n        (row.encoding === "git-crlf" &&\n          full.state.c.sources[index].encoding === "git-crlf"),\n      "PRIVATE_SOURCE_ENCODING",\n    );\n    need(\n      row.encoding === "exact"\n        ? row.bytes === row.canonicalBytes && row.sha256 === row.canonicalSha256\n        : row.bytes >= row.canonicalBytes &&\n            row.bytes - row.canonicalBytes <= row.canonicalBytes,\n      "PRIVATE_SOURCE_ENCODING",\n',
        new: '      typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256),\n      "PRIVATE_SOURCE_HASH",\n',
        oldSha256:
          "1f6c756cfd29cfeea0dcff2a9c072c37af8d6c2b9657d10fc62335d2e04e731f",
        newSha256:
          "842c4a4cf8a3aa7188edfeedd45e227395aa9166367ca1c1973f68af6e99d449",
      },
    ],
  },
};
function fullGraphSourcesInverse(text, name) {
  text = fullGraphStageInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_SOURCES_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_SOURCES_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_SOURCES_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_SOURCES_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_SOURCES_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_SOURCES_WHOLE");
  return text;
}
const FULL_GRAPH_VISITED_HISTORY = {
  driver: {
    bytes: 306666,
    sha256: "799d762e9b4e30aa7f076580dd1f5b45a7baf585e16218ee11517ea1ab826b23",
    rows: [
      {
        old: "",
        new: "// `visited` counts every directory entry under the output directory, so the\n// generated headers and siso's own state files legitimately raise it after the\n// generate-headers role; the pinned graph is bound by the file count, byte\n// count and digest (and, separately, by every pin).\nfunction fullGraphSummaryEqual(result, summary) {\n  return (\n    Boolean(result) &&\n    Boolean(summary) &&\n    result.files === summary.files &&\n    result.bytes === summary.bytes &&\n    result.sha256 === summary.sha256\n  );\n}\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "8afb6c11a08390396609cf90147089b873eb4f22eb8ec65338608d69c58a404c",
      },
      {
        old: "        staticProjectionEqual(result, receipt.summary),\n",
        new: "        fullGraphSummaryEqual(result, receipt.summary),\n",
        oldSha256:
          "5d9918f5ebc8d1f78f7e1cd12885b39be5209c64af5f67fc4776242fe39df8d9",
        newSha256:
          "237ec37be498ddec76d416ce25f3a3ac2b8d985834074a2a1a6716effb77f311",
      },
    ],
  },
};
function fullGraphVisitedInverse(text, name) {
  text = fullGraphSourcesInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_VISITED_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_VISITED_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_VISITED_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_VISITED_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_VISITED_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_VISITED_WHOLE");
  return text;
}
const FULL_GRAPH_LITERAL_HISTORY = {
  driver: {
    bytes: 306488,
    sha256: "6d822f19fa8fbbb7a748cbecea20244c48d9d02cd60c1a4f313190bff02590c8",
    rows: [
      {
        old: "",
        new: '// CEF writes string values unescaped ("%s"), so Windows paths keep single\n// backslashes; GN reads a backslash that does not start \\" \\\\ or \\$ literally.\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "bc9cc1ce178b25003dedb449266507061997bf95afd94b191b6e1e99da991d78",
      },
      {
        old: '  /^\\s*([a-z][a-z0-9_]*)\\s*=\\s*(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\\\$\\x00-\\x1f]|\\\\["\\\\])*")\\s*(?:#.*)?$/.source.replaceAll(\n',
        new: '  /^\\s*([a-z][a-z0-9_]*)\\s*=\\s*(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\\\$\\x00-\\x1f]|\\\\["\\\\]|\\\\(?=[^"\\\\$\\x00-\\x1f]))*")\\s*(?:#.*)?$/.source.replaceAll(\n',
        oldSha256:
          "2a72456ec355e524736b6907c586c050fed5ad676f8f5cfe532707f40784c155",
        newSha256:
          "cafd48e6bebcc0da54ce0acdb051d53f3adce65d22f08e9c5f4c924fcf87e4a5",
      },
    ],
  },
  controller: {
    bytes: 178352,
    sha256: "578a0af7abe48508f61ae7d7163f8d2c5b4e4d9e21147c05db8aa2a5391fd775",
    rows: [
      {
        old: "",
        new: '// CEF writes string values unescaped ("%s"), so Windows paths keep single\n// backslashes; GN reads a backslash that does not start \\" \\\\ or \\$ literally.\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "bc9cc1ce178b25003dedb449266507061997bf95afd94b191b6e1e99da991d78",
      },
      {
        old: '  /^\\s*([a-z][a-z0-9_]*)\\s*=\\s*(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\\\$\\x00-\\x1f]|\\\\["\\\\])*")\\s*(?:#.*)?$/.source.replaceAll(\n',
        new: '  /^\\s*([a-z][a-z0-9_]*)\\s*=\\s*(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\\\$\\x00-\\x1f]|\\\\["\\\\]|\\\\(?=[^"\\\\$\\x00-\\x1f]))*")\\s*(?:#.*)?$/.source.replaceAll(\n',
        oldSha256:
          "2a72456ec355e524736b6907c586c050fed5ad676f8f5cfe532707f40784c155",
        newSha256:
          "cafd48e6bebcc0da54ce0acdb051d53f3adce65d22f08e9c5f4c924fcf87e4a5",
      },
    ],
  },
};
function fullGraphLiteralInverse(text, name) {
  text = fullGraphVisitedInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_LITERAL_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_LITERAL_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_LITERAL_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_LITERAL_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_LITERAL_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_LITERAL_WHOLE");
  return text;
}
const FULL_GRAPH_CAUSE_HISTORY = {
  driver: {
    bytes: 302254,
    sha256: "9618495d956425d4ce6505ffed2cc34eec6387cd805f2795acebaee71b799d82",
    rows: [
      {
        old: "",
        new: '// One printable line with the owned root, other absolute paths, URLs and\n// token-like strings replaced, bounded to `limit` characters.\nfunction fullRedactLine(value, root, limit) {\n  let line = typeof value === "string" ? value : "";\n  if (typeof root === "string" && root.length > 0)\n    for (const variant of [\n      root,\n      root.replaceAll("/", "\\\\"),\n      root.replaceAll("\\\\", "/"),\n    ])\n      line = line.split(variant).join("<root>");\n  return line\n    .replace(/https?:\\/\\/\\S+/gi, "<url>")\n    .replace(/[A-Za-z]:[\\\\/][^\\s"\']*/g, "<path>")\n    .replace(/\\\\\\\\[^\\s"\']+/g, "<path>")\n    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "<token>")\n    .replace(/[^\\x20-\\x7e]/g, "?")\n    .slice(0, limit);\n}\n// Last lines of the metadata role logs (bounded, redacted) so the failing real\n// tool names itself even when the thrown code is generic.\nasync function fullFailureLogTails(root) {\n  const rows = [];\n  try {\n    for (const [role, channels] of [\n      ["qual-gn-desc-pa", ["stderr"]],\n      ["qual-gn-desc-cef", ["stderr"]],\n      ["qual-gn-args", ["stderr"]],\n      ["qual-generate-headers", ["stderr", "stdout"]],\n    ])\n      for (const channel of channels) {\n        let handle;\n        try {\n          handle = await fs.open(\n            path.join(\n              root,\n              "private-qualification-logs",\n              role + "." + channel + ".log",\n            ),\n            "r",\n          );\n          const { size } = await handle.stat();\n          const length = Math.min(size, 600),\n            buffer = Buffer.alloc(length);\n          if (length > 0) await handle.read(buffer, 0, length, size - length);\n          const text = buffer\n            .toString("latin1")\n            .replaceAll("\\r", "")\n            .trim()\n            .split("\\n")\n            .slice(-4)\n            .join(" | ");\n          rows.push({\n            role,\n            channel,\n            bytes: size,\n            tail: fullRedactLine(text, root, 240),\n          });\n        } catch {\n          rows.push({ role, channel, bytes: null, tail: "" });\n        } finally {\n          await handle?.close().catch(() => {});\n        }\n      }\n  } catch {\n    /* Diagnostics never replace the first failure. */\n  }\n  return rows;\n}\n// Bounded, redacted cause of a failure at or after metadata-qualification: the\n// active step label, the safe error code, the errno-style code, up to three\n// function names from the stack and one short message line. Never raw paths\n// outside the owned tree, URLs or token-like strings.\nfunction fullFailureCause(error, step, root) {\n  try {\n    if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n      return null;\n    const text = (key) => {\n      const value = fullGraphOwnValue(error, key);\n      return typeof value === "string" ? value : null;\n    };\n    const message = text("message"),\n      errno = text("code"),\n      stack = text("stack");\n    const frames = [];\n    if (stack)\n      for (const match of stack\n        .slice(0, 16384)\n        .matchAll(\n          /^\\s+at (?:async )?([A-Za-z_$][\\w$]{0,63})(?:\\.([A-Za-z_$][\\w$]{0,63}))? \\(/gm,\n        )) {\n        frames.push(match[2] ?? match[1]);\n        if (frames.length === 3) break;\n      }\n    const line = fullRedactLine(\n      message === null ? "" : message.slice(0, 2048).split(/\\r?\\n/)[0],\n      root,\n      300,\n    );\n    const safe = (value, pattern) =>\n      typeof value === "string" && pattern.test(value) ? value : null;\n    return {\n      kind: "windows-arm-source-failure-cause",\n      step: safe(step, /^[a-z0-9-]{1,48}$/),\n      code: safe(message, /^[A-Z][A-Z0-9_]{2,63}$/),\n      errno: safe(errno, /^[A-Z][A-Z0-9_]{2,31}$/),\n      frames,\n      message: line,\n    };\n  } catch {\n    return null;\n  }\n}\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "722d6eb28964ee626f679a0dc8e408952d650fa6dc82208dcbe6262830dc8d9b",
      },
      {
        old: "",
        new: '    const failureCause =\n      failed && stage === "metadata-qualification"\n        ? fullFailureCause(primary, currentProgress?.label, root)\n        : null;\n    const failureLogs =\n      failed && stage === "metadata-qualification"\n        ? await fullFailureLogTails(root)\n        : null;\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "2f2af5e62eaa3602de93d0843f526173e9d3cffb50397bee314765e1c0a80bee",
      },
      {
        old: "",
        new: "      ...(failureCause ? { failureCause } : {}),\n      ...(failureLogs?.length ? { failureLogs } : {}),\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "09cc6675e811865a03b5be3fd2ade3db8e9b60099dea14cbefce4f6884b8677b",
      },
      {
        old: "",
        new: "      const cause = fullFailureCause(error, null, null);\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "7356106c1b7cec813a60a44706c6116524e18e32d34acb5fc013d1861fb6310e",
      },
      {
        old: "",
        new: "          ...(cause ? { cause } : {}),\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "381bb2b9cd771d75ce428ea9e8303a855658bcd611fda5ffb2d844092cf4ee4f",
      },
    ],
  },
};
function fullGraphCauseInverse(text, name) {
  text = fullGraphLiteralInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_CAUSE_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_CAUSE_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_CAUSE_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_CAUSE_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_CAUSE_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_CAUSE_WHOLE");
  return text;
}
const FULL_GRAPH_ARGS_HISTORY = {
  driver: {
    bytes: 300593,
    sha256: "99b5acb12fdb6cb3d04d3b52229d8c78a8c8dde34993fe9557d37de6ea7aad66",
    rows: [
      {
        old: '  for (const [name, expected] of Object.entries(QUALIFICATION_DECLARED_ARGS))\n    need(values[name] === expected, "PRIVATE_GN_ARG_CRITICAL");\n',
        new: '  const argMismatch = Object.entries(QUALIFICATION_DECLARED_ARGS).filter(\n    ([name, expected]) =>\n      values[name] !== expected &&\n      // GN lists the declared default "" for the v8 sandbox switch and only\n      // resolves it from pointer compression inside v8/BUILD.gn, so "" (unset)\n      // is the enabled state on arm64; an explicit false still denies.\n      !(name === "v8_enable_sandbox" && values[name] === \'""\'),\n  );\n  if (argMismatch.length) {\n    // Names and short literal values of the mismatching critical switches only.\n    const failure = new Error("PRIVATE_GN_ARG_CRITICAL");\n    failure.gnArgShape = argMismatch\n      .slice(0, 16)\n      .map(([name]) => [\n        name,\n        typeof values[name] === "string" ? values[name].slice(0, 32) : "absent",\n      ]);\n    throw failure;\n  }\n',
        oldSha256:
          "365701c28899099681f87d4fbb84e79de172b50445188cdfb53e45a6944ef43b",
        newSha256:
          "05c942b7765c911ed0a26bec7c870daae5b997cdd6e8570e3dfa5e7ac8b2c36c",
      },
      {
        old: "",
        new: '  } catch {\n    return null;\n  }\n}\n// Mismatching critical GN switch names and short values (bounded, no paths).\nfunction fullGnArgDiagnostic(error) {\n  try {\n    if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n      return null;\n    const rows = fullGraphOwnValue(error, "gnArgShape");\n    if (!Array.isArray(rows) || rows.length > 16) return null;\n    const keys = [];\n    for (const row of rows) {\n      if (\n        !Array.isArray(row) ||\n        row.length !== 2 ||\n        typeof row[0] !== "string" ||\n        !/^[a-z][a-z0-9_]{0,127}$/.test(row[0]) ||\n        typeof row[1] !== "string" ||\n        !/^[\\x20-\\x7e]{0,32}$/.test(row[1])\n      )\n        return null;\n      keys.push([row[0], row[1]]);\n    }\n    return { kind: "windows-arm-source-gn-arg-critical", keys };\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "a6e782866f37f69c30e2066fca52280b731913b4a34496b7d3e0a3bfc4f2c794",
      },
      {
        old: "",
        new: '    const gnArgDiagnostic =\n      failed && stage === "metadata-qualification"\n        ? fullGnArgDiagnostic(primary)\n        : null;\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "3aa21cf8c4a387be310aac5b345991e2849b1bc9c6891fa58b4d95b8dadfa810",
      },
      {
        old: "",
        new: "      ...(gnArgDiagnostic ? { gnArgDiagnostic } : {}),\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "769270e1a8d0b4b43275f8ddd7324523b520ec30e209e1b49777938eb667bb69",
      },
    ],
  },
  controller: {
    bytes: 177684,
    sha256: "95b9c3b3d32ea97d70b6c5a61577d323193b3d0ce55078bc9a305aadd64c6dce",
    rows: [
      {
        old: "  for (const [name, expected] of Object.entries(\n",
        new: "  const argMismatch = Object.entries(\n",
        oldSha256:
          "359b0f83a8c4774bf508fff36d67b73a6634d582bb0044ca13b7769f0a3a7c0c",
        newSha256:
          "523cd4a414e823375213ee21cadcff6ea65562d97a7ba14b1b1796b1b9246643",
      },
      {
        old: '  ))\n    need(values[name] === expected, "PRIVATE_GN_ARG_CRITICAL");\n',
        new: '  ).filter(\n    ([name, expected]) =>\n      values[name] !== expected &&\n      // GN lists the declared default "" for the v8 sandbox switch and only\n      // resolves it from pointer compression inside v8/BUILD.gn, so "" (unset)\n      // is the enabled state on arm64; an explicit false still denies.\n      !(name === "v8_enable_sandbox" && values[name] === \'""\'),\n  );\n  if (argMismatch.length) {\n    // Names and short literal values of the mismatching critical switches only.\n    const failure = new Error("PRIVATE_GN_ARG_CRITICAL");\n    failure.gnArgShape = argMismatch\n      .slice(0, 16)\n      .map(([name]) => [\n        name,\n        typeof values[name] === "string" ? values[name].slice(0, 32) : "absent",\n      ]);\n    throw failure;\n  }\n',
        oldSha256:
          "9a77626914c0ebe5d122aebcc512d04b5c4eada776132750383cb658e22c2837",
        newSha256:
          "1c70991bc6d2c9c308b2b234210e6e12ce9bb1536560ef526de57a7740417763",
      },
    ],
  },
};
function fullGraphArgsInverse(text, name) {
  text = fullGraphCauseInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_ARGS_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_ARGS_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_ARGS_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_ARGS_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_ARGS_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_ARGS_WHOLE");
  return text;
}
const FULL_GRAPH_LIMITS_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989",
    rows: [
      {
        old: '    "sourceSeconds": 10800,\n',
        new: '    "sourceSeconds": 14400,\n',
        oldSha256:
          "f4487aafda717bc4fa6a3b54f2aefd75e751fa098f382a8d7e28a85987cc5128",
        newSha256:
          "9e099f3c08b5466917ba0843ec60386ea23f551719bf1409d67a03387ad43005",
      },
    ],
  },
  driver: {
    bytes: 300504,
    sha256: "1d8842482adf844a9f4622e1ab563177d691f292c64fc58c03b692b36d6f8ce3",
    rows: [
      {
        old: "    aggregateWorkMs: 5400000,\n",
        new: "    aggregateWorkMs: 6300000,\n",
        oldSha256:
          "93ef46e94920b53aff1b5b4f0da3d4732c553d4910ed725596d9bff2a357bcd3",
        newSha256:
          "f652aaa3b94c9be360f49d53ccdd47e57ae29db19a31187e59dc620210890bcb",
      },
      {
        old: "  // Six roles each revalidate the 4.5-minute graph inventory before and after,\n  // so the original 15-minute phase cannot hold them; 90 minutes still leaves\n  // the 150-second reserve inside the original source budget.\n  const allowance = Math.min(5400000, remaining - 150000);\n",
        new: "  // Four roles each revalidate the 4.4-minute graph inventory before and after\n  // (about 45 minutes) plus the GN and siso runs, so the original 15-minute\n  // phase cannot hold them; 105 minutes is the measured need with margin, still\n  // clipped to the remaining source budget less the 150-second reserve.\n  const allowance = Math.min(6300000, remaining - 150000);\n",
        oldSha256:
          "89da3ec78da391ee69f231a41ee43aaa4a0340620d910b30e9262499e87fd1e4",
        newSha256:
          "41e3c2c780d175eea2fe3ed670dd07de4f72aa608978a619867b69689df2efcf",
      },
      {
        old: "      if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 10800000)\n",
        new: "      if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 14400000)\n",
        oldSha256:
          "cc85b485b0746df352c00c0f9b8d1d911fb2edff8121755e8c92f1c5dc4e3d24",
        newSha256:
          "c8eb08df421208dab965bb8c408d1620e2488232619634dae73259838e600495",
      },
      {
        old: "          elapsed <= 10800000 &&\n",
        new: "          elapsed <= 14400000 &&\n",
        oldSha256:
          "32c70b45c14a63d9588c742a5be4ac9f4322b293cd80cb620d10a9bcac0237fe",
        newSha256:
          "6b6fc0ad6b83f36ac1f3c7e77d6fc34592f005c5760f313d470136f7d342b046",
      },
      {
        old: '  "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989";\n',
        new: '  "c1a3a02f7267db73055a66addb14d6ac2565a3ba96685822f81b27e8080ea633";\n',
        oldSha256:
          "fb9963aa8148587faa48ae66c8b3b8547f4fab8e849eff2d49aab18815841446",
        newSha256:
          "99c7471341f60d05d95ccbbca3630271c294f050a9d0ad697984b90319eee09a",
      },
      {
        old: '  need(remaining > 150 && remaining <= 10800, "PRIVATE_DEADLINE");\n',
        new: '  need(remaining > 150 && remaining <= 14400, "PRIVATE_DEADLINE");\n',
        oldSha256:
          "c1ce91776c3112acec575bd472ac82d360bf6e4266d46efe8af5fc4f25035abe",
        newSha256:
          "0acb675f238a49dfd0206b04a84cba0d3e2fe8cb18f9e6893e7f35ec1646af41",
      },
      {
        old: "  const original = Math.min(\n    10800000,\n",
        new: "  const original = Math.min(\n    14400000,\n",
        oldSha256:
          "1265a06245ba4adba77c0069d796779a8d849eaccc073871d6188bf312982072",
        newSha256:
          "7087b74e126b8730b172bebdc96a820af6e5101bc3c4fefab9168dcff3f67c4a",
      },
      {
        old: "      limits.sourceSeconds === 10800 &&\n",
        new: "      limits.sourceSeconds === 14400 &&\n",
        oldSha256:
          "b2be24b418cadf239aaa0d27dfb76c6bebde8bdb459e59c6edc1f07790c64ab9",
        newSha256:
          "c693d6e5124689bfe07658adc46db2297ac25a64e910cc4763a1308d5e5be9ab",
      },
      {
        old: "      10800000,\n",
        new: "      14400000,\n",
        oldSha256:
          "0ff1ffe51ff6e078334fb633a440ee0563beef4452d293dc81464d8fc18b6d52",
        newSha256:
          "1e04c71bda0d550c7a46aaa1f76de129c2b3685109a4ae628716dc9c03e74e47",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "99a159f07f14eae0a18b72bc696d0ce81097b87bd44e9843ff4b3d3789ccb8af",
    rows: [
      {
        old: "PROFILE_SHA256 = 'be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989'\n",
        new: "PROFILE_SHA256 = 'c1a3a02f7267db73055a66addb14d6ac2565a3ba96685822f81b27e8080ea633'\n",
        oldSha256:
          "dc0050ef4c91357e662d8bf36a0c6508d03c5c8f547d66ad315e34ab17576b2e",
        newSha256:
          "e84bea563ca0315fe310d2b34aa621fae065e238896fdd7107291ee966f21586",
      },
      {
        old: "    need(150 < whole <= 21600 and 150 < source <= 10800 and\n",
        new: "    need(150 < whole <= 21600 and 150 < source <= 14400 and\n",
        oldSha256:
          "b13870ea593f2ee58f1581791b930a3d14bd72e49d2141fac80defff3cc27da0",
        newSha256:
          "b4e7aa839dd4f6f0f798921808e073c301b3b043e5c0fc63313ca72171f6cea4",
      },
      {
        old: "                         'runtime-closure': 720}.get(role, 10800)\n",
        new: "                         'runtime-closure': 720}.get(role, 14400)\n",
        oldSha256:
          "105e5d0a664aa3aa5ae246d377ee1c63b506383975f4fb41c8450ac1c77641e4",
        newSha256:
          "16f2d807285812074e1936aaefe1eba58c5daeee58f47a54d4e96a467f475090",
      },
    ],
  },
  controller: {
    bytes: 177684,
    sha256: "ec3ce6cd45d74fcaf75e0426a50ac697a36b86de890b46023143fda83ac79fe3",
    rows: [
      {
        old: '  "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989";\n',
        new: '  "c1a3a02f7267db73055a66addb14d6ac2565a3ba96685822f81b27e8080ea633";\n',
        oldSha256:
          "fb9963aa8148587faa48ae66c8b3b8547f4fab8e849eff2d49aab18815841446",
        newSha256:
          "99c7471341f60d05d95ccbbca3630271c294f050a9d0ad697984b90319eee09a",
      },
      {
        old: "const SOURCE_MS = 10800000;\n",
        new: "const SOURCE_MS = 14400000;\n",
        oldSha256:
          "29f47cf5678eb0da3864e31baee7b92e23bc98cf227d43b28cb9ca67ce736a26",
        newSha256:
          "7bb00737e2f3b5788ee80a33a05290cc90b6bce066f443c66f9702e5d83b3f68",
      },
    ],
  },
};
function fullGraphLimitsInverse(text, name) {
  text = fullGraphArgsInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_LIMITS_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_LIMITS_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_LIMITS_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_LIMITS_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_LIMITS_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_LIMITS_WHOLE");
  return text;
}
const FULL_GRAPH_BUDGET_HISTORY = {
  driver: {
    bytes: 300280,
    sha256: "8f66ef72e567712c80a0fe63005306599698672b30b47ef924cf153e90027ac5",
    rows: [
      {
        old: "    aggregateWorkMs: 900000,\n",
        new: "    aggregateWorkMs: 5400000,\n",
        oldSha256:
          "1e4c4e17b7bcae739e4db0b4756ef4e4622f51c0f6d163179c5e539991b7af5f",
        newSha256:
          "93ef46e94920b53aff1b5b4f0da3d4732c553d4910ed725596d9bff2a357bcd3",
      },
      {
        old: "  const allowance = Math.min(900000, remaining - 150000);\n",
        new: "  // Six roles each revalidate the 4.5-minute graph inventory before and after,\n  // so the original 15-minute phase cannot hold them; 90 minutes still leaves\n  // the 150-second reserve inside the original source budget.\n  const allowance = Math.min(5400000, remaining - 150000);\n",
        oldSha256:
          "3e9fa98c2eaec0ede8b8135b6f0c08e7338df6963e556b401563a989024dfd8e",
        newSha256:
          "89da3ec78da391ee69f231a41ee43aaa4a0340620d910b30e9262499e87fd1e4",
      },
    ],
  },
};
function fullGraphBudgetInverse(text, name) {
  text = fullGraphLimitsInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_BUDGET_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_BUDGET_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_BUDGET_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_BUDGET_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_BUDGET_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_BUDGET_WHOLE");
  return text;
}
const FULL_GRAPH_SHAPE_HISTORY = {
  driver: {
    bytes: 297164,
    sha256: "19a14ac8024f8aa1f30c6df5906fea28a70a8163e6b1003beb0353454809fcc6",
    rows: [
      {
        old: "  qualificationShape(\n    action,\n    [\n",
        new: "  // Closed key set of the pinned GN150a9d6 src/gn/desc_builder.cc for an\n  // action: the core keys are always emitted, the role key is required by the\n  // reviewed policy, and the rest are emitted only when non-empty (the\n  // inherited public_configs/libs/... also appear, e.g. buildflags inherits a\n  // public config and the clang builtins lib through its public dep).\n  const gnCore = [\n",
        oldSha256:
          "60db788b61f9d2a1e270b9527c3dbba01d619065b92742807be54fd9a59db852",
        newSha256:
          "04784b6b4fc73fca6d5ca7acfb4e390c40c24aa546de3203f150acfb84e25dd8",
      },
      {
        old: '      "deps",\n      ...(role === "partitionAlloc" ? ["response_file_contents"] : ["inputs"]),\n',
        new: '      "deps",\n',
        oldSha256:
          "15b3792b20ebeb1c8228a787a00296172b8420d8fea81201260dde65486e30e2",
        newSha256:
          "4c62f6037299260d2f14ca4a461f49c012e4d21c855a8486e965e0bfb4558759",
      },
      {
        old: '    "PRIVATE_GN_DESC_FIELDS",\n  );\n',
        new: '    gnRequired = [\n      ...gnCore,\n      role === "partitionAlloc" ? "response_file_contents" : "inputs",\n    ],\n    gnOptional = [\n      "data",\n      "sources",\n      "inputs",\n      "response_file_contents",\n      "depfile",\n      "output_name",\n      "output_dir",\n      "output_extension",\n      "gen_deps",\n      "validations",\n      "public_configs",\n      "all_dependent_configs",\n      "libs",\n      "lib_dirs",\n      "frameworks",\n      "weak_frameworks",\n      "weak_libraries",\n      "framework_dirs",\n    ];\n  const gnPlain =\n    action !== null &&\n    typeof action === "object" &&\n    !Array.isArray(action) &&\n    Object.getPrototypeOf(action) === Object.prototype;\n  if (\n    !gnPlain ||\n    !gnRequired.every((key) => Object.hasOwn(action, key)) ||\n    !Object.keys(action).every(\n      (key) => gnRequired.includes(key) || gnOptional.includes(key),\n    )\n  ) {\n    // Names and value types only, bounded; never values.\n    const failure = new Error("PRIVATE_GN_DESC_FIELDS");\n    failure.gnDescShape = gnPlain\n      ? Object.keys(action)\n          .slice(0, 64)\n          .map((key) => [\n            key.replace(/[^a-z0-9_]/g, "_").slice(0, 48),\n            action[key] === null\n              ? "null"\n              : Array.isArray(action[key])\n                ? "array"\n                : typeof action[key],\n          ])\n      : [];\n    throw failure;\n  }\n  for (const key of gnOptional)\n    if (Object.hasOwn(action, key))\n      need(\n        Array.isArray(action[key])\n          ? action[key].length <= 4096 &&\n              action[key].every(\n                (item) =>\n                  typeof item === "string" &&\n                  qualificationStringBound(item, 4096),\n              )\n          : typeof action[key] === "string" &&\n              qualificationStringBound(action[key], 4096),\n        "PRIVATE_GN_DESC_FIELDS",\n      );\n',
        oldSha256:
          "2b3ffec696ac3f114ed639094be49a81561a043d55f82f325e8c4c75651a2973",
        newSha256:
          "eb8260b105358b1ff3ece2975ec9f31cf8935e6505e83ef1441ace1920b0eeb7",
      },
      {
        old: "",
        new: '}\n// Observed GN desc action key names and value types only (bounded, no values).\nfunction fullGnDescDiagnostic(error) {\n  try {\n    if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n      return null;\n    const rows = fullGraphOwnValue(error, "gnDescShape");\n    if (!Array.isArray(rows) || rows.length > 64) return null;\n    const keys = [];\n    for (const row of rows) {\n      if (\n        !Array.isArray(row) ||\n        row.length !== 2 ||\n        typeof row[0] !== "string" ||\n        !/^[a-z0-9_]{1,48}$/.test(row[0]) ||\n        !["array", "string", "number", "boolean", "object", "null"].includes(\n          row[1],\n        )\n      )\n        return null;\n      keys.push([row[0], row[1]]);\n    }\n    return { kind: "windows-arm-source-gn-desc-shape", keys };\n  } catch {\n    return null;\n  }\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "13e226c3ded6e7978a4770842d14eb0d19b7b881e3c3b331b588b869cdf88ace",
      },
      {
        old: "",
        new: '    const gnDescDiagnostic =\n      failed && stage === "metadata-qualification"\n        ? fullGnDescDiagnostic(primary)\n        : null;\n',
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "630a37f882334dba120c79073da8e79f8aa8bafef30380a99674d6a37f8c67cf",
      },
      {
        old: "",
        new: "      ...(gnDescDiagnostic ? { gnDescDiagnostic } : {}),\n",
        oldSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        newSha256:
          "bfb08c042adca7e7b6e20c7b921b71ffb3b51f92547a2d76e4e3e13e1c22521e",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "62760e79a1076d07f3b8c00ebb26f631f9f0336bbb99b162a9dedc9f014e2c73",
    rows: [
      {
        old: "  parentMetadata_qualificationShape(\n    action,\n    [\n",
        new: "  // Closed key set of the pinned GN150a9d6 src/gn/desc_builder.cc for an\n  // action: the core keys are always emitted, the role key is required by the\n  // reviewed policy, and the rest are emitted only when non-empty (the\n  // inherited public_configs/libs/... also appear, e.g. buildflags inherits a\n  // public config and the clang builtins lib through its public dep).\n  const gnCore = [\n",
        oldSha256:
          "74ec9f82ff2b642045394e9b12bdaeeebadeceb72b54e6b8533d7f7463763738",
        newSha256:
          "04784b6b4fc73fca6d5ca7acfb4e390c40c24aa546de3203f150acfb84e25dd8",
      },
      {
        old: '      "deps",\n      ...(role === "partitionAlloc" ? ["response_file_contents"] : ["inputs"]),\n',
        new: '      "deps",\n',
        oldSha256:
          "15b3792b20ebeb1c8228a787a00296172b8420d8fea81201260dde65486e30e2",
        newSha256:
          "4c62f6037299260d2f14ca4a461f49c012e4d21c855a8486e965e0bfb4558759",
      },
      {
        old: '    "PRIVATE_GN_DESC_FIELDS",\n  );\n',
        new: '    gnRequired = [\n      ...gnCore,\n      role === "partitionAlloc" ? "response_file_contents" : "inputs",\n    ],\n    gnOptional = [\n      "data",\n      "sources",\n      "inputs",\n      "response_file_contents",\n      "depfile",\n      "output_name",\n      "output_dir",\n      "output_extension",\n      "gen_deps",\n      "validations",\n      "public_configs",\n      "all_dependent_configs",\n      "libs",\n      "lib_dirs",\n      "frameworks",\n      "weak_frameworks",\n      "weak_libraries",\n      "framework_dirs",\n    ];\n  const gnPlain =\n    action !== null &&\n    typeof action === "object" &&\n    !Array.isArray(action) &&\n    Object.getPrototypeOf(action) === Object.prototype;\n  if (\n    !gnPlain ||\n    !gnRequired.every((key) => Object.hasOwn(action, key)) ||\n    !Object.keys(action).every(\n      (key) => gnRequired.includes(key) || gnOptional.includes(key),\n    )\n  ) {\n    // Names and value types only, bounded; never values.\n    const failure = new Error("PRIVATE_GN_DESC_FIELDS");\n    failure.gnDescShape = gnPlain\n      ? Object.keys(action)\n          .slice(0, 64)\n          .map((key) => [\n            key.replace(/[^a-z0-9_]/g, "_").slice(0, 48),\n            action[key] === null\n              ? "null"\n              : Array.isArray(action[key])\n                ? "array"\n                : typeof action[key],\n          ])\n      : [];\n    throw failure;\n  }\n  for (const key of gnOptional)\n    if (Object.hasOwn(action, key))\n      need(\n        Array.isArray(action[key])\n          ? action[key].length <= 4096 &&\n              action[key].every(\n                (item) =>\n                  typeof item === "string" &&\n                  parentMetadata_qualificationStringBound(item, 4096),\n              )\n          : typeof action[key] === "string" &&\n              parentMetadata_qualificationStringBound(action[key], 4096),\n        "PRIVATE_GN_DESC_FIELDS",\n      );\n',
        oldSha256:
          "2b3ffec696ac3f114ed639094be49a81561a043d55f82f325e8c4c75651a2973",
        newSha256:
          "41ae60b3f85c27d8a98d1bdcc5cc0ddaa01286be4bffdc65471ebde0b690f9d0",
      },
    ],
  },
};
function fullGraphShapeInverse(text, name) {
  text = fullGraphBudgetInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_SHAPE_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_SHAPE_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_SHAPE_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_SHAPE_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_SHAPE_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_SHAPE_WHOLE");
  return text;
}
const FULL_GRAPH_PATH_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2",
    rows: [
      {
        old: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '      "profileSha256": "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
        newSha256:
          "edd7aec6133b0861f98c348367d54be9ab3cc0c06001c73a6c3beab2705185d1",
      },
      {
        old: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '      "profileSha256": "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
        newSha256:
          "fc25495a35149d615f743038c0e88f15f9533bd777e82633590926f40eb96006",
      },
      {
        old: '  "metadataRecipeSha256": "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37",\n',
        new: '  "metadataRecipeSha256": "8f41fafa6722fcf6e68bd67f3bdad6317e3be77c03e1c01b0e41758aab6fb3c9",\n',
        oldSha256:
          "b0ef88f353d8e9fcfa993124a46dd862930f567836fee4fa2c9fc0e2e59890b8",
        newSha256:
          "fbd3be57898bb51552bab0d94d39d52f18c83d5561c6491fbed9c017aed6e223",
      },
    ],
  },
  driver: {
    bytes: 297164,
    sha256: "8ccbcf6ca6252e53bbd5e399521578c9665309c59120fdbf7380a3ffa6846850",
    rows: [
      {
        old: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        new: '  "8f41fafa6722fcf6e68bd67f3bdad6317e3be77c03e1c01b0e41758aab6fb3c9";\n',
        oldSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
        newSha256:
          "91e9df48edca27254a67d45afe3654ea741d5d5f25381671373a76011f0ccc53",
      },
      {
        old: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        new: '  "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989";\n',
        oldSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
        newSha256:
          "fb9963aa8148587faa48ae66c8b3b8547f4fab8e849eff2d49aab18815841446",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "9f33c9695ab44d82fa38154f723a23e4ec61da2e9d5ef62e671e5a8d5563e8e9",
    rows: [
      {
        old: "PROFILE_SHA256 = '01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2'\n",
        new: "PROFILE_SHA256 = 'be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989'\n",
        oldSha256:
          "913451cc4e80d3aee1af4d27556b94f912ca4fbdf02e904b0094856d19be6a26",
        newSha256:
          "dc0050ef4c91357e662d8bf36a0c6508d03c5c8f547d66ad315e34ab17576b2e",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "6b26b4a0ac49b3ac16b5eda04098c39d2add168d99d106ca5f4e5fa72f98a0b4",
    rows: [
      {
        old: '    profile: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '    profile: "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "fb04d2d06d9b05e1856829ed5d047392836a657cf78bcecb3d323edec24e07be",
        newSha256:
          "7a4b48c068df36966d080ccd54963ef811afea526a5ffd2ee4ce54b5cdb2c9b2",
      },
      {
        old: '    profile: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '    profile: "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "85d1837fbce3019237bafe4ee930da1f784fff920d79299ac43fed76fc0284ea",
        newSha256:
          "cb1277140b776e89b1c8d1509f7ec286c62c32eaa6940f64e2e511431e212744",
      },
      {
        old: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        new: '  "be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989";\n',
        oldSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
        newSha256:
          "fb9963aa8148587faa48ae66c8b3b8547f4fab8e849eff2d49aab18815841446",
      },
      {
        old: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        new: '  "8f41fafa6722fcf6e68bd67f3bdad6317e3be77c03e1c01b0e41758aab6fb3c9";\n',
        oldSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
        newSha256:
          "91e9df48edca27254a67d45afe3654ea741d5d5f25381671373a76011f0ccc53",
      },
    ],
  },
  producer: {
    bytes: 61403,
    sha256: "4643fd24aa78b607e698fd61663f18654c9b82abf755bc95da4bb68484b727b1",
    rows: [
      {
        old: "                    'sha256': '953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50',\n",
        new: "                    'sha256': 'e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05',\n",
        oldSha256:
          "8c82155f4ad72ec92aa25de8691a8f0cc5484d0409ade5128519c185c726f1ba",
        newSha256:
          "7e97d3d5ed4938715771575a4004f1cf3a5d77b41cc7e6d3ce9e10a7f250dd77",
      },
      {
        old: "                    'sha256': 'ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719',\n",
        new: "                    'sha256': '442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6',\n",
        oldSha256:
          "04a9c43d20ab002f500e2cfe55777269d36300b6e4f55e420ee409f1954c1d01",
        newSha256:
          "1250a67f483b0435f3e56b45d657c8f7535ef662cfbfac629bb26bc2aeca0f39",
      },
    ],
  },
  imageCurrent: {
    bytes: 34813,
    sha256: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",
    rows: [
      {
        old: '        "bytes": 195961,\n        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        new: '        "bytes": 196018,\n        "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2"\n',
        oldSha256:
          "44db50fc5f77ef0e9234680ede59f285fbd9344c9fd1d7eeb8eeb0859f6f3fb7",
        newSha256:
          "9331dc69c8aa53ab318120567a0f4d90040b4ed6760dbaf65e3429ce6f98ff15",
      },
      {
        old: '      "bytes": 195961,\n      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        new: '      "bytes": 196018,\n      "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2",\n',
        oldSha256:
          "463fc86252bf42ff7786e6c99871c09cb4f1ea4274fc414a971badeced8d1932",
        newSha256:
          "78bc4392b6be991316efd8a7833e9043d11a132bf34b678c59726ba20b17ebd6",
      },
    ],
  },
  image20261021: {
    bytes: 35867,
    sha256: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",
    rows: [
      {
        old: '        "bytes": 195961,\n        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        new: '        "bytes": 196018,\n        "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2"\n',
        oldSha256:
          "44db50fc5f77ef0e9234680ede59f285fbd9344c9fd1d7eeb8eeb0859f6f3fb7",
        newSha256:
          "9331dc69c8aa53ab318120567a0f4d90040b4ed6760dbaf65e3429ce6f98ff15",
      },
      {
        old: '      "bytes": 195961,\n      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        new: '      "bytes": 196018,\n      "sha256": "525eba90977c7c040509029141b153d4d1f14c405960a338469aa167a23bbce2",\n',
        oldSha256:
          "463fc86252bf42ff7786e6c99871c09cb4f1ea4274fc414a971badeced8d1932",
        newSha256:
          "78bc4392b6be991316efd8a7833e9043d11a132bf34b678c59726ba20b17ebd6",
      },
    ],
  },
  engineProfile: {
    bytes: 8903,
    sha256: "59e3c3527215b1bf29a7255236b9adabbc825e3dc185b6d1f4268470e2b654f2",
    rows: [
      {
        old: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '      "profileSha256": "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
        newSha256:
          "edd7aec6133b0861f98c348367d54be9ab3cc0c06001c73a6c3beab2705185d1",
      },
      {
        old: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '      "profileSha256": "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
        newSha256:
          "fc25495a35149d615f743038c0e88f15f9533bd777e82633590926f40eb96006",
      },
    ],
  },
  privateProfile: {
    bytes: 22347,
    sha256: "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37",
    rows: [
      {
        old: '  "baseCandidatePolicySha256": "59e3c3527215b1bf29a7255236b9adabbc825e3dc185b6d1f4268470e2b654f2",\n',
        new: '  "baseCandidatePolicySha256": "9df48c9f1bfded6b7e9953aca9cc58ba5ada24ac0d70d25481b998bdfd80e7f5",\n',
        oldSha256:
          "de8999c3bad8e832f9f292e8361c65f6b0a1550f1d9da242c24eec3b160ace5c",
        newSha256:
          "8331b308187a0234b12e0200115b21e5132db20363889471c7ab09716f11e990",
      },
      {
        old: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        new: '      "profileSha256": "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",\n',
        oldSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
        newSha256:
          "edd7aec6133b0861f98c348367d54be9ab3cc0c06001c73a6c3beab2705185d1",
      },
      {
        old: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        new: '      "profileSha256": "442dde898498335536d158a1c39ca61abec5564bd72437ea43cd5745df0de3a6",\n',
        oldSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
        newSha256:
          "fc25495a35149d615f743038c0e88f15f9533bd777e82633590926f40eb96006",
      },
    ],
  },
  mirror: {
    bytes: 195961,
    sha256: "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",
    rows: [
      {
        old: "      candidates.push({ file, path: path.relative(root, file), metadata });\n",
        new: '      candidates.push({\n        file,\n        path: path.relative(root, file).split(path.sep).join("/"),\n        metadata,\n      });\n',
        oldSha256:
          "001ced507d2d3863d5e44a0a0bf10ddf4d23e0345255cb2a0377018df5f8ea2b",
        newSha256:
          "e9d92ab9f06e100c6bbc336393e43075e17407b9b254cf009f84b39b343e3648",
      },
    ],
  },
};
function fullGraphPathInverse(text, name) {
  text = fullGraphShapeInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_PATH_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_PATH_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_PATH_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_PATH_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_PATH_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_PATH_WHOLE");
  return text;
}
const FULL_GRAPH_DEADLINE_HISTORY = {
  profile: {
    bytes: 11144,
    sha256: "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332",
    rows: [
      {
        old: '      "profileSha256": "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "2a11c8ee7650978ddd556e3c88858d50c6d123db55b0cded99f77f526be0441e",
        newSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
      },
      {
        old: '      "profileSha256": "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "2b595173341d7825d14fe15e0e957adaca1063bb7a568b8eb31e3d550b76d9b8",
        newSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
      },
      {
        old: '  "metadataRecipeSha256": "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",\n',
        new: '  "metadataRecipeSha256": "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37",\n',
        oldSha256:
          "92ec62219f370c19a862ed1a69f28bea159078be990b9f421a1b59b36dc410a0",
        newSha256:
          "b0ef88f353d8e9fcfa993124a46dd862930f567836fee4fa2c9fc0e2e59890b8",
      },
    ],
  },
  driver: {
    bytes: 297164,
    sha256: "c8fb2c5d78dd9a38b015ba8e2c6e0d05e3f43c54da7f4848ce1bc4303af2d883",
    rows: [
      {
        old: '  "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052";\n',
        new: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        oldSha256:
          "2db5d8287d4c0f1b597da122f5d45f2d43dc637024b423f797dcf004bcc6e6c4",
        newSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
      },
      {
        old: "                Math.floor(Math.min(180000, state.end - performance.now())),\n",
        new: "                Math.floor(Math.min(900000, state.end - performance.now())),\n",
        oldSha256:
          "27ce0306ae1b6c93a31e647289e1245b785bde95e37eeac5d049bc2eb73e6476",
        newSha256:
          "c97fbb60c3981e3a359ad412fb45e14b027b179ef89408f428237709bc665159",
      },
      {
        old: "              1,\n              Math.floor(Math.min(180000, state.end - performance.now())),\n",
        new: "              1,\n              Math.floor(Math.min(900000, state.end - performance.now())),\n",
        oldSha256:
          "6ca640f847991ecf3d38b7255b2748db86c972a80b226101a4de751d37ac7770",
        newSha256:
          "eb65d76f99d5fc62ad2d87053255332fd56497024d472468cce4ca8287736501",
      },
      {
        old: '  "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332";\n',
        new: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        oldSha256:
          "c25dd24b51eff5245ab7dccd1eee3e195e2f1f5b301106d8e1c3dd1091501412",
        newSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
      },
      {
        old: "    elapsedMs > 180000\n",
        new: "    elapsedMs > 900000\n",
        oldSha256:
          "5e488a917f8f1d5ba65966bb601deab1db175d59890081c1b54347a5c878fd88",
        newSha256:
          "45192cdaab2e7fd6d291e578549a9125482f58931a7b9b35dbba2eca22e04d52",
      },
    ],
  },
  python: {
    bytes: 35367,
    sha256: "277fda994b94cec4de45331305104ae90a212e1ded739d7611116b3dbbfa16df",
    rows: [
      {
        old: "PROFILE_SHA256 = '2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332'\n",
        new: "PROFILE_SHA256 = '01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2'\n",
        oldSha256:
          "6f768c881308c6ee74744bfd648606a698d75efc300693d41458bb6032564ddc",
        newSha256:
          "913451cc4e80d3aee1af4d27556b94f912ca4fbdf02e904b0094856d19be6a26",
      },
    ],
  },
  controller: {
    bytes: 175570,
    sha256: "74d50ee77552237fbc390d7e96fbbc695bdea883af2b0fcf02e393edafebfeb3",
    rows: [
      {
        old: '    profile: "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '    profile: "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "6aad45f7a13f68438c22258fdb4aa2c91a402dfdceeac15916ea728044a7883c",
        newSha256:
          "fb04d2d06d9b05e1856829ed5d047392836a657cf78bcecb3d323edec24e07be",
      },
      {
        old: '    profile: "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '    profile: "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "de5a32ece35acccfce8723e3e296d44fab1c4bcf5d65f4e572b0527f5f982e6a",
        newSha256:
          "85d1837fbce3019237bafe4ee930da1f784fff920d79299ac43fed76fc0284ea",
      },
      {
        old: '  "2e41f52d0e4e45167d2ec35d5da13c3c2152c930ba727dd3a5e2e84fe7d15332";\n',
        new: '  "01d436e6aa1d58b444fec05350b487c6528cab183cb02913dccd4416fd00afe2";\n',
        oldSha256:
          "c25dd24b51eff5245ab7dccd1eee3e195e2f1f5b301106d8e1c3dd1091501412",
        newSha256:
          "6cb4b70c9b45d0eb30c87ce0f078663389fe463e0cad44b602e5159adfca75ab",
      },
      {
        old: '  "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052";\n',
        new: '  "8d572c6c9fc37843418d4c460efba5949ff21d7fd93ea24a713ce9c50690de37";\n',
        oldSha256:
          "2db5d8287d4c0f1b597da122f5d45f2d43dc637024b423f797dcf004bcc6e6c4",
        newSha256:
          "3999975214c33a61d516a9fa845e5b2d68fe984d5af049fb6adf9452f2384911",
      },
      {
        old: "            Math.floor(Math.min(180000, checkLease(state.lease))),\n",
        new: "            Math.floor(Math.min(900000, checkLease(state.lease))),\n",
        oldSha256:
          "3fd7036e35ce5ede092abe0a7e8013fa6a1aa22c7557eacd480a5ebdd6d1053c",
        newSha256:
          "7c1e4cadb7e5f0b8ab018cd6538a26b5892003062687cc10cabcea2467758ac8",
      },
    ],
  },
  producer: {
    bytes: 61403,
    sha256: "870857c0f46283ff23238a239249a9a9b672a6995cc2de134fc79507560ec01f",
    rows: [
      {
        old: "                    'sha256': '55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041',\n",
        new: "                    'sha256': '953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50',\n",
        oldSha256:
          "7ca3858a9945354478fbadc4aeb7e88bf876935ebcf59ad74689f8c18e3cd75b",
        newSha256:
          "8c82155f4ad72ec92aa25de8691a8f0cc5484d0409ade5128519c185c726f1ba",
      },
      {
        old: "                    'sha256': '3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637',\n",
        new: "                    'sha256': 'ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719',\n",
        oldSha256:
          "62c637cb53b0cb3b51504f316ed6a8bc54d5e9052499ccf67eb6bae4c91d8f85",
        newSha256:
          "04a9c43d20ab002f500e2cfe55777269d36300b6e4f55e420ee409f1954c1d01",
      },
    ],
  },
  imageCurrent: {
    bytes: 34813,
    sha256: "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",
    rows: [
      {
        old: '        "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f"\n',
        new: '        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        oldSha256:
          "c4897e44d8b465913974cfed470766b84e463a1980556b4d74bd3ce75be5cffa",
        newSha256:
          "ad01cda05689e1ad02b6d286925ae775efa398ad842438f811439861455736e4",
      },
      {
        old: '      "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f",\n',
        new: '      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        oldSha256:
          "219dfdc18c0997fac6912891bf0079adf363316b0352e0655686f2b7eab473f5",
        newSha256:
          "6279953bea63295575c7ded6c6517cade3d88a23fa72990b6f6f699bb5095002",
      },
    ],
  },
  image20261021: {
    bytes: 35867,
    sha256: "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",
    rows: [
      {
        old: '        "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f"\n',
        new: '        "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e"\n',
        oldSha256:
          "c4897e44d8b465913974cfed470766b84e463a1980556b4d74bd3ce75be5cffa",
        newSha256:
          "ad01cda05689e1ad02b6d286925ae775efa398ad842438f811439861455736e4",
      },
      {
        old: '      "sha256": "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f",\n',
        new: '      "sha256": "39e60e243bb93a85376f389cafe37be3566111274adc7bae6329a288784f9c6e",\n',
        oldSha256:
          "219dfdc18c0997fac6912891bf0079adf363316b0352e0655686f2b7eab473f5",
        newSha256:
          "6279953bea63295575c7ded6c6517cade3d88a23fa72990b6f6f699bb5095002",
      },
    ],
  },
  engineProfile: {
    bytes: 8903,
    sha256: "a49d50f77ab89e9e15e18de99946e757b1478ea306dfc58c1bc6a8379a46d18f",
    rows: [
      {
        old: '      "profileSha256": "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "2a11c8ee7650978ddd556e3c88858d50c6d123db55b0cded99f77f526be0441e",
        newSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
      },
      {
        old: '      "profileSha256": "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "2b595173341d7825d14fe15e0e957adaca1063bb7a568b8eb31e3d550b76d9b8",
        newSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
      },
    ],
  },
  privateProfile: {
    bytes: 22347,
    sha256: "e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052",
    rows: [
      {
        old: '  "baseCandidatePolicySha256": "a49d50f77ab89e9e15e18de99946e757b1478ea306dfc58c1bc6a8379a46d18f",\n',
        new: '  "baseCandidatePolicySha256": "59e3c3527215b1bf29a7255236b9adabbc825e3dc185b6d1f4268470e2b654f2",\n',
        oldSha256:
          "f6e84d9777c9203aa37b3306b23d0190a042490bc2af1a58e7663ff8ff66825f",
        newSha256:
          "de8999c3bad8e832f9f292e8361c65f6b0a1550f1d9da242c24eec3b160ace5c",
      },
      {
        old: '      "profileSha256": "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",\n',
        new: '      "profileSha256": "953f7aa7d6ec6117e1588b533dd90efc121249d3fa82fd37e40678a65254dd50",\n',
        oldSha256:
          "2a11c8ee7650978ddd556e3c88858d50c6d123db55b0cded99f77f526be0441e",
        newSha256:
          "30b052de938e855f215ee71ffaf2770f5f56964360eb9c4bcb0e0c011cc30435",
      },
      {
        old: '      "profileSha256": "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",\n',
        new: '      "profileSha256": "ccac67ead5ed17f84143ac95961b51b7dc7b5629744512a6b5e70b960800a719",\n',
        oldSha256:
          "2b595173341d7825d14fe15e0e957adaca1063bb7a568b8eb31e3d550b76d9b8",
        newSha256:
          "1044b5a06f596af44313fd2eca48d75091776ac56cb6ebdd45507204fc115114",
      },
    ],
  },
  mirror: {
    bytes: 195961,
    sha256: "fc5c43ea4e3111aa130db664d03f01935c6e2fc7c51349d34b00ee31ba9c597f",
    rows: [
      {
        old: "  milliseconds: 180000,\n",
        new: "  milliseconds: 900000,\n",
        oldSha256:
          "e581dd0c4c13980fb976d093bf2ff7f1617ae8e9e09378f269fc74d2e373e952",
        newSha256:
          "24cdda4fecbe121c497c35ce7cf388c841b95b5eb7e6ebd458082237913e3024",
      },
    ],
  },
};
function fullGraphDeadlineInverse(text, name) {
  text = fullGraphPathInverse(text, name);
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const spec = FULL_GRAPH_DEADLINE_HISTORY[name];
  if (!spec) return text;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_DEADLINE_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_DEADLINE_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_DEADLINE_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_DEADLINE_WHOLE",
  );
  assert.equal(sha(text), spec.sha256, "ASSEMBLY_INVERSE_GRAPH_DEADLINE_WHOLE");
  return text;
}
const FULL_GRAPH_DIAGNOSTICS_HISTORY = {
  bytes: 290034,
  sha256: "8f6ccea24cf9104e61ab26999dbec23a9fc90c346c018e8501252d68446b75c0",
  rows: [
    {
      old: "",
      new: "              ...fullGraphInventoryObserver(owner),\n",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "530c81351ac020444f04500e5c98f80612f84f58bfb00b1b06816ce05b24f482",
    },
    {
      old: "",
      new: '// BEGIN FULL GRAPH FAILURE OBSERVATIONS\n// Closed DATA only. The original graph helper, owner and every limit are unchanged.\nconst fullGraphObservations = new WeakMap();\nfunction fullGraphOwnValue(value, key) {\n  if (!value || typeof value !== "object" || utilTypes.isProxy(value))\n    return undefined;\n  const field = Object.getOwnPropertyDescriptor(value, key);\n  return field && Object.hasOwn(field, "value") ? field.value : undefined;\n}\nfunction fullGraphCounts(value) {\n  const files = fullGraphOwnValue(value, "files"),\n    bytes = fullGraphOwnValue(value, "bytes"),\n    visited = fullGraphOwnValue(value, "visited");\n  return Number.isSafeInteger(files) &&\n    files >= 0 &&\n    files <= 50001 &&\n    Number.isSafeInteger(bytes) &&\n    bytes >= 0 &&\n    bytes <= 50001 * 256 * 1024 ** 2 &&\n    Number.isSafeInteger(visited) &&\n    visited >= 0 &&\n    visited <= 300001\n    ? { files, bytes, visited }\n    : null;\n}\nfunction fullGraphProgress(value) {\n  const counts = fullGraphCounts(value),\n    phase = fullGraphOwnValue(value, "phase"),\n    active = fullGraphOwnValue(value, "active"),\n    completedHashedFiles = fullGraphOwnValue(value, "completedHashedFiles"),\n    completedHashedBytes = fullGraphOwnValue(value, "completedHashedBytes"),\n    elapsedMs = fullGraphOwnValue(value, "elapsedMs");\n  if (\n    !counts ||\n    !["metadata", "hashing", "complete", "stopped"].includes(phase) ||\n    !Number.isSafeInteger(active) ||\n    active < 0 ||\n    active > 4 ||\n    !Number.isSafeInteger(completedHashedFiles) ||\n    completedHashedFiles < 0 ||\n    completedHashedFiles > counts.files ||\n    !Number.isSafeInteger(completedHashedBytes) ||\n    completedHashedBytes < 0 ||\n    completedHashedBytes > counts.bytes ||\n    !Number.isSafeInteger(elapsedMs) ||\n    elapsedMs < 0 ||\n    elapsedMs > 180000\n  )\n    return null;\n  const supplied = fullGraphOwnValue(value, "categories"),\n    categories = {};\n  let files = 0,\n    bytes = 0;\n  for (const name of ["args", "build", "toolchain", "target"]) {\n    const row = fullGraphOwnValue(supplied, name),\n      count = fullGraphOwnValue(row, "files"),\n      size = fullGraphOwnValue(row, "bytes");\n    if (\n      !Number.isSafeInteger(count) ||\n      count < 0 ||\n      count > counts.files ||\n      !Number.isSafeInteger(size) ||\n      size < 0 ||\n      size > counts.bytes\n    )\n      return null;\n    categories[name] = Object.freeze({ files: count, bytes: size });\n    files += count;\n    bytes += size;\n  }\n  if (files !== counts.files || bytes !== counts.bytes) return null;\n  return Object.freeze({\n    phase,\n    ...counts,\n    active,\n    completedHashedFiles,\n    completedHashedBytes,\n    elapsedMs,\n    categories: Object.freeze(categories),\n  });\n}\nfunction fullGraphInventoryObserver(owner) {\n  const observation = fullGraphObservations.get(owner);\n  if (!observation) return {};\n  return {\n    observe(value) {\n      try {\n        if (\n          observation.closed ||\n          observation.state.retired ||\n          observation.state.epoch !== observation.epoch\n        )\n          return;\n        if (observation.progress.length >= 36) {\n          observation.discardedSamples = Math.min(\n            36,\n            observation.discardedSamples + 1,\n          );\n          return;\n        }\n        const sample = fullGraphProgress(value);\n        if (sample) observation.progress.push(sample);\n        else\n          observation.discardedSamples = Math.min(\n            36,\n            observation.discardedSamples + 1,\n          );\n      } catch {\n        // No diagnostic failure may retire an owner or replace the original cause.\n      }\n    },\n  };\n}\nfunction collectFullQualificationGraph(owner) {\n  const { state } = fullMetadataOwner(owner);\n  need(!fullGraphObservations.has(owner), "FULL_GRAPH_OBSERVATION_REPEAT");\n  const observation = {\n    state,\n    epoch: state.epoch,\n    progress: [],\n    discardedSamples: 0,\n    closed: false,\n  };\n  fullGraphObservations.set(owner, observation);\n  const pending = collectQualificationGraph(owner);\n  // Observe settlement without adding a new promise/adoption boundary.\n  void pending.then(\n    () => {\n      observation.closed = true;\n    },\n    () => {\n      observation.closed = true;\n    },\n  );\n  return pending;\n}\nfunction fullGraphFailureClassification(error) {\n  if (!error || utilTypes.isProxy(error) || !utilTypes.isNativeError(error))\n    return { code: "UNKNOWN" };\n  const code = fullGraphOwnValue(error, "code");\n  if (code === "GRAPH_BOUND") {\n    const counts = fullGraphCounts(fullGraphOwnValue(error, "graphCounts"));\n    return { code: "GRAPH_BOUND", ...(counts ? { graphCounts: counts } : {}) };\n  }\n  if (\n    [\n      "ENOENT",\n      "EACCES",\n      "EPERM",\n      "EIO",\n      "EMFILE",\n      "ENFILE",\n      "ENOMEM",\n      "ENOSPC",\n      "ENOTDIR",\n      "EISDIR",\n      "ELOOP",\n      "EINVAL",\n      "EBADF",\n      "EBUSY",\n      "ETIMEDOUT",\n      "ENAMETOOLONG",\n      "EROFS",\n      "ENODEV",\n      "ECANCELED",\n      "ABORT_ERR",\n    ].includes(code)\n  )\n    return { code: "GRAPH_FS_ERROR", errno: code };\n  const known = new Map([\n    ["Invalid graph deadline", "GRAPH_INVALID_DEADLINE"],\n    ["Invalid graph inventory counters", "GRAPH_INVALID_COUNTERS"],\n    ["Checkpoint asset size", "GRAPH_ASSET_SIZE"],\n    ["Checkpoint asset changed", "GRAPH_ASSET_CHANGED"],\n    ["Fresh complete GN graph required", "GRAPH_INCOMPLETE"],\n    ["Complete graph pins required", "GRAPH_INCOMPLETE_PINS"],\n    ["Checkpoint links are not admitted", "GRAPH_LINK_REJECTED"],\n    ["Checkpoint path alias", "GRAPH_PATH_ALIAS"],\n    ["Invalid checkpoint object shape", "GRAPH_INVALID_PIN_SHAPE"],\n    ["Bounded graph pin count", "GRAPH_INVALID_PIN_COUNT"],\n    ["Bounded graph pin bytes", "GRAPH_INVALID_PIN_BYTES"],\n    ["Canonical relative graph pin", "GRAPH_INVALID_PIN_PATH"],\n    ["Declared graph pin kind", "GRAPH_INVALID_PIN_KIND"],\n    ["Bounded graph pin size", "GRAPH_INVALID_PIN_SIZE"],\n    ["Graph pin snapshot byte bound", "GRAPH_PIN_SNAPSHOT_BOUND"],\n    ["Complete graph snapshot digest", "GRAPH_PIN_SNAPSHOT_DIGEST"],\n  ]);\n  return { code: known.get(fullSourceErrorMessage(error)) ?? "UNKNOWN" };\n}\nfunction fullSourceGraphDiagnostic(owner, error) {\n  try {\n    const observation = fullGraphObservations.get(owner);\n    if (\n      !observation ||\n      !observation.closed ||\n      observation.state !== qualificationSourceOwners.get(owner)\n    )\n      return null;\n    const diagnostic = {\n      kind: "windows-arm-source-graph-failure",\n      phase: "graph-inventory",\n      progress: observation.progress.slice(),\n      discardedSamples: observation.discardedSamples,\n    };\n    return { ...diagnostic, ...fullGraphFailureClassification(error) };\n  } catch {\n    return null;\n  }\n}\n// END FULL GRAPH FAILURE OBSERVATIONS\n\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "70d60ee5d3dc3daa87e22ae0f466473bc944d29270dfb6bf993359564aa881d5",
    },
    {
      old: "      const capture = await collectQualificationGraph(qualificationOwner);\n",
      new: "      const capture = await collectFullQualificationGraph(qualificationOwner);\n",
      oldSha256:
        "8202e9fc8dd602f87c591d928af0e22e7a217086397b60ac42a4ad72846faa8c",
      newSha256:
        "1a8da4463c12c6b382a0d15794e33a8684191bfc292fc598a47854735d47259e",
    },
    {
      old: "",
      new: '    const graphDiagnostic =\n      failed && stage === "graph-inventory"\n        ? fullSourceGraphDiagnostic(qualificationOwner, primary)\n        : null;\n',
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "4b9c8848aba05bd15c932be88c07b43af27e323bdf6dd9ff72d6f56b851d678c",
    },
    {
      old: '      message !== null &&\n      /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(message)\n        ? message\n        : failed\n          ? "FULL_SOURCE_FAILED"\n          : null;\n',
      new: '      graphDiagnostic?.code === "GRAPH_BOUND"\n        ? "GRAPH_BOUND"\n        : message !== null &&\n            /^(?:FULL|PRIVATE|SOURCE_GIT)_[A-Z_]{1,56}$/.test(message)\n          ? message\n          : failed\n            ? "FULL_SOURCE_FAILED"\n            : null;\n',
      oldSha256:
        "5637d3e3263ca30a0b01b2dd972548930c0bbca034f36851ad458f8694734373",
      newSha256:
        "126a41b375c181fcd2fef86e2ddd52941ea8fa82e545a9e90e702388633eb5ec",
    },
    {
      old: "",
      new: "      ...(graphDiagnostic ? { graphDiagnostic } : {}),\n",
      oldSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      newSha256:
        "9ec1d7264fe3d84caa1bc963407aefaa80ff503490d6dc047505c40be670df0d",
    },
  ],
};
function fullGraphDiagnosticsInverse(text, name) {
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  text = fullGraphDeadlineInverse(text, name);
  if (name !== "driver") return text;
  const spec = FULL_GRAPH_DIAGNOSTICS_HISTORY;
  for (const row of spec.rows) {
    assert.equal(
      sha(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_PIN",
    );
    assert.equal(
      sha(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_WHOLE",
  );
  assert.equal(
    sha(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_GRAPH_DIAGNOSTIC_WHOLE",
  );
  return text;
}

function fullHooks3600Inverse(text, name) {
  text = fullGraphDiagnosticsInverse(text, name);
  const spec = FULL_HOOKS_3600_HISTORY[name];
  if (!spec) return text;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(
      hash(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_HOOKS_3600_PIN",
    );
    assert.equal(
      hash(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_HOOKS_3600_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_HOOKS_3600_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_HOOKS_3600_WHOLE",
  );
  assert.equal(hash(text), spec.sha256, "ASSEMBLY_INVERSE_HOOKS_3600_WHOLE");
  return text;
}
function fullGnProjectionDigestInverse(text, name) {
  text = fullHooks3600Inverse(text, name);
  if (name !== "driver") return text;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of FULL_GN_PROJECTION_DIGEST_INVERSE.rows) {
    assert.equal(
      hash(row.new),
      row.newSha256,
      "ASSEMBLY_INVERSE_GN_DIGEST_PIN",
    );
    assert.equal(
      hash(row.old),
      row.oldSha256,
      "ASSEMBLY_INVERSE_GN_DIGEST_PIN",
    );
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GN_DIGEST_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    FULL_GN_PROJECTION_DIGEST_INVERSE.bytes,
    "ASSEMBLY_INVERSE_GN_DIGEST_WHOLE",
  );
  assert.equal(
    hash(text),
    FULL_GN_PROJECTION_DIGEST_INVERSE.sha256,
    "ASSEMBLY_INVERSE_GN_DIGEST_WHOLE",
  );
  return text;
}
function fullGnShellTransportInverse(text, name) {
  text = fullGnProjectionDigestInverse(text, name);
  if (name !== "driver") return text;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of FULL_GN_SHELL_TRANSPORT_INVERSE.rows) {
    assert.equal(hash(row.new), row.newSha256);
    assert.equal(hash(row.old), row.oldSha256);
    assert.equal(
      text.split(row.new).length,
      2,
      "ASSEMBLY_INVERSE_GN_TRANSPORT_COUNT",
    );
    text = text.replace(row.new, () => row.old);
  }
  assert.equal(
    Buffer.byteLength(text),
    FULL_GN_SHELL_TRANSPORT_INVERSE.bytes,
    "ASSEMBLY_INVERSE_GN_TRANSPORT_WHOLE",
  );
  assert.equal(
    hash(text),
    FULL_GN_SHELL_TRANSPORT_INVERSE.sha256,
    "ASSEMBLY_INVERSE_GN_TRANSPORT_WHOLE",
  );
  return text;
}
function fullBootstrapCacheInverse(text, name) {
  text = fullGnShellTransportInverse(text, name);
  text = fullSourceEnvironmentInverse(text, name);
  if (name === "workflow") return text; // This repair never changes workflow bytes.
  const spec = FULL_BOOTSTRAP_CACHE_HISTORY[name];
  assert(spec, "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_SCOPE");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(
      text.split(row.newRaw).length,
      2,
      "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_COUNT",
    );
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_BYTES",
  );
  assert.equal(
    hash(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_BOOTSTRAP_CACHE_WHOLE",
  );
  return text;
}
// END EXACT FULL BOOTSTRAP CACHE INVERSE

function sourceAcquisitionInverse(text, name) {
  text = fullBootstrapCacheInverse(text, name);
  const spec = SOURCE_ACQUISITION_HISTORY[name];
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(
      text.split(row.newRaw).length,
      2,
      "ASSEMBLY_INVERSE_SOURCE_ACQUISITION_COUNT",
    );
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(
    Buffer.byteLength(text),
    spec.bytes,
    "ASSEMBLY_INVERSE_SOURCE_ACQUISITION_BYTES",
  );
  assert.equal(
    hash(text),
    spec.sha256,
    "ASSEMBLY_INVERSE_SOURCE_ACQUISITION_WHOLE",
  );
  return text;
}
// END EXACT FULL SOURCE ACQUISITION INVERSE

function sourceFailureControllerInverse(text) {
  text = sourceAcquisitionInverse(text, "controller");
  const spec = SOURCE_FAILURE_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END EXACT SOURCE FAILURE DATA INVERSE

function sourceParentControllerInverse(text) {
  text = sourceFailureControllerInverse(text);
  const spec = SOURCE_PARENT_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of spec.rows) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END EXACT SOURCE PARENT INVERSE

function producerMetricControllerInverse(text) {
  text = sourceParentControllerInverse(text);
  const spec = PRODUCER_METRIC_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of [...spec.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}

function clockFailureControllerInverse(text) {
  text = producerMetricControllerInverse(text);
  const spec = CLOCK_FAILURE_INVERSE;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(spec.block), spec.blockSha256);
  assert.equal(text.split(spec.block).length, 2);
  assert.equal(text.split(spec.newPredicate).length, 2);
  text = text
    .replace(spec.block, "")
    .replace(spec.newPredicate, spec.oldPredicate);
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END EXACT CLOCK FAILURE ENUM INVERSE

// BEGIN EXACT STARTUP OBSERVABILITY INVERSE
const STARTUP_OBSERVABILITY_HISTORY = {
  rows: [
    {
      oldRaw:
        '  );\n  operationState(token);\n  return c; // Accounting/identity DATA only; no source/session is issued.\n}\n\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n      65536,\n',
      newRaw:
        '  );\n  operationState(token);\n  return c; // Accounting/identity DATA only; no source/session is issued.\n}\n\n// BEGIN BOUNDED STARTUP OBSERVABILITY\n// Diagnostic DATA only. No path/message/env/stack or capability is serialized.\nconst startupErrorContexts = new WeakMap();\nconst STARTUP_FILE_KINDS = Object.freeze({\n  initial: "none",\n  profile: "profile",\n  policy: "policy",\n  workflow: "workflow",\n  scope: "none",\n  node: "node",\n  python: "python",\n  "workflow-clock": "clock",\n  "parent-clock": "clock",\n  "root-module": "root-module",\n  "source-root": "source-root",\n  "source-input": "producer-input",\n  "source-context": "context",\n  "source-launch": "launcher",\n});\nconst STARTUP_ERROR_CODES = new Set([\n  "ENOENT",\n  "EACCES",\n  "EPERM",\n  "ENOTDIR",\n  "EISDIR",\n  "ELOOP",\n  "EMFILE",\n  "ENFILE",\n  "EBADF",\n  "EIO",\n  "EINVAL",\n  "ENOSPC",\n  "ERR_INVALID_ARG_TYPE",\n  "ERR_INVALID_ARG_VALUE",\n  "ERR_ACCESS_DENIED",\n]);\nconst STARTUP_SYSCALLS = new Set([\n  "open",\n  "lstat",\n  "stat",\n  "realpath",\n  "read",\n  "write",\n  "close",\n  "spawn",\n]);\nfunction observeStartupPhase(bootstrap, phase) {\n  const owner = bootstrapOwners.get(bootstrap);\n  need(owner && !owner.closed && owner.pid === process.pid, "BOOTSTRAP_BRAND");\n  need(Object.hasOwn(STARTUP_FILE_KINDS, phase), "BOOTSTRAP_PHASE");\n  owner.startupPhase = phase;\n}\nfunction captureStartupFailure(bootstrap, error) {\n  const owner = bootstrapOwners.get(bootstrap);\n  if (\n    !owner ||\n    owner.closed ||\n    owner.pid !== process.pid ||\n    utilTypes.isProxy(error) ||\n    !utilTypes.isNativeError(error) ||\n    startupErrorContexts.has(error)\n  )\n    return;\n  const phase = Object.hasOwn(STARTUP_FILE_KINDS, owner.startupPhase)\n    ? owner.startupPhase\n    : "initial";\n  startupErrorContexts.set(\n    error,\n    Object.freeze({ phase, fileKind: STARTUP_FILE_KINDS[phase] }),\n  );\n}\nfunction startupFailureReport(error) {\n  const native = !utilTypes.isProxy(error) && utilTypes.isNativeError(error);\n  const own = (key) =>\n    native ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined;\n  const message = own("message");\n  const code =\n    typeof message === "string" &&\n    /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(message)\n      ? message\n      : "FULL_SDK_CONTROL_FAILED";\n  let name = native ? "NativeError" : "ThrownValue";\n  if (native) {\n    const prototype = Object.getPrototypeOf(error);\n    for (const type of [\n      Error,\n      TypeError,\n      RangeError,\n      SyntaxError,\n      ReferenceError,\n      EvalError,\n      URIError,\n      AggregateError,\n    ])\n      if (prototype === type.prototype) name = type.name;\n  }\n  const diagnostic = {\n    ...((native ? startupErrorContexts.get(error) : undefined) ?? {\n      phase: "unknown",\n      fileKind: "none",\n    }),\n    name,\n  };\n  if (STARTUP_ERROR_CODES.has(own("code"))) diagnostic.code = own("code");\n  if (STARTUP_SYSCALLS.has(own("syscall"))) diagnostic.syscall = own("syscall");\n  return {\n    kind: "windows-arm-full-sdk-failure",\n    error: code,\n    diagnostic,\n    sdkBuilt: false,\n    nativeAcceptance: false,\n  };\n}\n// END BOUNDED STARTUP OBSERVABILITY\n\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  observeStartupPhase(bootstrap, "profile");\n  const profileRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n      65536,\n',
      oldSha256:
        "b5669efdc9aa73d7d72b448e2d4274ec726170371ce18bd23deaf6121454fb9b",
      newSha256:
        "289a9cd9d16840dea9063266210737478507f0fb38079a7f2f70120ebccf0993",
    },
    {
      oldRaw:
        '  need(\n    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&\n      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",\n    "SOURCE_FIXED_ENTRY",\n  );\n  const policyRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.policy),\n      1048576,\n',
      newRaw:
        '  need(\n    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&\n      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",\n    "SOURCE_FIXED_ENTRY",\n  );\n  observeStartupPhase(bootstrap, "policy");\n  const policyRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.policy),\n      1048576,\n',
      oldSha256:
        "25023aececc507c239b67764e64ce9471aad02cad59548d54c23b776d990f66b",
      newSha256:
        "372513cdd4fa282ee8e6c530b045103dfad25f2a77747055ba6241f3bcb95e51",
    },
    {
      oldRaw:
        '    policy.schemaVersion === 1 &&\n      policy.recordSchemaVersion === 1 &&\n      policy.kind === "sorng-windows-arm64-sdk-origin-policy",\n    "SOURCE_POLICY_KIND",\n  );\n  const workflow = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.workflow),\n      2097152,\n      policy.workflowPin,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n',
      newRaw:
        '    policy.schemaVersion === 1 &&\n      policy.recordSchemaVersion === 1 &&\n      policy.kind === "sorng-windows-arm64-sdk-origin-policy",\n    "SOURCE_POLICY_KIND",\n  );\n  observeStartupPhase(bootstrap, "workflow");\n  const workflow = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.workflow),\n      2097152,\n      policy.workflowPin,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  observeStartupPhase(bootstrap, "scope");\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n',
      oldSha256:
        "a8d81a50a42c5180a48b6805f9dbeac74ea95b5a5e010335416061bfb790df2f",
      newSha256:
        "0e21a50f0ad5903b4f455e25246b4e4e1a9067c36b24a65af6608f400ade1b73",
    },
    {
      oldRaw:
        '    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const actualNode = await fs.realpath(process.execPath);\n  bootstrapState(bootstrap);\n  need(\n    actualNode.replaceAll("\\\\", "/").toLowerCase() ===\n      profile.node.path.toLowerCase(),\n',
      newRaw:
        '    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  observeStartupPhase(bootstrap, "node");\n  const actualNode = await fs.realpath(process.execPath);\n  bootstrapState(bootstrap);\n  need(\n    actualNode.replaceAll("\\\\", "/").toLowerCase() ===\n      profile.node.path.toLowerCase(),\n',
      oldSha256:
        "2d31bf72ace606e3037cdda992674f899387738e55a7ba560f91e8301b55c8fe",
      newSha256:
        "7bd09df0695dc0442613d0cc3b8185c6ed081ebdb1ce176f16058e01506a6eea",
    },
    {
      oldRaw:
        '      hashBytes(nodeRaw) === profile.node.sha256 &&\n      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),\n    "SOURCE_NODE_PIN",\n  );\n  bootstrapState(bootstrap);\n  const pythonRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      profile.python.path,\n      profile.python.bytes,\n',
      newRaw:
        '      hashBytes(nodeRaw) === profile.node.sha256 &&\n      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),\n    "SOURCE_NODE_PIN",\n  );\n  bootstrapState(bootstrap);\n  observeStartupPhase(bootstrap, "python");\n  const pythonRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      profile.python.path,\n      profile.python.bytes,\n',
      oldSha256:
        "5ec854098dafcd7a34c3e11c05d4eccc473a3ec4afde7096e45b23bb6be2f73d",
      newSha256:
        "79683a7d9012e6cce6fd3dd73b0979f88e9e6604fd1b0b58f61cbb58e2570d4e",
    },
    {
      oldRaw:
        '  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n  // The checked workflow is the origin of this accounting record. It cannot\n  // open either code gate or replace source/native qualification authority.\n  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");\n  const workflowClock = readWorkflowClock(\n',
      newRaw:
        '  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  observeStartupPhase(bootstrap, "workflow-clock");\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n  // The checked workflow is the origin of this accounting record. It cannot\n  // open either code gate or replace source/native qualification authority.\n  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");\n  const workflowClock = readWorkflowClock(\n',
      oldSha256:
        "d7e588ddc913615bb313f88abfa027a9b67adf0084580a48bf9b5b80596b5e13",
      newSha256:
        "cbd3bf1edf4212950008304311a9b806b4fd8090f30379ed154b27cdcc12423c",
    },
    {
      oldRaw:
        "  const wholeLease = leases.get(owner.lease);\n  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);\n  bootstrapState(bootstrap);\n  const clockProbeMonoStart = performance.now();\n  // END FIRST WORKFLOW CLOCK INTERSECTION\n  const sample = await samplePythonClock(\n    bootstrap,\n    profile.python.path,\n    environment,\n  );\n",
      newRaw:
        '  const wholeLease = leases.get(owner.lease);\n  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);\n  bootstrapState(bootstrap);\n  const clockProbeMonoStart = performance.now();\n  // END FIRST WORKFLOW CLOCK INTERSECTION\n  observeStartupPhase(bootstrap, "parent-clock");\n  const sample = await samplePythonClock(\n    bootstrap,\n    profile.python.path,\n    environment,\n  );\n',
      oldSha256:
        "227f88f5e36a5f4648800b63ed53b47f3aff5c3e94a9052c0440903a5bae19c4",
      newSha256:
        "bd203f0add9cdc599870abf05898271a179e8b4e16507bc1a005971ad3969e7a",
    },
    {
      oldRaw:
        '  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.\n  const rootCode = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "source-root.mjs"),\n      1895,\n',
      newRaw:
        '  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.\n  observeStartupPhase(bootstrap, "root-module");\n  const rootCode = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "source-root.mjs"),\n      1895,\n',
      oldSha256:
        "e0c72a53dfa04f812f6ecd38811146e9ef212024ab4d38e4b1bab7096a51796b",
      newSha256:
        "2e0c150c9d2028d441c602849115a56ddd5eee5f4dc47fa23ef05868d3939172",
    },
    {
      oldRaw:
        '        row.bytes === rootCode.length &&\n        row.sha256 === hashBytes(rootCode),\n    ).length === 1,\n    "SOURCE_ROOT_CODE_CLOSURE",\n  );\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    fullSdkSourceRootName(process.env.ImageVersion, selected.id),\n  );\n',
      newRaw:
        '        row.bytes === rootCode.length &&\n        row.sha256 === hashBytes(rootCode),\n    ).length === 1,\n    "SOURCE_ROOT_CODE_CLOSURE",\n  );\n  observeStartupPhase(bootstrap, "source-root");\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    fullSdkSourceRootName(process.env.ImageVersion, selected.id),\n  );\n',
      oldSha256:
        "0bd0a1f8a17e82c7ff3b31ea66ad4c11c76ccbb9794cf91aee794937db9f4914",
      newSha256:
        "8f0b49f7a52c1aef8417665608f0f3793fc7f9c91c0509a4baf7a99f7b40a3c7",
    },
    {
      oldRaw:
        '        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = (\n        await operationWork(token, () =>\n          bootstrapHeldFile(\n            bootstrap,\n            path.join(CONTROLLER_REPO, row.path),\n',
      newRaw:
        '        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      observeStartupPhase(bootstrap, "source-input");\n      const raw = (\n        await operationWork(token, () =>\n          bootstrapHeldFile(\n            bootstrap,\n            path.join(CONTROLLER_REPO, row.path),\n',
      oldSha256:
        "04b7c2c970dba576879c5e8f7db429aaddeb5e9e847063d9a74468e7869df1ae",
      newSha256:
        "feaaf3b5a77e2515cdf5f4977dfc49d97caea5df60b441e93b6680c207a7fc1a",
    },
    {
      oldRaw:
        '        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n',
      newRaw:
        '        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    observeStartupPhase(bootstrap, "source-context");\n    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n',
      oldSha256:
        "a962286d0ab38b357c9126348cafba92a906c5c15a375cb79f3247f0ded55606",
      newSha256:
        "fefdec8264096b94411fc8368d3f69829298e2c585226dd3de5a6d8779ec289f",
    },
    {
      oldRaw:
        '    }\n  };\n  try {\n    bootstrapState(bootstrap);\n    operation = await createSourceOperation(bootstrap);\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    await runEnginePhase(control, "probe-clang");\n    await runEnginePhase(control, "probe-link");\n',
      newRaw:
        '    }\n  };\n  try {\n    bootstrapState(bootstrap);\n    operation = await createSourceOperation(bootstrap);\n    observeStartupPhase(bootstrap, "source-launch");\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    await runEnginePhase(control, "probe-clang");\n    await runEnginePhase(control, "probe-link");\n',
      oldSha256:
        "44d762a02933a6163361065e979b10d5901489563d3f9eb40dc81fe0356168ab",
      newSha256:
        "54f03cccc3dd4c89512c63d1fe805231c37ad368d33b6c7f7075d5e9069a19b5",
    },
    {
      oldRaw:
        '      await runEnginePhase(control, "package");\n      result = await verifyProducedSdk(control);\n    }\n    await publishControllerOutcome(control, result);\n  } catch (error) {\n    remember(error);\n  } finally {\n    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);\n    const controlState = control ? controls.get(control) : undefined;\n    try {\n',
      newRaw:
        '      await runEnginePhase(control, "package");\n      result = await verifyProducedSdk(control);\n    }\n    await publishControllerOutcome(control, result);\n  } catch (error) {\n    captureStartupFailure(bootstrap, error);\n    remember(error);\n  } finally {\n    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);\n    const controlState = control ? controls.get(control) : undefined;\n    try {\n',
      oldSha256:
        "58f2f5eee1725e7b0235090d8faf3f3372ad03f3a36cd8a629589428ca98db21",
      newSha256:
        "7adbc66c1bffeaf92d426485814d0a8099532c6ef0ee1b13efbcac06809c656c",
    },
    {
      oldRaw:
        '        argv[0] === "--execute",\n      "ENTRY_ARGV",\n    );\n    return runFullSdkTransaction(bootstrap);\n  } catch (error) {\n    const owner = bootstrapOwners.get(bootstrap);\n    owner.closed = true;\n    leases.get(owner.lease).closed = true;\n    bootstrapOwners.delete(bootstrap);\n    throw error;\n',
      newRaw:
        '        argv[0] === "--execute",\n      "ENTRY_ARGV",\n    );\n    return runFullSdkTransaction(bootstrap);\n  } catch (error) {\n    captureStartupFailure(bootstrap, error);\n    const owner = bootstrapOwners.get(bootstrap);\n    owner.closed = true;\n    leases.get(owner.lease).closed = true;\n    bootstrapOwners.delete(bootstrap);\n    throw error;\n',
      oldSha256:
        "1235478ea088c3230edadc8645fcd0f27863b41045926a4ef6e20e2ea0fb80f8",
      newSha256:
        "f490deea9e9da663e2751bed1447fcf99f8475f97d95c158f33c80a411ef04d5",
    },
    {
      oldRaw:
        '  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)\n) {\n  Promise.resolve()\n    .then(() => main())\n    .catch((error) => {\n      const code = /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(error?.message ?? "")\n        ? error.message\n        : "FULL_SDK_CONTROL_FAILED";\n      console.error(\n        JSON.stringify({\n          kind: "windows-arm-full-sdk-failure",\n          error: code,\n          sdkBuilt: false,\n          nativeAcceptance: false,\n        }),\n      );\n      process.exitCode = 1;\n    });\n}\n',
      newRaw:
        "  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)\n) {\n  Promise.resolve()\n    .then(() => main())\n    .catch((error) => {\n      console.error(JSON.stringify(startupFailureReport(error)));\n      process.exitCode = 1;\n    });\n}\n",
      oldSha256:
        "113b9553e292fe11ac84d9d0644fc792a0f269b087115014f3d0b3e02c887944",
      newSha256:
        "9225655ad454e8be739ad29ed3760f091d9eebce4db246f82cb923fc8eabd0e7",
    },
  ],
  bytes: 161561,
  sha256: "43604b5ddf7c738270bb5bead62a1ae4f321176a4cbb77288ef4022818b2e9cf",
};
function startupControllerInverse(text) {
  text = clockFailureControllerInverse(text);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of [...STARTUP_OBSERVABILITY_HISTORY.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(text.split(row.newRaw).length, 2);
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), STARTUP_OBSERVABILITY_HISTORY.bytes);
  assert.equal(hash(text), STARTUP_OBSERVABILITY_HISTORY.sha256);
  return text;
}
// END EXACT STARTUP OBSERVABILITY INVERSE

// BEGIN FINITE ASSEMBLY HISTORY
const ASSEMBLY_HISTORY = {
  controller: {
    rows: [
      {
        name: "finite-0",
        oldRaw:
          '// Closed source controller. Public admission, native qualification, engine,\n// package, transport and SDK record/publication authority remain unavailable.\nimport * as fs from "node:fs/promises";\nimport * as expectedDefaults from "./expected-defaults.mjs";\nimport { constants } from "node:fs";\nimport { randomBytes, randomUUID, createHash } from "node:crypto";\nimport { spawn, ChildProcess } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nimport * as checkpoint from "./current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";\nimport path from "node:path";\nimport * as custom from "./current-source-helpers/scripts/lib/browser-custom-runtime.mjs";\nimport {\n  WORKFLOW_CLOCK_ENV,\n  readWorkflowClock,\n  intersectWorkflowClock,\n} from "./workflow-clock.mjs";\n\n',
        newRaw:
          '// Owned full-SDK build qualification controller. Native acceptance, readiness\n// and publication require later independent evidence.\nimport * as fs from "node:fs/promises";\nimport * as expectedDefaults from "./expected-defaults.mjs";\nimport { fullSdkSourceRootName } from "./source-root.mjs";\nimport * as sdkRuntime from "./current-source-helpers/scripts/cef-runtime-ci.mjs";\nimport { inspectNativeSlice } from "./full-sdk-engine-worker.mjs";\nimport { constants } from "node:fs";\nimport { randomBytes, createHash } from "node:crypto";\nimport { spawn, ChildProcess } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nimport * as checkpoint from "./current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs";\nimport path from "node:path";\nimport { types as utilTypes } from "node:util";\nimport * as custom from "./current-source-helpers/scripts/lib/browser-custom-runtime.mjs";\nimport {\n  WORKFLOW_CLOCK_ENV,\n  readWorkflowClock,\n  intersectWorkflowClock,\n} from "./workflow-clock.mjs";\n\n',
        oldSha256:
          "2e9dd3a92ecdf2b71a88c2c5f8f5ec727cc011624f0136761989eee0faa92aba",
        newSha256:
          "727e6f074e12a6d7a12d0d659e7227b208c1b8ef3d1a1d23974368e27c8d9cb9",
      },
      {
        name: "finite-1",
        oldRaw:
          "  );\n  state.cleanupWallEnd = Math.min(\n    Date.now() + CLEANUP_MS,\n    lease.wallEnd - FINAL_RESERVE_MS,\n  );\n  state.retirement = (async () => {\n    try {\n      if (state.marker) {\n        const marker = state.marker;\n        state.marker = null;\n        await cleanupStep(state, () => marker.close());\n      }\n      need(\n        state.pending.size === 0 &&\n",
        newRaw:
          "  );\n  state.cleanupWallEnd = Math.min(\n    Date.now() + CLEANUP_MS,\n    lease.wallEnd - FINAL_RESERVE_MS,\n  );\n  state.retirement = (async () => {\n    try {\n      for (const fd of [...(state.assetFds ?? [])]) {\n        await cleanupStep(state, () => fd.close());\n        state.assetFds.delete(fd);\n      }\n      if (state.marker) {\n        const marker = state.marker;\n        state.marker = null;\n        await cleanupStep(state, () => marker.close());\n      }\n      need(\n        state.pending.size === 0 &&\n",
        oldSha256:
          "364ef8c54489272bfc181a56f1499df12508695da8d6478ecfacc7a0d3e99dae",
        newSha256:
          "cef1c5fee6951ae96679b5f8b2165c2b67f9f8624e4bb275808042d8289a85df",
      },
      {
        name: "finite-2",
        oldRaw:
          '      executionAdmitted: false,\n    });\n  })();\n  return state.retirement;\n}\n\n// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false;\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\n',
        newRaw:
          '      executionAdmitted: false,\n    });\n  })();\n  return state.retirement;\n}\n\n// BEGIN CLOSED FULL SDK SOURCE CONTROLLER\nconst CONTROLLER_ADMITTED = false; // Native acceptance is established by later actual evidence.\nconst SOURCE_QUALIFICATION_ALLOWED = true;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst MODULE_URL = import.meta.url;\nconst CONTROLLER_HERE = path.dirname(fileURLToPath(MODULE_URL));\nconst CONTROLLER_REPO = path.resolve(CONTROLLER_HERE, "../..");\nconst bootstrapOwners = new WeakMap();\nconst sourceOperations = new WeakMap();\nconst SOURCE_MS = 7200000;\nconst SOURCE_LOG_CAP = 131072;\n',
        oldSha256:
          "ecf320013ed6ed086a817d424ac1299919f258ad6f4622c523578acf852d3759",
        newSha256:
          "b864bf890cf1ab62953da847b04d52f964673b672b09b02a168043fa787f9dfb",
      },
      {
        name: "finite-3",
        oldRaw:
          '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}\nasync function recheckSourceReceipt(receipt, leaseToken) {\n  const source = sourceState(receipt, leaseToken);\n  const state = operationState(source.operationToken, true);\n  need(\n    state.sourceReceipt === receipt &&\n      source.metadataSnapshot === state.metadataSnapshot &&\n      state.metadataSnapshot &&\n      state.creationJoined &&\n      state.logFds.size === 0 &&\n      state.readFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n  need(!state.child, "SOURCE_LAUNCH_REUSE");\n  const child = spawn(state.plan.executable, state.plan.argv, {\n    cwd: state.root,\n    env: state.plan.environment,\n',
        newRaw:
          '      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}\n// BEGIN PRIVATE INSTALLED TOOL PROOF\nconst TOOL_PROOF_ROOTS = Object.freeze([\n  "include",\n  "atlmfc/include",\n  "lib/x64",\n  "lib/arm64",\n  "atlmfc/lib/x64",\n  "atlmfc/lib/arm64",\n  "bin/Hostx64/x64",\n  "bin/Hostx64/arm64",\n]);\nfunction inspectInstalledToolProof(raw, baseRaw) {\n  const proof = parentMetadata_qualificationBoundedJson(raw, 16 * 1024 ** 2),\n    base = JSON.parse(baseRaw);\n  parentMetadata_qualificationShape(\n    proof,\n    [\n      "kind",\n      "roots",\n      "files",\n      "bytes",\n      "visited",\n      "sha256",\n      "executed",\n      "previous14AreCompleteClosure",\n    ],\n    "TOOL_PROOF_FIELDS",\n  );\n  need(\n    proof.kind === "windows-arm-full-installed-source-inventory" &&\n      canonical(proof.roots) === canonical(TOOL_PROOF_ROOTS) &&\n      proof.executed === false &&\n      proof.previous14AreCompleteClosure === false &&\n      Array.isArray(proof.files) &&\n      proof.files.length > 0 &&\n      proof.files.length <= base.limits.installedFiles &&\n      Number.isSafeInteger(proof.visited) &&\n      proof.visited >= proof.files.length &&\n      proof.visited <= base.limits.installedFiles &&\n      Number.isSafeInteger(proof.bytes) &&\n      proof.bytes > 0 &&\n      proof.bytes <= base.limits.installedBytes,\n    "TOOL_PROOF_SCOPE",\n  );\n  let previous = "",\n    total = 0;\n  const folded = new Set(),\n    rows = new Map();\n  for (const row of proof.files) {\n    parentMetadata_qualificationShape(\n      row,\n      ["path", "bytes", "sha256"],\n      "TOOL_PROOF_ROW",\n    );\n    need(\n      typeof row.path === "string" &&\n        row.path.length > 0 &&\n        row.path.length <= 4096 &&\n        !/[\\x00-\\x1f\\x7f:\\\\]/.test(row.path) &&\n        row.path\n          .split("/")\n          .every((part) => part && part !== "." && part !== "..") &&\n        TOOL_PROOF_ROOTS.some((root) => row.path.startsWith(root + "/")) &&\n        row.path > previous &&\n        !folded.has(row.path.toLowerCase()) &&\n        Number.isSafeInteger(row.bytes) &&\n        row.bytes >= 0 &&\n        row.bytes <= base.limits.installedFileBytes &&\n        /^[a-f0-9]{64}$/.test(row.sha256),\n      "TOOL_PROOF_ROW_SCOPE",\n    );\n    previous = row.path;\n    folded.add(row.path.toLowerCase());\n    rows.set(row.path, row);\n    total += row.bytes;\n    need(total <= base.limits.installedBytes, "TOOL_PROOF_BYTES");\n  }\n  // Match Python\'s fixed json.dumps(...,sort_keys=True,separators=(\',\',\':\')).\n  const encoded = canonical(proof.files).replace(\n    /[\\x7f-\\uffff]/g,\n    (char) => "\\\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),\n  );\n  need(\n    total === proof.bytes && hashBytes(Buffer.from(encoded)) === proof.sha256,\n    "TOOL_PROOF_DIGEST",\n  );\n  const installed14 = Object.freeze({\n    "host-cl.exe": "bin/Hostx64/arm64/cl.exe",\n    "host-link.exe": "bin/Hostx64/arm64/link.exe",\n    "host-lib.exe": "bin/Hostx64/arm64/lib.exe",\n    "crt-libcmt.lib": "lib/arm64/libcmt.lib",\n    "crt-libcpmt.lib": "lib/arm64/libcpmt.lib",\n    "crt-libvcruntime.lib": "lib/arm64/libvcruntime.lib",\n    "crt-oldnames.lib": "lib/arm64/oldnames.lib",\n    "atl-atls.lib": "atlmfc/lib/arm64/atls.lib",\n    "atl-uafxcw.lib": "atlmfc/lib/arm64/uafxcw.lib",\n    "header-vcruntime.h": "include/vcruntime.h",\n    "header-vector": "include/vector",\n    "header-string": "include/string",\n    "header-atlbase.h": "atlmfc/include/atlbase.h",\n    "header-afxwin.h": "atlmfc/include/afxwin.h",\n  });\n  need(\n    Array.isArray(base.installedMsvc14) &&\n      base.installedMsvc14.length === 14 &&\n      new Set(base.installedMsvc14.map((row) => row.role)).size === 14,\n    "TOOL_PROOF_BASE",\n  );\n  for (const pin of base.installedMsvc14) {\n    const actual = rows.get(installed14[pin.role]);\n    need(\n      actual && actual.bytes === pin.bytes && actual.sha256 === pin.sha256,\n      "TOOL_PROOF_INSTALLED14",\n    );\n  }\n  return Object.freeze({\n    files: proof.files.length,\n    bytes: total,\n    sha256: proof.sha256,\n  });\n}\nasync function verifySourceToolProof(token) {\n  const state = operationState(token);\n  need(state.creationJoined && !state.toolProofSnapshot, "TOOL_PROOF_JOIN");\n  const input = state.plan.producerInputs.findIndex(\n    (row) => row.path === "native/windows-arm-full-sdk/profile.json",\n  );\n  need(\n    input >= 0 &&\n      state.plan.producerInputs[input].sha256 ===\n        "ccadcf1fc6f86fe11b922d93c11dc6192ccf571f03c485c610e89938c60b546a",\n    "TOOL_PROOF_BASE_PIN",\n  );\n  const baseRelative = "source-inputs/" + input,\n    base = await heldOperationFile(\n      token,\n      baseRelative,\n      65536,\n      state.plan.producerInputs[input],\n    );\n  const relative = "installed-source-inventory.json",\n    held = await heldOperationFile(token, relative, 16 * 1024 ** 2);\n  operationState(token);\n  const projection = inspectInstalledToolProof(held.raw, base.raw);\n  await operationFence(token);\n  operationState(token);\n  state.toolProofSnapshot = Object.freeze({\n    projection,\n    record: Object.freeze({\n      relative,\n      maximum: 16 * 1024 ** 2,\n      pin: Object.freeze({ ...held.pin }),\n      identity: held.identity,\n    }),\n    base: Object.freeze({\n      relative: baseRelative,\n      maximum: 65536,\n      pin: Object.freeze({ ...base.pin }),\n      identity: base.identity,\n    }),\n  });\n}\nasync function recheckSourceToolProof(token) {\n  const state = operationState(token, true),\n    snapshot = state.toolProofSnapshot;\n  need(\n    snapshot &&\n      state.sourceReceipt &&\n      sourceSessions.get(state.sourceReceipt)?.toolProofSnapshot === snapshot,\n    "TOOL_PROOF_BINDING",\n  );\n  for (const row of [snapshot.record, snapshot.base]) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum,\n      row.pin,\n      true,\n    );\n    operationState(token, true);\n    need(actual.identity === row.identity, "TOOL_PROOF_REPLACED");\n  }\n}\n// END PRIVATE INSTALLED TOOL PROOF\n\nasync function recheckSourceReceipt(receipt, leaseToken) {\n  const source = sourceState(receipt, leaseToken);\n  const state = operationState(source.operationToken, true);\n  need(\n    state.sourceReceipt === receipt &&\n      source.metadataSnapshot === state.metadataSnapshot &&\n      state.metadataSnapshot &&\n      state.creationJoined &&\n      state.logFds.size === 0 &&\n      state.readFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n  await recheckSourceToolProof(source.operationToken);\n}\nfunction startSourceChild(token) {\n  const state = operationState(token);\n  need(!state.child, "SOURCE_LAUNCH_REUSE");\n  const child = spawn(state.plan.executable, state.plan.argv, {\n    cwd: state.root,\n    env: state.plan.environment,\n',
        oldSha256:
          "d5163d1a9a7571a260aab1e8661e5bd6dda73abece7b48e2666de85e8dc5721d",
        newSha256:
          "bbcfb38e04c2a441b4302d8395e6d56d994cd8710c1bc8e08c820241f32d4cd2",
      },
      {
        name: "finite-4",
        oldRaw:
          '        state.pendingWriters === 0,\n      "SOURCE_FD_JOIN",\n    );\n    state.creationJoined = true;\n    await verifyNativeSourceRecords(token);\n    await verifySourceSnapshot(token);\n    await verifySourceMetadata(token);\n    operationState(token);\n    const receipt = Object.freeze({\n      kind: "closed-full-sdk-created-source-session",\n    });\n    const source = {\n      lease: state.lease,\n      stage: "joined-success",\n',
        newRaw:
          '        state.pendingWriters === 0,\n      "SOURCE_FD_JOIN",\n    );\n    state.creationJoined = true;\n    await verifyNativeSourceRecords(token);\n    await verifySourceSnapshot(token);\n    await verifySourceMetadata(token);\n    await verifySourceToolProof(token);\n    await recheckSourceMetadata(token, false);\n    operationState(token);\n    const receipt = Object.freeze({\n      kind: "closed-full-sdk-created-source-session",\n    });\n    const source = {\n      lease: state.lease,\n      stage: "joined-success",\n',
        oldSha256:
          "442488085d852e3f9c6fb1301f106d4a71bf3195a176e319704f96fb32a5178c",
        newSha256:
          "417a3def6b370c53896151e9d310bdcee44a5ea2d2cac266ba236c5ebf5fd701",
      },
      {
        name: "finite-5",
        oldRaw:
          '      target: "aarch64-pc-windows-msvc",\n      sourceId: state.plan.sourceId,\n      profileSha256: state.plan.profileSha256,\n      root: state.root,\n      rootIdentity: state.rootIdentity,\n      operationToken: token,\n      metadataSnapshot: state.metadataSnapshot,\n    };\n    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.\n    sourceSessions.set(receipt, source);\n    state.sourceReceipt = receipt;\n    state.issued = true;\n    return receipt;\n  } catch (error) {\n',
        newRaw:
          '      target: "aarch64-pc-windows-msvc",\n      sourceId: state.plan.sourceId,\n      profileSha256: state.plan.profileSha256,\n      root: state.root,\n      rootIdentity: state.rootIdentity,\n      operationToken: token,\n      metadataSnapshot: state.metadataSnapshot,\n      toolProofSnapshot: state.toolProofSnapshot,\n    };\n    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.\n    sourceSessions.set(receipt, source);\n    state.sourceReceipt = receipt;\n    state.issued = true;\n    return receipt;\n  } catch (error) {\n',
        oldSha256:
          "3bc564f03576a4e40c3a6a3b7d74f1a83a2c9be54fe746d3b37f8da970c79074",
        newSha256:
          "8526313dd2ccfea34779f1a870fa2a4ddc61fdb75f6cfe1f496b9c2d09330865",
      },
      {
        name: "finite-6",
        oldRaw:
          '      if (!probe.joined) child.unref();\n    }\n    probe.child = null;\n    stdout = [];\n    stderr = [];\n  }\n}\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(CONTROLLER_ADMITTED, "EXECUTION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = await fs.readFile(\n    path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n  );\n  bootstrapState(bootstrap);\n  const profile = JSON.parse(profileRaw);\n  const policyRaw = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.policy),\n  );\n  bootstrapState(bootstrap);\n  const policy = JSON.parse(policyRaw);\n  const workflow = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.workflow),\n  );\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n      policy.target === "aarch64-pc-windows-msvc" &&\n',
        newRaw:
          '      if (!probe.joined) child.unref();\n    }\n    probe.child = null;\n    stdout = [];\n    stderr = [];\n  }\n}\n// BEGIN BOUNDED BOOTSTRAP FILE READER\n// Read-only, creation-owned FDs. These bytes never issue a source capability.\nasync function bootstrapHeldFile(bootstrap, file, maximum, expected) {\n  const owner = bootstrapState(bootstrap),\n    lease = leases.get(owner.lease);\n  need(\n    typeof file === "string" &&\n      path.isAbsolute(file) &&\n      Number.isSafeInteger(maximum) &&\n      maximum > 0 &&\n      maximum <= 268435456,\n    "BOOTSTRAP_FILE_SCOPE",\n  );\n  file = path.resolve(file);\n  const wallEnd = Math.min(\n      lease.wallEnd - CLEANUP_MS - FINAL_RESERVE_MS,\n      owner.wallStart + SOURCE_MS - CLEANUP_MS - FINAL_RESERVE_MS,\n    ),\n    monoEnd = Math.min(\n      lease.monoEnd - CLEANUP_MS - FINAL_RESERVE_MS,\n      owner.monoStart + SOURCE_MS - CLEANUP_MS - FINAL_RESERVE_MS,\n    );\n  owner.bootstrapFds ??= new Set();\n  owner.bootstrapPending ??= new Set();\n  let failed = false,\n    primary,\n    fd,\n    raw,\n    identity;\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n    }\n  };\n  const remaining = () => {\n    bootstrapState(bootstrap);\n    const left = Math.min(\n      wallEnd - Date.now(),\n      monoEnd - performance.now(),\n      checkLease(owner.lease),\n    );\n    need(left > 0, "BOOTSTRAP_READ_DEADLINE");\n    return left;\n  };\n  const wait = async (action, late) => {\n    const ms = remaining();\n    let timer,\n      abort,\n      settled = false,\n      received = false,\n      value;\n    const pending = Promise.resolve().then(() => {\n      remaining();\n      return action();\n    });\n    owner.bootstrapPending.add(pending);\n    pending.then(\n      (value) => {\n        owner.bootstrapPending.delete(pending);\n        if (settled && late)\n          Promise.resolve()\n            .then(() => late(value))\n            .catch(remember);\n      },\n      () => owner.bootstrapPending.delete(pending),\n    );\n    try {\n      value = await Promise.race([\n        pending,\n        new Promise((_, reject) => {\n          timer = setTimeout(\n            () => reject(new Error("FULL_SDK_CONTROL_BOOTSTRAP_READ_DEADLINE")),\n            ms,\n          );\n          abort = () => reject(lease.signal.reason);\n          lease.signal?.addEventListener("abort", abort, { once: true });\n          if (lease.signal?.aborted) abort();\n        }),\n      ]);\n      received = true;\n      remaining();\n      settled = true;\n      return value;\n    } catch (error) {\n      settled = true;\n      if (received && late)\n        Promise.resolve()\n          .then(() => late(value))\n          .catch(remember);\n      throw error;\n    } finally {\n      clearTimeout(timer);\n      lease.signal?.removeEventListener("abort", abort);\n    }\n  };\n  const ancestors = [];\n  const fence = async () => {\n    for (const entry of ancestors)\n      need(\n        operationDirectoryId(\n          await wait(() => fs.lstat(entry.path, { bigint: true })),\n        ) === entry.identity,\n        "BOOTSTRAP_ANCESTOR_CHANGED",\n      );\n    need(\n      (await wait(() => fs.realpath(file))) === file,\n      "BOOTSTRAP_FILE_ALIAS",\n    );\n  };\n  try {\n    for (let current = path.dirname(file); ; current = path.dirname(current)) {\n      ancestors.push({\n        path: current,\n        identity: operationDirectoryId(\n          await wait(() => fs.lstat(current, { bigint: true })),\n        ),\n      });\n      if (current === path.dirname(current)) break;\n    }\n    await fence();\n    const named = await wait(() => fs.lstat(file, { bigint: true }));\n    identity = fileId(named);\n    need(\n      named.size >= 0n && named.size <= BigInt(maximum),\n      "BOOTSTRAP_FILE_BOUND",\n    );\n    const closeLate = async (value) => {\n      await value.close();\n      owner.bootstrapFds.delete(value);\n    };\n    fd = await wait(\n      () =>\n        fs\n          .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))\n          .then((value) => {\n            owner.bootstrapFds.add(value);\n            return value;\n          }),\n      closeLate,\n    );\n    const held = await wait(() => fd.stat({ bigint: true }));\n    need(\n      held.size >= 0n && held.size <= BigInt(maximum),\n      "BOOTSTRAP_FILE_BOUND",\n    );\n    need(\n      fileId(held) === identity &&\n        fileId(await wait(() => fs.lstat(file, { bigint: true }))) === identity,\n      "BOOTSTRAP_FILE_CHANGED",\n    );\n    // The bound is checked on the held FD BEFORE allocating. One sentinel byte\n    // detects growth; no request or allocation can exceed the original max+1.\n    const buffer = Buffer.alloc(Number(held.size) + 1);\n    let count = 0;\n    while (count < buffer.length) {\n      const value = await wait(() =>\n        fd.read(buffer, count, buffer.length - count, count),\n      );\n      if (!value.bytesRead) break;\n      count += value.bytesRead;\n    }\n    need(\n      count === Number(held.size) && count <= maximum,\n      "BOOTSTRAP_FILE_GROWTH",\n    );\n    need(\n      fileId(await wait(() => fd.stat({ bigint: true }))) === identity &&\n        fileId(await wait(() => fs.lstat(file, { bigint: true }))) === identity,\n      "BOOTSTRAP_FILE_CHANGED",\n    );\n    raw = buffer.subarray(0, count);\n    if (expected)\n      need(\n        raw.length === expected.bytes && hashBytes(raw) === expected.sha256,\n        "BOOTSTRAP_FILE_PIN",\n      );\n    await fence();\n    remaining();\n  } catch (error) {\n    remember(error);\n  } finally {\n    if (fd) {\n      const cleanup = owner.bootstrapFailureCleanup ?? {\n        cleanupEnd: Math.min(\n          performance.now() + CLEANUP_MS,\n          lease.monoEnd - FINAL_RESERVE_MS,\n        ),\n        cleanupWallEnd: Math.min(\n          Date.now() + CLEANUP_MS,\n          lease.wallEnd - FINAL_RESERVE_MS,\n        ),\n      };\n      if (failed) owner.bootstrapFailureCleanup ??= cleanup;\n      try {\n        await cleanupStep(cleanup, async () => {\n          await fd.close();\n          owner.bootstrapFds.delete(fd);\n        });\n      } catch (error) {\n        owner.bootstrapFailureCleanup ??= cleanup;\n        remember(error);\n      }\n    }\n  }\n  if (failed) throw primary;\n  await fence();\n  remaining();\n  need(owner.bootstrapFds.size === 0, "BOOTSTRAP_FD_JOIN");\n  return { raw, identity, pin: { bytes: raw.length, sha256: hashBytes(raw) } };\n}\n// END BOUNDED BOOTSTRAP FILE READER\n\n// BEGIN FIXED RESTORE HANDOFF\nfunction producerInputDigest(rows) {\n  need(\n    Array.isArray(rows) &&\n      rows.length > 0 &&\n      rows.length <= 128 &&\n      new Set(rows.map((row) => row.path.toLowerCase())).size === rows.length,\n    "PRODUCER_INPUTS",\n  );\n  return hashBytes(\n    Buffer.from(\n      canonical(\n        [...rows]\n          .map((row) => ({\n            path: row.path,\n            bytes: row.bytes,\n            sha256: row.sha256,\n          }))\n          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),\n      ),\n    ),\n  );\n}\nasync function readRestoreHandoff(bootstrap, rows, image, sourceId) {\n  bootstrapState(bootstrap);\n  const requested = process.env.CEF_FULLSDK_RESTORE_RUN;\n  if (requested === "0") return null;\n  need(/^[1-9][0-9]{0,19}$/.test(requested ?? ""), "RESTORE_RUN");\n  const temp = path.resolve(CONTROLLER_REPO, "../../_temp");\n  need(path.resolve(process.env.RUNNER_TEMP ?? "") === temp, "RESTORE_TEMP");\n  const directory = path.join(\n    temp,\n    `sorng-windows-arm-checkpoint-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,\n  );\n  need((await fs.realpath(directory)) === directory, "RESTORE_ALIAS");\n  bootstrapState(bootstrap);\n  for (let current = directory; ; current = path.dirname(current)) {\n    directoryId(await fs.lstat(current, { bigint: true }));\n    bootstrapState(bootstrap);\n    if (current === path.dirname(current)) break;\n  }\n  const file = path.join(directory, "ready.json"),\n    before = await fs.lstat(file, { bigint: true });\n  bootstrapState(bootstrap);\n  const identity = fileId(before);\n  need(\n    before.size > 0n && before.size <= 2n * 1024n ** 2n,\n    "RESTORE_READY_BOUND",\n  );\n  const heldReady = await bootstrapHeldFile(bootstrap, file, 2 * 1024 ** 2);\n  need(heldReady.identity === identity, "RESTORE_READY_CHANGED");\n  const raw = heldReady.raw;\n  bootstrapState(bootstrap);\n  need(\n    raw.length === Number(before.size) &&\n      fileId(await fs.lstat(file, { bigint: true })) === identity,\n    "RESTORE_READY_CHANGED",\n  );\n  bootstrapState(bootstrap);\n  const ready = JSON.parse(raw);\n  parentMetadata_qualificationShape(\n    ready,\n    [\n      "kind",\n      "schemaVersion",\n      "record",\n      "priorRunId",\n      "priorAttempt",\n      "currentRunId",\n      "currentAttempt",\n      "head",\n      "identity",\n      "sealArtifact",\n    ],\n    "RESTORE_READY_FIELDS",\n  );\n  need(\n    ready.kind === "windows-arm-full-sdk-checkpoint-download" &&\n      ready.schemaVersion === 1 &&\n      ready.priorRunId === requested &&\n      /^[1-9][0-9]{0,8}$/.test(ready.priorAttempt) &&\n      ready.currentRunId === process.env.GITHUB_RUN_ID &&\n      ready.currentAttempt === process.env.GITHUB_RUN_ATTEMPT &&\n      /^[a-f0-9]{40}$/.test(ready.head),\n    "RESTORE_READY_SCOPE",\n  );\n  parentMetadata_qualificationShape(\n    ready.sealArtifact,\n    ["id", "bytes", "sha256"],\n    "RESTORE_ARTIFACT_FIELDS",\n  );\n  need(\n    Number.isSafeInteger(ready.sealArtifact.id) &&\n      ready.sealArtifact.id > 0 &&\n      Number.isSafeInteger(ready.sealArtifact.bytes) &&\n      ready.sealArtifact.bytes > 0 &&\n      ready.sealArtifact.bytes <= 3 * 1024 ** 2 &&\n      /^[a-f0-9]{64}$/.test(ready.sealArtifact.sha256),\n    "RESTORE_ARTIFACT_PIN",\n  );\n  const source = ready.identity;\n  parentMetadata_qualificationShape(\n    source,\n    [\n      "image",\n      "sourceId",\n      "producerSha256",\n      "sourceDateEpoch",\n      "canonicalRoot",\n      "toolProofPin",\n      "graphPin",\n    ],\n    "RESTORE_IDENTITY_FIELDS",\n  );\n  need(\n    source.image === image &&\n      source.sourceId === sourceId &&\n      source.producerSha256 === producerInputDigest(rows) &&\n      source.canonicalRoot === fullSdkSourceRootName(image, sourceId) &&\n      canonical(source.sourceDateEpoch) ===\n        canonical({ present: false, value: null }),\n    "RESTORE_SOURCE_IDENTITY",\n  );\n  for (const [pin, max] of [\n    [ready.record, 2 * 1024 ** 2],\n    [source.toolProofPin, 16 * 1024 ** 2],\n    [source.graphPin, 16 * 1024 ** 2],\n  ]) {\n    parentMetadata_qualificationShape(\n      pin,\n      ["bytes", "sha256"],\n      "RESTORE_PIN_FIELDS",\n    );\n    need(\n      Number.isSafeInteger(pin.bytes) &&\n        pin.bytes > 0 &&\n        pin.bytes <= max &&\n        /^[a-f0-9]{64}$/.test(pin.sha256),\n      "RESTORE_PIN",\n    );\n  }\n  bootstrapState(bootstrap);\n  return Object.freeze({\n    runId: ready.priorRunId,\n    attempt: ready.priorAttempt,\n    readyPin: Object.freeze({ bytes: raw.length, sha256: hashBytes(raw) }),\n  });\n}\n// END FIXED RESTORE HANDOFF\n\nfunction sourceContextRecord(token, profile, policy, policyRaw, sample) {\n  const state = operationState(token),\n    owner = bootstrapState(state.bootstrap),\n    selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  const wholeRemaining =\n    Math.min(\n      leases.get(owner.lease).wallEnd - Date.now(),\n      leases.get(owner.lease).monoEnd - performance.now(),\n    ) / 1000;\n  const sourceRemaining =\n    Math.min(\n      state.sourceWallEnd - Date.now(),\n      state.sourceMonoEnd - performance.now(),\n    ) / 1000;\n  const acquisitionRemaining =\n    Math.min(\n      4500000 - (Date.now() - owner.wallStart),\n      4500000 - (performance.now() - owner.monoStart),\n      sourceRemaining * 1000,\n    ) / 1000;\n  const c = {\n    kind: "windows-arm-full-sdk-context",\n    mode: "full-sdk-source-gn",\n    workflow: profile.workflow,\n    policy: profile.policy,\n    ref: "refs/heads/main",\n    repository: "supermarsx/sortOfRemoteNG",\n    repositoryId: "1010282954",\n    event: "workflow_dispatch",\n    visibility: "public",\n    defaultBranch: "main",\n    inputs: { restore_run: process.env.CEF_FULLSDK_RESTORE_RUN },\n    checkpointRestore: owner.checkpointRestore ?? null,\n    image: process.env.ImageVersion,\n    target: "aarch64-pc-windows-msvc",\n    sourceId: selected.id,\n    sourceProfileSha256: selected.profile,\n    head: process.env.GITHUB_SHA,\n    workflowSha: process.env.GITHUB_WORKFLOW_SHA,\n    runId: process.env.GITHUB_RUN_ID,\n    attempt: process.env.GITHUB_RUN_ATTEMPT,\n    sources: policy.producerInputs,\n    originPolicySha256: hashBytes(policyRaw),\n    wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,\n    monotonicWholeEnd: sample.monotonic + wholeRemaining,\n    wallWorkEnd: state.sourceWallEnd / 1000,\n    monotonicWorkEnd: sample.monotonic + sourceRemaining,\n    wallAcquisitionEnd:\n      Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n    monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n  };\n  need(\n    sourceRemaining > 150 && acquisitionRemaining > 150,\n    "SOURCE_ORIGINAL_BUDGET",\n  );\n  operationState(token);\n  return c; // Accounting/identity DATA only; no source/session is issued.\n}\n\nasync function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(SOURCE_QUALIFICATION_ALLOWED, "SOURCE_QUALIFICATION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n      65536,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    profileRaw.length > 0 &&\n      profileRaw.length <= 65536 &&\n      hashBytes(profileRaw) === FULL_SOURCE_PROFILE_SHA256,\n    "SOURCE_PROFILE_PIN",\n  );\n  const profile = JSON.parse(profileRaw);\n  need(\n    profile.workflow === ".github/workflows/windows-arm-full-sdk.yml" &&\n      profile.policy === "native/windows-arm-full-sdk/sdk-origin-review.json",\n    "SOURCE_FIXED_ENTRY",\n  );\n  const policyRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.policy),\n      1048576,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  const policy = JSON.parse(policyRaw);\n  parentMetadata_qualificationShape(\n    policy,\n    [\n      "schemaVersion",\n      "kind",\n      "origin",\n      "target",\n      "workflow",\n      "workflowPin",\n      "sources",\n      "bridge",\n      "producerInputs",\n      "recordSchemaVersion",\n      "jobPolicy",\n    ],\n    "SOURCE_POLICY_FIELDS",\n  );\n  need(\n    policy.schemaVersion === 1 &&\n      policy.recordSchemaVersion === 1 &&\n      policy.kind === "sorng-windows-arm64-sdk-origin-policy",\n    "SOURCE_POLICY_KIND",\n  );\n  const workflow = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_REPO, profile.workflow),\n      2097152,\n      policy.workflowPin,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n      policy.target === "aarch64-pc-windows-msvc" &&\n',
        oldSha256:
          "e1dfa5aebd507c3b861c986127c12541c5040a8c11bea2a5bae8a1b9efb7f433",
        newSha256:
          "21e76f91b5daaab57440c8519ab31218ab5f444cc0926c805b06fe5ec989a4bd",
      },
      {
        name: "finite-7",
        oldRaw:
          '      process.env.GITHUB_REF === "refs/heads/main" &&\n      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&\n      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&\n      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),\n    "SOURCE_WORKFLOW_SCOPE",\n  );\n  need(\n    profile.nativeSourceEntryQualified === true &&\n      profile.sourceProgramCarryforwardQualified === true,\n    "SOURCE_NATIVE_UNQUALIFIED",\n  );\n  const selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  const environment = Object.freeze({\n    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const pythonRaw = await fs.readFile(profile.python.path);\n  bootstrapState(bootstrap);\n  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n',
        newRaw:
          '      process.env.GITHUB_REF === "refs/heads/main" &&\n      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&\n      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&\n      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),\n    "SOURCE_WORKFLOW_SCOPE",\n  );\n  need(\n    profile.sourceQualificationAllowed === true &&\n      profile.fullModeBodyImplemented === true &&\n      profile.sourceSessionIssuerImplemented === true &&\n      profile.controllerCreationPathImplemented === true &&\n      profile.parentExpectedDefaultsImplemented === true &&\n      profile.firstWorkflowClockImplemented === true &&\n      profile.nativeSourceEntryQualified === false &&\n      profile.sourceProgramCarryforwardQualified === false,\n    "SOURCE_ATTEMPT_POLICY",\n  );\n  const selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  need(\n    /^(?:0|[1-9][0-9]{0,19})$/.test(process.env.CEF_FULLSDK_RESTORE_RUN ?? ""),\n    "SOURCE_RESTORE_RUN",\n  );\n  // Resume authentication and fixed ready-file binding are completed before\n  // any source actor; a nonzero request cannot silently become a fresh build.\n  owner.checkpointRestore = await readRestoreHandoff(\n    bootstrap,\n    policy.producerInputs,\n    process.env.ImageVersion,\n    selected.id,\n  );\n  bootstrapState(bootstrap);\n  need(\n    process.env.CEF_FULLSDK_RESTORE_RUN === "0" || owner.checkpointRestore,\n    "SOURCE_RESTORE_AUTHENTICATION",\n  );\n  const environment = Object.freeze({\n    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const actualNode = await fs.realpath(process.execPath);\n  bootstrapState(bootstrap);\n  need(\n    actualNode.replaceAll("\\\\", "/").toLowerCase() ===\n      profile.node.path.toLowerCase(),\n    "SOURCE_PARENT_NODE",\n  );\n  const nodeInfo = await fs.lstat(actualNode, { bigint: true });\n  bootstrapState(bootstrap);\n  need(\n    nodeInfo.isFile() &&\n      !nodeInfo.isSymbolicLink() &&\n      nodeInfo.nlink === 1n &&\n      nodeInfo.size === BigInt(profile.node.bytes),\n    "SOURCE_NODE_FILE",\n  );\n  const nodeRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      actualNode,\n      profile.node.bytes,\n      profile.node,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    nodeRaw.length === profile.node.bytes &&\n      hashBytes(nodeRaw) === profile.node.sha256 &&\n      fileId(await fs.lstat(actualNode, { bigint: true })) === fileId(nodeInfo),\n    "SOURCE_NODE_PIN",\n  );\n  bootstrapState(bootstrap);\n  const pythonRaw = (\n    await bootstrapHeldFile(\n      bootstrap,\n      profile.python.path,\n      profile.python.bytes,\n      profile.python,\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n',
        oldSha256:
          "2fb19f1baf1b1e2c1d9f64dbf7b5b6cf774c3257dd69397f48c2295c6426fbd0",
        newSha256:
          "1fdfc7986bf7d6900727cae2815c7c4ba4a0422e38c2d713bd38e9d1c8412840",
      },
      {
        name: "finite-8",
        oldRaw:
          '    performance.now(),\n  );\n  wholeLease.wallEnd = inheritedEnds.wallEnd;\n  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    "windows-arm-full-sdk-" + randomUUID(),\n  );\n  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });\n  const state = {\n    bootstrap,\n    lease: owner.lease,\n    root,\n    rootFence: [],\n',
        newRaw:
          '    performance.now(),\n  );\n  wholeLease.wallEnd = inheritedEnds.wallEnd;\n  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  // Stable naming DATA; exclusive mkdir below still creates a fresh lifetime.\n  const rootCode = (\n    await bootstrapHeldFile(\n      bootstrap,\n      path.join(CONTROLLER_HERE, "source-root.mjs"),\n      1895,\n      {\n        bytes: 1895,\n        sha256:\n          "07c9301da8df45fbed8e19e66fdd2155a78748e63b84fe313a5a359c6bf7a799",\n      },\n    )\n  ).raw;\n  bootstrapState(bootstrap);\n  need(\n    rootCode.length === 1895 &&\n      hashBytes(rootCode) ===\n        "07c9301da8df45fbed8e19e66fdd2155a78748e63b84fe313a5a359c6bf7a799",\n    "SOURCE_ROOT_MODULE_PIN",\n  );\n  need(\n    policy.producerInputs.filter(\n      (row) =>\n        row.path === "native/windows-arm-full-sdk/source-root.mjs" &&\n        row.bytes === rootCode.length &&\n        row.sha256 === hashBytes(rootCode),\n    ).length === 1,\n    "SOURCE_ROOT_CODE_CLOSURE",\n  );\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    fullSdkSourceRootName(process.env.ImageVersion, selected.id),\n  );\n  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });\n  const state = {\n    bootstrap,\n    lease: owner.lease,\n    root,\n    rootFence: [],\n',
        oldSha256:
          "bb9184a0abaa2380db8092e8f78773cbf7685d561d625285e4bdeb0c2ebeeca8",
        newSha256:
          "c8b7797daf3f641438fc05e239936a27759b3afef7f40ad20bc3af83ccca679c",
      },
      {
        name: "finite-9",
        oldRaw:
          '    for (const [index, row] of policy.producerInputs.entries()) {\n      need(\n        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = await operationWork(token, () =>\n        fs.readFile(path.join(CONTROLLER_REPO, row.path)),\n      );\n      need(\n        raw.length === row.bytes &&\n          raw.length <= 2 * 1024 ** 2 &&\n          hashBytes(raw) === row.sha256,\n        "SOURCE_INPUT_PIN",\n      );\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const wholeRemaining =\n      Math.min(\n        leases.get(owner.lease).wallEnd - Date.now(),\n        leases.get(owner.lease).monoEnd - performance.now(),\n      ) / 1000;\n    const sourceRemaining =\n      Math.min(\n        state.sourceWallEnd - Date.now(),\n        state.sourceMonoEnd - performance.now(),\n      ) / 1000;\n    const acquisitionRemaining =\n      Math.min(\n        4500000 - (Date.now() - owner.wallStart),\n        4500000 - (performance.now() - owner.monoStart),\n        sourceRemaining * 1000,\n      ) / 1000;\n    const c = {\n      kind: "windows-arm-full-sdk-context",\n      mode: "full-sdk-source-gn",\n      workflow: profile.workflow,\n      policy: profile.policy,\n      ref: "refs/heads/main",\n      repository: "supermarsx/sortOfRemoteNG",\n      repositoryId: "1010282954",\n      event: "workflow_dispatch",\n      visibility: "public",\n      defaultBranch: "main",\n      inputs: {},\n      image: process.env.ImageVersion,\n      target: "aarch64-pc-windows-msvc",\n      sourceId: selected.id,\n      sourceProfileSha256: selected.profile,\n      head: process.env.GITHUB_SHA,\n      workflowSha: process.env.GITHUB_WORKFLOW_SHA,\n      runId: process.env.GITHUB_RUN_ID,\n      attempt: process.env.GITHUB_RUN_ATTEMPT,\n      sources: policy.producerInputs,\n      originPolicySha256: hashBytes(policyRaw),\n      wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,\n      monotonicWholeEnd: sample.monotonic + wholeRemaining,\n      wallWorkEnd: state.sourceWallEnd / 1000,\n      monotonicWorkEnd: sample.monotonic + sourceRemaining,\n      wallAcquisitionEnd:\n        Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n      monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n    };\n    need(\n      sourceRemaining > 150 && acquisitionRemaining > 150,\n      "SOURCE_ORIGINAL_BUDGET",\n    );\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n    );\n    const env = Object.freeze({\n      ...environment,\n',
        newRaw:
          '    for (const [index, row] of policy.producerInputs.entries()) {\n      need(\n        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = (\n        await operationWork(token, () =>\n          bootstrapHeldFile(\n            bootstrap,\n            path.join(CONTROLLER_REPO, row.path),\n            2097152,\n            row,\n          ),\n        )\n      ).raw;\n      need(\n        raw.length === row.bytes &&\n          raw.length <= 2 * 1024 ** 2 &&\n          hashBytes(raw) === row.sha256,\n        "SOURCE_INPUT_PIN",\n      );\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const c = sourceContextRecord(token, profile, policy, policyRaw, sample);\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n    );\n    const env = Object.freeze({\n      ...environment,\n',
        oldSha256:
          "a526f0be71e900196232e081c8a9c411f190177a1d8f2d090907afc0fefa726a",
        newSha256:
          "224ebdb529ac39f10dd58d999b0a7a4bf1af317a216b109783127098f26c6885",
      },
      {
        name: "finite-10",
        oldRaw:
          '      /^[1-9][0-9]{0,19}$/.test(launch.ownCreationFiletime) &&\n      launch.parentPid === process.pid &&\n      launch.parentCreationFiletime === packet.parentCreationFiletime &&\n      launch.contextSha256 === packetPin.sha256,\n    "ENGINE_LAUNCH_BINDING",\n  );\n  const jobRecord = await read(`jobs/${role}/receipt.json`),\n    job = inspectJob(jobRecord, true);\n  need(\n    job.rootPid !== launch.ownPid &&\n      job.rootCreationFiletime !== launch.ownCreationFiletime,\n    "ENGINE_JOB_IDENTITY",\n  );\n  const closed = parseRecord(await read(`full-sdk-engine-closed-${role}.json`));\n  need(\n',
        newRaw:
          '      /^[1-9][0-9]{0,19}$/.test(launch.ownCreationFiletime) &&\n      launch.parentPid === process.pid &&\n      launch.parentCreationFiletime === packet.parentCreationFiletime &&\n      launch.contextSha256 === packetPin.sha256,\n    "ENGINE_LAUNCH_BINDING",\n  );\n  const jobRecord = await read(`jobs/${role}/receipt.json`),\n    job = parseRecord(jobRecord);\n  need(\n    job.rootPid !== launch.ownPid &&\n      job.rootCreationFiletime !== launch.ownCreationFiletime,\n    "ENGINE_JOB_IDENTITY",\n  );\n  const closed = parseRecord(await read(`full-sdk-engine-closed-${role}.json`));\n  need(\n',
        oldSha256:
          "a53ca5fb80a2aacfca8524c284cabdb4ded4aff47ef1fdaae591ad5b7a80b040",
        newSha256:
          "a49d1a5162afdbfa53fd566567a52b330765bc3eb36a5e74deedfbb08f4a0f41",
      },
      {
        name: "finite-11",
        oldRaw:
          '      closed.parentPid === process.pid &&\n      closed.parentCreationFiletime === packet.parentCreationFiletime &&\n      closed.sourceContextSha256 === packet.sourceContextSha256 &&\n      closed.sdkBuilt === false &&\n      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  const resultRecord = await read(`full-sdk-engine-${role}-result.json`),\n    result = parseRecord(resultRecord);\n  need(\n    result.kind === "windows-arm-full-sdk-engine-worker-result" &&\n      result.role === role &&\n      result.sourceContextSha256 === packet.sourceContextSha256 &&\n      result.image === packet.image &&\n',
        newRaw:
          '      closed.parentPid === process.pid &&\n      closed.parentCreationFiletime === packet.parentCreationFiletime &&\n      closed.sourceContextSha256 === packet.sourceContextSha256 &&\n      closed.sdkBuilt === false &&\n      closed.nativeAcceptance === false,\n    "ENGINE_CLOSE_BINDING",\n  );\n  if (role === "cef-engine" && job.success === false) {\n    inspectNativeSlice(job, closed.jobSeconds);\n    need(\n      closed.completion === "native-slice-ended" &&\n        closed.receiptPin?.bytes === jobRecord.pin.bytes &&\n        closed.receiptPin?.sha256 === jobRecord.pin.sha256 &&\n        phase.nativeWallEnd <= leases.get(state.leaseToken).wallEnd - 3600000 &&\n        phase.nativeMonoEnd <= leases.get(state.leaseToken).monoEnd - 3600000,\n      "ENGINE_SLICE_CLOSE",\n    );\n    await engineBoundary(token, phase);\n    engineState(token, phase);\n    const fact = Object.freeze({\n      role,\n      nativeSliceEnded: true,\n      result: null,\n      context: Object.freeze({ ...packetPin }),\n      receipt: Object.freeze({ ...jobRecord.pin }),\n      closure: Object.freeze({ ...records[2].pin }),\n      launch: Object.freeze({ ...records[0].pin }),\n      records: Object.freeze(records),\n      nativeAcceptance: false,\n    });\n    state.nativeSliceFact = fact; // Only this actual creator/readback path writes it.\n    return fact;\n  }\n  inspectJob(jobRecord, true);\n  if (role === "cef-engine")\n    need(closed.completion === "success", "ENGINE_CEF_COMPLETION");\n  const resultRecord = await read(`full-sdk-engine-${role}-result.json`),\n    result = parseRecord(resultRecord);\n  need(\n    result.kind === "windows-arm-full-sdk-engine-worker-result" &&\n      result.role === role &&\n      result.sourceContextSha256 === packet.sourceContextSha256 &&\n      result.image === packet.image &&\n',
        oldSha256:
          "0c693d2f3ff8ff9d7c248d015554dcba43804f3a405581c55bd5c9ee603bfdfc",
        newSha256:
          "dc2f9655950204fdd7db5aae524a18e5301911a04a3a16afc64b6ad7f03ec506",
      },
      {
        name: "finite-12",
        oldRaw:
          '}\nasync function runEnginePhase(token, role) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  state.engineResults ??= [];\n  const index = state.engineResults.length;\n  need(\n    index < ENGINE_ROLES.length &&\n      role === ENGINE_ROLES[index] &&\n      !state.enginePhase,\n    "ENGINE_SEQUENCE",\n  );\n  const lease = leases.get(state.leaseToken),\n    nowWall = Date.now(),\n    nowMono = performance.now();\n  if (index === 0)\n    state.probeEnds = Object.freeze({\n      wallEnd: Math.min(lease.wallEnd - 150000, nowWall + 900000),\n      monoEnd: Math.min(lease.monoEnd - 150000, nowMono + 900000),\n    });\n  const phase = {\n    role,\n    wallEnd:\n      index <= 1\n        ? state.probeEnds.wallEnd\n        : Math.min(lease.wallEnd - 150000, nowWall + ENGINE_CAPS_MS[index]),\n    monoEnd:\n      index <= 1\n        ? state.probeEnds.monoEnd\n        : Math.min(lease.monoEnd - 150000, nowMono + ENGINE_CAPS_MS[index]),\n    retired: false,\n    pending: new Set(),\n    logFds: new Set(),\n    pendingWriters: 0,\n    writeQueue: Promise.resolve(),\n    outputBytes: 0,\n    child: null,\n    cleanupConfirmed: false,\n  };\n  state.enginePhase = phase;\n  try {\n    await engineBoundary(token, phase);\n    const operation = operationState(state.source.operationToken, true),\n      root = state.source.root,\n      contextPin = operation.plan.rootPins.find(\n        (row) => row.relative === "context.json",\n      ),\n      sourceContext = parseRecord(\n        await engineRead(token, phase, "context.json", 131072, contextPin),\n',
        newRaw:
          '}\nasync function runEnginePhase(token, role) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  state.engineResults ??= [];\n  const index = state.engineResults.length;\n  const checkpoint =\n    role === "checkpoint-seal" &&\n    index === 3 &&\n    state.nativeSliceFact === state.engineResults[2] &&\n    state.nativeSliceFact?.nativeSliceEnded === true;\n  need(\n    index < ENGINE_ROLES.length &&\n      (checkpoint || role === ENGINE_ROLES[index]) &&\n      !state.enginePhase &&\n      (index !== 3 || checkpoint || !state.nativeSliceFact),\n    "ENGINE_SEQUENCE",\n  );\n  const lease = leases.get(state.leaseToken),\n    nowWall = Date.now(),\n    nowMono = performance.now();\n  if (index === 0)\n    state.probeEnds = Object.freeze({\n      wallEnd: Math.min(lease.wallEnd - 150000, nowWall + 900000),\n      monoEnd: Math.min(lease.monoEnd - 150000, nowMono + 900000),\n    });\n  const reserve = role === "cef-engine" ? 3600000 : 150000,\n    cap = checkpoint ? 3600000 : ENGINE_CAPS_MS[index];\n  const nativeWallEnd =\n      index <= 1\n        ? state.probeEnds.wallEnd\n        : Math.min(lease.wallEnd - reserve, nowWall + cap),\n    nativeMonoEnd =\n      index <= 1\n        ? state.probeEnds.monoEnd\n        : Math.min(lease.monoEnd - reserve, nowMono + cap);\n  const phase = {\n    role,\n    nativeWallEnd,\n    nativeMonoEnd,\n    wallEnd: Math.min(\n      lease.wallEnd - 150000,\n      nativeWallEnd + (role === "cef-engine" ? 90000 : 0),\n    ),\n    monoEnd: Math.min(\n      lease.monoEnd - 150000,\n      nativeMonoEnd + (role === "cef-engine" ? 90000 : 0),\n    ),\n    retired: false,\n    pending: new Set(),\n    logFds: new Set(),\n    pendingWriters: 0,\n    writeQueue: Promise.resolve(),\n    outputBytes: 0,\n    child: null,\n    cleanupConfirmed: false,\n  };\n  state.enginePhase = phase;\n  try {\n    await engineBoundary(token, phase);\n    if (index >= 2) compilerAdmission(token, phase);\n    const operation = operationState(state.source.operationToken, true),\n      root = state.source.root,\n      contextPin = operation.plan.rootPins.find(\n        (row) => row.relative === "context.json",\n      ),\n      sourceContext = parseRecord(\n        await engineRead(token, phase, "context.json", 131072, contextPin),\n',
        oldSha256:
          "d43d199e4e665d231cc7ed5678e9b02b96a388c2646c82bb91807fd49a3c5143",
        newSha256:
          "8cd00dffe5670710c22ae046067eeabba1fa115f9d3a8bee81f5589fd2d424dc",
      },
      {
        name: "finite-13",
        oldRaw:
          '        "ENGINE_GIT_PIN",\n      );\n      gitPolicyFiles.push({ relative, ...value.pin });\n    }\n    // Consume the original already-captured Python/Node endpoint projection.\n    // No second clock child and no now+whole lease are introduced here.\n    engineState(token, phase);\n    need(phase.monoEnd <= lease.monoEnd - 150000, "ENGINE_ORIGINAL_BUDGET");\n    const previous = state.engineResults.at(-1),\n      packet = {\n        schemaVersion: 1,\n        kind: "windows-arm-full-sdk-engine-context",\n        mode: "full-sdk-engine",\n        role,\n        sourceContextSha256: contextPin.sha256,\n        image: state.source.image,\n        sourceId: state.source.sourceId,\n        target: state.source.target,\n        wallWholeEnd: sourceContext.wallWholeEnd,\n        monotonicWholeEnd: sourceContext.monotonicWholeEnd,\n        wallPhaseEnd: phase.wallEnd / 1000,\n        monotonicPhaseEnd: Math.min(\n          sourceContext.monotonicWholeEnd - 150,\n          sourceContext.monotonicWholeEnd -\n            (lease.monoEnd - phase.monoEnd) / 1000,\n        ),\n        parentPid: process.pid,\n        parentCreationFiletime: operation.plan.parentCreationFiletime,\n        metadataFiles: state.source.metadataSnapshot.records.map((row) => ({\n          relative: row.relative,\n          ...row.pin,\n        })),\n        gitPolicyFiles,\n        prior: previous\n          ? { result: previous.result, receipt: previous.receipt }\n          : null,\n      };\n    const raw = Buffer.from(JSON.stringify(packet, null, 2) + "\\n"),\n      packetPin = { bytes: raw.length, sha256: hashBytes(raw) };\n    await engineSave(token, phase, `full-sdk-engine-${role}-context.json`, raw);\n    for (const name of ["stdout", "stderr"]) {\n      await engineWork(token, phase, () => currentRoot(token, state));\n      engineState(token, phase);\n',
        newRaw:
          '        "ENGINE_GIT_PIN",\n      );\n      gitPolicyFiles.push({ relative, ...value.pin });\n    }\n    // Consume the original already-captured Python/Node endpoint projection.\n    // No second clock child and no now+whole lease are introduced here.\n    engineState(token, phase);\n    need(\n      phase.nativeMonoEnd <= lease.monoEnd - 150000,\n      "ENGINE_ORIGINAL_BUDGET",\n    );\n    const previous = state.engineResults.at(-1),\n      packet = {\n        schemaVersion: 1,\n        kind: "windows-arm-full-sdk-engine-context",\n        mode: "full-sdk-engine",\n        role,\n        sourceContextSha256: contextPin.sha256,\n        image: state.source.image,\n        sourceId: state.source.sourceId,\n        target: state.source.target,\n        wallWholeEnd: sourceContext.wallWholeEnd,\n        monotonicWholeEnd: sourceContext.monotonicWholeEnd,\n        wallPhaseEnd: phase.nativeWallEnd / 1000,\n        monotonicPhaseEnd: Math.min(\n          sourceContext.monotonicWholeEnd - 150,\n          sourceContext.monotonicWholeEnd -\n            (lease.monoEnd - phase.nativeMonoEnd) / 1000,\n        ),\n        parentPid: process.pid,\n        parentCreationFiletime: operation.plan.parentCreationFiletime,\n        metadataFiles: state.source.metadataSnapshot.records.map((row) => ({\n          relative: row.relative,\n          ...row.pin,\n        })),\n        gitPolicyFiles,\n        prior: checkpoint\n          ? {\n              result: null,\n              receipt: previous.receipt,\n              closure: previous.closure,\n              launch: previous.launch,\n            }\n          : previous\n            ? { result: previous.result, receipt: previous.receipt }\n            : null,\n      };\n    const raw = Buffer.from(JSON.stringify(packet, null, 2) + "\\n"),\n      packetPin = { bytes: raw.length, sha256: hashBytes(raw) };\n    await engineSave(token, phase, `full-sdk-engine-${role}-context.json`, raw);\n    for (const name of ["stdout", "stderr"]) {\n      await engineWork(token, phase, () => currentRoot(token, state));\n      engineState(token, phase);\n',
        oldSha256:
          "c60894a9c8cc2f4fbc53daa128b0f3918a2ff992534e6a741709c7f27cad8a07",
        newSha256:
          "acd93a33a5232f0ea54875952d462d3859dba27ac85607c2a40cea167bb4f930",
      },
      {
        name: "finite-14",
        oldRaw:
          '  } finally {\n    await retireEnginePhase(token, phase);\n    if (state.failed) throw state.primary;\n  }\n}\n// END ACTUAL PARENT ENGINE CREATION\n\nasync function runFullSdkTransaction(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  let operation, control;\n  try {\n    operation = await createSourceOperation(bootstrap);\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    return Object.freeze({\n      kind: "closed-full-sdk-source-controller",\n      executionAdmitted: false,\n      sdkBuilt: false,\n    });\n  } finally {\n    if (control) await retireControl(control);\n    if (operation) await retireSourceOperation(operation);\n    owner.closed = true;\n    bootstrapOwners.delete(bootstrap);\n    leases.get(owner.lease).closed = true;\n  }\n}\n// END CLOSED FULL SDK SOURCE CONTROLLER\n\nexport function main() {\n  // Deliberately do not inspect arguments, environment, paths or getters.\n  throw new Error("FULL_SDK_CONTROL_EXECUTION_CLOSED");\n}\n',
        newRaw:
          '  } finally {\n    await retireEnginePhase(token, phase);\n    if (state.failed) throw state.primary;\n  }\n}\n// END ACTUAL PARENT ENGINE CREATION\n\n// BEGIN PRIVATE COMPILER ADMISSION\nfunction compilerAdmission(token, phase) {\n  const state = engineState(token, phase),\n    source = sourceState(state.sourceReceipt, state.leaseToken);\n  if (!state.compilerAdmission) {\n    need(\n      phase.role === "cef-engine" &&\n        state.engineResults.length === 2 &&\n        state.engineResults[0].role === "probe-clang" &&\n        state.engineResults[1].role === "probe-link",\n      "COMPILER_CREATED_PROBES",\n    );\n    const matched = source.metadataSnapshot?.matchedExpectedDefaults;\n    need(\n      matched?.comparison.expectedMacroCount === 61 &&\n        matched.comparison.partitionAllocActionValuesMatch === true &&\n        matched.comparison.partitionAllocHeaderValuesMatch === true &&\n        matched.comparison.cefV8SandboxValue === 1 &&\n        source.toolProofSnapshot,\n      "COMPILER_SOURCE_FACTS",\n    );\n    state.compilerAdmission = Object.freeze({\n      sourceReceipt: state.sourceReceipt,\n      source,\n      metadataSnapshot: source.metadataSnapshot,\n      toolProofSnapshot: source.toolProofSnapshot,\n      expectedDefaults: matched,\n      clang: state.engineResults[0],\n      link: state.engineResults[1],\n      full61Qualified: true,\n      nativeAcceptance: false,\n    });\n  }\n  const fact = state.compilerAdmission;\n  need(\n    fact.sourceReceipt === state.sourceReceipt &&\n      fact.source === source &&\n      fact.metadataSnapshot === source.metadataSnapshot &&\n      fact.toolProofSnapshot === source.toolProofSnapshot &&\n      fact.expectedDefaults ===\n        source.metadataSnapshot.matchedExpectedDefaults &&\n      fact.clang === state.engineResults[0] &&\n      fact.link === state.engineResults[1] &&\n      fact.full61Qualified === true,\n    "COMPILER_RETAINED_FACT",\n  );\n  return fact;\n}\n// END PRIVATE COMPILER ADMISSION\n\n// BEGIN PRIVATE FINAL SDK VERIFICATION\nasync function sealSdkAsset(token, name, expected, kind = "sdk") {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    typeof name === "string" &&\n      /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(name) &&\n      Number.isSafeInteger(expected?.size) &&\n      expected.size > 0 &&\n      expected.size <= 2 * 1024 ** 3 &&\n      /^[a-f0-9]{64}$/.test(expected.sha256),\n    "SDK_ASSET_SCOPE",\n  );\n  need(kind === "sdk" || kind === "checkpoint", "OUTPUT_KIND");\n  const file = path.join(\n    state.source.root,\n    kind === "sdk" ? "full-sdk-package/bundle" : "full-sdk-checkpoint-output",\n    name,\n  );\n  await currentRoot(token, state);\n  await physical(token, state, path.dirname(file));\n  state.assetFds ??= new Set();\n  const fd = await work(\n    token,\n    state,\n    () =>\n      fs\n        .open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))\n        .then((value) => {\n          state.assetFds.add(value);\n          return value;\n        }),\n    async (late) => {\n      await late.close();\n      state.assetFds.delete(late);\n    },\n  );\n  let failed = false,\n    primary,\n    value;\n  try {\n    const info = await work(token, state, () => fd.stat({ bigint: true })),\n      identity = fileId(info);\n    need(info.size === BigInt(expected.size), "SDK_ASSET_SIZE");\n    need(\n      fileId(\n        await work(token, state, () => fs.lstat(file, { bigint: true })),\n      ) === identity,\n      "SDK_ASSET_CHANGED",\n    );\n    const digest = createHash("sha256"),\n      buffer = Buffer.alloc(1048576);\n    let total = 0;\n    while (total <= expected.size) {\n      const { bytesRead } = await work(token, state, () =>\n        fd.read(\n          buffer,\n          0,\n          Math.min(buffer.length, expected.size + 1 - total),\n          total,\n        ),\n      );\n      if (!bytesRead) break;\n      total += bytesRead;\n      digest.update(buffer.subarray(0, bytesRead));\n    }\n    need(\n      total === expected.size && digest.digest("hex") === expected.sha256,\n      "SDK_ASSET_PIN",\n    );\n    need(\n      fileId(await work(token, state, () => fd.stat({ bigint: true }))) ===\n        identity &&\n        fileId(\n          await work(token, state, () => fs.lstat(file, { bigint: true })),\n        ) === identity,\n      "SDK_ASSET_CHANGED",\n    );\n    value = Object.freeze({\n      name,\n      size: total,\n      sha256: expected.sha256,\n      identity,\n    });\n  } catch (error) {\n    failed = true;\n    primary = fail(state, error);\n  } finally {\n    try {\n      await work(token, state, () => fd.close());\n      state.assetFds.delete(fd);\n    } catch (error) {\n      if (!failed) {\n        failed = true;\n        primary = fail(state, error);\n      }\n    }\n  }\n  if (failed) throw primary;\n  await currentRoot(token, state);\n  retained(token, state);\n  return value;\n}\nasync function verifyProducedSdk(token) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    state.engineResults?.length === ENGINE_ROLES.length &&\n      !state.enginePhase &&\n      state.engineResults.every(\n        (row, index) => row.role === ENGINE_ROLES[index],\n      ),\n    "SDK_PHASES",\n  );\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  for (const phase of state.engineResults)\n    for (const row of phase.records) {\n      const actual = await work(token, state, () =>\n        heldOperationFile(\n          state.source.operationToken,\n          row.relative,\n          row.maximum,\n          row.pin,\n          true,\n        ),\n      );\n      need(actual.identity === row.identity, "SDK_PHASE_RECORD_CHANGED");\n    }\n  const result = parseRecord(\n    await work(token, state, () =>\n      heldOperationFile(\n        state.source.operationToken,\n        "full-sdk-engine-package-result.json",\n        131072,\n        state.engineResults[3].result,\n        true,\n      ),\n    ),\n  );\n  need(\n    result.sdkBuilt === true &&\n      result.role === "package" &&\n      result.output?.bundle === "full-sdk-package/bundle" &&\n      Array.isArray(result.output.assets) &&\n      result.output.assets.length === 5 &&\n      new Set(result.output.assets.map((row) => row.name)).size === 5,\n    "SDK_PACKAGE_RESULT",\n  );\n  const operation = operationState(state.source.operationToken, true),\n    lockRecord = await work(token, state, () =>\n      heldOperationFile(\n        state.source.operationToken,\n        "full-sdk-package/bundle/source-lock.json",\n        2 * 1024 ** 2,\n        undefined,\n        true,\n      ),\n    ),\n    lock = JSON.parse(lockRecord.raw);\n  need(\n    custom.identitySha256(lock) === state.source.sourceId,\n    "SDK_SOURCE_IDENTITY",\n  );\n  const identity = sdkRuntime.releaseIdentity(lock, state.source.target),\n    names = [\n      "runtime.json",\n      "source-lock.json",\n      "manifest.json",\n      "receipt.json",\n      identity.archive,\n    ];\n  need(\n    result.output.assets.every((row) => names.includes(row.name)),\n    "SDK_ASSET_SET",\n  );\n  const assets = [];\n  for (const name of names)\n    assets.push(\n      await sealSdkAsset(\n        token,\n        name,\n        result.output.assets.find((row) => row.name === name),\n      ),\n    );\n  const verified = await work(token, state, () =>\n    sdkRuntime.verifyBundle(\n      path.join(state.source.root, "full-sdk-package/bundle"),\n      "supermarsx/sortOfRemoteNG",\n    ),\n  );\n  retained(token, state);\n  need(\n    verified.descriptor.target === state.source.target &&\n      verified.identity.sourceLockSha256 === state.source.sourceId &&\n      verified.assets.length === 5 &&\n      verified.assets.every((row) =>\n        assets.some(\n          (asset) =>\n            asset.name === row.name &&\n            asset.size === row.size &&\n            asset.sha256 === row.sha256,\n        ),\n      ),\n    "SDK_BUNDLE_BINDING",\n  );\n  for (const asset of assets) {\n    const current = await sealSdkAsset(token, asset.name, asset);\n    need(current.identity === asset.identity, "SDK_ASSET_REPLACED");\n  }\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n  retained(token, state);\n  need(\n    state.assetFds.size === 0 &&\n      operation.readFds.size === 0 &&\n      operation.logFds.size === 0,\n    "SDK_FD_JOIN",\n  );\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-produced",\n    sourceId: state.source.sourceId,\n    image: state.source.image,\n    target: state.source.target,\n    sdkBuilt: true,\n    nativeAcceptance: false,\n    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-package/bundle",\n    assets: Object.freeze(assets),\n  });\n  state.sdkSeal = seal; // Private final fact; the report/transport is a projection only.\n  return seal;\n}\nasync function verifyProducedCheckpoint(token) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    state.engineResults?.length === 4 &&\n      state.engineResults[2] === state.nativeSliceFact &&\n      state.nativeSliceFact?.nativeSliceEnded === true &&\n      state.engineResults[3].role === "checkpoint-seal" &&\n      !state.enginePhase &&\n      state.compilerAdmission?.full61Qualified === true,\n    "CHECKPOINT_PRIVATE_PHASES",\n  );\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  for (const phase of state.engineResults)\n    for (const row of phase.records) {\n      const value = await work(token, state, () =>\n        heldOperationFile(\n          state.source.operationToken,\n          row.relative,\n          row.maximum,\n          row.pin,\n          true,\n        ),\n      );\n      need(value.identity === row.identity, "CHECKPOINT_PHASE_CHANGED");\n    }\n  const actor = state.engineResults[3],\n    output = actor.output;\n  need(\n    output?.dataOnly === true &&\n      output.sealed === true &&\n      output.outcome === "quiet-deadline" &&\n      output.bundle === "full-sdk-checkpoint-output" &&\n      output.sourceContextSha256 ===\n        state.source.metadataSnapshot.matchedExpectedDefaults.contextSha256,\n    "CHECKPOINT_SEAL_RESULT",\n  );\n  const operation = operationState(state.source.operationToken, true),\n    read = (relative, maximum, pin) =>\n      work(token, state, () =>\n        heldOperationFile(\n          state.source.operationToken,\n          relative,\n          maximum,\n          pin,\n          true,\n        ),\n      );\n  const result = parseRecord(\n    await read("full-sdk-checkpoint-seal-result.json", 131072, output.result),\n  );\n  need(\n    canonical(result) ===\n      canonical(\n        Object.fromEntries(\n          Object.entries(output).filter(([key]) => key !== "result"),\n        ),\n      ),\n    "CHECKPOINT_ACTOR_RESULT",\n  );\n  const checkpoint = await read(\n      "full-sdk-checkpoint-output/checkpoint.json",\n      2 * 1024 ** 2,\n      output.checkpoint,\n    ),\n    record = parentMetadata_qualificationBoundedJson(\n      checkpoint.raw,\n      2 * 1024 ** 2,\n    );\n  parentMetadata_qualificationShape(\n    record,\n    [\n      "schemaVersion",\n      "kind",\n      "identity",\n      "workflow",\n      "producerInputs",\n      "outArchive",\n      "inputSidecar",\n      "rawChain",\n      "nativeEvidence",\n      "codec",\n      "sourceQualified",\n      "sdkBuilt",\n      "nativeAcceptance",\n      "executionAdmitted",\n    ],\n    "CHECKPOINT_RECORD_FIELDS",\n  );\n  const graph = await read(\n      "source-gn-logs/fresh-graph-pins.json",\n      16 * 1024 ** 2,\n    ),\n    sourceContext = parseRecord(\n      await read(\n        "context.json",\n        131072,\n        operation.plan.rootPins.find((row) => row.relative === "context.json"),\n      ),\n    );\n  need(\n    record.schemaVersion === 1 &&\n      record.kind === "windows-arm-full-sdk-compiled-checkpoint" &&\n      record.sourceQualified === false &&\n      record.sdkBuilt === false &&\n      record.nativeAcceptance === false &&\n      record.executionAdmitted === false &&\n      canonical(record.codec) ===\n        canonical({\n          bytes: 154847,\n          sha256:\n            "043659e63e1cfc50b5af8209a1e30fd924ed379e7355069fa654b657bc789113",\n        }) &&\n      canonical(record.producerInputs) ===\n        canonical(operation.plan.producerInputs),\n    "CHECKPOINT_RECORD_SCOPE",\n  );\n  const expectedIdentity = {\n    image: state.source.image,\n    sourceId: state.source.sourceId,\n    producerSha256: producerInputDigest(operation.plan.producerInputs),\n    sourceDateEpoch: { present: false, value: null },\n    canonicalRoot: path.basename(state.source.root),\n    toolProofPin: state.source.toolProofSnapshot.record.pin,\n    graphPin: graph.pin,\n  };\n  need(\n    canonical(record.identity) === canonical(expectedIdentity) &&\n      canonical(record.workflow) ===\n        canonical({\n          repository: "supermarsx/sortOfRemoteNG",\n          repositoryId: 1010282954,\n          path: ".github/workflows/windows-arm-full-sdk.yml",\n          ref: "refs/heads/main",\n          head: sourceContext.head,\n          runId: sourceContext.runId,\n          attempt: sourceContext.attempt,\n        }),\n    "CHECKPOINT_IDENTITY",\n  );\n  const mapping = {\n    sourceContext: "context.json",\n    engineContext: "full-sdk-engine-cef-engine-context.json",\n    launch: "full-sdk-engine-cef-engine-launch.json",\n    job: "jobs/cef-engine/receipt.json",\n    close: "full-sdk-engine-closed-cef-engine.json",\n    sourceJob: "jobs/full-source-operation/receipt.json",\n    sourceLauncher: "full-source-launcher-result.json",\n    sourceClose: "full-source-closed-launcher.json",\n  };\n  parentMetadata_qualificationShape(\n    record.rawChain,\n    ["outcome", ...Object.keys(mapping)],\n    "CHECKPOINT_CHAIN_FIELDS",\n  );\n  need(\n    record.rawChain.outcome === "quiet-deadline",\n    "CHECKPOINT_NATIVE_OUTCOME",\n  );\n  for (const [key, relative] of Object.entries(mapping))\n    await read(relative, 1048576, record.rawChain[key]);\n  need(\n    canonical(record.rawChain.engineContext) ===\n      canonical(state.nativeSliceFact.context) &&\n      canonical(record.rawChain.launch) ===\n        canonical(state.nativeSliceFact.launch) &&\n      canonical(record.rawChain.job) ===\n        canonical(state.nativeSliceFact.receipt) &&\n      canonical(record.rawChain.close) ===\n        canonical(state.nativeSliceFact.closure),\n    "CHECKPOINT_PRIVATE_CHAIN",\n  );\n  const archive = record.outArchive;\n  parentMetadata_qualificationShape(\n    archive,\n    [\n      "complete",\n      "chunks",\n      "inventory",\n      "rawBytes",\n      "compressedBytes",\n      "entries",\n      "linksIncluded",\n    ],\n    "CHECKPOINT_ARCHIVE_FIELDS",\n  );\n  need(\n    archive.complete === true &&\n      archive.linksIncluded === false &&\n      Number.isSafeInteger(archive.rawBytes) &&\n      archive.rawBytes >= 0 &&\n      archive.rawBytes <= 256 * 1024 ** 3 &&\n      Number.isSafeInteger(archive.entries) &&\n      archive.entries > 0 &&\n      archive.entries <= 300000 &&\n      Array.isArray(archive.chunks) &&\n      archive.chunks.length > 0 &&\n      archive.chunks.length <= 32 &&\n      archive.inventory?.name === "inventory.json",\n    "CHECKPOINT_ARCHIVE",\n  );\n  const rows = [\n    { name: "checkpoint.json", ...checkpoint.pin, maximum: 2 * 1024 ** 2 },\n    { name: "inputs.jsonl", ...record.inputSidecar, maximum: 1536 * 1024 ** 2 },\n    { name: "graph.json", ...graph.pin, maximum: 16 * 1024 ** 2 },\n    {\n      name: "tools.json",\n      ...state.source.toolProofSnapshot.record.pin,\n      maximum: 16 * 1024 ** 2,\n    },\n    {\n      name: "native-chain.json",\n      ...record.nativeEvidence,\n      maximum: 2 * 1024 ** 2,\n    },\n    { ...archive.inventory, maximum: 128 * 1024 ** 2 },\n  ];\n  let compressed = 0;\n  for (const [index, row] of archive.chunks.entries()) {\n    parentMetadata_qualificationShape(\n      row,\n      ["name", "bytes", "sha256"],\n      "CHECKPOINT_CHUNK_FIELDS",\n    );\n    need(\n      row.name === `checkpoint-${String(index).padStart(5, "0")}.bin`,\n      "CHECKPOINT_CHUNK_NAME",\n    );\n    compressed += row.bytes;\n    rows.push({ ...row, maximum: 1024 ** 3 });\n  }\n  need(\n    Number.isSafeInteger(compressed) &&\n      compressed === archive.compressedBytes &&\n      compressed <= 32 * 1024 ** 3,\n    "CHECKPOINT_COMPRESSED_BOUND",\n  );\n  const assets = [];\n  for (const row of rows) {\n    need(\n      Number.isSafeInteger(row.bytes) &&\n        row.bytes > 0 &&\n        row.bytes <= row.maximum &&\n        /^[a-f0-9]{64}$/.test(row.sha256),\n      "CHECKPOINT_ASSET_BOUND",\n    );\n    assets.push(\n      await sealSdkAsset(\n        token,\n        row.name,\n        { size: row.bytes, sha256: row.sha256 },\n        "checkpoint",\n      ),\n    );\n  }\n  for (const row of assets) {\n    const value = await sealSdkAsset(token, row.name, row, "checkpoint");\n    need(value.identity === row.identity, "CHECKPOINT_ASSET_CHANGED");\n  }\n  await work(token, state, () =>\n    recheckSourceReceipt(state.sourceReceipt, state.leaseToken),\n  );\n  await currentRoot(token, state);\n  retained(token, state);\n  need(state.assetFds.size === 0, "CHECKPOINT_FD_JOIN");\n  const seal = Object.freeze({\n    kind: "windows-arm-full-sdk-checkpoint-produced",\n    image: state.source.image,\n    sourceId: state.source.sourceId,\n    target: state.source.target,\n    checkpointSealed: true,\n    sdkBuilt: false,\n    nativeAcceptance: false,\n    runtimeReady: false,\n    publicationAllowed: false,\n    bundle: "full-sdk-checkpoint-output",\n    checkpoint: Object.freeze({ ...checkpoint.pin }),\n    assets: Object.freeze(assets),\n  });\n  state.checkpointSeal = seal;\n  return seal;\n}\n\nasync function publishControllerOutcome(token, seal) {\n  const state = controls.get(token);\n  need(state, "CONTROL_BRAND");\n  retained(token, state);\n  need(\n    (state.sdkSeal === seal && seal.sdkBuilt === true) ||\n      (state.checkpointSeal === seal && seal.checkpointSealed === true),\n    "RESULT_PRIVATE_FACT",\n  );\n  const operation = operationState(state.source.operationToken, true),\n    context = operation.plan.rootPins.find(\n      (row) => row.relative === "context.json",\n    );\n  await currentRoot(token, state);\n  retained(token, state);\n  const raw = Buffer.from(JSON.stringify(seal, null, 2) + "\\n");\n  need(raw.length <= 131072, "RESULT_BOUND");\n  await work(token, state, () =>\n    fs.writeFile(\n      path.join(state.source.root, "full-sdk-controller-result.json"),\n      raw,\n      { flag: "wx" },\n    ),\n  );\n  await currentRoot(token, state);\n  retained(token, state);\n  const file = process.env.GITHUB_OUTPUT;\n  need(\n    typeof file === "string" &&\n      path.isAbsolute(file) &&\n      path.dirname(file) ===\n        path.join(\n          path.resolve(CONTROLLER_REPO, "../../_temp"),\n          "_runner_file_commands",\n        ) &&\n      /^set_output_[a-f0-9-]{36}$/.test(path.basename(file)),\n    "RESULT_OUTPUT_PATH",\n  );\n  await physical(token, state, path.dirname(file));\n  const record = Buffer.from(\n    `root=${state.source.root.replaceAll("\\\\", "/")}\\ncontext_sha256=${context.sha256}\\noutcome=${seal.sdkBuilt ? "sdk" : "checkpoint"}\\n`,\n  );\n  need(record.length <= 1024, "RESULT_OUTPUT_BOUND");\n  state.assetFds ??= new Set();\n  const fd = await work(\n    token,\n    state,\n    () =>\n      fs\n        .open(\n          file,\n          constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),\n        )\n        .then((value) => {\n          state.assetFds.add(value);\n          return value;\n        }),\n    async (late) => {\n      await late.close();\n      state.assetFds.delete(late);\n    },\n  );\n  try {\n    const before = await work(token, state, () => fd.stat({ bigint: true }));\n    need(\n      fileId(before) ===\n        fileId(\n          await work(token, state, () => fs.lstat(file, { bigint: true })),\n        ),\n      "RESULT_OUTPUT_CHANGED",\n    );\n    retained(token, state);\n    await work(token, state, () => fd.writeFile(record));\n    const after = await work(token, state, () => fd.stat({ bigint: true }));\n    need(\n      after.dev === before.dev &&\n        after.ino === before.ino &&\n        after.size === before.size + BigInt(record.length) &&\n        fileId(after) ===\n          fileId(\n            await work(token, state, () => fs.lstat(file, { bigint: true })),\n          ),\n      "RESULT_OUTPUT_CHANGED",\n    );\n    await work(token, state, () => fd.close());\n    state.assetFds.delete(fd);\n  } catch (error) {\n    throw fail(state, error);\n  }\n  await currentRoot(token, state);\n  retained(token, state);\n}\n// END PRIVATE FINAL SDK VERIFICATION\n\nasync function runFullSdkTransaction(bootstrap) {\n  const owner = bootstrapOwners.get(bootstrap);\n  need(owner && owner.pid === process.pid, "BOOTSTRAP_BRAND");\n  let operation,\n    control,\n    result,\n    failed = false,\n    primary;\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n    }\n  };\n  try {\n    bootstrapState(bootstrap);\n    operation = await createSourceOperation(bootstrap);\n    const source = await runSourcePhase(operation);\n    control = await createControl(source, owner.lease);\n    await prepareFreshPolicy(control);\n    await runEnginePhase(control, "probe-clang");\n    await runEnginePhase(control, "probe-link");\n    const engine = await runEnginePhase(control, "cef-engine");\n    if (engine === controls.get(control).nativeSliceFact) {\n      await runEnginePhase(control, "checkpoint-seal");\n      result = await verifyProducedCheckpoint(control);\n    } else {\n      await runEnginePhase(control, "package");\n      result = await verifyProducedSdk(control);\n    }\n    await publishControllerOutcome(control, result);\n  } catch (error) {\n    remember(error);\n  } finally {\n    if (failed && !owner.cancel.signal.aborted) owner.cancel.abort(primary);\n    const controlState = control ? controls.get(control) : undefined;\n    try {\n      if (control) await retireControl(control);\n    } catch (error) {\n      remember(error);\n    }\n    if (controlState && controlState.cleanupConfirmed !== true)\n      remember(\n        controlState.failed\n          ? controlState.primary\n          : new Error("FULL_SDK_CONTROL_CLEANUP_UNCONFIRMED"),\n      );\n    const sourceToken = operation ?? owner.operation,\n      source = sourceToken ? sourceOperations.get(sourceToken) : undefined;\n    try {\n      if (sourceToken) await retireSourceOperation(sourceToken);\n    } catch (error) {\n      remember(error);\n    }\n    if (source && source.cleanupConfirmed !== true)\n      remember(\n        source.failed\n          ? source.primary\n          : new Error("FULL_SDK_CONTROL_SOURCE_CLEANUP_UNCONFIRMED"),\n      );\n    const leaseBeforeClose = leases.get(owner.lease),\n      bootstrapCleanup = owner.bootstrapFailureCleanup ?? {\n        cleanupEnd: Math.min(\n          performance.now() + CLEANUP_MS,\n          leaseBeforeClose.monoEnd - FINAL_RESERVE_MS,\n        ),\n        cleanupWallEnd: Math.min(\n          Date.now() + CLEANUP_MS,\n          leaseBeforeClose.wallEnd - FINAL_RESERVE_MS,\n        ),\n      };\n    const closing = [...(owner.bootstrapFds ?? [])].map((fd) =>\n      Promise.resolve()\n        .then(() => fd.close())\n        .then(() => owner.bootstrapFds.delete(fd)),\n    );\n    try {\n      if (closing.length || owner.bootstrapPending?.size)\n        await cleanupStep(bootstrapCleanup, () =>\n          Promise.all([\n            ...closing,\n            ...[...(owner.bootstrapPending ?? [])].map((value) =>\n              value.catch(() => undefined),\n            ),\n          ]),\n        );\n    } catch (error) {\n      remember(error);\n    }\n    if (owner.bootstrapFds?.size || owner.bootstrapPending?.size)\n      remember(new Error("FULL_SDK_CONTROL_BOOTSTRAP_CLEANUP_UNCONFIRMED"));\n    // No awaited cleanup or falsy primary can skip these final revocations.\n    owner.closed = true;\n    bootstrapOwners.delete(bootstrap);\n    const lease = leases.get(owner.lease);\n    if (lease) lease.closed = true;\n  }\n  if (failed) throw primary;\n  return result;\n}\n// END CLOSED FULL SDK SOURCE CONTROLLER\n\nexport function main(argv = process.argv.slice(2)) {\n  const bootstrap = beginFullSdkBootstrap();\n  try {\n    need(\n      !utilTypes.isProxy(argv) &&\n        Array.isArray(argv) &&\n        Object.getPrototypeOf(argv) === Array.prototype &&\n        Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===\n          "0,length" &&\n        Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>\n          Object.hasOwn(row, "value"),\n        ) &&\n        argv.length === 1 &&\n        argv[0] === "--execute",\n      "ENTRY_ARGV",\n    );\n    return runFullSdkTransaction(bootstrap);\n  } catch (error) {\n    const owner = bootstrapOwners.get(bootstrap);\n    owner.closed = true;\n    leases.get(owner.lease).closed = true;\n    bootstrapOwners.delete(bootstrap);\n    throw error;\n  }\n}\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(MODULE_URL)\n) {\n  Promise.resolve()\n    .then(() => main())\n    .catch((error) => {\n      const code = /^FULL_SDK_CONTROL_[A-Z_]{1,80}$/.test(error?.message ?? "")\n        ? error.message\n        : "FULL_SDK_CONTROL_FAILED";\n      console.error(\n        JSON.stringify({\n          kind: "windows-arm-full-sdk-failure",\n          error: code,\n          sdkBuilt: false,\n          nativeAcceptance: false,\n        }),\n      );\n      process.exitCode = 1;\n    });\n}\n',
        oldSha256:
          "2c44896d97bdbb2af2ce1ede3e18e971414546258e5ddcf2eaa4f8d9e46243cb",
        newSha256:
          "f078a5a61b89dc3c766aabe1bc567e3da89cccf7f42c77f65d3aedfd1b8f7a09",
      },
    ],
    bytes: 113463,
    sha256: "9ef4d2b569e57b7483390a1ec922635526fc60f38ed102346b8541d4fffbd893",
  },
  driver: {
    rows: [
      {
        name: "finite-0",
        oldRaw:
          '  closeSync,\n  writeFileSync,\n  watch,\n  renameSync,\n  realpathSync,\n} from "node:fs";\nimport path from "node:path";\nimport { pathToFileURL, fileURLToPath } from "node:url";\nimport { createHash } from "node:crypto";\nimport { spawn } from "node:child_process";\n\nconst HERE = path.dirname(fileURLToPath(import.meta.url));\nconst REPO = path.resolve(HERE, "../..");\nconst HELPER_ROOT = path.join(HERE, "current-source-helpers");\n',
        newRaw:
          '  closeSync,\n  writeFileSync,\n  watch,\n  renameSync,\n  realpathSync,\n} from "node:fs";\nimport path from "node:path";\nimport { types as utilTypes } from "node:util";\nimport { pathToFileURL, fileURLToPath } from "node:url";\nimport { createHash } from "node:crypto";\nimport { spawn } from "node:child_process";\n\nconst HERE = path.dirname(fileURLToPath(import.meta.url));\nconst REPO = path.resolve(HERE, "../..");\nconst HELPER_ROOT = path.join(HERE, "current-source-helpers");\n',
        oldSha256:
          "5cc44095289854506159987e454b7ded8c92ab45536c35fb0ceb37c1876cec9e",
        newSha256:
          "87b766fa1c5c2775da7503b51d1c0c907a46e08cd47555c709e7b9440d2fa587",
      },
      {
        name: "finite-1",
        oldRaw:
          '    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nconst FULL_SOURCE_BODY_ADMITTED = false;\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "528dfa3b3a510f0fc9c5e5f48af8044e004ccd9f2b217b1943d2d67053be9aa2";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\nconst fullMetadataOwners = new WeakMap();\nconst fullMetadataSources = new WeakMap();\nconst fullMetadataContexts = new WeakMap();\n',
        newRaw:
          '    need(performance.now() - began < allowed, "FULL_SOURCE_STAGE_DEADLINE");\n    return result;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nconst FULL_SOURCE_BODY_ADMITTED = true; // Reviewed source qualification attempt; no engine grant.\nconst FULL_SOURCE_PROFILE_SHA256 =\n  "ffb9fce5aa8020dd46d2d32d8196172dfd56f3e28e6e12db934b276536927f1b";\nconst fullSourceProfiles = new WeakMap();\n\n// Actual full source owner and graph receipts are the only metadata issuers.\n// The unchanged private profile below is a pinned data recipe, never full authority.\nconst fullMetadataOwners = new WeakMap();\nconst fullMetadataSources = new WeakMap();\nconst fullMetadataContexts = new WeakMap();\n',
        oldSha256:
          "e6906ec3134f45b283a317ed788887c0f6aec76ab08abac3b1651201f81dbabc",
        newSha256:
          "582f700f9a3b650f36924a1ec446d212fa2cf95ab1144fec41f5a048eeeace44",
      },
      {
        name: "finite-2",
        oldRaw:
          '      c.kind === "windows-arm-full-sdk-context" &&\n      c.head === c.workflowSha &&\n      /^[a-f0-9]{40}$/.test(c.head) &&\n      /^[1-9][0-9]*$/.test(c.runId) &&\n      /^[1-9][0-9]*$/.test(c.attempt) &&\n      c.inputs &&\n      Object.getPrototypeOf(c.inputs) === Object.prototype &&\n      Object.keys(c.inputs).length === 0,\n    "FULL_SDK_SOURCE_CONTEXT",\n  );\n}\nasync function loadFullSourceProfile(root, c, provisional, contextPin) {\n  requireFullSourceContext(c);\n  const raw = await held(\n    path.join(HERE, "full-sdk-source-profile.json"),\n',
        newRaw:
          '      c.kind === "windows-arm-full-sdk-context" &&\n      c.head === c.workflowSha &&\n      /^[a-f0-9]{40}$/.test(c.head) &&\n      /^[1-9][0-9]*$/.test(c.runId) &&\n      /^[1-9][0-9]*$/.test(c.attempt) &&\n      c.inputs &&\n      Object.getPrototypeOf(c.inputs) === Object.prototype &&\n      Object.keys(c.inputs).length === 1 &&\n      typeof c.inputs.restore_run === "string" &&\n      /^(?:0|[1-9][0-9]{0,19})$/.test(c.inputs.restore_run),\n    "FULL_SDK_SOURCE_CONTEXT",\n  );\n}\nasync function loadFullSourceProfile(root, c, provisional, contextPin) {\n  requireFullSourceContext(c);\n  const raw = await held(\n    path.join(HERE, "full-sdk-source-profile.json"),\n',
        oldSha256:
          "f010f710b669e91884f8538d269abbd21757ede2849a00073707d516ad8463dd",
        newSha256:
          "aadd9cef691bdcb830c3af465e47e9a1a9a3a4c7d761f9388a01ba91c1ef049a",
      },
      {
        name: "finite-3",
        oldRaw:
          '  need(sha(raw) === FULL_SOURCE_PROFILE_SHA256, "FULL_SDK_SOURCE_PROFILE_PIN");\n  const full = JSON.parse(raw);\n  need(\n    full.fullModeBodyImplemented === true &&\n      full.sourceSessionIssuerImplemented === true &&\n      full.executionAdmitted === false &&\n      full.sourceProgramCarryforwardQualified === false &&\n      full.fullArm64DefaultsQualified === false,\n    "FULL_SDK_SOURCE_PROFILE_CLOSED",\n  );\n  const pin = full.images[c.image];\n  need(\n    pin &&\n      c.sourceId === pin.sourceId &&\n      c.sourceProfileSha256 === pin.profileSha256,\n',
        newRaw:
          '  need(sha(raw) === FULL_SOURCE_PROFILE_SHA256, "FULL_SDK_SOURCE_PROFILE_PIN");\n  const full = JSON.parse(raw);\n  need(\n    full.fullModeBodyImplemented === true &&\n      full.sourceSessionIssuerImplemented === true &&\n      full.executionAdmitted === false &&\n      full.sourceProgramCarryforwardQualified === false &&\n      full.fullArm64DefaultsQualified === false &&\n      full.sourceQualificationAllowed === true,\n    "FULL_SDK_SOURCE_PROFILE_CLOSED",\n  );\n  const pin = full.images[c.image];\n  need(\n    pin &&\n      c.sourceId === pin.sourceId &&\n      c.sourceProfileSha256 === pin.profileSha256,\n',
        oldSha256:
          "0ebb57c69b0a2597ef5464cccbf655f30089ceed3d7075e4a92f60fb7506ca78",
        newSha256:
          "f55d43e3c391111c0b04d8c37e1a7a63647be6eaaccb5383828e1bf8f6978b0d",
      },
      {
        name: "finite-4",
        oldRaw:
          '  });\n  return { p, budget, tools, files, privatePolicyRaw: raw };\n}\nfunction fullSourceCommands(root, p, hooks, contextPin) {\n  const state = fullSourceProfiles.get(p);\n  need(state && state.root === root, "FULL_SDK_SOURCE_RECIPE_BRAND");\n  state.budget.remaining();\n  return Object.freeze(\n    sourceCommands(root, p, hooks, contextPin).map((row) => {\n      if (row.role !== "verify-setup") return row;\n      need(\n        row.args[2] === path.join(HERE, "producer.py") &&\n          row.args[3] === "--verify-source-setup",\n        "FULL_SDK_SOURCE_SETUP_VECTOR",\n      );\n',
        newRaw:
          '  });\n  return { p, budget, tools, files, privatePolicyRaw: raw };\n}\nfunction fullSourceCommands(root, p, hooks, contextPin) {\n  const state = fullSourceProfiles.get(p);\n  need(state && state.root === root, "FULL_SDK_SOURCE_RECIPE_BRAND");\n  state.budget.remaining();\n  const commands = Object.freeze(\n    sourceCommands(root, p, hooks, contextPin).map((row) => {\n      if (row.role !== "verify-setup") return row;\n      need(\n        row.args[2] === path.join(HERE, "producer.py") &&\n          row.args[3] === "--verify-source-setup",\n        "FULL_SDK_SOURCE_SETUP_VECTOR",\n      );\n',
        oldSha256:
          "3e8de510120ee0a1f7d757cbc7b5179aabee260f03c4944822a95a2c2ce5222d",
        newSha256:
          "d1223875fd0e72492cc6e038c4e027a19b0cf42fd240faf540c4e6b4cef0a49a",
      },
      {
        name: "finite-5",
        oldRaw:
          '          root,\n          contextPin,\n          "--execute",\n        ]),\n      });\n    }),\n  );\n}\nasync function runFullSourceBody(argv) {\n  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");\n  need(\n    process.platform === "win32" &&\n      process.arch === "x64" &&\n      argv.length === 4 &&\n      argv[0] === "--full-sdk-source-gn" &&\n',
        newRaw:
          '          root,\n          contextPin,\n          "--execute",\n        ]),\n      });\n    }),\n  );\n  return Object.freeze([\n    ...commands,\n    Object.freeze({\n      role: "restore-checkpoint",\n      executable: p.python.path,\n      cwd: root,\n      args: Object.freeze([\n        "-I",\n        "-B",\n        path.join(HERE, "compiled_checkpoint.py"),\n        "--restore",\n        root,\n        contextPin,\n      ]),\n    }),\n  ]);\n}\n\n// BEGIN SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION\nconst fullSourceSentinelOwners = new WeakSet();\nasync function normalizeFullSourceDepotToolsSentinel(root, p, contextPin) {\n  const binding = fullBootstrapAuthority(root, p, contextPin);\n  need(binding && !fullSourceSentinelOwners.has(p), "FULL_SENTINEL_OWNER");\n  const relative =\n      "source-checkout/src/third_party/depot_tools/.disable_auto_update",\n    file = path.join(root, relative),\n    script = path.join(path.dirname(file), "update_depot_tools_toggle.py"),\n    scriptPin = {\n      bytes: 1205,\n      sha256:\n        "6797d3ed046e32efbd48e044347dce7703559b76b4adaca1c874f69ff83c1c23",\n    };\n  const originalRemaining = binding.budget.remaining(),\n    began = performance.now(),\n    monoEnd = began + Math.min(30000, originalRemaining),\n    wallEnd = Math.min(\n      Date.now() + 30000,\n      binding.context.wallWholeEnd * 1000 - 150000,\n    );\n  let failed = false,\n    primary,\n    fd,\n    result,\n    retired = false;\n  const remember = (error) => {\n    if (!failed) {\n      failed = true;\n      primary = error;\n    }\n  };\n  const owner = () => {\n    need(\n      fullBootstrapAuthority(root, p, contextPin) === binding,\n      "FULL_SENTINEL_RETIRED",\n    );\n    binding.budget.remaining();\n    need(\n      performance.now() < monoEnd && Date.now() < wallEnd,\n      "FULL_SENTINEL_DEADLINE",\n    );\n  };\n  const wait = async (action) => {\n    owner();\n    let timer;\n    try {\n      const value = await Promise.race([\n        Promise.resolve().then(() => {\n          owner();\n          return action();\n        }),\n        new Promise((_, reject) => {\n          timer = setTimeout(\n            () => reject(new Error("FULL_SENTINEL_DEADLINE")),\n            Math.max(\n              1,\n              Math.min(\n                monoEnd - performance.now(),\n                wallEnd - Date.now(),\n                binding.budget.remaining(),\n              ),\n            ),\n          );\n        }),\n      ]);\n      owner();\n      return value;\n    } finally {\n      clearTimeout(timer);\n    }\n  };\n  const dirId = (info) => {\n    need(\n      info.isDirectory() && !info.isSymbolicLink(),\n      "FULL_SENTINEL_DIRECTORY",\n    );\n    return [\n      info.dev,\n      info.ino,\n      info.mode,\n      info.uid,\n      info.gid,\n      info.birthtimeNs,\n    ].join(":");\n  };\n  const parents = [];\n  const fence = async () => {\n    for (const entry of parents)\n      need(\n        dirId(await wait(() => fs.lstat(entry.path, { bigint: true }))) ===\n          entry.identity,\n        "FULL_SENTINEL_ANCESTOR",\n      );\n    need((await wait(() => physical(file))) === file, "FULL_SENTINEL_ALIAS");\n    owner();\n  };\n  try {\n    await wait(() => held(script, scriptPin.bytes, binding.budget, scriptPin));\n    for (let current = path.dirname(file); ; current = path.dirname(current)) {\n      parents.push({\n        path: current,\n        identity: dirId(await wait(() => fs.lstat(current, { bigint: true }))),\n      });\n      if (current === path.dirname(current)) break;\n    }\n    await fence();\n    const pendingOpen = wait(() =>\n      fs\n        .open(file, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))\n        .then(async (value) => {\n          if (retired) {\n            await value.close();\n            throw primary;\n          }\n          fd = value;\n          return value;\n        }),\n    );\n    await pendingOpen;\n    const before = await wait(() => fd.stat({ bigint: true }));\n    need(\n      before.isFile() &&\n        !before.isSymbolicLink() &&\n        before.nlink === 1n &&\n        before.size > 0n &&\n        before.size <= 4096n,\n      "FULL_SENTINEL_FILE",\n    );\n    const identity = signature(before);\n    need(\n      signature(await wait(() => fs.lstat(file, { bigint: true }))) ===\n        identity,\n      "FULL_SENTINEL_CHANGED",\n    );\n    const buffer = Buffer.alloc(Number(before.size) + 1);\n    let count = 0;\n    while (count < buffer.length) {\n      const read = await wait(() =>\n        fd.read(buffer, count, buffer.length - count, count),\n      );\n      if (!read.bytesRead) break;\n      count += read.bytesRead;\n    }\n    need(\n      count === Number(before.size) &&\n        signature(await wait(() => fd.stat({ bigint: true }))) === identity &&\n        signature(await wait(() => fs.lstat(file, { bigint: true }))) ===\n          identity,\n      "FULL_SENTINEL_CHANGED",\n    );\n    const raw = buffer.subarray(0, count),\n      prefix = Buffer.from("Disabled by " + script + " at ", "utf8");\n    need(\n      raw.length > prefix.length + 2 &&\n        raw.subarray(0, prefix.length).equals(prefix) &&\n        raw.subarray(-2).equals(Buffer.from("\\r\\n")),\n      "FULL_SENTINEL_GRAMMAR",\n    );\n    const timestampRaw = raw.subarray(prefix.length, -2);\n    need(\n      timestampRaw.every((byte) => byte >= 32 && byte <= 126),\n      "FULL_SENTINEL_GRAMMAR",\n    );\n    const timestamp = timestampRaw.toString("ascii"),\n      match =\n        /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\\.[0-9]{6})?$/.exec(\n          timestamp,\n        );\n    need(\n      match && (timestamp.length === 19 || timestamp.length === 26),\n      "FULL_SENTINEL_TIMESTAMP",\n    );\n    const [year, month, day, hour, minute, second] = match.slice(1).map(Number),\n      date = new Date(0);\n    date.setUTCFullYear(year, month - 1, day);\n    date.setUTCHours(hour, minute, second, 0);\n    need(\n      year >= 1 &&\n        year <= 9999 &&\n        date.getUTCFullYear() === year &&\n        date.getUTCMonth() === month - 1 &&\n        date.getUTCDate() === day &&\n        date.getUTCHours() === hour &&\n        date.getUTCMinutes() === minute &&\n        date.getUTCSeconds() === second,\n      "FULL_SENTINEL_TIMESTAMP",\n    );\n    const canonical = Buffer.concat([\n      prefix,\n      Buffer.from("1970-01-01 00:00:00\\r\\n"),\n    ]);\n    await fence();\n    need(\n      signature(await wait(() => fd.stat({ bigint: true }))) === identity &&\n        signature(await wait(() => fs.lstat(file, { bigint: true }))) ===\n          identity,\n      "FULL_SENTINEL_CHANGED",\n    );\n    owner();\n    fullSourceSentinelOwners.add(p); // This genuine source lifetime may normalize once.\n    if (!raw.equals(canonical)) {\n      owner();\n      const written = await wait(() =>\n        fd.write(canonical, 0, canonical.length, 0),\n      );\n      need(\n        written.bytesWritten === canonical.length,\n        "FULL_SENTINEL_PARTIAL_WRITE",\n      );\n      owner();\n      await wait(() => fd.truncate(canonical.length));\n      owner();\n      await wait(() => fd.sync());\n    }\n    const after = await wait(() => fd.stat({ bigint: true }));\n    need(\n      after.isFile() &&\n        after.nlink === 1n &&\n        after.dev === before.dev &&\n        after.ino === before.ino &&\n        after.size === BigInt(canonical.length) &&\n        signature(after) ===\n          signature(await wait(() => fs.lstat(file, { bigint: true }))),\n      "FULL_SENTINEL_CHANGED",\n    );\n    const check = Buffer.alloc(canonical.length + 1);\n    let size = 0;\n    while (size < check.length) {\n      const value = await wait(() =>\n        fd.read(check, size, check.length - size, size),\n      );\n      if (!value.bytesRead) break;\n      size += value.bytesRead;\n    }\n    need(\n      size === canonical.length &&\n        check.subarray(0, size).equals(canonical) &&\n        signature(await wait(() => fd.stat({ bigint: true }))) ===\n          signature(after),\n      "FULL_SENTINEL_READBACK",\n    );\n    await fence();\n    owner();\n    result = {\n      dataOnly: true,\n      relative,\n      bytes: canonical.length,\n      sha256: sha(canonical),\n    };\n  } catch (error) {\n    remember(error);\n    retired = true;\n    fullSourceProfiles.delete(p);\n  } finally {\n    // Poison before awaited close; no rollback/retry.\n    if (fd) {\n      let timer;\n      const close = Promise.resolve().then(() => fd.close());\n      try {\n        await Promise.race([\n          close,\n          new Promise((_, reject) => {\n            timer = setTimeout(\n              () => reject(new Error("FULL_SENTINEL_CLOSE_DEADLINE")),\n              Math.max(\n                1,\n                Math.min(monoEnd - performance.now(), wallEnd - Date.now()),\n              ),\n            );\n          }),\n        ]);\n      } catch (error) {\n        remember(error);\n        fullSourceProfiles.delete(p);\n      } finally {\n        clearTimeout(timer);\n      }\n    }\n  }\n  if (failed) throw primary;\n  try {\n    await fence();\n    owner();\n    return result;\n  } catch (error) {\n    retired = true;\n    fullSourceProfiles.delete(p);\n    throw error;\n  }\n}\n// END SOURCE OWNED DEPOT TOOLS SENTINEL NORMALIZATION\n\nasync function runFullSourceBody(argv) {\n  need(FULL_SOURCE_BODY_ADMITTED, "FULL_SDK_SOURCE_EXECUTION_CLOSED");\n  need(\n    process.platform === "win32" &&\n      process.arch === "x64" &&\n      argv.length === 4 &&\n      argv[0] === "--full-sdk-source-gn" &&\n',
        oldSha256:
          "b1f528bb40e0f61b05798de6173717d48501a9cae6994b15fba4c84b4ae83195",
        newSha256:
          "b740a7e5b8e3532fd8ef25aebfb4c8c7cbaf86c0e691e528bca0c01715e5c473",
      },
      {
        name: "finite-6",
        oldRaw:
          '        custom.verifySourceCheckoutVersion(\n          p.python.path,\n          files.chromium,\n          lock.upstream.cef.version,\n        ),\n      );\n      await held(gnPath, 16 * 1024 ** 2, budget, gnPin);\n      stage = "cef-gn";\n      await checked(() =>\n        executeCommand(\n          executionCommands[7],\n          executionCommands,\n          env,\n          files,\n',
        newRaw:
          '        custom.verifySourceCheckoutVersion(\n          p.python.path,\n          files.chromium,\n          lock.upstream.cef.version,\n        ),\n      );\n      await held(gnPath, 16 * 1024 ** 2, budget, gnPin);\n      await normalizeFullSourceDepotToolsSentinel(root, p, argv[2]);\n      // BEGIN SOURCE OWNED CHECKPOINT RESTORE\n      let restoredCheckpoint;\n      if (c.inputs.restore_run !== "0") {\n        need(\n          c.checkpointRestore &&\n            c.checkpointRestore.runId === c.inputs.restore_run,\n          "FULL_RESTORE_CONTEXT",\n        );\n        fullBootstrapAuthority(root, p, argv[2]);\n        stage = "restore-checkpoint";\n        const rawRestore = await checked(() =>\n          executeCommand(\n            executionCommands[8],\n            executionCommands,\n            env,\n            files,\n            budget,\n            limits,\n            true,\n            { value: bootstrap, contextSha: argv[2] },\n          ),\n        );\n        fullBootstrapAuthority(root, p, argv[2]);\n        restoredCheckpoint = qualificationBoundedJson(\n          Buffer.from(rawRestore),\n          131072,\n        );\n        need(\n          restoredCheckpoint.dataOnly === true &&\n            restoredCheckpoint.restored === true &&\n            restoredCheckpoint.priorGraphFile ===\n              "full-sdk-checkpoint-import/graph.json",\n          "FULL_RESTORE_DATA",\n        );\n        await held(\n          path.join(root, restoredCheckpoint.priorGraphFile),\n          16 * 1024 ** 2,\n          budget,\n          restoredCheckpoint.graphPin,\n        );\n        fullBootstrapAuthority(root, p, argv[2]);\n      } else need(c.checkpointRestore === null, "FULL_RESTORE_UNREQUESTED");\n      // END SOURCE OWNED CHECKPOINT RESTORE\n      stage = "cef-gn";\n      await checked(() =>\n        executeCommand(\n          executionCommands[7],\n          executionCommands,\n          env,\n          files,\n',
        oldSha256:
          "f0e56389c86ee043a2f90cedd0bf9edfc8a78eccffce05d3c75302ff9c2bad88",
        newSha256:
          "d1b3792ca8eb4ba05145413eacc4ef5012df3a62c7344e32f52d408bf8c1994a",
      },
      {
        name: "finite-7",
        oldRaw:
          '        ),\n      );\n      stage = "graph-inventory";\n      currentProgress.phase("graph-inventory");\n      const capture = await collectQualificationGraph(qualificationOwner);\n      graph = capture.summary;\n      const snapshot = capture.diagnostic;\n      budget.remaining();\n      await qualificationOwnerAwait(\n        qualificationOwner,\n        fs.writeFile(\n          path.join(files.logs, "fresh-graph-pins.json"),\n          JSON.stringify(snapshot) + "\\n",\n          { flag: "wx" },\n',
        newRaw:
          '        ),\n      );\n      stage = "graph-inventory";\n      currentProgress.phase("graph-inventory");\n      const capture = await collectQualificationGraph(qualificationOwner);\n      graph = capture.summary;\n      const snapshot = capture.diagnostic;\n      // BEGIN FRESH RESTORED GRAPH COMPARISON\n      if (restoredCheckpoint) {\n        const priorGraph = qualificationBoundedJson(\n          await qualificationOwnerAwait(\n            qualificationOwner,\n            held(\n              path.join(root, "full-sdk-checkpoint-import/graph.json"),\n              16 * 1024 ** 2,\n              budget,\n              restoredCheckpoint.graphPin,\n            ),\n          ),\n          16 * 1024 ** 2,\n        );\n        fullMetadataOwner(qualificationOwner);\n        need(\n          staticProjectionEqual(snapshot, priorGraph),\n          "FULL_RESTORE_FRESH_GRAPH_MISMATCH",\n        );\n      }\n      // END FRESH RESTORED GRAPH COMPARISON\n      budget.remaining();\n      await qualificationOwnerAwait(\n        qualificationOwner,\n        fs.writeFile(\n          path.join(files.logs, "fresh-graph-pins.json"),\n          JSON.stringify(snapshot) + "\\n",\n          { flag: "wx" },\n',
        oldSha256:
          "9a0c929ca5ddc0400425b9afb2384cb8536db0ec155e60ea03c87410d36b3aca",
        newSha256:
          "a26c3978a0445ad052d0deb1a1b278e03719615e9e1371c5d60a7dab75f020ca",
      },
      {
        name: "finite-8",
        oldRaw:
          '      if (!failed) throw error;\n    }\n  }\n}\n// END CLOSED FULL SDK SOURCE BODY\n\n// BEGIN INACTIVE FULL SDK SOURCE INTERFACE\nexport function fullSdkSourceMain() {\n  // No caller argument, path, environment, report or callback can enable this.\n  // Exact b039 body retained; full-mode body adaptation is not implemented.\n  throw new Error("FULL_SDK_SOURCE_EXECUTION_CLOSED");\n}\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)\n)\n  fullSdkSourceMain();\n// END INACTIVE FULL SDK SOURCE INTERFACE\n\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)\n)\n  main().catch((error) => {\n    const code = /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,56}$/.test(\n      error?.message ?? "",\n    )\n      ? error.message\n      : "PRIVATE_DRIVER_UNAVAILABLE";\n    console.error(\n      JSON.stringify({\n        success: false,\n        firstFailure: code,\n        executionAdmitted: false,\n      }),\n    );\n    process.exitCode = 1;\n  });\n',
        newRaw:
          '      if (!failed) throw error;\n    }\n  }\n}\n// END CLOSED FULL SDK SOURCE BODY\n\n// BEGIN INACTIVE FULL SDK SOURCE INTERFACE\n// Historical derivation marker; admission is a reviewed SOURCE attempt only.\nexport function fullSdkSourceMain(argv = process.argv.slice(2)) {\n  need(\n    !utilTypes.isProxy(argv) &&\n      Array.isArray(argv) &&\n      Object.getPrototypeOf(argv) === Array.prototype &&\n      Object.keys(Object.getOwnPropertyDescriptors(argv)).sort().join() ===\n        "0,1,2,3,length" &&\n      Object.values(Object.getOwnPropertyDescriptors(argv)).every((row) =>\n        Object.hasOwn(row, "value"),\n      ) &&\n      argv.length === 4 &&\n      argv.every((value) => typeof value === "string") &&\n      argv[0] === "--full-sdk-source-gn" &&\n      /^[a-f0-9]{64}$/.test(argv[2]) &&\n      argv[3] === "--execute",\n    "FULL_DRIVER_ARGV",\n  );\n  return runFullSourceBody(argv);\n}\nif (\n  process.argv[1] &&\n  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)\n) {\n  Promise.resolve()\n    .then(() => fullSdkSourceMain())\n    .catch((error) => {\n      const code = /^(?:PRIVATE|FULL|SOURCE_GIT)_[A-Z_]{1,80}$/.test(\n        error?.message ?? "",\n      )\n        ? error.message\n        : "FULL_SDK_SOURCE_FAILED";\n      console.error(\n        JSON.stringify({\n          success: false,\n          firstFailure: code,\n          executionAdmitted: false,\n        }),\n      );\n      process.exitCode = 1;\n    });\n}\n// END INACTIVE FULL SDK SOURCE INTERFACE\n',
        oldSha256:
          "35780cc038c9d92b81d2afbc20db4cce92ec4343a2a16e16e6efdddbee3a8b61",
        newSha256:
          "602111a5158c9edc29851f9c6ed17d25603f306b9b7df785582c81aae49839bd",
      },
    ],
    bytes: 256606,
    sha256: "a1b9eb8eff5fb0e4a8e1719f1286e58147023fb77332b0a756c6c40303cf7b26",
  },
};
function assemblyInverse(text, name) {
  if (name === "controller") text = startupControllerInverse(text);
  const spec = ASSEMBLY_HISTORY[name];
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  for (const row of [...spec.rows].reverse()) {
    assert.equal(hash(row.newRaw), row.newSha256);
    assert.equal(hash(row.oldRaw), row.oldSha256);
    assert.equal(
      text.split(row.newRaw).length,
      2,
      "ASSEMBLY_INVERSE:" + row.name,
    );
    text = text.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(Buffer.byteLength(text), spec.bytes);
  assert.equal(hash(text), spec.sha256);
  return text;
}
// END FINITE ASSEMBLY HISTORY

// Exact parent-metadata inverse precedes the unchanged clock-only history check.
const PARENT_METADATA_CLOCK_HISTORY = [
  {
    name: "runSourcePhase",
    oldRaw:
      'async function runSourcePhase(token) {\n  const state = operationState(token);\n  need(!state.issued && !state.child, "SOURCE_PHASE_REUSE");\n  try {\n    await operationFence(token);\n    for (const [property, name] of [\n      ["stdoutFd", "source-launcher.stdout.log"],\n      ["stderrFd", "source-launcher.stderr.log"],\n    ]) {\n      await operationFence(token);\n      const fd = await operationWork(\n        token,\n        () =>\n          fs.open(\n            path.join(state.root, name),\n            constants.O_WRONLY |\n              constants.O_CREAT |\n              constants.O_EXCL |\n              (constants.O_NOFOLLOW ?? 0),\n            0o600,\n          ),\n        (late) => late.close(),\n      );\n      state[property] = fd;\n      state.logFds.add(fd);\n    }\n    await operationFence(token);\n    operationState(token);\n    startSourceChild(token);\n    await operationWork(token, () => state.childJoined);\n    const e = state.childEvents;\n    need(\n      e.spawn &&\n        e.exit &&\n        e.close &&\n        e.stdout &&\n        e.stderr &&\n        e.code === 0 &&\n        e.signal === null &&\n        e.closeCode === 0 &&\n        e.closeSignal === null &&\n        Number.isSafeInteger(state.creationPid) &&\n        state.creationPid > 0,\n      "SOURCE_CHILD_JOIN",\n    );\n    await operationWork(token, () => closeSourceLogs(state));\n    need(\n      state.readFds.size === 0 &&\n        state.logFds.size === 0 &&\n        state.pendingWriters === 0,\n      "SOURCE_FD_JOIN",\n    );\n    state.creationJoined = true;\n    await verifyNativeSourceRecords(token);\n    await verifySourceSnapshot(token);\n    operationState(token);\n    const receipt = Object.freeze({\n      kind: "closed-full-sdk-created-source-session",\n    });\n    const source = {\n      lease: state.lease,\n      stage: "joined-success",\n      pendingWriters: 0,\n      creationJoined: true,\n      image: state.plan.image,\n      target: "aarch64-pc-windows-msvc",\n      sourceId: state.plan.sourceId,\n      profileSha256: state.plan.profileSha256,\n      root: state.root,\n      rootIdentity: state.rootIdentity,\n      operationToken: token,\n    };\n    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.\n    sourceSessions.set(receipt, source);\n    state.sourceReceipt = receipt;\n    state.issued = true;\n    return receipt;\n  } catch (error) {\n    fail(state, error);\n    await retireSourceOperation(token);\n    throw state.primary;\n  }\n}',
    newRaw:
      'async function runSourcePhase(token) {\n  const state = operationState(token);\n  need(!state.issued && !state.child, "SOURCE_PHASE_REUSE");\n  try {\n    await operationFence(token);\n    for (const [property, name] of [\n      ["stdoutFd", "source-launcher.stdout.log"],\n      ["stderrFd", "source-launcher.stderr.log"],\n    ]) {\n      await operationFence(token);\n      const fd = await operationWork(\n        token,\n        () =>\n          fs.open(\n            path.join(state.root, name),\n            constants.O_WRONLY |\n              constants.O_CREAT |\n              constants.O_EXCL |\n              (constants.O_NOFOLLOW ?? 0),\n            0o600,\n          ),\n        (late) => late.close(),\n      );\n      state[property] = fd;\n      state.logFds.add(fd);\n    }\n    await operationFence(token);\n    operationState(token);\n    startSourceChild(token);\n    await operationWork(token, () => state.childJoined);\n    const e = state.childEvents;\n    need(\n      e.spawn &&\n        e.exit &&\n        e.close &&\n        e.stdout &&\n        e.stderr &&\n        e.code === 0 &&\n        e.signal === null &&\n        e.closeCode === 0 &&\n        e.closeSignal === null &&\n        Number.isSafeInteger(state.creationPid) &&\n        state.creationPid > 0,\n      "SOURCE_CHILD_JOIN",\n    );\n    await operationWork(token, () => closeSourceLogs(state));\n    need(\n      state.readFds.size === 0 &&\n        state.logFds.size === 0 &&\n        state.pendingWriters === 0,\n      "SOURCE_FD_JOIN",\n    );\n    state.creationJoined = true;\n    await verifyNativeSourceRecords(token);\n    await verifySourceSnapshot(token);\n    await verifySourceMetadata(token);\n    operationState(token);\n    const receipt = Object.freeze({\n      kind: "closed-full-sdk-created-source-session",\n    });\n    const source = {\n      lease: state.lease,\n      stage: "joined-success",\n      pendingWriters: 0,\n      creationJoined: true,\n      image: state.plan.image,\n      target: "aarch64-pc-windows-msvc",\n      sourceId: state.plan.sourceId,\n      profileSha256: state.plan.profileSha256,\n      root: state.root,\n      rootIdentity: state.rootIdentity,\n      operationToken: token,\n      metadataSnapshot: state.metadataSnapshot,\n    };\n    // Sole sourceSessions writer. Only this actual creation/join/readback path can reach it.\n    sourceSessions.set(receipt, source);\n    state.sourceReceipt = receipt;\n    state.issued = true;\n    return receipt;\n  } catch (error) {\n    fail(state, error);\n    await retireSourceOperation(token);\n    throw state.primary;\n  }\n}',
    oldSha256:
      "9a707731da6d6d8e0ed7077efcf2a033593f6108f51f43ca99de200c119fe6c3",
    newSha256:
      "faee5651d33ebda4daba92403d293f20879c7f95fc38cdb7815b51aca70feca5",
  },
  {
    name: "verifySourceSnapshot",
    oldRaw:
      'async function verifySourceSnapshot(token, joinedAllowed = false) {\n  const state = operationState(token, joinedAllowed);\n  for (const row of state.plan.rootPins)\n    await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum ?? 2 * 1024 ** 2,\n      row,\n      joinedAllowed,\n    );\n  for (const row of state.originalRecords ?? []) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      Math.max(row.pin.bytes, 1),\n      row.pin,\n      joinedAllowed,\n    );\n    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");\n  }\n  const graphRecord = await heldOperationFile(\n    token,\n    "source-gn-logs/fresh-graph-pins.json",\n    16 * 1024 ** 2,\n    undefined,\n    joinedAllowed,\n  );\n  const expected = parseRecord(graphRecord);\n  let snapshot,\n    callbackFailed = false,\n    callbackError,\n    calls = 0;\n  const summary = await operationWork(\n    token,\n    () =>\n      checkpoint.graphInventory(\n        path.join(state.root, "source-checkout/src/out/Release_GN_arm64"),\n        {\n          timeoutMs: Math.max(\n            1,\n            Math.floor(Math.min(180000, checkLease(state.lease))),\n          ),\n          observePins(value) {\n            try {\n              operationState(token, joinedAllowed);\n              need(++calls === 1, "SOURCE_GRAPH_CALLBACK");\n              snapshot = JSON.parse(checkpoint.graphPinSnapshot(value));\n            } catch (error) {\n              callbackFailed = true;\n              callbackError = error;\n              throw error;\n            }\n          },\n        },\n      ),\n    undefined,\n    joinedAllowed,\n  );\n  if (callbackFailed) throw callbackError;\n  need(\n    calls === 1 &&\n      snapshot &&\n      canonical(snapshot) === canonical(expected) &&\n      summary.sha256 === expected.sha256 &&\n      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}',
    newRaw:
      'async function verifySourceSnapshot(token, joinedAllowed = false) {\n  const state = operationState(token, joinedAllowed);\n  for (const row of state.plan.rootPins)\n    await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum ?? 2 * 1024 ** 2,\n      row,\n      joinedAllowed,\n    );\n  for (const row of state.originalRecords ?? []) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      Math.max(row.pin.bytes, 1),\n      row.pin,\n      joinedAllowed,\n    );\n    need(actual.identity === row.identity, "SOURCE_RECEIPT_REPLACED");\n  }\n  const graphRecord = await heldOperationFile(\n    token,\n    "source-gn-logs/fresh-graph-pins.json",\n    16 * 1024 ** 2,\n    undefined,\n    joinedAllowed,\n  );\n  const expected = parseRecord(graphRecord);\n  let snapshot,\n    callbackFailed = false,\n    callbackError,\n    calls = 0;\n  const summary = await operationWork(\n    token,\n    () =>\n      checkpoint.graphInventory(\n        path.join(state.root, "source-checkout/src/out/Release_GN_arm64"),\n        {\n          timeoutMs: Math.max(\n            1,\n            Math.floor(Math.min(180000, checkLease(state.lease))),\n          ),\n          observePins(value) {\n            try {\n              operationState(token, joinedAllowed);\n              need(++calls === 1, "SOURCE_GRAPH_CALLBACK");\n              snapshot = JSON.parse(checkpoint.graphPinSnapshot(value));\n            } catch (error) {\n              callbackFailed = true;\n              callbackError = error;\n              throw error;\n            }\n          },\n        },\n      ),\n    undefined,\n    joinedAllowed,\n  );\n  if (callbackFailed) throw callbackError;\n  need(\n    calls === 1 &&\n      snapshot &&\n      canonical(snapshot) === canonical(expected) &&\n      summary.sha256 === expected.sha256 &&\n      state.sourceResult.graph.sha256 === expected.sha256,\n    "SOURCE_GRAPH_CHANGED",\n  );\n  await recheckSourceMetadata(token, joinedAllowed);\n  await operationFence(token, joinedAllowed);\n  state.graphSnapshot = snapshot;\n}',
    oldSha256:
      "f9692150013a109fa5a5b9357cd8252124ab5d10d23499c76a428523247cedc6",
    newSha256:
      "04938d985f72d4b428458cc3c6e826a0e6123d9a74078def4b83d05f4874a49a",
  },
  {
    name: "recheckSourceReceipt",
    oldRaw:
      'async function recheckSourceReceipt(receipt, leaseToken) {\n  const source = sourceState(receipt, leaseToken);\n  const state = operationState(source.operationToken, true);\n  need(\n    state.sourceReceipt === receipt &&\n      state.creationJoined &&\n      state.logFds.size === 0 &&\n      state.readFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n}',
    newRaw:
      'async function recheckSourceReceipt(receipt, leaseToken) {\n  const source = sourceState(receipt, leaseToken);\n  const state = operationState(source.operationToken, true);\n  need(\n    state.sourceReceipt === receipt &&\n      source.metadataSnapshot === state.metadataSnapshot &&\n      state.metadataSnapshot &&\n      state.creationJoined &&\n      state.logFds.size === 0 &&\n      state.readFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_JOIN_CHANGED",\n  );\n  await verifySourceSnapshot(source.operationToken, true);\n}',
    oldSha256:
      "ef7c8b8f5078ba43bf6efd1438a3c4569801417518a514d04a3213995ad20e88",
    newSha256:
      "6f22fd2f8d4b7c7d1537cda21a7b138712256cf7c3a12199f12cfa145833d3b5",
  },
  {
    name: "createSourceOperation",
    oldRaw:
      'async function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(CONTROLLER_ADMITTED, "EXECUTION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = await fs.readFile(\n    path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n  );\n  bootstrapState(bootstrap);\n  const profile = JSON.parse(profileRaw);\n  const policyRaw = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.policy),\n  );\n  bootstrapState(bootstrap);\n  const policy = JSON.parse(policyRaw);\n  const workflow = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.workflow),\n  );\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n      policy.target === "aarch64-pc-windows-msvc" &&\n      process.env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&\n      process.env.GITHUB_REPOSITORY_ID === "1010282954" &&\n      process.env.GITHUB_REF === "refs/heads/main" &&\n      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&\n      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&\n      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),\n    "SOURCE_WORKFLOW_SCOPE",\n  );\n  need(\n    profile.nativeSourceEntryQualified === true &&\n      profile.sourceProgramCarryforwardQualified === true,\n    "SOURCE_NATIVE_UNQUALIFIED",\n  );\n  const selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  const environment = Object.freeze({\n    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const pythonRaw = await fs.readFile(profile.python.path);\n  bootstrapState(bootstrap);\n  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n  // The checked workflow is the origin of this accounting record. It cannot\n  // open either code gate or replace source/native qualification authority.\n  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");\n  const workflowClock = readWorkflowClock(\n    process.env[WORKFLOW_CLOCK_ENV],\n    process.env,\n    Date.now(),\n  );\n  const wholeLease = leases.get(owner.lease);\n  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);\n  bootstrapState(bootstrap);\n  const clockProbeMonoStart = performance.now();\n  // END FIRST WORKFLOW CLOCK INTERSECTION\n  const sample = await samplePythonClock(\n    bootstrap,\n    profile.python.path,\n    environment,\n  );\n  // BEGIN FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  const inheritedEnds = intersectWorkflowClock(\n    workflowClock,\n    sample.monotonic,\n    clockProbeMonoStart,\n    wholeLease,\n    Date.now(),\n    performance.now(),\n  );\n  wholeLease.wallEnd = inheritedEnds.wallEnd;\n  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    "windows-arm-full-sdk-" + randomUUID(),\n  );\n  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });\n  const state = {\n    bootstrap,\n    lease: owner.lease,\n    root,\n    rootFence: [],\n    owner: null,\n    ownerPath: path.join(root, "full-sdk-source-owner.bin"),\n    ownerIdentity: null,\n    rootIdentity: null,\n    closed: false,\n    failed: false,\n    primary: undefined,\n    issued: false,\n    pending: new Set(),\n    lateCleanups: new Set(),\n    readFds: new Set(),\n    logFds: new Set(),\n    pendingWriters: 0,\n    writeQueue: Promise.resolve(),\n    outputBytes: 0,\n    child: null,\n    creationJoined: false,\n    cleanupConfirmed: false,\n    sourceWallEnd: Math.min(\n      leases.get(owner.lease).wallEnd,\n      owner.wallStart + SOURCE_MS,\n    ),\n    sourceMonoEnd: Math.min(\n      leases.get(owner.lease).monoEnd,\n      owner.monoStart + SOURCE_MS,\n    ),\n  };\n  sourceOperations.set(token, state);\n  owner.operation = token;\n  try {\n    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));\n    for (let current = root; ; current = path.dirname(current)) {\n      const info = await operationWork(token, () =>\n        fs.lstat(current, { bigint: true }),\n      );\n      state.rootFence.unshift({\n        path: current,\n        identity: operationDirectoryId(info),\n      });\n      if (current === path.dirname(current)) break;\n    }\n    state.rootIdentity = directoryId(\n      await operationWork(token, () => fs.lstat(root, { bigint: true })),\n    );\n    state.owner = await operationWork(\n      token,\n      () =>\n        fs.open(\n          state.ownerPath,\n          constants.O_RDWR |\n            constants.O_CREAT |\n            constants.O_EXCL |\n            (constants.O_NOFOLLOW ?? 0),\n          0o600,\n        ),\n      (late) => late.close(),\n    );\n    await operationWork(token, () => state.owner.writeFile(randomBytes(32)));\n    state.ownerIdentity = fileId(\n      await operationWork(token, () => state.owner.stat({ bigint: true })),\n    );\n    for (const name of ["source-inputs", "tmp", "home"]) {\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.mkdir(path.join(root, name), { mode: 0o700 }),\n      );\n    }\n    need(\n      Array.isArray(policy.producerInputs) &&\n        policy.producerInputs.length > 0 &&\n        policy.producerInputs.length <= 128,\n      "SOURCE_INPUTS",\n    );\n    for (const [index, row] of policy.producerInputs.entries()) {\n      need(\n        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = await operationWork(token, () =>\n        fs.readFile(path.join(CONTROLLER_REPO, row.path)),\n      );\n      need(\n        raw.length === row.bytes &&\n          raw.length <= 2 * 1024 ** 2 &&\n          hashBytes(raw) === row.sha256,\n        "SOURCE_INPUT_PIN",\n      );\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const wholeRemaining =\n      Math.min(\n        leases.get(owner.lease).wallEnd - Date.now(),\n        leases.get(owner.lease).monoEnd - performance.now(),\n      ) / 1000;\n    const sourceRemaining =\n      Math.min(\n        state.sourceWallEnd - Date.now(),\n        state.sourceMonoEnd - performance.now(),\n      ) / 1000;\n    const acquisitionRemaining =\n      Math.min(\n        4500000 - (Date.now() - owner.wallStart),\n        4500000 - (performance.now() - owner.monoStart),\n        sourceRemaining * 1000,\n      ) / 1000;\n    const c = {\n      kind: "windows-arm-full-sdk-context",\n      mode: "full-sdk-source-gn",\n      workflow: profile.workflow,\n      policy: profile.policy,\n      ref: "refs/heads/main",\n      repository: "supermarsx/sortOfRemoteNG",\n      repositoryId: "1010282954",\n      event: "workflow_dispatch",\n      visibility: "public",\n      defaultBranch: "main",\n      inputs: {},\n      image: process.env.ImageVersion,\n      target: "aarch64-pc-windows-msvc",\n      sourceId: selected.id,\n      sourceProfileSha256: selected.profile,\n      head: process.env.GITHUB_SHA,\n      workflowSha: process.env.GITHUB_WORKFLOW_SHA,\n      runId: process.env.GITHUB_RUN_ID,\n      attempt: process.env.GITHUB_RUN_ATTEMPT,\n      sources: policy.producerInputs,\n      originPolicySha256: hashBytes(policyRaw),\n      wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,\n      monotonicWholeEnd: sample.monotonic + wholeRemaining,\n      wallWorkEnd: state.sourceWallEnd / 1000,\n      monotonicWorkEnd: sample.monotonic + sourceRemaining,\n      wallAcquisitionEnd:\n        Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n      monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n    };\n    need(\n      sourceRemaining > 150 && acquisitionRemaining > 150,\n      "SOURCE_ORIGINAL_BUDGET",\n    );\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n    );\n    const env = Object.freeze({\n      ...environment,\n      TEMP: path.join(root, "tmp"),\n      TMP: path.join(root, "tmp"),\n      USERPROFILE: path.join(root, "home"),\n    });\n    state.plan = Object.freeze({\n      executable: profile.python.path,\n      argv: Object.freeze([\n        "-I",\n        "-B",\n        path.join(CONTROLLER_HERE, "full_sdk_source.py"),\n        "--full-sdk-source-launcher",\n        root,\n        hashBytes(contextRaw),\n        "--execute",\n      ]),\n      environment: env,\n      image: c.image,\n      sourceId: selected.id,\n      profileSha256: selected.profile,\n      parentCreationFiletime: sample.parentCreationFiletime,\n      rootPins: Object.freeze([\n        {\n          relative: "context.json",\n          bytes: contextRaw.length,\n          sha256: hashBytes(contextRaw),\n        },\n        ...policy.producerInputs.map((row, index) => ({\n          relative: `source-inputs/${index}`,\n          bytes: row.bytes,\n          sha256: row.sha256,\n        })),\n        ...PATCHED_SOURCE_PINS,\n      ]),\n    });\n    await operationFence(token);\n    return token;\n  } catch (error) {\n    fail(state, error);\n    await retireSourceOperation(token);\n    throw state.primary;\n  }\n}',
    newRaw:
      'async function createSourceOperation(bootstrap) {\n  const owner = bootstrapState(bootstrap);\n  // Native/public activation is separate. No boolean/report can open this code gate.\n  need(CONTROLLER_ADMITTED, "EXECUTION_CLOSED");\n  need(!owner.operation, "BOOTSTRAP_REUSE");\n  const profileRaw = await fs.readFile(\n    path.join(CONTROLLER_HERE, "full-sdk-source-profile.json"),\n  );\n  bootstrapState(bootstrap);\n  const profile = JSON.parse(profileRaw);\n  const policyRaw = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.policy),\n  );\n  bootstrapState(bootstrap);\n  const policy = JSON.parse(policyRaw);\n  const workflow = await fs.readFile(\n    path.join(CONTROLLER_REPO, profile.workflow),\n  );\n  bootstrapState(bootstrap);\n  need(\n    workflow.length === policy.workflowPin.bytes &&\n      hashBytes(workflow) === policy.workflowPin.sha256 &&\n      policy.workflow === profile.workflow &&\n      policy.origin === "owned-windows-arm64-full-sdk" &&\n      policy.target === "aarch64-pc-windows-msvc" &&\n      process.env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&\n      process.env.GITHUB_REPOSITORY_ID === "1010282954" &&\n      process.env.GITHUB_REF === "refs/heads/main" &&\n      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&\n      process.env.GITHUB_SHA === process.env.GITHUB_WORKFLOW_SHA &&\n      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),\n    "SOURCE_WORKFLOW_SCOPE",\n  );\n  need(\n    profile.nativeSourceEntryQualified === true &&\n      profile.sourceProgramCarryforwardQualified === true,\n    "SOURCE_NATIVE_UNQUALIFIED",\n  );\n  const selected = sources[process.env.ImageVersion];\n  need(selected, "SOURCE_IMAGE");\n  const environment = Object.freeze({\n    SystemRoot: "C:/Windows",\n    WINDIR: "C:/Windows",\n    PATH: "C:/Windows/System32",\n    PYTHONDONTWRITEBYTECODE: "1",\n  });\n  const pythonRaw = await fs.readFile(profile.python.path);\n  bootstrapState(bootstrap);\n  need(\n    pythonRaw.length === profile.python.bytes &&\n      hashBytes(pythonRaw) === profile.python.sha256,\n    "SOURCE_PYTHON_PIN",\n  );\n  // BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n  // The checked workflow is the origin of this accounting record. It cannot\n  // open either code gate or replace source/native qualification authority.\n  need(!owner.workflowClock, "WORKFLOW_CLOCK_REUSE");\n  const workflowClock = readWorkflowClock(\n    process.env[WORKFLOW_CLOCK_ENV],\n    process.env,\n    Date.now(),\n  );\n  const wholeLease = leases.get(owner.lease);\n  wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);\n  bootstrapState(bootstrap);\n  const clockProbeMonoStart = performance.now();\n  // END FIRST WORKFLOW CLOCK INTERSECTION\n  const sample = await samplePythonClock(\n    bootstrap,\n    profile.python.path,\n    environment,\n  );\n  // BEGIN FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  const inheritedEnds = intersectWorkflowClock(\n    workflowClock,\n    sample.monotonic,\n    clockProbeMonoStart,\n    wholeLease,\n    Date.now(),\n    performance.now(),\n  );\n  wholeLease.wallEnd = inheritedEnds.wallEnd;\n  wholeLease.monoEnd = inheritedEnds.monoEnd;\n  owner.workflowClock = workflowClock;\n  bootstrapState(bootstrap);\n  // END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n  const root = path.join(\n    CONTROLLER_REPO,\n    ".artifacts",\n    "windows-arm-full-sdk-" + randomUUID(),\n  );\n  const token = Object.freeze({ kind: "closed-full-sdk-source-operation" });\n  const state = {\n    bootstrap,\n    lease: owner.lease,\n    root,\n    rootFence: [],\n    owner: null,\n    ownerPath: path.join(root, "full-sdk-source-owner.bin"),\n    ownerIdentity: null,\n    rootIdentity: null,\n    closed: false,\n    failed: false,\n    primary: undefined,\n    issued: false,\n    pending: new Set(),\n    lateCleanups: new Set(),\n    readFds: new Set(),\n    logFds: new Set(),\n    pendingWriters: 0,\n    writeQueue: Promise.resolve(),\n    outputBytes: 0,\n    child: null,\n    creationJoined: false,\n    cleanupConfirmed: false,\n    sourceWallEnd: Math.min(\n      leases.get(owner.lease).wallEnd,\n      owner.wallStart + SOURCE_MS,\n    ),\n    sourceMonoEnd: Math.min(\n      leases.get(owner.lease).monoEnd,\n      owner.monoStart + SOURCE_MS,\n    ),\n  };\n  sourceOperations.set(token, state);\n  owner.operation = token;\n  try {\n    await operationWork(token, () => fs.mkdir(root, { mode: 0o700 }));\n    for (let current = root; ; current = path.dirname(current)) {\n      const info = await operationWork(token, () =>\n        fs.lstat(current, { bigint: true }),\n      );\n      state.rootFence.unshift({\n        path: current,\n        identity: operationDirectoryId(info),\n      });\n      if (current === path.dirname(current)) break;\n    }\n    state.rootIdentity = directoryId(\n      await operationWork(token, () => fs.lstat(root, { bigint: true })),\n    );\n    state.owner = await operationWork(\n      token,\n      () =>\n        fs.open(\n          state.ownerPath,\n          constants.O_RDWR |\n            constants.O_CREAT |\n            constants.O_EXCL |\n            (constants.O_NOFOLLOW ?? 0),\n          0o600,\n        ),\n      (late) => late.close(),\n    );\n    await operationWork(token, () => state.owner.writeFile(randomBytes(32)));\n    state.ownerIdentity = fileId(\n      await operationWork(token, () => state.owner.stat({ bigint: true })),\n    );\n    for (const name of ["source-inputs", "tmp", "home"]) {\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.mkdir(path.join(root, name), { mode: 0o700 }),\n      );\n    }\n    need(\n      Array.isArray(policy.producerInputs) &&\n        policy.producerInputs.length > 0 &&\n        policy.producerInputs.length <= 128,\n      "SOURCE_INPUTS",\n    );\n    for (const [index, row] of policy.producerInputs.entries()) {\n      need(\n        typeof row.path === "string" &&\n          !path.isAbsolute(row.path) &&\n          row.path.split(/[\\\\/]/).every((x) => x && x !== "." && x !== ".."),\n        "SOURCE_INPUT_PATH",\n      );\n      const raw = await operationWork(token, () =>\n        fs.readFile(path.join(CONTROLLER_REPO, row.path)),\n      );\n      need(\n        raw.length === row.bytes &&\n          raw.length <= 2 * 1024 ** 2 &&\n          hashBytes(raw) === row.sha256,\n        "SOURCE_INPUT_PIN",\n      );\n      await operationFence(token);\n      await operationWork(token, () =>\n        fs.writeFile(path.join(root, "source-inputs", String(index)), raw, {\n          flag: "wx",\n        }),\n      );\n    }\n    const wholeRemaining =\n      Math.min(\n        leases.get(owner.lease).wallEnd - Date.now(),\n        leases.get(owner.lease).monoEnd - performance.now(),\n      ) / 1000;\n    const sourceRemaining =\n      Math.min(\n        state.sourceWallEnd - Date.now(),\n        state.sourceMonoEnd - performance.now(),\n      ) / 1000;\n    const acquisitionRemaining =\n      Math.min(\n        4500000 - (Date.now() - owner.wallStart),\n        4500000 - (performance.now() - owner.monoStart),\n        sourceRemaining * 1000,\n      ) / 1000;\n    const c = {\n      kind: "windows-arm-full-sdk-context",\n      mode: "full-sdk-source-gn",\n      workflow: profile.workflow,\n      policy: profile.policy,\n      ref: "refs/heads/main",\n      repository: "supermarsx/sortOfRemoteNG",\n      repositoryId: "1010282954",\n      event: "workflow_dispatch",\n      visibility: "public",\n      defaultBranch: "main",\n      inputs: {},\n      image: process.env.ImageVersion,\n      target: "aarch64-pc-windows-msvc",\n      sourceId: selected.id,\n      sourceProfileSha256: selected.profile,\n      head: process.env.GITHUB_SHA,\n      workflowSha: process.env.GITHUB_WORKFLOW_SHA,\n      runId: process.env.GITHUB_RUN_ID,\n      attempt: process.env.GITHUB_RUN_ATTEMPT,\n      sources: policy.producerInputs,\n      originPolicySha256: hashBytes(policyRaw),\n      wallWholeEnd: leases.get(owner.lease).wallEnd / 1000,\n      monotonicWholeEnd: sample.monotonic + wholeRemaining,\n      wallWorkEnd: state.sourceWallEnd / 1000,\n      monotonicWorkEnd: sample.monotonic + sourceRemaining,\n      wallAcquisitionEnd:\n        Math.min(state.sourceWallEnd, owner.wallStart + 4500000) / 1000,\n      monotonicAcquisitionEnd: sample.monotonic + acquisitionRemaining,\n    };\n    need(\n      sourceRemaining > 150 && acquisitionRemaining > 150,\n      "SOURCE_ORIGINAL_BUDGET",\n    );\n    const contextRaw = Buffer.from(JSON.stringify(c, null, 2) + "\\n");\n    await operationFence(token);\n    await operationWork(token, () =>\n      fs.writeFile(path.join(root, "context.json"), contextRaw, { flag: "wx" }),\n    );\n    const env = Object.freeze({\n      ...environment,\n      TEMP: path.join(root, "tmp"),\n      TMP: path.join(root, "tmp"),\n      USERPROFILE: path.join(root, "home"),\n    });\n    state.plan = Object.freeze({\n      executable: profile.python.path,\n      argv: Object.freeze([\n        "-I",\n        "-B",\n        path.join(CONTROLLER_HERE, "full_sdk_source.py"),\n        "--full-sdk-source-launcher",\n        root,\n        hashBytes(contextRaw),\n        "--execute",\n      ]),\n      environment: env,\n      image: c.image,\n      sourceId: selected.id,\n      profileSha256: selected.profile,\n      parentCreationFiletime: sample.parentCreationFiletime,\n      producerInputs: Object.freeze(\n        policy.producerInputs.map((row) => Object.freeze({ ...row })),\n      ),\n      rootPins: Object.freeze([\n        {\n          relative: "context.json",\n          bytes: contextRaw.length,\n          sha256: hashBytes(contextRaw),\n        },\n        ...policy.producerInputs.map((row, index) => ({\n          relative: `source-inputs/${index}`,\n          bytes: row.bytes,\n          sha256: row.sha256,\n        })),\n        ...PATCHED_SOURCE_PINS,\n      ]),\n    });\n    await operationFence(token);\n    return token;\n  } catch (error) {\n    fail(state, error);\n    await retireSourceOperation(token);\n    throw state.primary;\n  }\n}',
    oldSha256:
      "f61e45a79749b8730feb040a098ebe55a7d48804ac6f5f43f4d4fd08ccc6684d",
    newSha256:
      "0ca58973a59c724080a349d1356296fe7a7da9ab501b85b1dfcd6500d109aec3",
  },
];

const FIXED61_CLOCK_HISTORY = [
  {
    name: "verifySourceMetadata",
    oldRaw:
      'async function verifySourceMetadata(token) {\n  const state = operationState(token);\n  need(\n    state.creationJoined &&\n      !state.metadataSnapshot &&\n      state.readFds.size === 0 &&\n      state.logFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_METADATA_JOIN",\n  );\n  await operationFence(token);\n  operationState(token);\n  const records = [];\n  const read = async (relative, maximum, pin) => {\n    const record = await heldOperationFile(token, relative, maximum, pin);\n    operationState(token);\n    records.push(\n      Object.freeze({\n        relative,\n        maximum,\n        pin: Object.freeze({ ...record.pin }),\n        identity: record.identity,\n      }),\n    );\n    return record.raw;\n  };\n  const input = async (name) => {\n    const rows = state.plan.producerInputs;\n    need(\n      Array.isArray(rows) &&\n        rows.filter((row) => row.path === name).length === 1,\n      "SOURCE_METADATA_INPUT",\n    );\n    const index = rows.findIndex((row) => row.path === name),\n      row = rows[index];\n    return read("source-inputs/" + index, 65536, row);\n  };\n  const recipeRaw = await input(\n      "native/windows-arm-full-sdk/private-qualification-profile.json",\n    ),\n    candidateRaw = await input(\n      "native/windows-arm-full-sdk/engine-qualification-profile.json",\n    );\n  const recipe = parentMetadata_qualificationPolicy(\n    recipeRaw,\n    candidateRaw,\n  ).policy;\n  const selected = recipe.images[state.plan.image];\n  need(\n    selected &&\n      selected.sourceId === state.plan.sourceId &&\n      selected.profileSha256 === state.plan.profileSha256,\n    "SOURCE_METADATA_IMAGE",\n  );\n  const out = "source-checkout/src/out/Release_GN_arm64/",\n    logs = "private-qualification-logs/";\n  const pa = await read(logs + "qual-gn-desc-pa.stdout.log", 1048576),\n    cef = await read(logs + "qual-gn-desc-cef.stdout.log", 1048576),\n    evaluated = await read(logs + "qual-gn-args.stdout.log", 4194304),\n    args = await read(out + "args.gn", 1048576),\n    paHeader = await read(\n      out + recipe.generatedInputs[0].relativeOutput,\n      8 * 1024 ** 2,\n    ),\n    cefHeader = await read(\n      out + recipe.generatedInputs[1].relativeOutput,\n      8 * 1024 ** 2,\n    );\n  const originalArgs = state.graphSnapshot?.pins?.find(\n    (pin) => pin.path === "args.gn",\n  );\n  need(\n    originalArgs &&\n      originalArgs.bytes === args.length &&\n      originalArgs.sha256 === hashBytes(args),\n    "SOURCE_METADATA_GRAPH_ARGS",\n  );\n  const projected = parentMetadataProjection(\n      recipeRaw,\n      candidateRaw,\n      { pa, cef, evaluated, args, paHeader, cefHeader },\n      state.plan.sourceId,\n    ),\n    report = parentMetadata_qualificationBoundedJson(\n      await read("full-metadata-result.json", 131072),\n      131072,\n    );\n  need(\n    parentMetadata_staticProjectionEqual(report, projected),\n    "SOURCE_METADATA_REPORT",\n  );\n  await operationFence(token);\n  operationState(token);\n  need(\n    state.readFds.size === 0 &&\n      state.logFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_METADATA_FD_JOIN",\n  );\n  state.metadataSnapshot = Object.freeze({\n    records: Object.freeze(records),\n    projectionSha256: hashBytes(\n      Buffer.from(parentMetadata_qualificationCanonical(projected)),\n    ),\n    full61Qualified: false,\n  });\n}',
    newRaw:
      'async function verifySourceMetadata(token) {\n  const state = operationState(token);\n  need(\n    state.creationJoined &&\n      !state.metadataSnapshot &&\n      state.readFds.size === 0 &&\n      state.logFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_METADATA_JOIN",\n  );\n  await operationFence(token);\n  operationState(token);\n  state.operationToken = token;\n  const codeBinding = await expectedDefaultsCodeBinding(token);\n  operationState(token);\n  const records = [];\n  const read = async (relative, maximum, pin) => {\n    const record = await heldOperationFile(token, relative, maximum, pin);\n    operationState(token);\n    records.push(\n      Object.freeze({\n        relative,\n        maximum,\n        pin: Object.freeze({ ...record.pin }),\n        identity: record.identity,\n      }),\n    );\n    return record.raw;\n  };\n  const input = async (name) => {\n    const rows = state.plan.producerInputs;\n    need(\n      Array.isArray(rows) &&\n        rows.filter((row) => row.path === name).length === 1,\n      "SOURCE_METADATA_INPUT",\n    );\n    const index = rows.findIndex((row) => row.path === name),\n      row = rows[index];\n    return read("source-inputs/" + index, 65536, row);\n  };\n  const recipeRaw = await input(\n      "native/windows-arm-full-sdk/private-qualification-profile.json",\n    ),\n    candidateRaw = await input(\n      "native/windows-arm-full-sdk/engine-qualification-profile.json",\n    );\n  const recipe = parentMetadata_qualificationPolicy(\n    recipeRaw,\n    candidateRaw,\n  ).policy;\n  const selected = recipe.images[state.plan.image];\n  need(\n    selected &&\n      selected.sourceId === state.plan.sourceId &&\n      selected.profileSha256 === state.plan.profileSha256,\n    "SOURCE_METADATA_IMAGE",\n  );\n  const out = "source-checkout/src/out/Release_GN_arm64/",\n    logs = "private-qualification-logs/";\n  const pa = await read(logs + "qual-gn-desc-pa.stdout.log", 1048576),\n    cef = await read(logs + "qual-gn-desc-cef.stdout.log", 1048576),\n    evaluated = await read(logs + "qual-gn-args.stdout.log", 4194304),\n    args = await read(out + "args.gn", 1048576),\n    paHeader = await read(\n      out + recipe.generatedInputs[0].relativeOutput,\n      8 * 1024 ** 2,\n    ),\n    cefHeader = await read(\n      out + recipe.generatedInputs[1].relativeOutput,\n      8 * 1024 ** 2,\n    );\n  const originalArgs = state.graphSnapshot?.pins?.find(\n    (pin) => pin.path === "args.gn",\n  );\n  need(\n    originalArgs &&\n      originalArgs.bytes === args.length &&\n      originalArgs.sha256 === hashBytes(args),\n    "SOURCE_METADATA_GRAPH_ARGS",\n  );\n  const projected = parentMetadataProjection(\n      recipeRaw,\n      candidateRaw,\n      { pa, cef, evaluated, args, paHeader, cefHeader },\n      state.plan.sourceId,\n    ),\n    report = parentMetadata_qualificationBoundedJson(\n      await read("full-metadata-result.json", 131072),\n      131072,\n    );\n  need(\n    parentMetadata_staticProjectionEqual(report, projected),\n    "SOURCE_METADATA_REPORT",\n  );\n  await operationFence(token);\n  operationState(token);\n  need(\n    state.readFds.size === 0 &&\n      state.logFds.size === 0 &&\n      state.pendingWriters === 0,\n    "SOURCE_METADATA_FD_JOIN",\n  );\n  const matchedExpectedDefaults = expectedDefaultsFact(\n    state,\n    projected,\n    codeBinding,\n  );\n  operationState(token);\n  state.metadataSnapshot = Object.freeze({\n    matchedExpectedDefaults,\n    records: Object.freeze(records),\n    projectionSha256: hashBytes(\n      Buffer.from(parentMetadata_qualificationCanonical(projected)),\n    ),\n    full61Qualified: false,\n  });\n}',
    oldSha256:
      "dce5dd363bce7c8e133503dd8f9e8c28b383380e3fefa7192689a53e8d1f5963",
    newSha256:
      "f1f9c96694dcadb4e55f760c631470c1e488b5ea50ad91a2044bc73dddca5509",
  },
  {
    name: "recheckSourceMetadata",
    oldRaw:
      'async function recheckSourceMetadata(token, joinedAllowed) {\n  const state = operationState(token, joinedAllowed),\n    snapshot = state.metadataSnapshot;\n  if (!snapshot) return; // Initial graph check precedes the sole metadata issuer.\n  for (const row of snapshot.records) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum,\n      row.pin,\n      joinedAllowed,\n    );\n    operationState(token, joinedAllowed);\n    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");\n  }\n  await operationFence(token, joinedAllowed);\n}',
    newRaw:
      'async function recheckSourceMetadata(token, joinedAllowed) {\n  const state = operationState(token, joinedAllowed),\n    snapshot = state.metadataSnapshot;\n  if (!snapshot) return; // Initial graph check precedes the sole metadata issuer.\n  const fact = snapshot.matchedExpectedDefaults,\n    context = state.plan.rootPins.find(\n      (row) => row.relative === "context.json",\n    );\n  need(\n    fact &&\n      fact.contextSha256 === context?.sha256 &&\n      fact.image === state.plan.image &&\n      fact.sourceId === state.plan.sourceId &&\n      fact.full61Qualified === false,\n    "SOURCE_DEFAULTS_FACT_BINDING",\n  );\n  const binding = await expectedDefaultsCodeBinding(token, joinedAllowed);\n  operationState(token, joinedAllowed);\n  need(\n    binding.saved.identity === fact.binding.saved.identity &&\n      binding.live.identity === fact.binding.live.identity &&\n      binding.policySha256 === fact.binding.policySha256,\n    "SOURCE_DEFAULTS_BINDING_CHANGED",\n  );\n  for (const row of snapshot.records) {\n    const actual = await heldOperationFile(\n      token,\n      row.relative,\n      row.maximum,\n      row.pin,\n      joinedAllowed,\n    );\n    operationState(token, joinedAllowed);\n    need(actual.identity === row.identity, "SOURCE_METADATA_REPLACED");\n  }\n  await operationFence(token, joinedAllowed);\n}',
    oldSha256:
      "fa67d89e510002cc6817983c73ccf454770bb534f97515977d202843097c4993",
    newSha256:
      "0b37821b502611e1fbcb42d28ce4d151a5c7abb355e9d6d0d27d429e77c07cec",
  },
];
function fixed61ClockInverse(text) {
  const begin = "// BEGIN FIXED EXPECTED DEFAULTS BINDING\n",
    end = "// END FIXED EXPECTED DEFAULTS BINDING\n\n";
  assert.equal(text.split(begin).length, 2);
  assert.equal(text.split(end).length, 2);
  let old =
    text.slice(0, text.indexOf(begin)) +
    text.slice(text.indexOf(end) + end.length);
  const imported =
    'import * as expectedDefaults from "./expected-defaults.mjs";\n';
  assert.equal(old.split(imported).length, 2);
  old = old.replace(imported, "");
  for (const row of FIXED61_CLOCK_HISTORY) {
    assert.equal(
      createHash("sha256").update(row.newRaw).digest("hex"),
      row.newSha256,
    );
    assert.equal(old.split(row.newRaw).length, 2);
    old = old.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(
    createHash("sha256").update(old).digest("hex"),
    "88fb25fede8b99c89fa3b4b47e98eb2a987aa279c578cd22ab5af26329f165c7",
  );
  return old;
}

function parentEngineClockInverse(text) {
  const begin = "// BEGIN ACTUAL PARENT ENGINE CREATION\n",
    end = "// END ACTUAL PARENT ENGINE CREATION\n";
  assert.equal(text.split(begin).length, 2);
  assert.equal(text.split(end).length, 2);
  const start = text.indexOf(begin),
    finish = text.indexOf(end) + end.length,
    block = text.slice(start, finish);
  assert.equal(Buffer.byteLength(block), 18848);
  assert.equal(
    createHash("sha256").update(block).digest("hex"),
    "bca62938d2ade4babfafe2487dc949305852ed95a6572ee5e52bedcc596feb97",
  );
  const old = text.slice(0, start) + text.slice(finish + 1);
  assert.equal(Buffer.byteLength(old), 94614);
  assert.equal(
    createHash("sha256").update(old).digest("hex"),
    "fcf7c8e17f4258b89372da11cbafc4e283e53f3d11dfb0c1f16a934e35f56142",
  );
  return old;
}

function parentMetadataClockInverse(text) {
  text = parentEngineClockInverse(assemblyInverse(text, "controller"));
  text = fixed61ClockInverse(text);
  const begin = "\n// BEGIN PRIVATE PARENT METADATA VERIFICATION\n",
    end = "// END PRIVATE PARENT METADATA VERIFICATION\n\n";
  assert.equal(text.split(begin).length, 2);
  assert.equal(text.split(end).length, 2);
  let restored =
    text.slice(0, text.indexOf(begin)) +
    text.slice(text.indexOf(end) + end.length);
  for (const row of PARENT_METADATA_CLOCK_HISTORY) {
    assert.equal(
      createHash("sha256").update(row.newRaw).digest("hex"),
      row.newSha256,
    );
    assert.equal(
      createHash("sha256").update(row.oldRaw).digest("hex"),
      row.oldSha256,
    );
    assert.equal(restored.split(row.newRaw).length, 2);
    restored = restored.replace(row.newRaw, () => row.oldRaw);
  }
  assert.equal(Buffer.byteLength(restored), 61855);
  assert.equal(
    createHash("sha256").update(restored).digest("hex"),
    "a74f98f96aba8e63da8ca67021c16c761d57cb85b2f18e622ff5737adb3f5f02",
  );
  return restored;
}

const baseWall = 1793610000000;
function fixture() {
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-full-sdk.yml@refs/heads/main",
    GITHUB_JOB: "sdk",
    GITHUB_RUN_ID: "123456789",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: "1".repeat(40),
    GITHUB_WORKFLOW_SHA: "1".repeat(40),
    ImageVersion: "20261030.294.1",
  };
  const value = {
    schemaVersion: 1,
    kind: "windows-arm-first-workflow-clock",
    clock: "windows-gettickcount64",
    dotnetMajor: 10,
    wallStartMs: baseWall,
    wallEndMs: baseWall + WORKFLOW_WHOLE_MS,
    tickStartMs: 1000000,
    tickEndMs: 1000000 + WORKFLOW_WHOLE_MS,
    repository: env.GITHUB_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    ref: env.GITHUB_REF,
    event: env.GITHUB_EVENT_NAME,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    job: env.GITHUB_JOB,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    head: env.GITHUB_SHA,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    image: env.ImageVersion,
  };
  return { env, value };
}

test("workflow clock binds the exact whole-job origin and rejects missing foreign malformed or stale carriers", () => {
  const { env, value } = fixture();
  const valid = readWorkflowClock(
    JSON.stringify(value),
    env,
    baseWall + 3600000,
  );
  assert(Object.isFrozen(valid));
  const variants = [
    { ...value, unknown: true },
    { ...value, schemaVersion: 2 },
    { ...value, clock: "qpc" },
    { ...value, dotnetMajor: 11 },
    { ...value, dotnetMajor: 7 },
    { ...value, repositoryId: "8" },
    { ...value, job: "proof" },
    { ...value, ref: "refs/heads/foreign" },
    { ...value, runId: "123456788" },
    { ...value, attempt: "1" },
    { ...value, head: "2".repeat(40) },
    { ...value, image: "20261031.1.1" },
    { ...value, wallEndMs: value.wallEndMs + 1 },
    { ...value, tickEndMs: value.tickEndMs + 1 },
    { ...value, tickStartMs: 1.5 },
    { ...value, wallStartMs: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const invalid of variants)
    assert.throws(() =>
      readWorkflowClock(JSON.stringify(invalid), env, baseWall + 3600000),
    );
  for (const raw of [
    undefined,
    "",
    "{}",
    "null",
    "x".repeat(4097),
    JSON.stringify(value) + "\n",
  ])
    assert.throws(() => readWorkflowClock(raw, env, baseWall));
  for (const [key, bad] of [
    ["GITHUB_REPOSITORY_VISIBILITY", "private"],
    ["RUNNER_ENVIRONMENT", "self-hosted"],
    ["CEF_DEFAULT_BRANCH", "other"],
    ["GITHUB_ACTIONS", "false"],
  ])
    assert.throws(() =>
      readWorkflowClock(
        JSON.stringify(value),
        { ...env, [key]: bad },
        baseWall,
      ),
    );
  assert.throws(() =>
    readWorkflowClock(JSON.stringify(value), env, baseWall - 1),
  );
  assert.throws(() =>
    readWorkflowClock(JSON.stringify(value), env, value.wallEndMs - 150000),
  );
});

test("workflow clock consumes setup and probe latency and only intersects existing lease ends", () => {
  const { value } = fixture();
  const start = 1000,
    returned = 1400,
    age = 3600000;
  const sample = (value.tickStartMs + age) / 1000;
  const lease = {
    wallEnd: baseWall + age + WORKFLOW_WHOLE_MS,
    monoEnd: start + WORKFLOW_WHOLE_MS,
  };
  const result = intersectWorkflowClock(
    value,
    sample,
    start,
    lease,
    baseWall + age + 400,
    returned,
  );
  assert.equal(result.wallEnd, value.wallEndMs);
  assert.equal(result.monoEnd, start + WORKFLOW_WHOLE_MS - age);
  assert(result.monoEnd < returned + WORKFLOW_WHOLE_MS - age);
  assert.equal(lease.monoEnd, start + WORKFLOW_WHOLE_MS);
  const smaller = intersectWorkflowClock(
    value,
    sample,
    start,
    { wallEnd: baseWall + age + 1000000, monoEnd: 2000000 },
    baseWall + age,
    returned,
  );
  assert.equal(smaller.wallEnd, baseWall + age + 1000000);
  assert.equal(smaller.monoEnd, 2000000);
  for (const tick of [
    value.tickStartMs - 1,
    value.tickEndMs - 150000,
    value.tickEndMs,
    Infinity,
    NaN,
  ])
    assert.throws(() =>
      intersectWorkflowClock(
        value,
        tick / 1000,
        start,
        lease,
        baseWall + age,
        returned,
      ),
    );
  assert.throws(() =>
    intersectWorkflowClock(
      value,
      sample + 0.0001,
      start,
      lease,
      baseWall + age,
      returned,
    ),
  );
  assert.throws(() =>
    intersectWorkflowClock(
      value,
      sample,
      returned + 1,
      lease,
      baseWall + age,
      returned,
    ),
  );
  // A wall rollback cannot restore an already elapsed monotonic whole budget.
  assert.throws(() =>
    intersectWorkflowClock(
      value,
      (value.tickEndMs + 1) / 1000,
      start,
      lease,
      baseWall + 1,
      returned,
    ),
  );
});

test("native-first capture preserves a scheduling gap even after wall rollback", () => {
  const { env, value } = fixture();
  const gap = 5000,
    elapsed = 11000,
    rollback = 5000;
  const wallNow = baseWall + elapsed - rollback;
  const lease = {
    wallEnd: baseWall + WORKFLOW_WHOLE_MS,
    monoEnd: 1000 + WORKFLOW_WHOLE_MS,
  };
  const oldWallFirst = {
    ...value,
    tickStartMs: value.tickStartMs + gap,
    tickEndMs: value.tickEndMs + gap,
  };
  const correctedNativeFirst = {
    ...value,
    wallStartMs: baseWall + gap,
    wallEndMs: baseWall + gap + WORKFLOW_WHOLE_MS,
  };
  const sample = (value.tickStartMs + elapsed) / 1000;
  const old = intersectWorkflowClock(
    readWorkflowClock(JSON.stringify(oldWallFirst), env, wallNow),
    sample,
    1000,
    lease,
    wallNow,
    1000,
  );
  const corrected = intersectWorkflowClock(
    readWorkflowClock(JSON.stringify(correctedNativeFirst), env, wallNow),
    sample,
    1000,
    lease,
    wallNow,
    1000,
  );
  assert.equal(old.monoEnd - 1000, WORKFLOW_WHOLE_MS - elapsed + gap);
  assert.equal(corrected.monoEnd - 1000, WORKFLOW_WHOLE_MS - elapsed);
  assert.equal(old.monoEnd - corrected.monoEnd, gap);
});

test(
  "the actual PowerShell first-step body captures the native clock before any scope or output work",
  { skip: process.platform !== "win32" },
  async () => {
    const { env } = fixture();
    const root = await mkdtemp(path.join(os.tmpdir(), "full-sdk-clock-"));
    try {
      const script = path.join(root, "capture.ps1"),
        output = path.join(root, "env.txt");
      await writeFile(script, FIRST_WORKFLOW_CLOCK_STEP);
      const args = [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        script,
      ];
      const before = Date.now();
      execFileSync("pwsh", args, {
        env: { ...process.env, ...env, GITHUB_ENV: output },
        windowsHide: true,
        timeout: 10000,
      });
      const after = Date.now();
      const line = (await readFile(output, "utf8")).trimEnd();
      assert(line.startsWith(WORKFLOW_CLOCK_ENV + "="));
      const value = readWorkflowClock(
        line.slice(WORKFLOW_CLOCK_ENV.length + 1),
        env,
        after,
      );
      assert(value.wallStartMs >= before && value.wallStartMs <= after);
      assert(value.tickStartMs > 0);
      assert.equal(value.tickEndMs - value.tickStartMs, WORKFLOW_WHOLE_MS);
      assert(
        FIRST_WORKFLOW_CLOCK_STEP.startsWith(
          "$fullSdkTickStart = [Environment]::TickCount64\n$fullSdkWallStart = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n",
        ),
      );
      assert(!FIRST_WORKFLOW_CLOCK_STEP.includes("Stopwatch"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("actual controller intersects the first-step lease before source creation while admitting only the reviewed qualification attempt", async () => {
  const text = (
    await readFile("native/windows-arm-full-sdk/full_sdk_control.mjs", "utf8")
  ).replaceAll("\r\n", "\n");
  assert(text.includes("const CONTROLLER_ADMITTED = false;"));
  assert(
    text.indexOf("const clockProbeMonoStart = performance.now();") <
      text.indexOf("const sample = await samplePythonClock("),
  );
  assert(
    text.indexOf("wholeLease.monoEnd = inheritedEnds.monoEnd;") <
      text.indexOf(
        "fullSdkSourceRootName(process.env.ImageVersion, selected.id)",
      ),
  );
  assert(
    text.includes(
      "wholeLease.wallEnd = Math.min(wholeLease.wallEnd, workflowClock.wallEndMs);",
    ),
  );
  assert(text.includes("owner.wallStart + SOURCE_MS"));
  assert(text.includes("owner.monoStart + SOURCE_MS"));
  assert(
    text.includes("ACQUISITION_MS - (performance.now() - owner.monoStart)"),
  );
  const old = parentMetadataClockInverse(text)
    .replace(
      /import \{\n  WORKFLOW_CLOCK_ENV,[\s\S]*?\} from "\.\/workflow-clock.mjs";\n/,
      "",
    )
    .replace(
      /  \/\/ BEGIN FIRST WORKFLOW CLOCK INTERSECTION\n[\s\S]*?  \/\/ END FIRST WORKFLOW CLOCK INTERSECTION\n/,
      "",
    )
    .replace(
      /  \/\/ BEGIN FIRST WORKFLOW CLOCK NATIVE PROJECTION\n[\s\S]*?  \/\/ END FIRST WORKFLOW CLOCK NATIVE PROJECTION\n/,
      "",
    );
  assert.equal(Buffer.byteLength(old), 60698);
  assert.equal(
    createHash("sha256").update(old).digest("hex"),
    "bbb1e7bfdd3aaa56c745940ddba1856fb02b40ddb135b6e1266f405e3ba94db1",
  );
});

test("actual failed-run carrier needs the workflow's bound public visibility without changing either original endpoint", async () => {
  // Actual41494694866 carrier data only: no execution/issuer qualification.
  const raw =
    '{"schemaVersion":1,"kind":"windows-arm-first-workflow-clock","clock":"windows-gettickcount64","dotnetMajor":10,"wallStartMs":1793641809611,"tickStartMs":132703,"wallEndMs":1793663409611,"tickEndMs":21732703,"repository":"supermarsx/sortOfRemoteNG","repositoryId":"1010282954","ref":"refs/heads/main","event":"workflow_dispatch","runId":"41494694866","attempt":"1","head":"48a0ba7bbbe2f3c8a2e7e60644d824da18193856","workflowSha":"48a0ba7bbbe2f3c8a2e7e60644d824da18193856","workflowRef":"supermarsx/sortOfRemoteNG/.github/workflows/windows-arm-full-sdk.yml@refs/heads/main","job":"sdk","image":"20261030.294.1"}';
  const carrier = JSON.parse(raw),
    env = {
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      CEF_DEFAULT_BRANCH: "main",
    };
  const fields = {
    repository: "GITHUB_REPOSITORY",
    repositoryId: "GITHUB_REPOSITORY_ID",
    ref: "GITHUB_REF",
    event: "GITHUB_EVENT_NAME",
    workflowRef: "GITHUB_WORKFLOW_REF",
    job: "GITHUB_JOB",
    runId: "GITHUB_RUN_ID",
    attempt: "GITHUB_RUN_ATTEMPT",
    head: "GITHUB_SHA",
    workflowSha: "GITHUB_WORKFLOW_SHA",
    image: "ImageVersion",
  };
  for (const [field, name] of Object.entries(fields))
    env[name] = carrier[field];
  const now = Date.parse("2026-11-02T17:50:39.037Z");
  assert.throws(
    () => readWorkflowClock(raw, env, now),
    /FULL_SDK_WORKFLOW_CLOCK_HOST/,
  );
  const workflow = (
    await readFile(".github/workflows/windows-arm-full-sdk.yml", "utf8")
  ).replaceAll("\r\n", "\n");
  const binding =
    "      GITHUB_REPOSITORY_VISIBILITY: ${{ github.event.repository.visibility }}\n";
  assert.equal(workflow.split(binding).length, 2);
  assert(workflow.indexOf(binding) < workflow.indexOf("    steps:"));
  assert(workflow.includes("github.event.repository.visibility == 'public'"));
  const accepted = readWorkflowClock(
    raw,
    { ...env, GITHUB_REPOSITORY_VISIBILITY: "public" },
    now,
  );
  assert.equal(accepted.wallEndMs, carrier.wallEndMs);
  assert.equal(accepted.tickEndMs, carrier.tickEndMs);
  assert.equal(accepted.wallEndMs - accepted.wallStartMs, 21600000);
  assert.equal(accepted.tickEndMs - accepted.tickStartMs, 21600000);
  for (const value of [
    undefined,
    "",
    "private",
    "Public",
    "public\n",
    "public\u0000",
  ])
    assert.throws(
      () =>
        readWorkflowClock(
          raw,
          { ...env, GITHUB_REPOSITORY_VISIBILITY: value },
          now,
        ),
      /FULL_SDK_WORKFLOW_CLOCK_HOST/,
    );
});
