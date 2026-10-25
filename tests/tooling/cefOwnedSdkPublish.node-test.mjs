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
import { publicationArguments } from "../../scripts/cef-owned-sdk-publish.mjs";
import {
  createAcceptanceSeal,
  HTTP2_CHECKS,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";
import {
  canonical,
  archiveCommand,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const repository = "supermarsx/sortOfRemoteNG";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const copy = (value) => structuredClone(value);
const workflow = ".github/workflows/cef-runtime-acceptance.yml";

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
      step.run?.includes("cef-owned-sdk-publish.mjs"),
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
