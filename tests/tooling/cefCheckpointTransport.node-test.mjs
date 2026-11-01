import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import path from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import * as core from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const source = await fs.readFile(
  "scripts/lib/cef-engineering-checkpoint.mjs",
  "utf8",
);
const ast = ts.createSourceFile(
  "core.mjs",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const body = (name) =>
  ast.statements
    .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
    .getText(ast)
    .replace(/^export /, "");
const producer = {
  repository: "owner/repo",
  repositoryId: 11,
  runId: 22,
  attempt: 1,
  head: "a".repeat(40),
  branch: "main",
  workflow: core.WORKFLOW,
};
const carrier = "c".repeat(40);
const transport = () => ({
  kind: "default-branch-container",
  defaultBranch: "main",
  carrierHead: carrier,
});
const entries = [
  { path: core.WORKFLOW, type: "blob", mode: "100644", sha: "1".repeat(40) },
  {
    path: "scripts/lib/cef-checkpoint-archive.py",
    type: "blob",
    mode: "100644",
    sha: "2".repeat(40),
  },
  {
    path: "scripts/lib/cef-engineering-checkpoint.mjs",
    type: "blob",
    mode: "100644",
    sha: "3".repeat(40),
  },
];
const identity = {
  target: core.TARGET,
  source: core.SOURCE_ID,
  producer: core.codeTreeDigest(entries),
  canonicalRoot: "/Users/runner/work/_temp/sorng-cef-engineering/pinned",
  image: "20260824.0482.1",
  tools: "4".repeat(64),
  graph: "5".repeat(64),
  siso: "6".repeat(64),
};
const pin = (name, bytes) => ({
  name,
  bytes: bytes.length,
  sha256: core.sha(bytes),
});
async function scratch(t) {
  const base = await fs.realpath(tmpdir());
  const root = await fs.mkdtemp(path.join(base, "cef-transport-"));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    assert.match(path.basename(root), /^cef-transport-/);
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
function extract(name, extra = {}) {
  const dependencies = {
    ...core,
    assert,
    JSON,
    Object,
    Buffer,
    path,
    Set,
    positive: (x) => Number.isSafeInteger(x) && x > 0,
    macCensusFactories: new WeakMap(),
    createReadStream,
    writeFile: fs.writeFile,
    readFile: fs.readFile,
    observedQuiet: async () => true,
    ...extra,
  };
  return new Function(
    ...Object.keys(dependencies),
    "return (" + body(name) + ")",
  )(...Object.values(dependencies));
}
const verifyCode = extract("verifyProducerCode");
const finalReadback = extract("verifyTechnicalReadback");
function writer(kind) {
  return extract(
    kind === "checkpoint" ? "uploadCheckpoint" : "uploadSdkBundle",
    { verifyProducerCode: verifyCode, verifyTechnicalReadback: finalReadback },
  );
}
async function fixture(t, kind) {
  const root = await scratch(t),
    blobs = new Map();
  const names =
    kind === "checkpoint"
      ? ["checkpoint-00000.bin", "inventory.json"]
      : core.sdkNames();
  for (const [n, name] of names.entries()) {
    const bytes = Buffer.from(`owned ${name} ${n}`);
    blobs.set(name, bytes);
    await fs.writeFile(path.join(root, name), bytes);
  }
  const compile = {
    outcome: kind === "checkpoint" ? "slice-ended" : "compiler-complete",
    exitCode: kind === "checkpoint" ? null : 0,
    quiescent: true,
    groupId: 123,
    quiescence: "observed-lineage-and-root-group",
    observed: [{ pid: 123, start: "Sat Oct 24 00:00:00 2026" }],
  };
  const manifest = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-checkpoint",
    identity: { ...identity },
    identitySha256: core.validateIdentity(identity),
    producer: { ...producer },
    archive: {
      complete: true,
      chunks: [pin(names[0], blobs.get(names[0]))],
      inventory: pin(names[1], blobs.get(names[1])),
      rawBytes: 100,
      compressedBytes: blobs.get(names[0]).length,
      entries: 2,
      linksIncluded: false,
    },
    compile,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  const completion =
    kind === "sdk"
      ? core.createSdkCompletion({
          producer: { ...producer },
          identity: { ...identity },
          compile,
          distributionExitCode: 0,
          checked: {
            descriptor: { target: core.TARGET },
            identity: { sourceLockSha256: core.SOURCE_ID },
            assets: names.map((name) => ({
              name,
              size: blobs.get(name).length,
              sha256: core.sha(blobs.get(name)),
            })),
          },
        })
      : null;
  return { root, blobs, manifest, completion };
}
function uploadApi(
  f,
  {
    initialTarget = carrier,
    finalEdit,
    refEdit,
    denyRef,
    mutateProducer = false,
  } = {},
) {
  const calls = [],
    uploaded = [];
  let post;
  const api = async (route, options = {}) => {
    calls.push({ route, method: options.method ?? "GET" });
    if (route === "")
      return {
        id: 11,
        full_name: producer.repository,
        private: false,
        visibility: "public",
        default_branch: "main",
      };
    if (route === `actions/workflows/${path.basename(core.WORKFLOW)}`)
      return { id: 66, path: core.WORKFLOW };
    if (route === "actions/runs/22")
      return {
        workflow_id: 66,
        event: "workflow_dispatch",
        head_sha: mutateProducer ? carrier : producer.head,
        head_branch: "main",
        head_repository: { id: 11 },
        run_attempt: 1,
      };
    if (route === `git/commits/${producer.head}`)
      return { sha: producer.head, tree: { sha: "7".repeat(40) } };
    if (route === `git/trees/${"7".repeat(40)}?recursive=1`)
      return { sha: "7".repeat(40), truncated: false, tree: entries };
    if (route === "git/ref/heads/main") {
      if (denyRef) throw denyRef;
      return (
        refEdit?.({
          ref: "refs/heads/main",
          object: { type: "commit", sha: carrier },
        }) ?? {
          ref: "refs/heads/main",
          object: { type: "commit", sha: carrier },
        }
      );
    }
    if (route === "releases") {
      assert.equal(options.method, "POST");
      assert.equal(options.body.target_commitish, carrier);
      assert(
        options.body.body.includes(producer.head) &&
          options.body.body.includes(carrier),
      );
      assert.equal(options.body.make_latest, "false");
      post = options.body;
      return {
        id: 33,
        draft: true,
        prerelease: true,
        tag_name: post.tag_name,
        target_commitish: initialTarget,
      };
    }
    if (route.startsWith("releases/33/assets?name=")) {
      const name = decodeURIComponent(route.split("?name=")[1]);
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, options.bodyBytes);
      const row = {
        id: 44 + uploaded.length,
        name,
        size: bytes.length,
        state: "uploaded",
        digest: `sha256:${core.sha(bytes)}`,
      };
      uploaded.push(row);
      f.blobs.set(name, bytes);
      return row;
    }
    if (route === "releases/33")
      return (
        finalEdit?.({
          id: 33,
          draft: true,
          prerelease: true,
          tag_name: post.tag_name,
          target_commitish: carrier,
        }) ?? {
          id: 33,
          draft: true,
          prerelease: true,
          tag_name: post.tag_name,
          target_commitish: carrier,
        }
      );
    if (route === "releases/33/assets?per_page=100")
      return (
        finalEdit?.(uploaded.map((x) => ({ ...x }))) ??
        uploaded.map((x) => ({ ...x }))
      );
    assert.fail(`unplanned fixed route ${route}`);
  };
  return { api, calls, uploaded };
}
async function upload(f, kind, model) {
  return writer(kind)(model.api, {
    bundle: f.root,
    producer,
    ...(kind === "checkpoint"
      ? { manifest: f.manifest }
      : { completion: f.completion }),
  });
}

test("resolver observes only exact same-repository current main and never accepts a caller carrier or alternate ref", async () => {
  const calls = [];
  const api = async (route) => {
    calls.push(route);
    return route === ""
      ? {
          id: 11,
          full_name: producer.repository,
          private: false,
          visibility: "public",
          default_branch: "main",
        }
      : { ref: "refs/heads/main", object: { type: "commit", sha: carrier } };
  };
  const value = await core.resolveTechnicalTransport(api, producer);
  assert.deepEqual(value, transport());
  assert(Object.isFrozen(value));
  assert.deepEqual(calls, ["", "git/ref/heads/main"]);
  for (const delta of [
    { kind: "source" },
    { defaultBranch: "Main" },
    { carrierHead: "main" },
    { carrierHead: "C".repeat(40) },
    { carrierHead: producer.head, extra: true },
  ])
    assert.throws(() =>
      core.validateTechnicalTransport({ ...transport(), ...delta }),
    );
  for (const ref of [
    { ref: "refs/tags/main", object: { type: "commit", sha: carrier } },
    { ref: "refs/heads/main", object: { type: "tag", sha: carrier } },
    { ref: "refs/heads/main", object: { type: "commit", sha: "bad" } },
  ])
    await assert.rejects(
      core.resolveTechnicalTransport(
        async (route) =>
          route === ""
            ? {
                id: 11,
                full_name: producer.repository,
                private: false,
                visibility: "public",
                default_branch: "main",
              }
            : ref,
        producer,
      ),
      /Technical transport ref mismatch|Exact technical transport carrier required/,
    );
  for (const visibility of [undefined, "internal", "private"]) {
    const routes = [];
    await assert.rejects(
      core.resolveTechnicalTransport(async (route) => {
        routes.push(route);
        return {
          id: 11,
          full_name: producer.repository,
          private: false,
          visibility,
          default_branch: "main",
        };
      }, producer),
      /Technical transport repository mismatch/,
    );
    assert.deepEqual(routes, [""]);
  }
  await assert.rejects(
    core.resolveTechnicalTransport(api, { ...producer, branch: "other" }),
  );
});
test("API client adds only the exact main read and retains all cross-ref and write fences", async () => {
  const calls = [];
  const api = core.apiClient(
    producer.repository,
    "fixture-token",
    async (url, options) => {
      calls.push([url, options.method]);
      return new Response("{}");
    },
    { readOnly: true },
  );
  await api("git/ref/heads/main");
  assert.equal(calls.length, 1);
  for (const route of [
    "git/ref/heads/Main",
    "git/ref/heads/other",
    "git/refs/heads/main",
    "git/ref/heads/main?x=1",
    "git/ref/tags/main",
    "git/ref/heads/main/../other",
  ])
    await assert.rejects(api(route), /Closed same-repository/);
  for (const method of ["POST", "PATCH", "DELETE"])
    await assert.rejects(
      api("git/ref/heads/main", { method }),
      /Restore API is GET-only/,
    );
  assert.equal(calls.length, 1);
});
test("workflow-permission403 is terminal and does not retry a different release carrier", async () => {
  let requests = 0;
  const api = core.apiClient(
    producer.repository,
    "fixture",
    async () => {
      requests++;
      return new Response(
        JSON.stringify({ message: "Resource not accessible by integration" }),
        { status: 403 },
      );
    },
    { log: () => {} },
  );
  await assert.rejects(
    api("releases", {
      method: "POST",
      body: {
        tag_name: "technical-fixture",
        target_commitish: carrier,
        draft: true,
        prerelease: true,
        make_latest: "false",
      },
    }),
    /Checkpoint GitHub operation failed/,
  );
  assert.equal(requests, 1);
});
for (const kind of ["checkpoint", "sdk"]) {
  test(`${kind} writer seals carrier separately and retains original build source only after final exact readback`, async (t) => {
    const f = await fixture(t, kind),
      model = uploadApi(f);
    const original = core.canonical(
      kind === "checkpoint" ? f.manifest : f.completion,
    );
    const seal = await upload(f, kind, model);
    assert.equal(seal.schemaVersion, 2);
    assert.equal(seal.producer.head, producer.head);
    assert.deepEqual({ ...seal.transport }, transport());
    assert.equal(
      core.canonical(kind === "checkpoint" ? f.manifest : f.completion),
      original,
    );
    if (kind === "checkpoint") {
      assert.equal(
        JSON.parse(f.blobs.get("manifest.json")).producer.head,
        producer.head,
      );
      assert(!f.blobs.get("manifest.json").includes(Buffer.from(carrier)));
    } else {
      assert.equal(seal.completionSha256, core.completionSha(f.completion));
      assert.equal(seal.completion.producer.head, producer.head);
    }
    const paths = model.calls.map((x) => x.route),
      post = paths.indexOf("releases");
    assert.equal(paths[post - 1], "git/ref/heads/main");
    assert(paths.indexOf(`git/commits/${producer.head}`) < post);
    assert.deepEqual(paths.slice(-2).sort(), [
      "releases/33",
      "releases/33/assets?per_page=100",
    ]);
    const legacy = { ...seal, schemaVersion: 1 };
    delete legacy.transport;
    const validate =
      kind === "checkpoint"
        ? (s) => core.validateSeal(s, producer)
        : (s) => core.validateSdkSeal(s, producer);
    validate(legacy);
    validate(seal);
    const foreign = { ...producer, branch: "Main" };
    assert.throws(
      () =>
        kind === "checkpoint"
          ? core.validateSeal({ ...seal, producer: foreign }, foreign)
          : core.validateSdkSeal({ ...seal, producer: foreign }, foreign),
      /Technical transport producer branch mismatch/,
    );
    for (const invalid of [
      { ...seal, schemaVersion: 1 },
      { ...legacy, schemaVersion: 2 },
      { ...seal, transport: { ...transport(), extra: true } },
      { ...seal, schemaVersion: 3 },
    ])
      assert.throws(() => validate(invalid));
  });
  test(`${kind} writer refuses mixed initial targets and changed final release or asset metadata`, async (t) => {
    for (const edit of [
      { initialTarget: producer.head },
      {
        finalEdit: (value) =>
          Array.isArray(value)
            ? value
            : { ...value, target_commitish: producer.head },
      },
      {
        finalEdit: (value) =>
          Array.isArray(value) ? value : { ...value, draft: false },
      },
      { finalEdit: (value) => (Array.isArray(value) ? value.slice(1) : value) },
      {
        finalEdit: (value) =>
          Array.isArray(value)
            ? value.map((x, i) =>
                i === 0 ? { ...x, digest: "sha256:" + "0".repeat(64) } : x,
              )
            : value,
      },
      { mutateProducer: true },
    ]) {
      const f = await fixture(t, kind),
        model = uploadApi(f, edit);
      await assert.rejects(upload(f, kind, model));
      if (edit.initialTarget) assert.equal(model.uploaded.length, 0);
      if (edit.mutateProducer)
        assert(!model.calls.some((x) => x.route === "git/ref/heads/main"));
    }
  });
  test(`${kind} carrier failure is not a producer-HEAD fallback or a permission retry`, async (t) => {
    const f = await fixture(t, kind),
      marker = Error("fixed carrier read refusal"),
      model = uploadApi(f, { denyRef: marker });
    await assert.rejects(upload(f, kind, model), (error) => error === marker);
    assert(!model.calls.some((x) => x.method === "POST"));
  });
}

test("v1 and v2 readers retain independent original producer/code checks and never require carrier still current main", async (t) => {
  const python = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(python.status, 0, python.stderr);
  for (const kind of ["checkpoint", "sdk"]) {
    const f = await fixture(t, kind),
      model = uploadApi(f),
      v2 = await upload(f, kind, model);
    for (const version of [1, 2]) {
      const seal = JSON.parse(core.canonical(v2));
      seal.schemaVersion = version;
      if (version === 1) delete seal.transport;
      const zip = path.join(f.root, `seal-${version}.zip`);
      const packed = spawnSync(
        python.stdout.trim(),
        [
          "-I",
          "-B",
          "-c",
          "import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w')as z:z.writestr('seal.json',sys.argv[2])",
          zip,
          core.canonical(seal),
        ],
        { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
      );
      assert.equal(packed.status, 0, packed.stderr);
      const zipBytes = await fs.readFile(zip),
        calls = [];
      let wrongTarget = false,
        wrongProducer = false;
      const request = async (url, options) => {
        assert.equal(options.method ?? "GET", "GET");
        const base = `https://api.github.com/repos/${producer.repository}`;
        assert(String(url) === base || String(url).startsWith(base + "/"));
        const route = String(url).slice(base.length).replace(/^\//, "");
        calls.push(route);
        if (route === "actions/artifacts/55/zip") return new Response(zipBytes);
        const asset = /^releases\/assets\/(\d+)$/.exec(route);
        if (asset) {
          const row = seal.assets.find((x) => x.id === Number(asset[1]));
          return new Response(f.blobs.get(row.name));
        }
        const rows = {
          "": {
            id: 11,
            full_name: producer.repository,
            private: false,
            visibility: "public",
            default_branch: "main",
          },
          [`actions/workflows/${path.basename(core.WORKFLOW)}`]: {
            id: 66,
            path: core.WORKFLOW,
          },
          "actions/runs/22": {
            id: 22,
            workflow_id: 66,
            event: "workflow_dispatch",
            head_sha: wrongProducer ? carrier : producer.head,
            head_branch: "main",
            head_repository: { id: 11 },
            run_attempt: 1,
            status: "completed",
            conclusion: kind === "sdk" ? "success" : "failure",
          },
          "actions/runs/22/artifacts?per_page=100": {
            total_count: 1,
            artifacts: [
              {
                id: 55,
                name:
                  kind === "sdk"
                    ? core.sdkSealName(producer)
                    : "cef-engineering-seal-22-1",
                expired: false,
                size_in_bytes: zipBytes.length,
                digest: `sha256:${core.sha(zipBytes)}`,
                workflow_run: { id: 22, head_sha: producer.head },
              },
            ],
          },
          "releases/33": {
            id: 33,
            draft: true,
            prerelease: true,
            tag_name: seal.release.tag,
            target_commitish: wrongTarget
              ? version === 1
                ? carrier
                : producer.head
              : version === 1
                ? producer.head
                : carrier,
          },
          "releases/33/assets?per_page=100": seal.assets.map((x) => ({
            id: x.id,
            name: x.name,
            size: x.bytes,
            state: "uploaded",
            digest: `sha256:${x.sha256}`,
          })),
          [`git/commits/${producer.head}`]: {
            sha: producer.head,
            tree: { sha: "7".repeat(40) },
          },
          [`git/trees/${"7".repeat(40)}?recursive=1`]: {
            sha: "7".repeat(40),
            truncated: false,
            tree: entries,
          },
        };
        assert(Object.hasOwn(rows, route), route);
        return new Response(JSON.stringify(rows[route]));
      };
      const transfer = (name) => {
        const api = core.apiClient(producer.repository, "fixture", request, {
          readOnly: true,
        });
        const common = {
          repository: producer.repository,
          token: "fixture",
          destination: path.join(f.root, name),
          python: python.stdout.trim(),
          helper: path.resolve("scripts/lib/cef-checkpoint-archive.py"),
          request,
        };
        return kind === "checkpoint"
          ? core.restoreDownload(api, { ...common, runId: 22 })
          : core.downloadSdkBundle(api, {
              ...common,
              selection: {
                producer: "engineering-sdk",
                target: core.TARGET,
                runId: 22,
                runAttempt: 1,
                headSha: producer.head,
                artifactId: 55,
                artifactSha256: core.sha(zipBytes),
                completionSha256: seal.completionSha256,
                descriptorSha256: seal.completion.bundleAssets.find(
                  (x) => x.name === "runtime.json",
                ).sha256,
              },
            });
      };
      const result = await transfer(`good-${version}`);
      assert.equal(result.runtimeReady, false);
      assert(calls.includes(`git/commits/${producer.head}`));
      assert(!calls.some((x) => x.startsWith("git/ref/")));
      if (kind === "sdk")
        assert.equal(
          core.sha(
            await fs.readFile(
              path.join(f.root, `good-${version}`, "sdk-completion-proof.json"),
            ),
          ),
          seal.completionSha256,
        );
      wrongTarget = true;
      await assert.rejects(transfer(`bad-target-${version}`));
      wrongTarget = false;
      wrongProducer = true;
      await assert.rejects(transfer(`bad-producer-${version}`));
    }
  }
});
