import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import {
  producerSelection,
  verifyAcceptanceBundle,
  acceptancePlan,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";

test("an explicit owned import remains a separate closed producer class", () => {
  const owned = {
    target: "x86_64-pc-windows-msvc",
    runId: 2,
    headSha: "a".repeat(40),
    artifactId: 3,
    artifactSha256: "b".repeat(64),
    descriptorSha256: "c".repeat(64),
    producer: "owned-import",
    runAttempt: 1,
    completionSha256: "d".repeat(64),
    reviewedImport: "native/cef-owned-sdk-imports/example/review.json",
    reviewSha256: "e".repeat(64),
  };
  assert.deepEqual(producerSelection([owned]), [owned]);
});
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  OWNED_WORKFLOW,
  OWNED_REPOSITORY,
  validateOwnedReview,
  readOwnedImportReview,
  validateLocalHandoff,
  quarantineTag,
  importSealName,
  ownedDraft,
  validateImportSeal,
  ownedCompletionSha,
  validateImportCompletion,
  verifyImportProducer,
  importCodeDigest,
  sealOwnedImport,
  downloadOwnedImport,
  ownedImportApi,
  verifyOwnedBundle,
  quarantineOwnedBundle,
  tokenFreeNode,
  parseOwnedJson,
} from "../../scripts/lib/cef-owned-sdk-import.mjs";
import { importArguments } from "../../scripts/cef-owned-sdk-import.mjs";
import {
  WINDOWS_CAPSULE_ORIGIN,
  WINDOWS_OPERATION2_ORIGIN,
  WINDOWS_OPERATION2_EVIDENCE,
  WINDOWS_OPERATION2_CLANG,
  WINDOWS_CAPSULE_IDENTITY,
  WINDOWS_CAPSULE_EVIDENCE,
} from "../../scripts/lib/cef-owned-sdk-handoff.mjs";
import {
  downloadAsset,
  canonical,
  codeTreeDigest,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => structuredClone(value);
const reviewPath = "native/cef-owned-sdk-imports/example/review.json";
function fixture() {
  const source = "a".repeat(64),
    target = "x86_64-pc-windows-msvc";
  const bodies = Object.fromEntries(
    [
      "runtime.json",
      "source-lock.json",
      "manifest.json",
      "receipt.json",
      `sorng-cef-custom-${source}-${target}.tar.bz2`,
    ].map((name) => [name, Buffer.from(`SYNTHETIC ${name}`)]),
  );
  const review = {
    schemaVersion: 1,
    kind: "sorng-cef-owned-import-review",
    origin: "existing-windows-package",
    target,
    sourceLockIdentity: source,
    bundleSourceLockRawSha256: hash(bodies["source-lock.json"]),
    originalInputsSourceLockRawSha256: "b".repeat(64),
    descriptorSha256: hash(bodies["runtime.json"]),
    handoffSha256: "c".repeat(64),
    reviewBinding: {
      canonicalReviewSha256: "d".repeat(64),
      evidencePins: {
        build: {
          path: "build-evidence.json",
          sha256: "e".repeat(64),
          size: 100,
        },
      },
      verificationPython: { sha256: "f".repeat(64), size: 100 },
    },
    assets: Object.entries(bodies).map(([name, bytes]) => ({
      name,
      bytes: bytes.length,
      sha256: hash(bytes),
    })),
    engineSha256: "1".repeat(64),
    filesVerified: 953,
  };
  const handoff = {
    kind: "sorng-cef-owned-sdk-handoff",
    schemaVersion: 1,
    target,
    sourceLockIdentity: source,
    bundleSourceLockRawSha256: review.bundleSourceLockRawSha256,
    originalInputsSourceLockRawSha256: review.originalInputsSourceLockRawSha256,
    descriptorSha256: review.descriptorSha256,
    assets: review.assets.map(({ name, bytes, sha256 }) => ({
      name,
      size: bytes,
      sha256,
    })),
    provenance: {
      origin: review.origin,
      engineSha256: review.engineSha256,
      originalBuildRecordPinned: true,
      newEngineBuildClaimed: false,
    },
    reviewBinding: clone(review.reviewBinding),
    engineSha256: review.engineSha256,
    filesVerified: 953,
    archiveSdkRelationship: "extracted-and-inventory-verified",
    verificationScope: "reviewed-local-bytes-and-evidence-bindings",
    productionReady: false,
    nativeAcceptance: "not-tested",
    hostedBuild: false,
    publicationAllowed: false,
    uploadAllowed: false,
  };
  const handoffBytes = Buffer.from(JSON.stringify(handoff));
  review.handoffSha256 = hash(handoffBytes);
  const reviewBytes = Buffer.from(JSON.stringify(review)),
    reviewSha = hash(reviewBytes);
  const tree = [
    "scripts/cef-owned-sdk-import.mjs",
    "scripts/lib/cef-owned-sdk-import.mjs",
    ".node-version",
    OWNED_WORKFLOW,
  ].map((name, i) => ({
    path: name,
    mode: "100644",
    type: "blob",
    sha: String(i + 1).repeat(40),
  }));
  const producer = {
    repository: OWNED_REPOSITORY,
    repositoryId: 7,
    runId: 10,
    attempt: 2,
    head: "5".repeat(40),
    branch: "main",
    workflow: OWNED_WORKFLOW,
    workflowId: 11,
    codeSha256: importCodeDigest(tree),
  };
  const run = {
    id: 10,
    head_sha: producer.head,
    head_branch: "main",
    run_attempt: 2,
    workflow_id: 11,
    event: "workflow_dispatch",
    path: OWNED_WORKFLOW,
    status: "in_progress",
    conclusion: null,
    repository: { id: 7, full_name: OWNED_REPOSITORY },
    head_repository: { id: 7, full_name: OWNED_REPOSITORY },
  };
  const repo = {
      id: 7,
      full_name: OWNED_REPOSITORY,
      default_branch: "main",
      private: false,
    },
    workflow = { id: 11, path: OWNED_WORKFLOW };
  const release = {
    id: 12,
    tag_name: quarantineTag(review, reviewSha),
    draft: true,
    prerelease: true,
    target_commitish: producer.head,
  };
  const assets = review.assets.map((pin, i) => ({
    id: 20 + i,
    name: pin.name,
    size: pin.bytes,
    digest: `sha256:${pin.sha256}`,
    state: "uploaded",
  }));
  const calls = [];
  const api = async (route, options = {}) => {
    calls.push({ route, method: options.method ?? "GET" });
    if (options.method && options.method !== "GET")
      throw Error("Synthetic GET-only");
    if (route === "") return clone(repo);
    if (route === "actions/workflows/cef-owned-sdk-import.yml")
      return clone(workflow);
    if (route === "actions/runs/10") return clone(run);
    if (route === `git/commits/${producer.head}`)
      return { tree: { sha: "6".repeat(40) } };
    if (route === `git/trees/${"6".repeat(40)}?recursive=1`)
      return { truncated: false, tree: clone(tree) };
    if (route === "releases/12") return clone(release);
    if (route === "releases/12/assets?per_page=100") return clone(assets);
    if (route === "actions/artifacts/40")
      return {
        id: 40,
        name: importSealName(10, 2),
        expired: false,
        digest: `sha256:${"7".repeat(64)}`,
        size_in_bytes: 100,
        workflow_run: { id: 10, head_sha: producer.head },
      };
    throw Error("Unexpected synthetic API route");
  };
  return {
    review,
    reviewBytes,
    reviewSha,
    handoff,
    handoffBytes,
    bodies,
    tree,
    producer,
    run,
    repo,
    workflow,
    release,
    assets,
    calls,
    api,
  };
}
async function temp(t) {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "owned-sdk-import-test-")),
  );
  t.after(async () => {
    assert.ok(path.basename(dir).startsWith("owned-sdk-import-test-"));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}
async function absent(file) {
  try {
    await readFile(file);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return true;
  }
}
function syntheticVerifier(f) {
  return async (bundle) => {
    assert.deepEqual(
      (await readdir(bundle)).sort(),
      Object.keys(f.bodies).sort(),
    );
    for (const pin of f.review.assets)
      assert.equal(
        hash(await readFile(path.join(bundle, pin.name))),
        pin.sha256,
      );
  };
}
function syntheticDownload(f) {
  return async (_repo, _token, route, output, pin) => {
    const asset = f.assets.find(
      (row) => route === `/releases/assets/${row.id}`,
    );
    assert.ok(asset);
    const bytes = f.bodies[asset.name];
    assert.equal(bytes.length, pin.bytes);
    assert.equal(hash(bytes), pin.sha256);
    await writeFile(output, bytes, { flag: "wx" });
  };
}

test("portable review has only typed local provenance and exact raw source/evidence/five assets", () => {
  const f = fixture();
  assert.equal(validateOwnedReview(f.review), f.review);
  assert.equal(
    validateLocalHandoff(f.review, f.handoffBytes).hostedBuild,
    false,
  );
  for (const mutate of [
    (r) => (r.hostedBuild = true),
    (r) => (r.origin = "github-hosted"),
    (r) => (r.target = "aarch64-pc-windows-msvc"),
    (r) => r.assets.push(clone(r.assets[0])),
    (r) => (r.assets[0].sha256 = "0".repeat(64)),
    (r) => (r.reviewBinding.verificationPython.path = "C:/private/python.exe"),
    (r) =>
      (r.reviewBinding.evidencePins.extra = clone(
        r.reviewBinding.evidencePins.build,
      )),
    (r) => (r.assets[0].unknown = true),
  ]) {
    const r = clone(f.review);
    mutate(r);
    assert.throws(() => validateOwnedReview(r));
  }
});
test("raw handoff and original evidence cannot be rebound or relabelled as a hosted build", () => {
  const f = fixture();
  for (const mutate of [
    (r) => (r.hostedBuild = true),
    (r) => (r.provenance.hostedBuild = true),
    (r) => (r.provenance.newEngineBuildClaimed = true),
    (r) => (r.provenance.engineSha256 = "9".repeat(64)),
    (r) => (r.sourceLockIdentity = "9".repeat(64)),
    (r) => (r.reviewBinding.evidencePins.build.sha256 = "9".repeat(64)),
  ]) {
    const value = clone(f.handoff);
    mutate(value);
    const bytes = Buffer.from(JSON.stringify(value));
    const review = clone(f.review);
    review.handoffSha256 = hash(bytes);
    assert.throws(() => validateLocalHandoff(review, bytes));
  }
  assert.throws(() => validateLocalHandoff(f.review, Buffer.from("{}")));
});
test("raw portable review pin and path are checked before parsing", async (t) => {
  const f = fixture(),
    root = await temp(t),
    file = path.join(root, reviewPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, f.reviewBytes);
  assert.deepEqual(
    await readOwnedImportReview(root, reviewPath, f.reviewSha),
    f.review,
  );
  await writeFile(file, Buffer.concat([f.reviewBytes, Buffer.from("\n")]));
  await assert.rejects(readOwnedImportReview(root, reviewPath, f.reviewSha));
  for (const relative of [
    "../review.json",
    "native/cef-owned-sdk-imports/../review.json",
    "C:/private/review.json",
    "native/cef-owned-sdk-imports/example/other.json",
  ])
    await assert.rejects(readOwnedImportReview(root, relative, f.reviewSha));
});
test("raw five-asset tampering and extra files fail before SDK parsing", async (t) => {
  const f = fixture(),
    bundle = await temp(t);
  for (const [name, bytes] of Object.entries(f.bodies))
    await writeFile(path.join(bundle, name), bytes);
  await writeFile(path.join(bundle, "runtime.json"), Buffer.from("tampered"));
  await assert.rejects(verifyOwnedBundle(bundle, f.review));
  await writeFile(path.join(bundle, "extra"), "unreviewed");
  await assert.rejects(verifyOwnedBundle(bundle, f.review));
});
test("draft quarantine rejects publication, asset mutation, duplicate IDs and unknown source", async () => {
  for (const mutate of [
    (f) => (f.release.draft = false),
    (f) => (f.release.prerelease = false),
    (f) => (f.release.tag_name = "unrelated"),
    (f) => (f.assets[0].digest = `sha256:${"9".repeat(64)}`),
    (f) => (f.assets[1].id = f.assets[0].id),
    (f) => f.assets.pop(),
    (f) => (f.assets[0].state = "new"),
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(ownedDraft(f.api, f.review, f.reviewSha, 12));
  }
});
test("manual importer requires exact default branch, workflow, attempt, repo and complete code tree", async () => {
  const f = fixture();
  await verifyImportProducer(f.api, f.producer);
  for (const mutate of [
    (f) => (f.run.head_branch = "feature"),
    (f) => (f.run.event = "push"),
    (f) => (f.run.head_sha = "9".repeat(40)),
    (f) => f.run.run_attempt++,
    (f) => f.run.workflow_id++,
    (f) => f.run.head_repository.id++,
    (f) => (f.repo.private = true),
    (f) => (f.workflow.path = "foreign.yml"),
    (f) => (f.tree[0].sha = "9".repeat(40)),
  ]) {
    const x = fixture();
    mutate(x);
    await assert.rejects(verifyImportProducer(x.api, x.producer));
  }
  const x = fixture();
  await assert.rejects(
    verifyImportProducer(x.api, x.producer, { completed: true }),
  );
  x.run.status = "completed";
  x.run.conclusion = "success";
  await verifyImportProducer(x.api, x.producer, { completed: true });
  x.run.conclusion = "failure";
  await assert.rejects(
    verifyImportProducer(x.api, x.producer, { completed: true }),
  );
});
test("only successful verification writes the small independent seal LAST", async (t) => {
  const f = fixture(),
    root = await temp(t),
    bundle = path.join(root, "bundle"),
    output = path.join(root, "proof");
  let verified = false;
  const seal = await sealOwnedImport(
    f.api,
    {
      review: f.review,
      reviewSha: f.reviewSha,
      reviewedImport: reviewPath,
      releaseId: 12,
      bundle,
      output,
      producer: f.producer,
      token: "synthetic-token",
      python: "not-executed",
    },
    {
      download: syntheticDownload(f),
      verify: async (...args) => {
        assert.equal(await absent(path.join(output, "seal.json")), true);
        await syntheticVerifier(f)(...args);
        verified = true;
      },
    },
  );
  assert.equal(verified, true);
  assert.equal(seal.completion.hostedBuild, false);
  assert.equal(seal.completion.originalBuildReplayed, false);
  assert.equal(seal.completion.nativeAcceptance, false);
  assert.deepEqual(
    validateImportSeal(
      JSON.parse(await readFile(path.join(output, "seal.json"))),
    ),
    seal,
  );
});
for (const phase of ["download", "verify", "mutation"]) {
  test(`no seal survives ${phase} failure`, async (t) => {
    const f = fixture(),
      root = await temp(t),
      bundle = path.join(root, "bundle"),
      output = path.join(root, "proof");
    await assert.rejects(
      sealOwnedImport(
        f.api,
        {
          review: f.review,
          reviewSha: f.reviewSha,
          reviewedImport: reviewPath,
          releaseId: 12,
          bundle,
          output,
          producer: f.producer,
          token: "synthetic",
          python: "not-executed",
        },
        {
          download:
            phase === "download"
              ? async () => {
                  throw Error("synthetic failure");
                }
              : syntheticDownload(f),
          verify: async (...args) => {
            await syntheticVerifier(f)(...args);
            if (phase === "verify") throw Error("synthetic failure");
            if (phase === "mutation") f.assets[0].id++;
          },
        },
      ),
    );
    assert.equal(await absent(path.join(output, "seal.json")), true);
  });
}
test("GET-only API cannot publish, append, follow redirects or send credentials elsewhere", async () => {
  let requests = 0;
  const request = async () => {
    requests++;
    return new Response("{}", { status: 200 });
  };
  const api = ownedImportApi(OWNED_REPOSITORY, "synthetic-token", request);
  for (const [route, options] of [
    ["releases", { method: "POST", body: { draft: false } }],
    ["releases/1", { method: "PATCH", body: { draft: false } }],
    ["https://foreign.test", {}],
    ["releases/1", { method: "DELETE" }],
    ["releases/1", { method: "PUT", body: {} }],
  ])
    await assert.rejects(api(route, options));
  assert.equal(requests, 0);
  assert.throws(() =>
    ownedImportApi("foreign/repo", "synthetic-token", request),
  );
  const f = fixture(),
    write = ownedImportApi(OWNED_REPOSITORY, "synthetic-token", request, {
      write: true,
      review: f.review,
      reviewSha: f.reviewSha,
    });
  await assert.rejects(
    write("releases", { method: "POST", body: { draft: false } }),
  );
  await assert.rejects(
    write("releases/1/assets?name=private.txt", {
      method: "POST",
      upload: true,
      bytes: 10,
      body: Buffer.alloc(10),
    }),
  );
  assert.equal(requests, 0);
});
test("asset redirects strip token headers and retain exact raw digest/size", async (t) => {
  const output = path.join(await temp(t), "asset"),
    bytes = Buffer.from("synthetic-public-byte"),
    calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/synthetic?signature=not-logged",
          },
        })
      : new Response(bytes);
  };
  await downloadAsset(
    OWNED_REPOSITORY,
    "synthetic-secret",
    "/releases/assets/1",
    output,
    { bytes: bytes.length, sha256: hash(bytes) },
    { request, maximum: 1000 },
  );
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer synthetic-secret",
  );
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, "error");
  assert.deepEqual(await readFile(output), bytes);
  await assert.rejects(
    downloadAsset(
      OWNED_REPOSITORY,
      "synthetic-secret",
      "/releases/assets/2",
      path.join(path.dirname(output), "bad"),
      { bytes: bytes.length, sha256: hash(bytes) },
      {
        request: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://foreign.test/asset" },
          }),
        maximum: 1000,
      },
    ),
  );
});
test("closed CLI has no implicit upload, publication, source build or flexible flags", () => {
  assert.deepEqual(
    importArguments([
      "plan",
      "--reviewed",
      reviewPath,
      "--review-sha256",
      "a".repeat(64),
    ]).mode,
    "plan",
  );
  for (const args of [
    ["publish"],
    ["plan", "--execute"],
    ["seal", "--execute"],
    ["quarantine-upload"],
    ["plan", "--reviewed", reviewPath, "--reviewed", reviewPath],
  ])
    assert.throws(() => importArguments(args));
});

