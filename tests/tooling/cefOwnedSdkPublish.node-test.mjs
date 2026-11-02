import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { identitySha256 } from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { inflateSync } from "node:zlib";
import {
  ENGINEERING_PRODUCER,
  ENGINEERING_PRODUCERS,
  ENGINEERING_REVIEW_KIND,
  validateEngineeringReview,
  readCommittedPublicationReview,
  verifyEngineeringCompletion,
  publishEngineeringSdk,
  engineeringPublicationArguments,
} from "../../native/cef-engineering-sdk-publication/publish.mjs";
import {
  nativeCodeTreeDigest,
  validatePublicationReview,
  readPublicationReview,
  verifyNativeAcceptanceMetadata,
  verifyNativeAcceptanceSeal,
  verifyOwnedPublication,
  publishOwnedSdk,
  rawAcceptanceSealSha,
  publicationPythonOptions,
  publicationApi,
  publicationAuthority,
  privatePublicationOutput,
  PUBLICATION_WORKFLOW,
} from "../../scripts/lib/cef-owned-sdk-publish.mjs";
import {
  publicationArguments,
  verifiedPublicationKey,
} from "../../scripts/cef-owned-sdk-publish.mjs";
import {
  createAcceptanceSeal,
  HTTP2_CHECKS,
  NATIVE_TARGETS,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";
import {
  canonical,
  archiveCommand,
  checkpointProfile,
  codeTreeDigest,
  createSdkCompletion,
  completionSha,
  sdkNames,
  sdkSealName,
  apiClient,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const repository = "supermarsx/sortOfRemoteNG";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const copy = (value) => structuredClone(value);
const workflow = ".github/workflows/cef-runtime-acceptance.yml";

test("publication output key accepts both truthful Windows ARM sources and retains the closed existing targets", () => {
  const sources = [
    "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
  ];
  for (const source of sources) {
    const key = source + "-aarch64-pc-windows-msvc";
    assert.equal(verifiedPublicationKey(key), key);
  }
  for (const target of ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]) {
    const key = "a".repeat(64) + "-" + target;
    assert.equal(verifiedPublicationKey(key), key);
  }
  for (const key of [
    null,
    undefined,
    123,
    {},
    "a".repeat(63) + "-aarch64-pc-windows-msvc",
    "A".repeat(64) + "-aarch64-pc-windows-msvc",
    "a".repeat(64) + "-aarch64-unknown-linux-gnu",
    "a".repeat(64) + "-x86_64-apple-darwin",
    "a".repeat(64) + "-aarch64-pc-windows-msvc-extra",
    "a".repeat(64) + "-aarch64-pc-windows-msvc\nkey=forged",
    "prefix-" + sources[0] + "-aarch64-pc-windows-msvc",
  ])
    assert.throws(
      () => verifiedPublicationKey(key),
      /Invalid immutable publication key/,
    );
});

const legacyLockRaw = readFileSync(
  new URL(
    "../../native/cef-build-inputs/20261023-registration-retirement-lf/source-lock.json",
    import.meta.url,
  ),
);
const legacyLock = JSON.parse(legacyLockRaw);
const modernLockRaw = readFileSync(
  new URL(
    "../../native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64/source-lock.json",
    import.meta.url,
  ),
);
const modernLock = JSON.parse(modernLockRaw);
function fixture(lock = legacyLock) {
  // Synthetic transport/serialization data. Never a native acceptance claim.
  const producer = {
    target: "x86_64-pc-windows-msvc",
    producer: "owned-import",
    runId: 41,
    runAttempt: 2,
    headSha: "a".repeat(40),
    artifactId: 42,
    artifactSha256: "b".repeat(64),
    descriptorSha256: "c".repeat(64),
    completionSha256: "d".repeat(64),
    reviewedImport: "native/cef-owned-sdk-imports/test/review.json",
    reviewSha256: "e".repeat(64),
  };
  const tree = {
    sha: "1".repeat(40),
    truncated: false,
    tree: [
      {
        mode: "100644",
        type: "blob",
        sha: "2".repeat(40),
        path: "scripts/native-acceptance.mjs",
      },
    ],
  };
  const code = {
    sourceTree: tree.sha,
    codeSha256: nativeCodeTreeDigest(tree),
    codeDigestFormat: "git-ls-tree-r-z-sha256-v1",
  };
  const execution = {
    repository,
    repositoryId: 11,
    runId: 101,
    runAttempt: 3,
    sourceSha: "f".repeat(40),
    workflow,
    ref: "refs/heads/Main",
    event: "workflow_dispatch",
    workflowRef: `${repository}/${workflow}@refs/heads/Main`,
  };
  const result = {
    schemaVersion: 1,
    kind: "sorng-cef-native-acceptance-run",
    target: producer.target,
    producer: { ...producer, sourceLockIdentity: identitySha256(lock) },
    ingestion: "operator-reviewed-local-bytes",
    hostedBuild: false,
    acceptanceSourceSha: execution.sourceSha,
    acceptanceWorkflowRunId: execution.runId,
    nativeHost: { platform: "win32", architecture: "x64" },
    sourceLockIdentity: identitySha256(lock),
    descriptorSha256: producer.descriptorSha256,
    reports: [
      { suite: "tls", accepted: true, reportSha256: hash("tls") },
      ...HTTP2_CHECKS.map((check) => ({
        suite: "http2",
        check,
        accepted: true,
        reportSha256: hash(check),
      })),
    ],
    builds: ["tls", "http2"].map((suite) => ({
      suite,
      clientSha256: hash(suite),
      cargoLockSha256: hash(`lock-${suite}`),
    })),
    ok: true,
    nativeExecutionPerformed: true,
    publicProviderAcceptance: false,
    productionReady: false,
    publicationAllowed: false,
  };
  if (lock.bridge.patchId === "sorng-tls-v2-682c378-5") {
    result.schemaVersion = 2;
    result.bridgePatchId = lock.bridge.patchId;
    result.capabilities = ["tls", "http2", "http3"];
    result.reports.push(
      ...[
        "multiplex",
        "deny",
        "delay",
        "revoke",
        "isolation",
        "cross-authority",
        "h2-fallback",
        "h1-fallback",
      ].map((check) => ({
        suite: "http3",
        check,
        accepted: true,
        reportSha256: hash(`http3-${check}`),
      })),
    );
    result.builds.push({
      suite: "http3",
      clientSha256: hash("http3"),
      cargoLockSha256: hash("lock-http3"),
    });
  }
  const reportSha = hash(JSON.stringify(result));
  const seal = createAcceptanceSeal(result, {
    execution,
    code,
    reportSha256: reportSha,
    sourceLock: lock,
  });
  const review = {
    schemaVersion: 1,
    kind: "sorng-cef-owned-publication-review",
    target: producer.target,
    sourceLockIdentity: result.sourceLockIdentity,
    descriptorSha256: producer.descriptorSha256,
    producer,
    acceptance: {
      runId: 101,
      runAttempt: 3,
      headSha: execution.sourceSha,
      sourceTree: tree.sha,
      codeSha256: code.codeSha256,
      artifactId: 102,
      artifactSha256: "7".repeat(64),
      sealSha256: hash(JSON.stringify(seal, null, 2)),
      nativeReportSha256: reportSha,
    },
  };
  const repo = {
    id: 11,
    full_name: repository,
    private: false,
    default_branch: "Main",
  };
  const run = {
    id: 101,
    run_attempt: 3,
    head_sha: execution.sourceSha,
    head_branch: "Main",
    workflow_id: 12,
    path: workflow,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    repository: { id: 11, full_name: repository },
    head_repository: { id: 11, full_name: repository },
  };
  const artifact = {
    id: 102,
    name: `cef-native-acceptance-seal-${review.target}-101-3`,
    expired: false,
    digest: `sha256:${review.acceptance.artifactSha256}`,
    size_in_bytes: 200,
    workflow_run: { id: 101, head_sha: execution.sourceSha },
  };
  const routes = {
    "": repo,
    "actions/workflows/cef-runtime-acceptance.yml": { id: 12, path: workflow },
    "actions/runs/101": run,
    "actions/artifacts/102": artifact,
    [`git/commits/${execution.sourceSha}`]: {
      sha: execution.sourceSha,
      tree: { sha: tree.sha },
    },
    [`git/trees/${tree.sha}?recursive=1`]: tree,
  };
  const api = async (route) => {
    assert.ok(Object.hasOwn(routes, route), route);
    return copy(routes[route]);
  };
  return { producer, tree, seal, review, repo, run, artifact, routes, api };
}

async function temp(t, prefix) {
  const parent = await realpath(os.tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, prefix)));
  const original = await lstat(root);
  assert.equal(path.dirname(root), parent);
  assert.ok(path.basename(root).startsWith(prefix));
  t.after(async () => {
    const current = await lstat(root);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, original.dev);
    assert.equal(current.ino, original.ino);
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("publication review is closed owned-only exact source, producer, acceptance attempt and independent pins", () => {
  const { review } = fixture();
  assert.equal(validatePublicationReview(review), review);
  for (const mutate of [
    (v) => {
      v.productionReady = true;
    },
    (v) => {
      delete v.producer.producer;
    },
    (v) => {
      v.producer.producer = "engineering-sdk";
    },
    (v) => {
      v.target = "aarch64-apple-darwin";
    },
    (v) => {
      v.descriptorSha256 = "b".repeat(64);
    },
    (v) => {
      v.acceptance.runAttempt = 0;
    },
    (v) => {
      v.acceptance.artifactSha256 = "0".repeat(64);
    },
    (v) => {
      v.acceptance.runId = Number.MAX_SAFE_INTEGER + 1;
    },
    (v) => {
      v.acceptance.url = "https://attacker.invalid/";
    },
  ]) {
    const value = copy(review);
    mutate(value);
    assert.throws(() => validatePublicationReview(value));
  }
  assert.throws(() =>
    publicationArguments([
      "publish",
      "--reviewed",
      "../outside.json",
      "--review-sha256",
      "a".repeat(64),
      "--execute",
    ]),
  );
  const args = [
    "--reviewed",
    "native/cef-owned-sdk-imports/test/publication.json",
    "--review-sha256",
    "a".repeat(64),
  ];
  assert.equal(publicationArguments(["verify", ...args]).mode, "verify");
  assert.throws(() => publicationArguments(["publish", ...args]));
  assert.throws(() => publicationArguments(["verify", ...args, "--execute"]));
  assert.throws(() =>
    publicationArguments(["publish", ...args, "--execute", "--execute"]),
  );
});

test("review authority is the exact raw regular Git blob at a clean commit, not a local or untracked file", async (t) => {
  const root = await temp(t, "cef-publication-review-");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  const relative = "native/cef-owned-sdk-imports/test/publication.json";
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  const { review } = fixture();
  const bytes = JSON.stringify(review, null, 2) + "\n";
  await writeFile(path.join(root, relative), bytes);
  await assert.rejects(
    readPublicationReview(root, relative, hash(bytes), "a".repeat(40)),
  );
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "fixture",
  );
  const head = git("rev-parse", "HEAD").trim();
  assert.deepEqual(
    await readPublicationReview(root, relative, hash(bytes), head),
    review,
  );
  await assert.rejects(
    readPublicationReview(root, relative, "a".repeat(64), head),
    /raw digest/,
  );
  await assert.rejects(
    readPublicationReview(root, relative, hash(bytes), "a".repeat(40)),
    /Clean committed/,
  );
  await writeFile(path.join(root, relative), bytes + " ");
  await assert.rejects(
    readPublicationReview(root, relative, hash(bytes), head),
    /Clean committed/,
  );
});

