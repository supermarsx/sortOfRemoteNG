// Protected engineering publication of genuinely imported local bytes.
// Native execution belongs to the independently authenticated acceptance run.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAcceptanceSeal,
  producerSelection,
  verifyAcceptanceBundle,
} from "../cef-runtime-acceptance-ci.mjs";
import { publish } from "../cef-runtime-ci.mjs";
import {
  OWNED_REPOSITORY,
  readOwnedImportReview,
  downloadOwnedImport,
  parseOwnedJson,
  verifyImportProducer,
  ownedDraft,
} from "./cef-owned-sdk-import.mjs";
import {
  archiveCommand,
  canonical,
  downloadAsset,
} from "./cef-engineering-checkpoint.mjs";

export const PUBLICATION_WORKFLOW =
  ".github/workflows/cef-owned-sdk-publish.yml";
const NATIVE_WORKFLOW = ".github/workflows/cef-runtime-acceptance.yml";
const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assert = (condition, message) => {
  if (!condition)
    throw Object.assign(new Error(message), {
      code: "OWNED_PUBLICATION_GUARD",
    });
};
const exact = (value, keys) =>
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === [...keys].sort().join(),
    "Closed owned-publication fields required",
  );
const digest = (value, size = 64) =>
  assert(
    typeof value === "string" &&
      new RegExp(`^[a-f0-9]{${size}}$`).test(value) &&
      !/^0+$/.test(value),
    "Invalid owned-publication digest",
  );
const positive = (value) =>
  assert(
    Number.isSafeInteger(value) && value > 0,
    "Exact positive owned-publication identifier required",
  );

export function validatePublicationReview(value) {
  exact(value, [
    "schemaVersion",
    "kind",
    "target",
    "sourceLockIdentity",
    "descriptorSha256",
    "producer",
    "acceptance",
  ]);
  assert(
    value.schemaVersion === 1 &&
      value.kind === "sorng-cef-owned-publication-review",
    "Owned publication review required",
  );
  digest(value.sourceLockIdentity);
  digest(value.descriptorSha256);
  producerSelection([value.producer]);
  assert(
    value.producer.producer === "owned-import" &&
      value.target === value.producer.target &&
      value.descriptorSha256 === value.producer.descriptorSha256,
    "Exact owned import target/descriptor required",
  );
  exact(value.acceptance, [
    "runId",
    "runAttempt",
    "headSha",
    "sourceTree",
    "codeSha256",
    "artifactId",
    "artifactSha256",
    "sealSha256",
    "nativeReportSha256",
  ]);
  for (const key of ["runId", "runAttempt", "artifactId"])
    positive(value.acceptance[key]);
  for (const key of ["headSha", "sourceTree"])
    digest(value.acceptance[key], 40);
  for (const key of [
    "codeSha256",
    "artifactSha256",
    "sealSha256",
    "nativeReportSha256",
  ])
    digest(value.acceptance[key]);
  return value;
}

export function publicationReviewPath(value) {
  assert(
    typeof value === "string" &&
      /^native\/cef-owned-sdk-imports\/[a-z0-9][a-z0-9.-]{0,95}\/publication\.json$/.test(
        value,
      ),
    "Committed publication-review path required",
  );
  return value;
}

export async function readPublicationReview(root, relative, rawSha, head) {
  publicationReviewPath(relative);
  digest(rawSha);
  digest(head, 40);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      timeout: 10000,
      maxBuffer: 1024 ** 2,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  assert(
    git("rev-parse", "HEAD").toString().trim() === head &&
      git("status", "--porcelain=v1", "--untracked-files=no").length === 0,
    "Clean committed publication checkout required",
  );
  const entry = git("ls-tree", "-z", "HEAD", "--", relative).toString();
  assert(
    /^100644 blob [a-f0-9]{40}\t/.test(entry) &&
      entry.endsWith(`${relative}\0`),
    "Regular committed publication review required",
  );
  const bytes = git("show", `HEAD:${relative}`);
  assert(
    bytes.length > 0 && bytes.length <= 65536 && sha(bytes) === rawSha,
    "Committed publication review raw digest differs",
  );
  // The authoritative raw bytes are the Git blob, unaffected by host EOL filters.
  return validatePublicationReview(parseOwnedJson(bytes.toString("utf8")));
}