test("explicit quarantine upload appends only five reviewed files and never publishes", async (t) => {
  const f = fixture(),
    bundle = await temp(t);
  for (const [name, bytes] of Object.entries(f.bodies))
    await writeFile(path.join(bundle, name), bytes);
  const calls = [],
    uploaded = [];
  const api = async (route, options = {}) => {
    calls.push({ route, method: options.method ?? "GET" });
    if (route === "releases" && options.method === "POST") {
      assert.equal(options.body.draft, true);
      assert.equal(options.body.tag_name, f.release.tag_name);
      return clone(f.release);
    }
    if (options.upload) {
      const bytes = [];
      for await (const chunk of options.body) bytes.push(chunk);
      const body = Buffer.concat(bytes),
        name = decodeURIComponent(route.split("?name=")[1]);
      const pin = f.review.assets.find((row) => row.name === name);
      assert.equal(hash(body), pin.sha256);
      const row = {
        id: 100 + uploaded.length,
        name,
        size: pin.bytes,
        state: "uploaded",
        digest: `sha256:${pin.sha256}`,
      };
      uploaded.push(row);
      return clone(row);
    }
    if (route === "releases/12") return clone(f.release);
    if (route === "releases/12/assets?per_page=100") return clone(uploaded);
    throw Error("unexpected synthetic operation");
  };
  await assert.rejects(
    quarantineOwnedBundle(
      api,
      {
        bundle,
        review: f.review,
        reviewSha: f.reviewSha,
        handoff: f.handoffBytes,
        commit: f.producer.head,
      },
      { verify: syntheticVerifier(f) },
    ),
  );
  assert.equal(calls.length, 0);
  const result = await quarantineOwnedBundle(
    api,
    {
      bundle,
      review: f.review,
      reviewSha: f.reviewSha,
      handoff: f.handoffBytes,
      commit: f.producer.head,
      execute: true,
    },
    { verify: syntheticVerifier(f) },
  );
  assert.equal(result.assets.length, 5);
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.hostedBuild, false);
  assert.ok(calls.every((row) => ["GET", "POST"].includes(row.method)));
  assert.equal(calls.filter((row) => row.method === "POST").length, 6);
});
async function completed(t) {
  const f = fixture(),
    root = await temp(t),
    bundle = path.join(root, "bundle"),
    output = path.join(root, "proof");
  const seal = await sealOwnedImport(
    f.api,
    {
      review: f.review,
      reviewSha: f.reviewSha,
      reviewedImport: reviewPath,
      releaseId: 12,
      bundle,
      output,
      producer: f.producer,
      token: "synthetic",
      python: "not-executed",
    },
    { verify: syntheticVerifier(f), download: syntheticDownload(f) },
  );
  f.run.status = "completed";
  f.run.conclusion = "success";
  const selection = {
    target: f.review.target,
    producer: "owned-import",
    runId: 10,
    headSha: f.producer.head,
    runAttempt: 2,
    artifactId: 40,
    artifactSha256: "7".repeat(64),
    descriptorSha256: f.review.descriptorSha256,
    completionSha256: seal.completionSha256,
    reviewedImport: reviewPath,
    reviewSha256: f.reviewSha,
  };
  return { ...f, root, bundle, output, seal, selection };
}
test("owned acceptance downloads a sealed local SDK without relabelling its original source as hosted", async (t) => {
  const f = await completed(t),
    destination = path.join(f.root, "download");
  let sdkDownloads = 0;
  const completion = await downloadOwnedImport(
    f.api,
    {
      selection: f.selection,
      review: f.review,
      token: "synthetic",
      destination,
      python: "not-executed",
    },
    {
      extract: async () => f.seal,
      download: async (...args) => {
        if (args[2].startsWith("/actions/artifacts/")) {
          await writeFile(args[3], "synthetic zip");
        } else {
          sdkDownloads++;
          await syntheticDownload(f)(...args);
        }
      },
    },
  );
  assert.equal(sdkDownloads, 5);
  assert.equal(completion.hostedBuild, false);
  assert.equal(completion.nativeAcceptance, false);
  const checked = {
    descriptor: { target: f.review.target },
    identity: { sourceLockSha256: f.review.sourceLockIdentity },
    assets: f.review.assets.map(({ name, bytes, sha256 }) => ({
      name,
      size: bytes,
      sha256,
    })),
  };
  assert.equal(
    await verifyAcceptanceBundle({
      bundle: destination,
      selection: f.selection,
      repository: OWNED_REPOSITORY,
      expectedLock: f.review.sourceLockIdentity,
      verifier: async () => checked,
      ownedReviewLoader: async () => f.review,
    }),
    checked,
  );
  const proof = path.join(destination, "owned-import-completion.json");
  await writeFile(proof, JSON.stringify({ ...completion, hostedBuild: true }));
  await assert.rejects(
    verifyAcceptanceBundle({
      bundle: destination,
      selection: f.selection,
      repository: OWNED_REPOSITORY,
      expectedLock: f.review.sourceLockIdentity,
      verifier: async () => checked,
      ownedReviewLoader: async () => f.review,
    }),
  );
});
for (const failure of [
  "head",
  "attempt",
  "fork",
  "workflow",
  "failed",
  "artifact",
  "review",
  "seal",
  "draft",
]) {
  test(`owned acceptance rejects ${failure} before SDK authority`, async (t) => {
    const f = await completed(t),
      selection = clone(f.selection),
      seal = clone(f.seal);
    let downloads = 0;
    if (failure === "head") f.run.head_sha = "9".repeat(40);
    if (failure === "attempt") f.run.run_attempt++;
    if (failure === "fork") f.run.head_repository.id++;
    if (failure === "workflow") f.workflow.path = "foreign.yml";
    if (failure === "failed") f.run.conclusion = "failure";
    if (failure === "artifact") selection.artifactSha256 = "9".repeat(64);
    if (failure === "review") selection.reviewSha256 = "9".repeat(64);
    if (failure === "seal") seal.completion.hostedBuild = true;
    if (failure === "draft") f.assets[0].id++;
    await assert.rejects(
      downloadOwnedImport(
        f.api,
        {
          selection,
          review: f.review,
          token: "synthetic",
          destination: path.join(f.root, "download"),
          python: "not-executed",
        },
        {
          extract: async () => seal,
          download: async (_repo, _token, route, output) => {
            assert.ok(route.startsWith("/actions/artifacts/"));
            downloads++;
            await writeFile(output, "synthetic zip");
          },
        },
      ),
    );
    assert.ok(
      downloads <= 1,
      "only the bounded seal may be read; no SDK asset is fetched",
    );
  });
}
test("owned plan uses the reviewed per-target source, not the legacy six-target lock identity", async () => {
  const f = fixture();
  f.run.status = "completed";
  f.run.conclusion = "success";
  const selection = {
    target: f.review.target,
    producer: "owned-import",
    runId: 10,
    headSha: f.producer.head,
    runAttempt: 2,
    artifactId: 40,
    artifactSha256: "7".repeat(64),
    descriptorSha256: f.review.descriptorSha256,
    completionSha256: "8".repeat(64),
    reviewedImport: reviewPath,
    reviewSha256: f.reviewSha,
  };
  const fetcher = async (url) => {
    const route = new URL(url).pathname
      .replace(`/repos/${OWNED_REPOSITORY}`, "")
      .replace(/^\//, "");
    return new Response(JSON.stringify(await f.api(route)), { status: 200 });
  };
  const result = await acceptancePlan({
    producers: [selection],
    inputs: "native/cef-build-inputs/20261022-registration-retirement",
    repository: OWNED_REPOSITORY,
    token: "synthetic",
    fetcher,
    ownedReviewLoader: async () => f.review,
  });
  assert.equal(
    result.matrix.include[0].sourceLockIdentity,
    f.review.sourceLockIdentity,
  );
  assert.equal(result.matrix.include[0].producer, "owned-import");
  assert.equal(result.nativeAcceptancePerformed, false);
});
test("completion and parser privacy are fail closed rather than exposing raw response values", () => {
  const f = fixture();
  for (const field of [
    "hostedBuild",
    "originalBuildReplayed",
    "runtimeReady",
    "nativeAcceptance",
  ]) {
    const bad = {
      schemaVersion: 1,
      kind: "sorng-cef-owned-import-completion",
      [field]: true,
    };
    assert.throws(() => validateImportCompletion(bad));
  }
  assert.throws(() =>
    validateImportSeal({
      schemaVersion: 1,
      kind: "engineering-sdk",
      completion: {},
    }),
  );
  assert.equal(
    ownedCompletionSha({ safe: true }),
    hash(canonical({ safe: true }) + "\n"),
  );
});
async function diagnosticSource() {
  const YAML = await import("yaml");
  const workflow = YAML.default.parse(
    await readFile(
      new URL(
        "../../.github/workflows/cef-owned-sdk-import.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const run = workflow.jobs.import.steps.find((row) =>
    row.name?.startsWith("Verify exact draft bytes"),
  ).run;
  const match = /^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE\n?$/.exec(
    run,
  );
  assert.ok(
    match,
    "Actual importer invocation must contain its closed diagnostic wrapper",
  );
  assert.equal(
    match[1].split('await import("./scripts/cef-owned-sdk-import.mjs")').length,
    2,
  );
  return match[1];
}

test("owned importer exposes closed bounded HTTP/failure diagnostics without changing source scripts", async () => {
  assert.ok(await diagnosticSource());
});

test("real Node imports the unchanged main exactly once and fails closed before any network outside its authority", async () => {
  const source = await diagnosticSource();
  const blockNetwork =
    "globalThis.fetch = () => { throw new Error('FORBIDDEN_NETWORK'); };";
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--import",
      `data:text/javascript,${encodeURIComponent(blockNetwork)}`,
    ],
    {
      input: source,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 ** 2,
      windowsHide: true,
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        PATH: process.env.PATH,
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
      },
    },
  );
  assert.equal(child.status, 1);
  assert.equal(child.error, undefined);
  const rows = child.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, "failed");
  assert.equal(rows[0].label, "invocation-authority");
  assert.equal(rows[0].observed, 0);
  assert.doesNotMatch(
    child.stderr + child.stdout,
    /FORBIDDEN_NETWORK|Owned SDK import failed/,
  );
});