test("native code identity exactly matches real Git ls-tree bytes including Gitlinks, executable and symlink modes and UTF8 ordering", async (t) => {
  const root = await temp(t, "cef-publication-git-");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { windowsHide: true });
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  for (const name of ["a/c", "a.b", "a-z", "é/file", "Ω", "😀", "run.sh"]) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), `fixture ${name}\n`);
  }
  git("add", ".");
  git("update-index", "--chmod=+x", "run.sh");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "fixture",
  );
  const first = git("rev-parse", "HEAD").toString().trim();
  const blob = git("rev-parse", "HEAD:a.b").toString().trim();
  git("update-index", "--add", "--cacheinfo", "160000", first, "submodule");
  git("update-index", "--add", "--cacheinfo", "120000", blob, "symbolic");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "mode fixtures",
  );
  const entries = git("ls-tree", "-r", "-t", "-z", "HEAD")
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf("\t"),
        [mode, type, object] = row.slice(0, tab).split(" ");
      return { mode, type, sha: object, path: row.slice(tab + 1) };
    });
  const expected = hash(git("ls-tree", "-r", "-z", "--full-tree", "HEAD"));
  assert.equal(
    nativeCodeTreeDigest({ truncated: false, tree: entries.reverse() }),
    expected,
  );
  assert.throws(() => nativeCodeTreeDigest({ truncated: true, tree: entries }));
  const duplicate = [...entries, entries[0]];
  assert.throws(() =>
    nativeCodeTreeDigest({ truncated: false, tree: duplicate }),
  );
  for (const patch of [
    { mode: "100600" },
    { mode: "160000", type: "blob" },
    { path: "../escape" },
    { path: "\ud800" },
  ])
    assert.throws(() =>
      nativeCodeTreeDigest({
        truncated: false,
        tree: [{ ...entries.find((v) => v.type === "blob"), ...patch }],
      }),
    );
});