// GitHub recursive trees include Gitlinks and executable/symlink modes. Match
// actual `git ls-tree -r -z --full-tree HEAD` bytes, not JSON/locale ordering.
export function nativeCodeTreeDigest(tree) {
  assert(
    tree &&
      tree.truncated === false &&
      Array.isArray(tree.tree) &&
      tree.tree.length > 0 &&
      tree.tree.length <= 100000,
    "Complete bounded native acceptance tree required",
  );
  const seen = new Set();
  const rows = [];
  for (const entry of tree.tree) {
    assert(
      typeof entry.path === "string" &&
        entry.path.length <= 4096 &&
        !entry.path.includes("\0") &&
        entry.path
          .split("/")
          .every((part) => part && part !== "." && part !== "..") &&
        Buffer.from(entry.path).toString("utf8") === entry.path &&
        !seen.has(entry.path),
      "Invalid native acceptance tree path",
    );
    seen.add(entry.path);
    digest(entry.sha, 40);
    if (entry.type === "tree") {
      assert(entry.mode === "040000", "Invalid native tree mode");
      continue;
    }
    assert(
      (entry.type === "blob" &&
        ["100644", "100755", "120000"].includes(entry.mode)) ||
        (entry.type === "commit" && entry.mode === "160000"),
      "Invalid native acceptance Git mode/type",
    );
    rows.push(entry);
  }
  assert(rows.length > 0, "Native acceptance source files required");
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return sha(
    Buffer.concat(
      rows.map((row) =>
        Buffer.from(`${row.mode} ${row.type} ${row.sha}\t${row.path}\0`),
      ),
    ),
  );
}

export async function verifyNativeAcceptanceMetadata(api, review) {
  validatePublicationReview(review);
  const selected = review.acceptance;
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api("actions/workflows/cef-runtime-acceptance.yml"),
    api(`actions/runs/${selected.runId}`),
  ]);
  assert(
    repo.full_name === OWNED_REPOSITORY &&
      repo.private === false &&
      typeof repo.default_branch === "string" &&
      repo.default_branch.length > 0,
    "Public default native acceptance repository required",
  );
  positive(repo.id);
  positive(workflow.id);
  assert(
    workflow.path === NATIVE_WORKFLOW &&
      run.id === selected.runId &&
      run.run_attempt === selected.runAttempt &&
      run.head_sha === selected.headSha &&
      run.head_branch === repo.default_branch &&
      run.workflow_id === workflow.id &&
      run.path === NATIVE_WORKFLOW &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.repository?.id === repo.id &&
      run.head_repository?.id === repo.id &&
      run.repository?.full_name === OWNED_REPOSITORY &&
      run.head_repository?.full_name === OWNED_REPOSITORY,
    "Exact successful default native acceptance attempt required",
  );
  const [artifact, commit] = await Promise.all([
    api(`actions/artifacts/${selected.artifactId}`),
    api(`git/commits/${selected.headSha}`),
  ]);
  assert(
    artifact.id === selected.artifactId &&
      artifact.name ===
        `cef-native-acceptance-seal-${review.target}-${selected.runId}-${selected.runAttempt}` &&
      artifact.expired === false &&
      artifact.digest === `sha256:${selected.artifactSha256}` &&
      artifact.workflow_run?.id === selected.runId &&
      artifact.workflow_run?.head_sha === selected.headSha &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes < 1024 ** 2,
    "Exact independent native acceptance artifact required",
  );
  assert(
    commit.sha === selected.headSha && commit.tree?.sha === selected.sourceTree,
    "Native acceptance source commit/tree differs",
  );
  const tree = await api(`git/trees/${selected.sourceTree}?recursive=1`);
  assert(
    tree.sha === selected.sourceTree &&
      nativeCodeTreeDigest(tree) === selected.codeSha256,
    "Reviewed native acceptance source code differs",
  );
  return { repo, artifact };
}