test("projecting exactly these workflow/test changes preserves the real Mac checkpoint code identity", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const entries = execFileSync(
    "git",
    ["-C", root, "ls-tree", "-r", "-z", "HEAD"],
    { maxBuffer: 8 * 1024 ** 2, windowsHide: true },
  )
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf("\t"),
        [mode, type, sha] = row.slice(0, tab).split(" ");
      return { mode, type, sha, path: row.slice(tab + 1) };
    });
  const touched = new Set([
    ".github/workflows/cef-owned-sdk-import.yml",
    "tests/tooling/cefOwnedSdkImport.node-test.mjs",
  ]);
  const projected = await Promise.all(
    entries.map(async (row) => {
      if (!touched.has(row.path)) return row;
      const bytes = await readFile(path.join(root, row.path));
      const object = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      return { ...row, sha: object };
    }),
  );
  assert.equal(codeTreeDigest(projected), codeTreeDigest(entries));
});

test("workflow seal is LAST with a scoped draft-visibility capability and no SDK compiler or publication", async () => {
  const YAML = await import("yaml"),
    value = YAML.default.parse(
      await readFile(
        new URL(
          "../../.github/workflows/cef-owned-sdk-import.yml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  assert.deepEqual(Object.keys(value.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(value.on.workflow_dispatch.inputs).sort(), [
    "quarantine_release_id",
    "review_sha256",
    "reviewed_import",
  ]);
  assert.deepEqual(value.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(value.jobs.import.permissions, {
    contents: "write",
    actions: "read",
  });
  assert.equal(value.jobs.import.environment, undefined);
  assert.equal(value.jobs.import.env, undefined);
  assert.deepEqual(Object.keys(value.jobs), ["import"]);
  assert.match(value.jobs.import.if, /repository.default_branch/);
  const steps = value.jobs.import.steps,
    last = steps.at(-1);
  const tokenSteps = steps.filter((step) => step.env?.GH_TOKEN);
  assert.equal(tokenSteps.length, 1);
  assert.equal(
    tokenSteps[0].name,
    "Verify exact draft bytes and write completion proof only after all checks",
  );
  assert.match(last.uses, /actions\/upload-artifact@/);
  assert.match(last.with.path, /\/seal.json$/);
  assert.equal(last.if, undefined);
  assert.ok(await diagnosticSource());
  assert.doesNotMatch(
    steps.map((row) => row.run ?? "").join("\n"),
    /\bcargo\b|\bautoninja\b|--execute|\bpublish\b|quarantine-upload/,
  );
});

async function runDiagnostic(
  main,
  originalFetch = async () => new Response("", { status: 200 }),
) {
  const source = await diagnosticSource();
  const logs = [],
    calls = [];
  let context;
  context = createContext({
    URL,
    console: {
      log: (...args) => {
        assert.equal(args.length, 1);
        logs.push(args[0]);
      },
    },
    process: {
      exitCode: undefined,
      env: { GH_TOKEN: "SENTINEL_TOKEN", PRIVATE_VALUE: "SENTINEL_PRIVATE" },
    },
    fetch: (...args) => {
      calls.push(args);
      return originalFetch(...args);
    },
    __loadModule: async (requested) => {
      assert.equal(requested, "./scripts/cef-owned-sdk-import.mjs");
      return {
        main: async (args) => {
          assert.deepEqual(Array.from(args), ["seal"]);
          return main(context);
        },
      };
    },
  });
  const injected = source.replace(
    'await import("./scripts/cef-owned-sdk-import.mjs")',
    'await __loadModule("./scripts/cef-owned-sdk-import.mjs")',
  );
  await new Script(`(async () => {${injected}\n})()`).runInContext(context);
  return {
    rows: logs.map((line) => JSON.parse(line)),
    output: logs.join("\n"),
    exitCode: context.process.exitCode,
    calls,
  };
}

test("actual embedded wrapper preserves GET args, redirect policy, Response identity and unread body without leaking IDs/URLs/headers", async () => {
  const response = new Response("SENTINEL_BODY", {
    status: 302,
    headers: {
      location:
        "https://release-assets.githubusercontent.com/private?secret=SENTINEL_SIGNED",
    },
  });
  const init = {
    method: "GET",
    redirect: "manual",
    headers: { Authorization: "Bearer SENTINEL_TOKEN" },
  };
  const url =
    "https://api.github.com/repos/supermarsx/sortOfRemoteNG/releases/422708047?secret=SENTINEL_QUERY";
  const result = await runDiagnostic(
    async (ctx) => {
      const actual = await ctx.fetch(url, init);
      assert.equal(actual, response);
      assert.equal(actual.bodyUsed, false);
      assert.equal(await actual.text(), "SENTINEL_BODY");
      return { credentials: "SENTINEL_RESULT" };
    },
    async (input, options) => {
      assert.equal(input, url);
      assert.equal(options, init);
      return response;
    },
  );
  assert.equal(result.calls.length, 1);
  assert.equal(result.exitCode, undefined);
  assert.deepEqual(result.rows[0], {
    kind: "owned-import-fetch",
    role: "draft",
    method: "get",
    status: 302,
    result: "http-error",
  });
  assert.equal(result.rows.at(-1).result, "complete");
  assert.doesNotMatch(
    result.output,
    /SENTINEL|422708047|https:|Authorization|Bearer|secret=/,
  );
});

test("actual embedded wrapper classifies only static roles across API metadata and signed transfers", async () => {
  const base = "https://api.github.com/repos/supermarsx/sortOfRemoteNG";
  const routes = [
    [base, "repository"],
    [`${base}/actions/workflows/cef-owned-sdk-import.yml`, "workflow"],
    [`${base}/actions/runs/40092694444`, "run"],
    [`${base}/git/commits/${"a".repeat(40)}`, "git-commit"],
    [`${base}/git/trees/${"b".repeat(40)}?recursive=1`, "git-tree"],
    [`${base}/releases/422708047`, "draft"],
    [`${base}/releases/422708047/assets?per_page=100`, "asset-list"],
    [`${base}/releases/assets/672172418`, "asset-download"],
    [
      "https://release-assets.githubusercontent.com/opaque?token=SENTINEL",
      "asset-transfer",
    ],
    [
      "https://objects.githubusercontent.com/opaque?token=SENTINEL",
      "asset-transfer",
    ],
    ["https://api.github.com/repos/other/repository/private", "other"],
    [
      "https://user:SENTINEL@api.github.com/repos/supermarsx/sortOfRemoteNG",
      "other",
    ],
  ];
  const result = await runDiagnostic(async (ctx) => {
    for (const [url] of routes)
      await ctx.fetch(url, { method: "GET", redirect: "error" });
  });
  assert.deepEqual(
    result.rows.slice(0, -1).map((row) => row.role),
    routes.map(([, role]) => role),
  );
  assert.ok(
    result.rows
      .slice(0, -1)
      .every(
        (row) =>
          row.status === 200 &&
          row.result === "http-ok" &&
          row.method === "get",
      ),
  );
  assert.doesNotMatch(
    result.output,
    /SENTINEL|40092694444|672172418|https:|recursive|opaque/,
  );
});

test("actual 404 and source assertions remain fatal with closed reason labels and no successful seal outcome", async () => {
  const denied = await runDiagnostic(
    async (ctx) => {
      const response = await ctx.fetch(
        "https://api.github.com/repos/supermarsx/sortOfRemoteNG/releases/422708047",
        { redirect: "error" },
      );
      assert(response.ok, "Owned import API failed");
    },
    async () => new Response("SENTINEL_RAW_ERROR", { status: 404 }),
  );
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.rows[0].role, "draft");
  assert.equal(denied.rows[0].status, 404);
  assert.deepEqual(denied.rows.at(-1), {
    kind: "owned-import-completion",
    result: "failed",
    errorClass: "assertion",
    label: "api-response",
    observed: 1,
    dropped: 0,
  });
  const source = await runDiagnostic(async () => {
    assert(false, "Uncommitted importer code forbidden");
  });
  assert.equal(source.exitCode, 1);
  assert.equal(source.rows.at(-1).label, "source-dirty");
  assert.doesNotMatch(
    denied.output + source.output,
    /SENTINEL|422708047|https:|Error:|stack/,
  );
});

test("network exceptions preserve exact identity through fetch while output class/message stays closed", async () => {
  const original = new TypeError(
    "SENTINEL_TOKEN https://private.invalid?token=secret",
  );
  let caught;
  const result = await runDiagnostic(
    async (ctx) => {
      try {
        await ctx.fetch(
          "https://api.github.com/repos/supermarsx/sortOfRemoteNG",
        );
      } catch (error) {
        caught = error;
        throw error;
      }
    },
    async () => {
      throw original;
    },
  );
  assert.equal(caught, original);
  assert.equal(result.exitCode, 1);
  assert.equal(result.rows[0].status, 0);
  assert.equal(result.rows[0].result, "network-error");
  assert.equal(result.rows.at(-1).errorClass, "type");
  assert.equal(result.rows.at(-1).label, "unclassified");
  assert.doesNotMatch(result.output, /SENTINEL|https:|token|secret|private/);
  const unknown = await runDiagnostic(async () => {
    throw { name: "SENTINEL_CLASS", message: "SENTINEL_SECRET" };
  });
  assert.equal(unknown.rows.at(-1).errorClass, "other");
  assert.equal(unknown.rows.at(-1).label, "unclassified");
  assert.doesNotMatch(unknown.output, /SENTINEL/);
});

test("diagnostics cap the TOTAL emitted rows at64 without dropping requests or changing importer exit", async () => {
  const result = await runDiagnostic(async (ctx) => {
    for (let i = 0; i < 90; i++)
      await ctx.fetch(
        `https://api.github.com/repos/supermarsx/sortOfRemoteNG/actions/runs/${i + 1}`,
      );
  });
  assert.equal(result.calls.length, 90);
  assert.equal(result.rows.length, 64);
  assert.equal(result.rows.at(-1).observed, 63);
  assert.equal(result.rows.at(-1).dropped, 27);
  assert.equal(result.rows.at(-1).result, "complete");
  assert.equal(result.exitCode, undefined);
});

test("wrapper adds no write requests and assertion labels come only from unchanged maintained sources", async () => {
  const source = await diagnosticSource();
  assert.equal((source.match(/await main\(/g) ?? []).length, 1);
  assert.match(source, /await main\(\["seal"\]\)/);
  assert.doesNotMatch(
    source,
    /process\.env\s*=|\.json\(|\.text\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)|setInterval|setTimeout/,
  );
  const labelBlock = source.slice(
    source.indexOf("const assertionLabels"),
    source.indexOf("try {\n  const { main }"),
  );
  const messages = [...labelBlock.matchAll(/\["([^"\n]+)", "[a-z-]+"\]/g)].map(
    (row) => row[1],
  );
  assert.ok(messages.length >= 10);
  const maintained =
    (await readFile(
      new URL("../../scripts/cef-owned-sdk-import.mjs", import.meta.url),
      "utf8",
    )) +
    (await readFile(
      new URL("../../scripts/lib/cef-owned-sdk-import.mjs", import.meta.url),
      "utf8",
    ));
  for (const message of messages)
    assert.ok(maintained.includes(JSON.stringify(message)), message);
});

test("actual verifier Node child and its Python descendant never inherit uploader credentials", async (t) => {
  const dir = await temp(t),
    script = path.join(dir, "observe.mjs");
  const python = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
      },
    },
  ).trim();
  await writeFile(
    script,
    `import {execFileSync} from 'node:child_process';
 const bad=Object.keys(process.env).filter(k=>/TOKEN|GITHUB|ACTIONS|SSH|SECRET|PASSWORD|NODE_OPTIONS|PYTHONPATH/i.test(k));
 const nested=execFileSync(process.argv[2],['-I','-B','-c','import os,json;print(json.dumps([k for k in os.environ if any(v in k.upper() for v in ["TOKEN","GITHUB","ACTIONS","SSH","SECRET","PASSWORD"])]))'],{encoding:'utf8'});
 console.log(JSON.stringify({bad,nested:JSON.parse(nested)}));`,
  );
  const observed = await tokenFreeNode(script, [python], {
    environment: {
      ...process.env,
      GH_TOKEN: "synthetic-private",
      GITHUB_TOKEN: "synthetic",
      ACTIONS_RUNTIME_TOKEN: "synthetic",
      SSH_AUTH_SOCK: "synthetic",
      NODE_OPTIONS: "--not-a-real-option",
      PYTHONPATH: "synthetic",
    },
  });
  assert.deepEqual(JSON.parse(observed.stdout), { bad: [], nested: [] });
  assert.throws(() => parseOwnedJson("private-synthetic-value"), {
    message: "Invalid owned-import JSON",
  });
});