test("independent native metadata allows an approved historical head and rejects changed attempts, failed jobs, foreign repositories and code", async () => {
  const f = fixture();
  assert.equal(
    (await verifyNativeAcceptanceMetadata(f.api, f.review)).repo.id,
    11,
  );
  const mutations = [
    ["actions/runs/101", { run_attempt: 4 }],
    ["actions/runs/101", { conclusion: "failure" }],
    ["actions/runs/101", { status: "in_progress" }],
    ["actions/runs/101", { event: "pull_request" }],
    ["actions/runs/101", { path: ".github/workflows/cef-patched-runtime.yml" }],
    ["actions/runs/101", { head_branch: "unreviewed" }],
    ["actions/runs/101", { head_sha: "a".repeat(40) }],
    [
      "actions/runs/101",
      { head_repository: { id: 99, full_name: repository } },
    ],
    ["actions/workflows/cef-runtime-acceptance.yml", { id: 99 }],
    ["actions/artifacts/102", { expired: true }],
    ["actions/artifacts/102", { name: f.artifact.name.replace("-3", "-4") }],
    ["actions/artifacts/102", { digest: `sha256:${"a".repeat(64)}` }],
    ["actions/artifacts/102", { size_in_bytes: 1024 ** 2 }],
    [
      `git/commits/${f.review.acceptance.headSha}`,
      { tree: { sha: "a".repeat(40) } },
    ],
    [`git/trees/${f.tree.sha}?recursive=1`, { truncated: true }],
    [
      `git/trees/${f.tree.sha}?recursive=1`,
      { tree: [{ ...f.tree.tree[0], sha: "a".repeat(40) }] },
    ],
  ];
  for (const [route, patch] of mutations) {
    const current = fixture();
    Object.assign(current.routes[route], patch);
    await assert.rejects(
      verifyNativeAcceptanceMetadata(current.api, current.review),
    );
  }
});

test("native seal cannot substitute another producer/attempt/source, drop security cases or claim hosted or production acceptance", () => {
  const f = fixture();
  assert.equal(verifyNativeAcceptanceSeal(f.seal, f.review, f.repo), f.seal);
  for (const mutate of [
    (s) => {
      s.nativeAcceptance = false;
    },
    (s) => {
      s.productionReady = true;
    },
    (s) => {
      s.hostedBuild = true;
    },
    (s) => {
      s.execution.runAttempt++;
    },
    (s) => {
      s.execution.sourceTree = "a".repeat(40);
    },
    (s) => {
      s.execution.codeSha256 = "b".repeat(64);
    },
    (s) => {
      s.execution.repositoryId++;
    },
    (s) => {
      s.producer.runAttempt++;
    },
    (s) => {
      s.nativeHost.architecture = "arm64";
    },
    (s) => {
      s.sourceLockIdentity = "a".repeat(64);
    },
    (s) => {
      s.reports.pop();
    },
    (s) => {
      s.reports[8] = s.reports[7];
    },
    (s) => {
      s.reports[2].accepted = false;
    },
    (s) => {
      s.builds.pop();
    },
    (s) => {
      s.report.sha256 = "a".repeat(64);
    },
  ]) {
    const seal = copy(f.seal);
    mutate(seal);
    assert.throws(() => verifyNativeAcceptanceSeal(seal, f.review, f.repo));
  }
});

async function flow(t, lock = legacyLock) {
  const root = await temp(t, "cef-publication-flow-");
  const f = fixture(lock),
    events = [];
  const completion = {
    hostedBuild: false,
    reviewSha256: f.producer.reviewSha256,
  };
  const options = {
    review: f.review,
    api: f.api,
    ownedApi: async () => {
      throw new Error("unexpected owned route");
    },
    token: "SENTINEL_PARENT_TOKEN",
    destination: path.join(root, "verify"),
    python: path.join(root, "python"),
    commit: "8".repeat(40),
  };
  const dependencies = {
    readOwnedReview: async () => ({
      target: f.review.target,
      sourceLockIdentity: f.review.sourceLockIdentity,
      descriptorSha256: f.review.descriptorSha256,
    }),
    download: async (repo, token, route) => {
      events.push("download-seal");
      assert.equal(repo, repository);
      assert.equal(token, options.token);
      assert.equal(route, "/actions/artifacts/102/zip");
    },
    extract: async (python, helper, args, limits) => {
      events.push("extract");
      assert.equal(args[0], "seal");
      assert.equal(limits.timeout, 15000);
      assert.ok(helper.endsWith("cef-checkpoint-archive.py"));
      return copy(f.seal);
    },
    rawSealSha: () => f.review.acceptance.sealSha256,
    downloadImport: async (_api, input) => {
      events.push("download-import");
      assert.deepEqual(input.selection, f.producer);
      await mkdir(input.destination);
      await writeFile(
        path.join(input.destination, "source-lock.json"),
        lock === modernLock ? modernLockRaw : legacyLockRaw,
      );
      return copy(completion);
    },
    verifyBundle: async () => {
      events.push("rehash-five-assets");
      return {
        descriptor: {
          target: f.review.target,
          sourceLock: {
            path: "source-lock.json",
            size: (lock === modernLock ? modernLockRaw : legacyLockRaw).length,
            sha256: hash(lock === modernLock ? modernLockRaw : legacyLockRaw),
          },
        },
        descriptorSha256: f.review.descriptorSha256,
        identity: {
          sourceLockSha256: f.review.sourceLockIdentity,
          key: `${f.review.sourceLockIdentity}-${f.review.target}`,
        },
      };
    },
    recheckImport: async () => {
      events.push("recheck-import");
    },
    beforePublish: async () => {
      events.push("fresh-controller-check");
    },
    publish: async (input) => {
      events.push("publish");
      assert.equal(input.commit, options.commit);
      assert.equal(input.repository, repository);
      assert.equal(input.execute, true);
      return { productionReady: false, prerelease: true };
    },
  };
  return { ...f, options, dependencies, events, root };
}