export function verifyNativeAcceptanceSeal(seal, review, repo) {
  validatePublicationReview(review);
  exact(seal, [
    "schemaVersion",
    "kind",
    "execution",
    "target",
    "producer",
    "sourceLockIdentity",
    "descriptorSha256",
    "nativeHost",
    "report",
    "reports",
    "builds",
    "ingestion",
    "hostedBuild",
    "nativeAcceptance",
    "productionReady",
    "publicationAllowed",
  ]);
  assert(
    seal.schemaVersion === 1 &&
      seal.kind === "sorng-cef-native-acceptance-seal" &&
      seal.nativeAcceptance === true &&
      seal.productionReady === false &&
      seal.publicationAllowed === false &&
      seal.hostedBuild === false &&
      seal.ingestion === "operator-reviewed-local-bytes",
    "Only successful native owned-import acceptance may publish",
  );
  exact(seal.execution, [
    "repository",
    "repositoryId",
    "runId",
    "runAttempt",
    "sourceSha",
    "workflow",
    "workflowRef",
    "ref",
    "event",
    "sourceTree",
    "codeSha256",
    "codeDigestFormat",
  ]);
  exact(seal.report, ["path", "sha256"]);
  const selected = review.acceptance;
  const execution = seal.execution;
  assert(
    execution.repository === OWNED_REPOSITORY &&
      execution.repositoryId === repo.id &&
      execution.runId === selected.runId &&
      execution.runAttempt === selected.runAttempt &&
      execution.sourceSha === selected.headSha &&
      execution.sourceTree === selected.sourceTree &&
      execution.codeSha256 === selected.codeSha256 &&
      execution.ref === `refs/heads/${repo.default_branch}` &&
      execution.workflowRef ===
        `${OWNED_REPOSITORY}/${NATIVE_WORKFLOW}@refs/heads/${repo.default_branch}` &&
      seal.report.path === "native-acceptance.json" &&
      seal.report.sha256 === selected.nativeReportSha256 &&
      seal.target === review.target &&
      seal.sourceLockIdentity === review.sourceLockIdentity &&
      seal.descriptorSha256 === review.descriptorSha256 &&
      canonical(seal.producer) === canonical(review.producer),
    "Native acceptance seal source/attempt/producer differs",
  );
  const { sourceTree, codeSha256, codeDigestFormat, ...identity } = execution;
  const result = {
    schemaVersion: 1,
    kind: "sorng-cef-native-acceptance-run",
    target: seal.target,
    producer: { ...seal.producer, sourceLockIdentity: seal.sourceLockIdentity },
    ingestion: seal.ingestion,
    hostedBuild: false,
    acceptanceSourceSha: execution.sourceSha,
    acceptanceWorkflowRunId: execution.runId,
    nativeHost: seal.nativeHost,
    sourceLockIdentity: seal.sourceLockIdentity,
    descriptorSha256: seal.descriptorSha256,
    reports: seal.reports,
    builds: seal.builds,
    ok: true,
    nativeExecutionPerformed: true,
    publicProviderAcceptance: false,
    productionReady: false,
    publicationAllowed: false,
  };
  const checked = createAcceptanceSeal(result, {
    execution: identity,
    code: { sourceTree, codeSha256, codeDigestFormat },
    reportSha256: seal.report.sha256,
  });
  assert(
    canonical(checked) === canonical(seal),
    "Complete native acceptance seal differs",
  );
  return seal;
}

// The unchanged strict archive helper validates/parses the one-member seal.
// This fixed stdlib probe additionally hashes the ORIGINAL member bytes, without
// extracting them or passing any GitHub credentials to a subprocess.
export function rawAcceptanceSealSha(python, zip, expectedZipSha) {
  assert(
    path.isAbsolute(python) && path.isAbsolute(zip),
    "Absolute owned seal tools required",
  );
  digest(expectedZipSha);
  const script =
    "import sys,hashlib,zipfile\np=sys.argv[1]\nb=open(p,'rb').read(1048576)\nassert len(b)<1048576 and hashlib.sha256(b).hexdigest()==sys.argv[2]\nwith zipfile.ZipFile(p) as z:\n assert z.namelist()==['seal.json']\n e=z.getinfo('seal.json')\n assert 0<e.file_size<1048576 and not e.flag_bits&1\n b=z.read(e)\n assert len(b)==e.file_size\n print(hashlib.sha256(b).hexdigest())\n";
  const output = execFileSync(
    python,
    ["-I", "-B", "-c", script, zip, expectedZipSha],
    publicationPythonOptions(python),
  )
    .toString()
    .trim();
  digest(output);
  return output;
}