test("portable incremental Windows reviews remain operator-local and require the exact thirteen raw roles", () => {
  const f = fixture();
  f.review.origin = "owned-windows-incremental-engine";
  const roles = [
    "build",
    "beforeimage",
    "apply",
    "prerequisites",
    "nativeOutput",
    "continuation",
    "engineJob",
    "engine",
    "engineOutput",
    "symbols",
    "package",
    "distribution",
    "preparation",
  ];
  f.review.reviewBinding.evidencePins = Object.fromEntries(
    roles.map((name) => [
      name,
      {
        path: `original/${name}.json`,
        size: 100,
        sha256: hash(`SYNTHETIC ${name}`),
      },
    ]),
  );
  f.handoff.provenance = {
    origin: f.review.origin,
    engineSha256: f.review.engineSha256,
    baselineEngineSha256: "2".repeat(64),
    originalControllerCommit: "3".repeat(40),
    actualToolFilesVerified: 8,
    nativeClassTestsPassed: 12,
    incrementalBuild: true,
    originalBuildRecordsPinned: true,
    originalBuildReplayed: false,
    pristineSourceBuild: false,
  };
  f.handoff.reviewBinding = clone(f.review.reviewBinding);
  const encoded = Buffer.from(JSON.stringify(f.handoff));
  f.review.handoffSha256 = hash(encoded);
  assert.doesNotThrow(() => validateOwnedReview(f.review));
  assert.equal(
    validateLocalHandoff(f.review, encoded).provenance.originalBuildReplayed,
    false,
  );
  for (const change of [
    (r) => (r.origin = "github-hosted"),
    (r) => delete r.reviewBinding.evidencePins.nativeOutput,
    (r) =>
      (r.reviewBinding.evidencePins.extra = clone(
        r.reviewBinding.evidencePins.build,
      )),
  ]) {
    const r = clone(f.review);
    change(r);
    assert.throws(() => validateOwnedReview(r));
  }
  for (const change of [
    (r) => (r.provenance.pristineSourceBuild = true),
    (r) => (r.provenance.originalBuildReplayed = true),
    (r) => (r.provenance.nativeClassTestsPassed = 11),
    (r) => (r.provenance.engineSha256 = "4".repeat(64)),
    (r) => (r.provenance.privatePath = "F:/private/account"),
    (r) => (r.hostedBuild = true),
    (r) => (r.nativeAcceptance = "accepted"),
  ]) {
    const handoff = clone(f.handoff);
    change(handoff);
    const bytes = Buffer.from(JSON.stringify(handoff));
    assert.throws(() =>
      validateLocalHandoff({ ...f.review, handoffSha256: hash(bytes) }, bytes),
    );
  }
  const old = fixture();
  assert.equal(
    validateLocalHandoff(old.review, old.handoffBytes).provenance
      .newEngineBuildClaimed,
    false,
  );
});

