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
function oldProducer() {
  return {
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: 1010282954,
    runId: M.runId,
    attempt: 1,
    head: M.head,
    branch: "main",
    workflow: core.WORKFLOW,
  };
}
function manifest(identity, inventory) {
  return {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-checkpoint",
    identity,
    identitySha256: core.validateIdentity(identity),
    producer: oldProducer(),
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
async function fixture(t) {
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
  const oldManifest = manifest(identity, inventory),
    manifestBytes = rawJson(oldManifest);
  const seal = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-seal",
    producer: oldProducer(),
    identitySha256: oldManifest.identitySha256,
    release: {
      id: 15,
      tag: `cef-checkpoint-${M.target}-${oldManifest.identitySha256.slice(0, 16)}-${M.runId}-1`,
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
    restoreRun: M.runId,
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

test("inactive retarget binds the actual main3aa129-row producer and canonical LF helper without inventing a seal", async () => {
  assert.equal(M.runId, 41378060040);
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
  await assert.rejects(fs.lstat(path.join(ROOT, M.policyPath)), {
    code: "ENOENT",
  });
  const archive = "scripts/lib/cef-checkpoint-archive.py";
  const canonical = git(ROOT, [
    "-c",
    "core.longpaths=true",
    "cat-file",
    "blob",
    "HEAD:" + archive,
  ]);
  assert.equal(canonical.length, 181586);
  assert.equal(
    core.sha(canonical),
    "839ed8a3be5f81dd7778bf7fb4d76209d7e64342ec9387dc323d5c280098165d",
  );
  const physical = await fs.readFile(path.join(ROOT, archive));
  assert.deepEqual(
    Buffer.from(physical.toString("utf8").replaceAll("\r\n", "\n")),
    canonical,
    "Windows physical18c bytes differ only by CRLF; proof remains canonical839, not a new source pin",
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
    "refs/heads/codex/linux-arm-3aa-producer-migration-20261102",
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

test("original deadline failure survives without invoking Git or a restore callback", async () => {
  const primary = new Error("original lease expired");
  await assert.rejects(
    migration.inspectLinuxMigrationCandidate({
      restoreRun: M.runId,
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