test("protected execution freshly reauthenticates both chains and rehashes bytes before immutable publication", async (t) => {
  const f = await flow(t);
  const result = await publishOwnedSdk(f.options, {}, f.dependencies);
  assert.deepEqual(f.events, [
    "download-seal",
    "extract",
    "download-import",
    "rehash-five-assets",
    "recheck-import",
    "fresh-controller-check",
    "publish",
  ]);
  assert.equal(result.hostedBuild, false);
  assert.equal(result.originalBuildReplayed, false);
  assert.equal(result.productionReady, false);
  assert.equal(result.nativeAcceptance.headSha, f.review.acceptance.headSha);
  assert.notEqual(f.options.commit, f.review.acceptance.headSha);
});

test("revision-five publication binds all seventeen native reports to the actual verified source and denies historical downgrade", async (t) => {
  const f = fixture(modernLock);
  assert.equal(
    verifyNativeAcceptanceSeal(f.seal, f.review, f.repo, modernLock),
    f.seal,
  );
  assert.throws(
    () => verifyNativeAcceptanceSeal(f.seal, f.review, f.repo),
    /verified producer/,
  );
  assert.throws(
    () => verifyNativeAcceptanceSeal(f.seal, f.review, f.repo, legacyLock),
    /verified producer/,
  );
  const downgrade = structuredClone(f.seal);
  downgrade.schemaVersion = 1;
  delete downgrade.capabilities;
  delete downgrade.bridgePatchId;
  downgrade.reports = downgrade.reports.slice(0, 9);
  downgrade.builds.pop();
  assert.throws(
    () => verifyNativeAcceptanceSeal(downgrade, f.review, f.repo, modernLock),
    /verified producer/,
  );
  const wrongCapability = structuredClone(f.seal);
  wrongCapability.capabilities = ["tls", "http2"];
  assert.throws(
    () =>
      verifyNativeAcceptanceSeal(wrongCapability, f.review, f.repo, modernLock),
    /Closed native seal declaration/,
  );
  const valid = await flow(t, modernLock);
  await publishOwnedSdk(valid.options, {}, valid.dependencies);
  assert(valid.events.includes("publish"));
  for (const tamper of ["downgrade", "lock-bytes", "partial-h3"]) {
    const flowCase = await flow(t, modernLock);
    if (tamper === "lock-bytes") {
      const original = flowCase.dependencies.downloadImport;
      flowCase.dependencies.downloadImport = async (...args) => {
        const result = await original(...args);
        await writeFile(
          path.join(args[1].destination, "source-lock.json"),
          legacyLockRaw,
        );
        return result;
      };
    } else {
      flowCase.dependencies.extract = async () => {
        const seal = structuredClone(flowCase.seal);
        if (tamper === "downgrade") {
          seal.schemaVersion = 1;
          delete seal.capabilities;
          delete seal.bridgePatchId;
          seal.reports = seal.reports.slice(0, 9);
          seal.builds.pop();
        } else seal.reports.pop();
        return seal;
      };
    }
    await assert.rejects(
      publishOwnedSdk(flowCase.options, {}, flowCase.dependencies),
    );
    assert.equal(flowCase.events.includes("publish"), false);
  }
});

test("malformed native seal envelopes reject before large owned bundle downloads", async (t) => {
  for (const lock of [legacyLock, modernLock]) {
    for (const change of [
      (seal) => (seal.extra = true),
      (seal) => seal.producer.runId++,
      (seal) => seal.execution.runAttempt++,
      (seal) => (seal.reports = null),
      (seal) => seal.builds.pop(),
      (seal) => (seal.schemaVersion = 3),
    ]) {
      const f = await flow(t, lock);
      f.dependencies.extract = async () => {
        const seal = structuredClone(f.seal);
        change(seal);
        return seal;
      };
      await assert.rejects(verifyOwnedPublication(f.options, f.dependencies));
      assert.equal(f.events.includes("download-import"), false);
      assert.equal(f.events.includes("publish"), false);
    }
  }
});

test("no release writes after native/import TOCTOU, invalid raw seal, changed asset bytes or controller failure", async (t) => {
  for (const type of [
    "raw-seal",
    "five-assets",
    "native-rerun",
    "import-rerun",
    "controller",
    "missing-native",
  ]) {
    const f = await flow(t);
    if (type === "raw-seal") f.dependencies.rawSealSha = () => "a".repeat(64);
    if (type === "five-assets")
      f.dependencies.verifyBundle = async () => {
        throw new Error("asset bytes changed");
      };
    if (type === "native-rerun")
      f.dependencies.downloadImport = async () => {
        f.routes["actions/runs/101"].run_attempt++;
        return { hostedBuild: false, reviewSha256: f.producer.reviewSha256 };
      };
    if (type === "import-rerun")
      f.dependencies.recheckImport = async () => {
        throw new Error("import attempt changed");
      };
    if (type === "controller")
      f.dependencies.beforePublish = async () => {
        throw new Error("controller code changed");
      };
    if (type === "missing-native")
      f.dependencies.extract = async () => {
        const seal = copy(f.seal);
        seal.reports.pop();
        return seal;
      };
    await assert.rejects(publishOwnedSdk(f.options, {}, f.dependencies));
    assert.ok(!f.events.includes("publish"), type);
  }
});

test("read-only verifier output is not authority or a reused download for the protected job", async (t) => {
  const f = await flow(t);
  await verifyOwnedPublication(f.options, f.dependencies);
  f.routes["actions/runs/101"].conclusion = "failure";
  const next = { ...f.options, destination: path.join(f.root, "publish") };
  await assert.rejects(publishOwnedSdk(next, {}, f.dependencies));
  assert.ok(!f.events.includes("publish"));
});