function capsuleImportFixture(operation2 = false) {
  const f = fixture(),
    review = f.review;
  review.origin = operation2
    ? WINDOWS_OPERATION2_ORIGIN
    : WINDOWS_CAPSULE_ORIGIN;
  review.sourceLockIdentity = WINDOWS_CAPSULE_IDENTITY;
  review.assets.find((row) => row.name.endsWith(".tar.bz2")).name =
    `sorng-cef-custom-${review.sourceLockIdentity}-${review.target}.tar.bz2`;
  review.reviewBinding.evidencePins = Object.fromEntries(
    (operation2 ? WINDOWS_OPERATION2_EVIDENCE : WINDOWS_CAPSULE_EVIDENCE).map(
      (role) => [role, { path: role + ".json", size: 100, sha256: hash(role) }],
    ),
  );
  const handoff = {
    kind: "sorng-cef-owned-sdk-handoff",
    schemaVersion: 1,
    target: review.target,
    sourceLockIdentity: review.sourceLockIdentity,
    bundleSourceLockRawSha256: review.bundleSourceLockRawSha256,
    originalInputsSourceLockRawSha256: review.originalInputsSourceLockRawSha256,
    descriptorSha256: review.descriptorSha256,
    assets: review.assets.map(({ bytes, ...row }) => ({ ...row, size: bytes })),
    reviewBinding: clone(review.reviewBinding),
    engineSha256: review.engineSha256,
    filesVerified: review.filesVerified,
    archiveSdkRelationship: "extracted-and-inventory-verified",
    verificationScope: "reviewed-local-bytes-and-evidence-bindings",
    productionReady: false,
    nativeAcceptance: "not-tested",
    hostedBuild: false,
    publicationAllowed: false,
    uploadAllowed: false,
    provenance: {
      origin: review.origin,
      engineSha256: review.engineSha256,
      baselineEngineSha256: "2".repeat(64),
      originalControllerCommit: "3".repeat(40),
      actualToolFilesVerified: 8,
      nativeClassTestsPassed: 42,
      incrementalBuild: true,
      originalBuildRecordsPinned: true,
      originalBuildReplayed: false,
      pristineSourceBuild: false,
      nativeProfileCounts: [36, 3, 3],
      actualSourceFilesVerified: 9,
      securityMacroCount: 61,
      instanceTracerEnabled: false,
      derivedFacts: true,
      reviewedEvidenceDigests: Object.fromEntries(
        (operation2 ? WINDOWS_OPERATION2_EVIDENCE : WINDOWS_CAPSULE_EVIDENCE)
          .filter((role) => role !== "build")
          .map((role) => [
            role,
            review.reviewBinding.evidencePins[role].sha256,
          ]),
      ),
    },
  };
  handoff.provenance.nestedOriginalRecordDigests = {
    nativeManifest: "4".repeat(64),
    nativeReceipt: "5".repeat(64),
    generatedFlags: "6".repeat(64),
    engineRecord: review.reviewBinding.evidencePins.engine.sha256,
    nativeStageReceipts: Object.fromEntries(
      [
        "apply-check",
        "apply-test-dependency",
        "security-build",
        "owned-quic-lifetime-full-list",
        "owned-quic-lifetime-full-run",
        "brp-dpd-list",
        "brp-dpd-run",
        "sandbox-list",
        "sandbox-run",
      ].map((name) => [name, "7".repeat(64)]),
    ),
    nativeObservations: Array(4).fill("8".repeat(64)),
  };
  if (operation2) {
    const p = handoff.provenance;
    p.previousFailedAttemptDigest =
      review.reviewBinding.evidencePins.previousEngineAttempt.sha256;
    p.engineAccountingDigest =
      review.reviewBinding.evidencePins.engineAccounting.sha256;
    p.separatelyObservedClang = {
      sha256: WINDOWS_OPERATION2_CLANG.sha256,
      bytes: WINDOWS_OPERATION2_CLANG.bytes,
      qualification: WINDOWS_OPERATION2_CLANG.provenance,
    };
    p.engineOperationPolicy = {
      jobs: 12,
      cpuRate: 3000,
      memoryBytes: "34359738368",
      activeLimit: 128,
      deadlineUtc: "2026-10-25T05:07:15Z",
      originalFailedDeadlineUtc: "2026-10-25T00:35:33Z",
    };
    p.nestedOriginalRecordDigests.previousEngineAttempt = {
      report: "4".repeat(64),
      manifest: "5".repeat(64),
      receipt: "6".repeat(64),
    };
    p.nestedOriginalRecordDigests.engineAccounting = p.engineAccountingDigest;
  }
  const encode = () => {
    const bytes = Buffer.from(JSON.stringify(handoff));
    review.handoffSha256 = hash(bytes);
    return bytes;
  };
  return { review, handoff, encode };
}
test("new capsule import remains exact-source operator-local42 evidence, separate from hosted/native acceptance", () => {
  const f = capsuleImportFixture();
  assert.doesNotThrow(() => validateOwnedReview(f.review));
  const value = validateLocalHandoff(f.review, f.encode());
  assert.equal(value.provenance.nativeClassTestsPassed, 42);
  assert.equal(value.nativeAcceptance, "not-tested");
  assert.equal(value.hostedBuild, false);
  assert.equal(value.publicationAllowed, false);
});
test("capsule import rejects wrong source, missing raw roles, profile/DPD/tracer drift and changed original digests before API", () => {
  const changes = [
    (f) => (f.review.sourceLockIdentity = "a".repeat(64)),
    (f) => delete f.review.reviewBinding.evidencePins.nativeJobs,
    (f) => (f.handoff.provenance.nativeClassTestsPassed = 12),
    (f) => (f.handoff.provenance.nativeProfileCounts = [36, 6, 0]),
    (f) => (f.handoff.provenance.securityMacroCount = 60),
    (f) => (f.handoff.provenance.instanceTracerEnabled = true),
    (f) => (f.handoff.provenance.actualSourceFilesVerified = 4),
    (f) =>
      (f.handoff.provenance.reviewedEvidenceDigests.engine = "a".repeat(64)),
    (f) => (f.handoff.hostedBuild = true),
    (f) => (f.handoff.nativeAcceptance = "passed"),
    (f) => (f.handoff.provenance.privatePath = "F:/private"),
    (f) =>
      (f.review.reviewBinding.evidencePins.engineOutput.size =
        64 * 1024 ** 2 + 1),
  ];
  for (const change of changes) {
    const f = capsuleImportFixture();
    change(f);
    assert.throws(() => validateLocalHandoff(f.review, f.encode()));
  }
});