export function publicationPythonOptions(python) {
  assert(path.isAbsolute(python), "Absolute publication Python required");
  return {
    timeout: 10000,
    maxBuffer: 256,
    windowsHide: true,
    env: { PATH: path.dirname(python) },
    stdio: ["ignore", "pipe", "ignore"],
  };
}

export async function verifyOwnedPublication(
  {
    review,
    api,
    ownedApi,
    token,
    destination,
    python,
    request = fetch,
    root = ROOT,
  },
  dependencies = {},
) {
  validatePublicationReview(review);
  const { repo, artifact } = await verifyNativeAcceptanceMetadata(api, review);
  const ownedReview = await (
    dependencies.readOwnedReview ?? readOwnedImportReview
  )(root, review.producer.reviewedImport, review.producer.reviewSha256);
  assert(
    ownedReview.target === review.target &&
      ownedReview.sourceLockIdentity === review.sourceLockIdentity &&
      ownedReview.descriptorSha256 === review.descriptorSha256,
    "Committed import review source/target differs",
  );
  assert(
    path.isAbsolute(destination) && path.isAbsolute(python),
    "Private absolute publication paths required",
  );
  await mkdir(destination);
  const zip = path.join(destination, "native-seal.zip");
  await (dependencies.download ?? downloadAsset)(
    OWNED_REPOSITORY,
    token,
    `/actions/artifacts/${review.acceptance.artifactId}/zip`,
    zip,
    { bytes: artifact.size_in_bytes, sha256: review.acceptance.artifactSha256 },
    { request, maximum: 1024 ** 2, deadline: Date.now() + 20 * 60000 },
  );
  const seal = await (dependencies.extract ?? archiveCommand)(
    python,
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ["seal", "--input", zip, "--output", destination],
    { timeout: 15000 },
  );
  assert(
    (dependencies.rawSealSha ?? rawAcceptanceSealSha)(
      python,
      zip,
      review.acceptance.artifactSha256,
    ) === review.acceptance.sealSha256,
    "Independent raw native seal digest differs",
  );
  verifyNativeAcceptanceSeal(seal, review, repo);
  const bundle = path.join(destination, "bundle");
  const completion = await (dependencies.downloadImport ?? downloadOwnedImport)(
    ownedApi,
    {
      selection: review.producer,
      review: ownedReview,
      repository: OWNED_REPOSITORY,
      token,
      destination: bundle,
      python,
      request,
    },
  );
  const checked = await (dependencies.verifyBundle ?? verifyAcceptanceBundle)({
    bundle,
    selection: review.producer,
    repository: OWNED_REPOSITORY,
    expectedLock: review.sourceLockIdentity,
  });
  assert(
    checked.descriptor.target === review.target &&
      checked.descriptorSha256 === review.descriptorSha256 &&
      checked.identity.sourceLockSha256 === review.sourceLockIdentity &&
      completion.hostedBuild === false &&
      completion.reviewSha256 === review.producer.reviewSha256,
    "Final imported bundle/provenance differs",
  );
  // Large downloads must not turn a superseded run/attempt or changed draft
  // into publication authority. Re-attest both chains after the last byte check.
  await verifyNativeAcceptanceMetadata(api, review);
  if (dependencies.recheckImport) {
    await dependencies.recheckImport(completion, ownedReview);
  } else {
    await verifyImportProducer(ownedApi, completion.producer, {
      completed: true,
    });
    const latest = await ownedDraft(
      ownedApi,
      ownedReview,
      review.producer.reviewSha256,
      completion.release.id,
    );
    assert(
      canonical(latest) ===
        canonical({ release: completion.release, assets: completion.assets }),
      "Owned import changed before publication",
    );
  }
  return {
    bundle,
    key: checked.identity.key,
    target: review.target,
    acceptance: review.acceptance,
    originalImport: completion,
    seal,
  };
}

export async function publishOwnedSdk(options, client, dependencies = {}) {
  digest(options.commit, 40);
  // Fresh download/authentication in the protected job; no verifier-job output
  // or uploaded bundle can bypass these checks after environment approval.
  const checked = await verifyOwnedPublication(options, dependencies);
  await dependencies.beforePublish?.();
  const result = await (dependencies.publish ?? publish)(
    {
      bundle: checked.bundle,
      repository: OWNED_REPOSITORY,
      execute: true,
      commit: options.commit,
    },
    client,
  );
  assert(
    result.productionReady === false && result.prerelease === true,
    "Engineering publication only",
  );
  return {
    ...result,
    ingestion: "operator-reviewed-local-bytes",
    hostedBuild: false,
    originalBuildReplayed: false,
    sourceLockIdentity: options.review.sourceLockIdentity,
    importCompletion: checked.originalImport,
    nativeAcceptance: checked.acceptance,
    productionReady: false,
  };
}

