import test from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
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
  downloadAsset,
  canonical,
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
test("workflow seal is LAST, default-branch/manual/read-only and contains no SDK compiler or publication", async () => {
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
  assert.match(value.jobs.import.if, /repository.default_branch/);
  const steps = value.jobs.import.steps,
    last = steps.at(-1);
  assert.match(last.uses, /actions\/upload-artifact@/);
  assert.match(last.with.path, /\/seal.json$/);
  assert.equal(last.if, undefined);
  assert.ok(
    steps
      .slice(0, -1)
      .some((row) => row.run === "node scripts/cef-owned-sdk-import.mjs seal"),
  );
  assert.doesNotMatch(
    steps.map((row) => row.run ?? "").join("\n"),
    /cargo|autoninja|--execute|publish|quarantine-upload/,
  );
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