function publisherContext(f) {
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_ID: "11",
    GITHUB_SHA: "8".repeat(40),
    GITHUB_WORKFLOW_SHA: "8".repeat(40),
    GITHUB_REF: "refs/heads/Main",
    GITHUB_WORKFLOW_REF: `${repository}/${PUBLICATION_WORKFLOW}@refs/heads/Main`,
    GITHUB_RUN_ID: "200",
    GITHUB_RUN_ATTEMPT: "1",
    CEF_OWNED_PUBLISH_APPROVED: "true",
  };
  f.routes["actions/workflows/cef-owned-sdk-publish.yml"] = {
    id: 13,
    path: PUBLICATION_WORKFLOW,
  };
  f.routes["actions/runs/200"] = {
    ...copy(f.run),
    id: 200,
    run_attempt: 1,
    head_sha: env.GITHUB_SHA,
    workflow_id: 13,
    path: PUBLICATION_WORKFLOW,
    status: "in_progress",
    conclusion: null,
  };
  return env;
}

test("publisher authority requires exact manual default protected context and cannot be borrowed from import/acceptance/fork jobs", async () => {
  const f = fixture(),
    env = publisherContext(f);
  assert.equal(
    (await publicationAuthority(env, f.api, { write: true })).id,
    11,
  );
  for (const patch of [
    { CEF_OWNED_PUBLISH_APPROVED: undefined },
    { GITHUB_WORKFLOW_SHA: "a".repeat(40) },
    { GITHUB_WORKFLOW_REF: `${repository}/${workflow}@refs/heads/Main` },
    { GITHUB_REPOSITORY: "foreign/repo" },
    { GITHUB_REPOSITORY_ID: "12" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_RUN_ATTEMPT: "01" },
    { GITHUB_REF: "refs/heads/unreviewed" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ])
    await assert.rejects(
      publicationAuthority({ ...env, ...patch }, f.api, { write: true }),
    );
  f.routes["actions/runs/200"].head_repository.id = 99;
  await assert.rejects(publicationAuthority(env, f.api, { write: true }));
});

test("metadata adapter only sends credentials to closed read-only API origins and never follows redirects", async () => {
  const calls = [];
  const api = publicationApi("PARENT_SECRET", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  });
  await api("actions/runs/101");
  assert.equal(
    calls[0].url,
    `https://api.github.com/repos/${repository}/actions/runs/101`,
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer PARENT_SECRET");
  for (const route of [
    "https://attacker.invalid",
    "../releases",
    "releases",
    "actions/runs/101/jobs?x=secret",
  ])
    await assert.rejects(api(route));
  assert.equal(calls.length, 1);
});

test("raw ZIP member hash is original bytes, strict seal extraction is unchanged and Python children exclude credentials", async (t) => {
  const root = await temp(t, "cef-publication-zip-");
  const python = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const zip = path.join(root, "seal.zip"),
    json = path.join(root, "raw.json");
  const { seal } = fixture();
  const raw = JSON.stringify(seal, null, 3) + "\n\n";
  await writeFile(json, raw);
  const pack =
    "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],'w');z.write(sys.argv[2],'seal.json');z.close()";
  execFileSync(python, ["-I", "-B", "-c", pack, zip, json], {
    windowsHide: true,
  });
  const zipSha = hash(await readFile(zip));
  assert.equal(rawAcceptanceSealSha(python, zip, zipSha), hash(raw));
  assert.notEqual(hash(raw), hash(JSON.stringify(seal, null, 2)));
  const parsed = await archiveCommand(
    python,
    path.resolve("scripts/lib/cef-checkpoint-archive.py"),
    ["seal", "--input", zip, "--output", root],
    { timeout: 15000 },
  );
  assert.equal(canonical(parsed), canonical(seal));
  assert.throws(() => rawAcceptanceSealSha(python, zip, "a".repeat(64)));
  const env = publicationPythonOptions(python);
  assert.deepEqual(Object.keys(env.env), ["PATH"]);
  const observed = execFileSync(
    python,
    [
      "-I",
      "-B",
      "-c",
      "import os,json;print(json.dumps({k:os.environ.get(k) for k in ['GH_TOKEN','GITHUB_TOKEN','ACTIONS_RUNTIME_TOKEN','INPUT_TOKEN']}))",
    ],
    env,
  ).toString();
  assert.deepEqual(JSON.parse(observed), {
    GH_TOKEN: null,
    GITHUB_TOKEN: null,
    ACTIONS_RUNTIME_TOKEN: null,
    INPUT_TOKEN: null,
  });
  execFileSync(
    python,
    [
      "-I",
      "-B",
      "-c",
      "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],'a');z.writestr('../outside','denied');z.close()",
      zip,
    ],
    { windowsHide: true },
  );
  const changedZipSha = hash(await readFile(zip));
  assert.throws(() => rawAcceptanceSealSha(python, zip, changedZipSha));
  await assert.rejects(
    archiveCommand(
      python,
      path.resolve("scripts/lib/cef-checkpoint-archive.py"),
      ["seal", "--input", zip, "--output", root],
      { timeout: 15000 },
    ),
  );
});

test("workflow scopes write-capable Draft verification separately from protected noncancellable publication", async () => {
  const value = YAML.parse(
    await readFile(".github/workflows/cef-owned-sdk-publish.yml", "utf8"),
  );
  assert.deepEqual(Object.keys(value.on), ["workflow_dispatch"]);
  assert.deepEqual(value.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(value.jobs.verify.permissions, {
    contents: "write",
    actions: "read",
  });
  assert.equal(value.jobs.verify.environment, undefined);
  assert.equal(value.jobs.publish.environment, "cef-runtime-publish");
  assert.deepEqual(value.jobs.publish.permissions, {
    contents: "write",
    actions: "read",
  });
  assert.equal(value.jobs.publish.needs, "verify");
  assert.equal(
    value.jobs.publish.concurrency.group,
    "cef-engine-publish-${{ needs.verify.outputs.key }}",
  );
  assert.equal(value.jobs.publish.concurrency["cancel-in-progress"], false);
  assert.equal(value.concurrency, undefined);
  for (const job of Object.values(value.jobs)) {
    assert.match(job.if, /workflow_dispatch/);
    assert.match(job.if, /default_branch/);
    const steps = job.steps;
    assert.equal(steps[0].with["persist-credentials"], false);
    assert.ok(
      !steps.some((step) => step.uses?.startsWith("actions/download-artifact")),
    );
    const command = steps.find((step) =>
      step.run?.includes("native/cef-engineering-sdk-publication/publish.mjs"),
    );
    assert.equal(command.env.GH_TOKEN, "${{ github.token }}");
    assert.doesNotMatch(command.run, /catalog|CEF_PUBLISH_APPROVED|skip|force/);
    assert.equal(steps.at(-1).if, "always()");
    assert.match(steps.at(-1).with.path, /\/publication-result\.json$/);
  }
  const source = await readFile("scripts/cef-owned-sdk-publish.mjs", "utf8");
  assert.doesNotMatch(source, /process\.env\s*=/);
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  assert.equal(
    ci.split("tests/tooling/cefOwnedSdkPublish.node-test.mjs").length,
    2,
  );
});

test("publication output can only be a fresh fixed immediate child of actual runner temp", async (t) => {
  const root = await temp(t, "cef-publication-output-");
  assert.equal(
    await privatePublicationOutput(
      root,
      path.join(root, "cef-owned-publication"),
    ),
    path.join(root, "cef-owned-publication"),
  );
  await assert.rejects(
    privatePublicationOutput(
      root,
      path.join(root, "nested", "cef-owned-publication"),
    ),
  );
  await assert.rejects(
    privatePublicationOutput(root, path.join(root, "other")),
  );
});

test("owned publication has a distinct protected adapter before any release writes", async () => {
  const module = await import("../../scripts/lib/cef-owned-sdk-publish.mjs");
  assert.equal(typeof module.verifyOwnedPublication, "function");
});

test("engineering publisher routing whole workflow inverse preserves the original protected owned publisher", async () => {
  const text = (
    await readFile(".github/workflows/cef-owned-sdk-publish.yml", "utf8")
  ).replaceAll("\r\n", "\n");
  const current = "native/cef-engineering-sdk-publication/publish.mjs";
  assert.equal(text.split(current).length, 3);
  const previous = text.replaceAll(
    current,
    "scripts/cef-owned-sdk-publish.mjs",
  );
  assert.equal(Buffer.byteLength(previous), 4156);
  assert.equal(
    hash(previous),
    "6bf7cd8f5304570f467d8464d5ff2ee7603073fbadd8165823ce0c42b558df25",
  );
});

// Immutable selected Git witness for producer59853, plus the one reviewed Linux
// module blob delta for1edd. Transport/native execution below is explicitly modeled.
const engineeringGitRowsDeflate =
  "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";
const linuxMigrationBlob = "5a195510ed0d488a94117105fb259d3e85420436";
function engineeringFixture(target = "x86_64-apple-darwin") {
  const old = fixture(modernLock),
    profile = checkpointProfile(target);
  const lockRaw = readFileSync(
    new URL("../../" + profile.inputs + "/source-lock.json", import.meta.url),
  );
  const lock = JSON.parse(lockRaw);
  const rows = JSON.parse(
    inflateSync(Buffer.from(engineeringGitRowsDeflate, "base64")),
  );
  if (target === "aarch64-unknown-linux-gnu")
    rows.find(
      (x) => x.path === "scripts/lib/cef-linux-producer-migration.mjs",
    ).sha = linuxMigrationBlob;
  assert.equal(codeTreeDigest(rows), ENGINEERING_PRODUCERS[target]);
  const sdkProducer = {
    repository,
    repositoryId: 11,
    runId: 41,
    attempt: 2,
    head: "a".repeat(40),
    branch: "main",
    workflow: ".github/workflows/cef-engineering-checkpoint.yml",
  };
  const completion = createSdkCompletion({
    producer: sdkProducer,
    identity: {
      target,
      source: profile.source,
      producer: ENGINEERING_PRODUCERS[target],
      canonicalRoot: path.resolve(
        path.parse(os.tmpdir()).root,
        "modeled-source",
      ),
      image: "MODELED",
      tools: hash("modeled-tools"),
      graph: hash("modeled-graph"),
      siso: hash("modeled-siso"),
    },
    compile: {
      outcome: "compiler-complete",
      exitCode: 0,
      quiescent: true,
      groupId: 7,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: 7, start: "Mon Nov 2 00:00:00 2026" }],
    },
    distributionExitCode: 0,
    checked: {
      descriptor: { target },
      identity: { sourceLockSha256: profile.source },
      assets: sdkNames(target).map((name) => ({
        name,
        size: 10,
        sha256: hash("modeled-" + name),
      })),
    },
  });
  const descriptor = completion.bundleAssets.find(
    (x) => x.name === "runtime.json",
  ).sha256;
  const producer = {
    ...old.producer,
    target,
    producer: "engineering-sdk",
    descriptorSha256: descriptor,
    completionSha256: completionSha(completion),
  };
  delete producer.reviewedImport;
  delete producer.reviewSha256;
  const execution = {
    ...old.seal.execution,
    ref: "refs/heads/main",
    workflowRef: `${repository}/${workflow}@refs/heads/main`,
  };
  const { sourceTree, codeSha256, codeDigestFormat, ...identity } = execution;
  const result = {
    schemaVersion: 2,
    kind: "sorng-cef-native-acceptance-run",
    capabilities: ["tls", "http2", "http3"],
    bridgePatchId: lock.bridge.patchId,
    target,
    producer: { ...producer, sourceLockIdentity: profile.source },
    acceptanceSourceSha: execution.sourceSha,
    acceptanceWorkflowRunId: execution.runId,
    nativeHost: {
      platform: NATIVE_TARGETS[target].platform,
      architecture: NATIVE_TARGETS[target].arch,
    },
    sourceLockIdentity: profile.source,
    descriptorSha256: descriptor,
    reports: old.seal.reports,
    builds: old.seal.builds.map((x) => ({
      ...x,
      helperSha256: hash("modeled-helper-" + x.suite),
    })),
    ok: true,
    nativeExecutionPerformed: true,
    publicProviderAcceptance: false,
    productionReady: false,
    publicationAllowed: false,
  };
  const seal = createAcceptanceSeal(result, {
    execution: identity,
    code: { sourceTree, codeSha256, codeDigestFormat },
    reportSha256: hash(JSON.stringify(result)),
    sourceLock: lock,
  });
  const review = {
    schemaVersion: 1,
    kind: ENGINEERING_REVIEW_KIND,
    target,
    sourceLockIdentity: profile.source,
    producerCodeSha256: ENGINEERING_PRODUCERS[target],
    descriptorSha256: descriptor,
    producer,
    acceptance: {
      ...old.review.acceptance,
      nativeReportSha256: seal.report.sha256,
      sealSha256: hash(JSON.stringify(seal)),
    },
  };
  const repo = { ...old.repo, default_branch: "main" };
  const routes = {
    ...old.routes,
    "": repo,
    "actions/runs/101": { ...old.run, head_branch: "main" },
    "actions/artifacts/102": {
      ...old.artifact,
      name: `cef-native-acceptance-seal-${target}-101-3`,
    },
  };
  const sdkSeal = {
    schemaVersion: 2,
    kind: "sorng-cef-engineering-sdk-seal",
    producer: sdkProducer,
    transport: {
      kind: "default-branch-container",
      defaultBranch: "main",
      carrierHead: "9".repeat(40),
    },
    release: {
      id: 300,
      tag: `cef-sdk-checkpoint-${target}-${completion.identitySha256.slice(0, 16)}-41-2`,
    },
    completion,
    completionSha256: producer.completionSha256,
    assets: completion.bundleAssets.map((x, i) => ({ id: i + 301, ...x })),
  };
  const sdkRoutes = {
    "": repo,
    "actions/workflows/cef-engineering-checkpoint.yml": {
      id: 66,
      path: sdkProducer.workflow,
    },
    "actions/runs/41": {
      id: 41,
      run_attempt: 2,
      head_sha: sdkProducer.head,
      head_branch: "main",
      workflow_id: 66,
      event: "workflow_dispatch",
      path: sdkProducer.workflow,
      status: "completed",
      conclusion: "success",
      repository: { id: 11, full_name: repository },
      head_repository: { id: 11, full_name: repository },
    },
    "actions/runs/41/artifacts?per_page=100": {
      total_count: 1,
      artifacts: [
        {
          id: 42,
          name: sdkSealName(sdkProducer, target),
          size_in_bytes: 1000,
          expired: false,
          digest: `sha256:${producer.artifactSha256}`,
          workflow_run: { id: 41, head_sha: sdkProducer.head },
        },
      ],
    },
    [`git/commits/${sdkProducer.head}`]: {
      sha: sdkProducer.head,
      tree: { sha: "3".repeat(40) },
    },
    [`git/trees/${"3".repeat(40)}?recursive=1`]: {
      sha: "3".repeat(40),
      truncated: false,
      tree: rows,
    },
    "releases/300": {
      id: 300,
      draft: true,
      prerelease: true,
      tag_name: sdkSeal.release.tag,
      target_commitish: sdkSeal.transport.carrierHead,
    },
    "releases/300/assets?per_page=100": sdkSeal.assets.map((x) => ({
      id: x.id,
      name: x.name,
      size: x.bytes,
      digest: `sha256:${x.sha256}`,
      state: "uploaded",
    })),
  };
  const api = (table) => async (route) => {
    assert.ok(Object.hasOwn(table, route), route);
    return copy(table[route]);
  };
  return {
    review,
    completion,
    sdkSeal,
    seal,
    repo,
    routes,
    sdkRoutes,
    api: api(routes),
    sdkApi: apiClient(
      repository,
      "MODELED_TOKEN",
      async (url, options) => {
        assert.equal(options.method, "GET");
        assert.equal(options.headers.Authorization, "Bearer MODELED_TOKEN");
        const base = `https://api.github.com/repos/${repository}`;
        assert(url === base || url.startsWith(base + "/"));
        const route = url.slice(base.length).replace(/^\//, "");
        assert.ok(Object.hasOwn(sdkRoutes, route), route);
        return new Response(JSON.stringify(sdkRoutes[route]), { status: 200 });
      },
      { readOnly: true, sdk: true, target },
    ),
    lockRaw,
    lock,
  };
}
async function engineeringFlow(t, target) {
  const f = engineeringFixture(target),
    root = await temp(t, "cef-engineering-publication-");
  const events = [];
  const options = {
    review: f.review,
    api: f.api,
    sdkApi: f.sdkApi,
    destination: path.join(root, "verify"),
    python: path.join(root, "python"),
    token: "MODELED_TOKEN",
    commit: "8".repeat(40),
  };
  const dependencies = {
    download: async () => {
      events.push("native-seal");
    },
    extract: async (_python, _helper, args) =>
      copy(args[2].endsWith("native-seal.zip") ? f.seal : f.sdkSeal),
    rawSealSha: () => f.review.acceptance.sealSha256,
    downloadSdk: async (_api, input) => {
      events.push("sdk-download");
      await mkdir(input.destination);
      await writeFile(
        path.join(input.destination, "source-lock.json"),
        f.lockRaw,
      );
      await writeFile(
        path.join(input.destination, "sdk-completion-proof.json"),
        canonical(f.completion) + "\n",
      );
    },
    verifyBundle: async () => {
      events.push("rehash-five-assets");
      return {
        descriptor: {
          target: f.review.target,
          sourceLock: {
            path: "source-lock.json",
            size: f.lockRaw.length,
            sha256: hash(f.lockRaw),
          },
        },
        descriptorSha256: f.review.descriptorSha256,
        identity: {
          sourceLockSha256: f.review.sourceLockIdentity,
          key: `${f.review.sourceLockIdentity}-${f.review.target}`,
        },
      };
    },
    beforePublish: async () => {
      events.push("fresh-controller-check");
    },
    publish: async (input) => {
      events.push("publish");
      assert.equal(input.commit, options.commit);
      assert.equal(input.repository, repository);
      assert.equal(input.execute, true);
      return { productionReady: false, prerelease: true };
    },
  };
  return { ...f, options, dependencies, events };
}

test("engineering publication exact target producers preserve Mac59853 and require the reviewed Linux1edd without source-only admission", () => {
  assert.equal(
    ENGINEERING_PRODUCERS["x86_64-apple-darwin"],
    ENGINEERING_PRODUCER,
  );
  assert.equal(
    ENGINEERING_PRODUCERS["aarch64-apple-darwin"],
    ENGINEERING_PRODUCER,
  );
  assert.equal(
    ENGINEERING_PRODUCERS["aarch64-unknown-linux-gnu"],
    "1eddf4f9c05172f03fb155346b1055f4d12b24505e608c3b7074245f530ff01c",
  );
  for (const target of Object.keys(ENGINEERING_PRODUCERS)) {
    const f = engineeringFixture(target);
    assert.equal(validateEngineeringReview(f.review), f.review);
    assert.equal(
      verifyEngineeringCompletion(f.completion, f.review, f.repo),
      f.completion,
    );
    for (const change of [
      (r) => {
        r.producerCodeSha256 = "f".repeat(64);
      },
      (r) => {
        r.producer.producer = "owned-import";
      },
      (r) => {
        r.kind = "sorng-cef-owned-publication-review";
      },
      (r) => {
        r.sourceLockIdentity = "a".repeat(64);
      },
    ]) {
      const r = copy(f.review);
      change(r);
      assert.throws(() => validateEngineeringReview(r));
    }
    for (const change of [
      (x) => {
        x.compile.outcome = "slice-ended";
      },
      (x) => {
        x.distributionExitCode = 1;
      },
      (x) => {
        x.bundleAssets.pop();
      },
      (x) => {
        x.identity.producer = "a".repeat(64);
      },
      (x) => {
        x.kind = "sorng-cef-engineering-checkpoint";
      },
    ]) {
      const c = copy(f.completion);
      change(c);
      const r = copy(f.review);
      r.producer.completionSha256 = completionSha(c);
      assert.throws(() => verifyEngineeringCompletion(c, r, f.repo));
    }
  }
});

test("engineering publication authenticates actual modeled SDK/native chains and reuses unchanged packager for all three profiles", async (t) => {
  for (const target of Object.keys(ENGINEERING_PRODUCERS)) {
    const f = await engineeringFlow(t, target);
    const result = await publishEngineeringSdk(f.options, {}, f.dependencies);
    assert.deepEqual(f.events, [
      "native-seal",
      "sdk-download",
      "rehash-five-assets",
      "fresh-controller-check",
      "publish",
    ]);
    assert.equal(result.producerKind, "engineering-sdk");
    assert.equal(result.originalBuildReplayed, false);
    assert.equal(result.productionReady, false);
    assert.equal(result.ingestion, undefined);
  }
});

test("engineering publication denies wrong native profile and foreign or failed metadata before large SDK transfer", async (t) => {
  for (const mutate of [
    (f) => {
      f.seal.nativeAcceptance = false;
    },
    (f) => {
      f.seal.nativeHost.architecture = "x64";
    },
    (f) => {
      f.seal.reports.pop();
    },
    (f) => {
      f.routes["actions/runs/101"].conclusion = "failure";
    },
    (f) => {
      f.routes["actions/runs/101"].head_repository.id = 12;
    },
    (f) => {
      f.seal.sourceLockIdentity = checkpointProfile(
        "x86_64-apple-darwin",
      ).source;
    },
  ]) {
    const f = await engineeringFlow(t, "aarch64-apple-darwin");
    mutate(f);
    await assert.rejects(publishEngineeringSdk(f.options, {}, f.dependencies));
    assert(!f.events.includes("sdk-download"));
    assert(!f.events.includes("publish"));
  }
});

test("engineering publication denies SDK producer, attempt, code and draft drift after byte verification without release writes", async (t) => {
  for (const mutate of [
    (f) => {
      f.sdkRoutes["actions/runs/41"].run_attempt++;
    },
    (f) => {
      f.sdkRoutes["actions/runs/41"].conclusion = "failure";
    },
    (f) => {
      f.sdkRoutes["actions/runs/41"].head_repository.id = 12;
    },
    (f) => {
      f.sdkRoutes[
        "actions/runs/41/artifacts?per_page=100"
      ].artifacts[0].expired = true;
    },
    (f) => {
      f.sdkRoutes[`git/trees/${"3".repeat(40)}?recursive=1`].tree[0].sha =
        "0".repeat(40);
    },
    (f) => {
      f.sdkRoutes["releases/300/assets?per_page=100"].pop();
    },
    (f) => {
      f.sdkRoutes["releases/300/assets?per_page=100"][0].digest =
        "sha256:" + "a".repeat(64);
    },
    (f) => {
      f.sdkRoutes["releases/300"].draft = false;
    },
  ]) {
    const f = await engineeringFlow(t);
    mutate(f);
    await assert.rejects(publishEngineeringSdk(f.options, {}, f.dependencies));
    assert(f.events.includes("rehash-five-assets"));
    assert(!f.events.includes("publish"));
  }
});

test("engineering publication review routing requires a clean raw committed fixed data namespace and never executes a JSON-selected module", async (t) => {
  const root = await temp(t, "cef-engineering-review-"),
    f = engineeringFixture();
  const relative =
    "native/cef-engineering-sdk-publication/reviews/model/publication.json";
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  const raw = Buffer.from(JSON.stringify(f.review) + "\n");
  await writeFile(path.join(root, relative), raw);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git("commit", "--quiet", "-m", "modeled review");
  const head = git("rev-parse", "HEAD").trim();
  assert.deepEqual(
    await readCommittedPublicationReview(root, relative, hash(raw), head),
    f.review,
  );
  await assert.rejects(
    readCommittedPublicationReview(root, relative, "a".repeat(64), head),
  );
  await assert.rejects(
    readCommittedPublicationReview(
      root,
      "scripts/selected-code.mjs",
      hash(raw),
      head,
    ),
  );
  await writeFile(path.join(root, relative), raw.toString() + " ");
  await assert.rejects(
    readCommittedPublicationReview(root, relative, hash(raw), head),
  );
  assert.equal(
    engineeringPublicationArguments([
      "verify",
      "--reviewed",
      relative,
      "--review-sha256",
      hash(raw),
    ]).mode,
    "verify",
  );
  assert.throws(() =>
    engineeringPublicationArguments([
      "publish",
      "--reviewed",
      relative,
      "--review-sha256",
      hash(raw),
    ]),
  );
  const source = await readFile(
    "native/cef-engineering-sdk-publication/publish.mjs",
    "utf8",
  );
  assert(source.includes("return ownedMain(argv, env)"));
  assert.doesNotMatch(source, /import\(\s*(?:review|options)\./);
  assert(source.includes("dependencies.publish ?? publish"));
});