export function publicationApi(token, request = fetch) {
  assert(
    typeof token === "string" && token.length > 0,
    "Publication metadata token required",
  );
  const deadline = Date.now() + 20 * 60000;
  return async (route) => {
    assert(
      /^(?:|actions\/workflows\/(?:cef-runtime-acceptance|cef-owned-sdk-publish)\.yml|actions\/runs\/[1-9][0-9]*|actions\/artifacts\/[1-9][0-9]*|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/.test(
        route,
      ) && Date.now() < deadline,
      "Closed read-only publication metadata route required",
    );
    const response = await request(
      `https://api.github.com/repos/${OWNED_REPOSITORY}${route ? `/${route}` : ""}`,
      {
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(Math.min(30000, deadline - Date.now())),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Publication metadata request failed");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      assert(bytes <= 8 * 1024 ** 2, "Publication metadata byte bound");
      chunks.push(chunk);
    }
    return parseOwnedJson(Buffer.concat(chunks).toString("utf8"));
  };
}

export async function publicationAuthority(env, api, { write = false } = {}) {
  assert(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      env.GITHUB_REPOSITORY === OWNED_REPOSITORY &&
      /^refs\/heads\/[^\s\x00-\x1f\x7f]{1,240}$/.test(env.GITHUB_REF ?? "") &&
      env.GITHUB_WORKFLOW_REF ===
        `${OWNED_REPOSITORY}/${PUBLICATION_WORKFLOW}@${env.GITHUB_REF}` &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      (!write || env.CEF_OWNED_PUBLISH_APPROVED === "true"),
    "Protected manual owned publisher required",
  );
  digest(env.GITHUB_SHA, 40);
  for (const key of [
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_REPOSITORY_ID",
  ]) {
    assert(
      /^[1-9][0-9]*$/.test(env[key] ?? ""),
      "Exact publisher identifiers required",
    );
    positive(Number(env[key]));
  }
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api("actions/workflows/cef-owned-sdk-publish.yml"),
    api(`actions/runs/${env.GITHUB_RUN_ID}`),
  ]);
  assert(
    repo.full_name === OWNED_REPOSITORY &&
      repo.private === false &&
      repo.id === Number(env.GITHUB_REPOSITORY_ID) &&
      workflow.path === PUBLICATION_WORKFLOW &&
      Number.isSafeInteger(workflow.id) &&
      workflow.id > 0 &&
      env.GITHUB_REF === `refs/heads/${repo.default_branch}` &&
      env.GITHUB_WORKFLOW_REF ===
        `${OWNED_REPOSITORY}/${PUBLICATION_WORKFLOW}@${env.GITHUB_REF}` &&
      run.id === Number(env.GITHUB_RUN_ID) &&
      run.run_attempt === Number(env.GITHUB_RUN_ATTEMPT) &&
      run.head_sha === env.GITHUB_SHA &&
      run.head_branch === repo.default_branch &&
      run.path === PUBLICATION_WORKFLOW &&
      run.workflow_id === workflow.id &&
      run.event === "workflow_dispatch" &&
      run.status === "in_progress" &&
      run.repository?.id === repo.id &&
      run.head_repository?.id === repo.id &&
      run.repository?.full_name === OWNED_REPOSITORY &&
      run.head_repository?.full_name === OWNED_REPOSITORY,
    "Exact default-branch publisher job required",
  );
  return repo;
}

export async function privatePublicationOutput(temp, requested) {
  const parent = await realpath(temp);
  assert(
    path.isAbsolute(requested) &&
      path.dirname(path.resolve(requested)) === parent &&
      path.basename(requested) === "cef-owned-publication",
    "Fresh immediate runner-temp publication output required",
  );
  const stamp = await lstat(parent);
  assert(
    stamp.isDirectory() && !stamp.isSymbolicLink(),
    "Canonical private runner temp required",
  );
  return requested;
}