// Synthetic public-import schema facts; no actual new SDK or successful operation2 claim.
test("operation2 import has its own exact20-role review and qualified Clang/accounting provenance", () => {
  const f = capsuleImportFixture(true);
  assert.doesNotThrow(() => validateOwnedReview(f.review));
  const v = validateLocalHandoff(f.review, f.encode());
  assert.equal(v.provenance.engineOperationPolicy.jobs, 12);
  assert.equal(v.nativeAcceptance, "not-tested");
  assert.equal(v.publicationAllowed, false);
});
test("operation2 import denies replaced source, clock, policy, digest and accounting authority", () => {
  const edits = [
    (f) => delete f.review.reviewBinding.evidencePins.engineAccounting,
    (f) =>
      (f.review.reviewBinding.evidencePins.engineAccounting.size =
        2 * 1024 ** 2 + 1),
    (f) =>
      (f.review.reviewBinding.evidencePins.previousEngineAttempt.size =
        1024 ** 2 + 1),
    (f) =>
      (f.handoff.provenance.separatelyObservedClang.sha256 = "a".repeat(64)),
    (f) =>
      (f.handoff.provenance.separatelyObservedClang.qualification =
        "native42-tool8"),
    (f) => (f.handoff.provenance.engineOperationPolicy.jobs = 8),
    (f) => (f.handoff.provenance.engineOperationPolicy.cpuRate = 2000),
    (f) =>
      (f.handoff.provenance.engineOperationPolicy.originalFailedDeadlineUtc =
        "now"),
    (f) => (f.handoff.provenance.engineOperationPolicy.deadlineUtc = "invalid"),
    (f) => (f.handoff.provenance.engineAccountingDigest = "a".repeat(64)),
    (f) =>
      (f.handoff.provenance.nestedOriginalRecordDigests.previousEngineAttempt =
        "b".repeat(64)),
    (f) => (f.handoff.provenance.previousFailedAttemptDigest = "c".repeat(64)),
    (f) => (f.handoff.nativeAcceptance = "passed"),
    (f) => (f.handoff.provenance.unreviewed = "field"),
  ];
  for (const edit of edits) {
    const f = capsuleImportFixture(true);
    edit(f);
    assert.throws(() => validateLocalHandoff(f.review, f.encode()));
  }
});
