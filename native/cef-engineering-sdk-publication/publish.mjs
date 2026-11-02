// Publication adapter for completed hosted engineering SDKs. Import is inert.
// This excluded adapter does not change the fixed engineering producer source.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main as ownedMain } from "../../scripts/cef-owned-sdk-publish.mjs";
import {
  acceptanceCodeIdentity,
  createAcceptanceSeal,
  producerSelection,
  verifyAcceptanceBundle,
  verifiedAcceptanceSourceLock,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";
import { githubClient, publish } from "../../scripts/cef-runtime-ci.mjs";
import {
  nativeCodeTreeDigest,
  privatePublicationOutput,
  publicationApi,
  publicationAuthority,
  rawAcceptanceSealSha,
  validatePublicationReview,
} from "../../scripts/lib/cef-owned-sdk-publish.mjs";
import {
  apiClient,
  archiveCommand,
  canonical,
  checkpointProfile,
  codeTreeDigest,
  completionSha,
  downloadAsset,
  downloadSdkBundle,
  sdkSealName,
  validateSdkCompletion,
  validateSdkSeal,
  verifyProducer,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REPOSITORY = "supermarsx/sortOfRemoteNG";
const NATIVE_WORKFLOW = ".github/workflows/cef-runtime-acceptance.yml";
export const ENGINEERING_PRODUCER =
  "bd8e67ca51e817002781f4d047e3f813fa1069f3aa686fc44f61fc14de899106";
export const ENGINEERING_PRODUCERS = Object.freeze({
  // Source binding only. A future actual successful run and both independent
  // completion/native seals are still mandatory; no failed run is selected.
  "aarch64-unknown-linux-gnu":
    "9da5a2b3fefbd4f03d53bfb24cac0941d7852adf8bc3529721efcfab5ec3780c",
  "x86_64-apple-darwin": ENGINEERING_PRODUCER,
  "aarch64-apple-darwin": ENGINEERING_PRODUCER,
});
export const ENGINEERING_REVIEW_KIND =
  "sorng-cef-engineering-sdk-publication-review";
const TARGETS = [
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
function need(condition, code) {
  if (!condition)
    throw Object.assign(new Error(code), {
      code: "ENGINEERING_PUBLICATION_DENIED",
    });
}
function exact(value, fields) {
  need(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === [...fields].sort().join(),
    "ENGINEERING_FIELDS",
  );
}
function digest(value, size = 64) {
  need(
    typeof value === "string" &&
      new RegExp(`^[a-f0-9]{${size}}$`).test(value) &&
      !/^0+$/.test(value),
    "ENGINEERING_DIGEST",
  );
}
function positive(value) {
  need(Number.isSafeInteger(value) && value > 0, "ENGINEERING_IDENTIFIER");
}
export function validateEngineeringReview(value) {
  exact(value, [
    "schemaVersion",
    "kind",
    "target",
    "sourceLockIdentity",
    "producerCodeSha256",
    "descriptorSha256",
    "producer",
    "acceptance",
  ]);
  need(
    value.schemaVersion === 1 && value.kind === ENGINEERING_REVIEW_KIND,
    "ENGINEERING_REVIEW",
  );
  need(TARGETS.includes(value.target), "ENGINEERING_TARGET");
  need(
    value.sourceLockIdentity === checkpointProfile(value.target).source &&
      typeof ENGINEERING_PRODUCERS[value.target] === "string" &&
      value.producerCodeSha256 === ENGINEERING_PRODUCERS[value.target],
    "ENGINEERING_PROFILE",
  );
  digest(value.descriptorSha256);
  producerSelection([value.producer]);
  need(
    value.producer.producer === "engineering-sdk" &&
      value.producer.target === value.target &&
      value.producer.descriptorSha256 === value.descriptorSha256,
    "ENGINEERING_PRODUCER_SELECTION",
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
function reviewPath(relative) {
  need(
    typeof relative === "string" &&
      /^(?:native\/cef-owned-sdk-imports\/[a-z0-9][a-z0-9.-]{0,95}|native\/cef-engineering-sdk-publication\/reviews\/[a-z0-9][a-z0-9.-]{0,95})\/publication\.json$/.test(
        relative,
      ),
    "ENGINEERING_REVIEW_PATH",
  );
  return relative;
}
export async function readCommittedPublicationReview(
  root,
  relative,
  rawSha,
  head,
) {
  reviewPath(relative);
  digest(rawSha);
  digest(head, 40);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      timeout: 10000,
      maxBuffer: 1024 ** 2,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  need(
    git("rev-parse", "HEAD").toString().trim() === head &&
      git("status", "--porcelain=v1", "--untracked-files=no").length === 0,
    "ENGINEERING_COMMITTED_CHECKOUT",
  );
  const entry = git("ls-tree", "-z", "HEAD", "--", relative).toString();
  need(
    /^100644 blob [a-f0-9]{40}\t/.test(entry) &&
      entry.endsWith(relative + "\0"),
    "ENGINEERING_REVIEW_BLOB",
  );
  const raw = git("show", "HEAD:" + relative);
  need(
    raw.length > 0 && raw.length <= 65536 && sha(raw) === rawSha,
    "ENGINEERING_REVIEW_RAW",
  );
  const review = JSON.parse(raw.toString("utf8"));
  if (review.kind === "sorng-cef-owned-publication-review") {
    need(
      relative.startsWith("native/cef-owned-sdk-imports/"),
      "ENGINEERING_REVIEW_PATH",
    );
    return validatePublicationReview(review);
  }
  need(
    relative.startsWith("native/cef-engineering-sdk-publication/reviews/"),
    "ENGINEERING_REVIEW_PATH",
  );
  return validateEngineeringReview(review);
}
export async function verifyEngineeringNativeMetadata(api, review) {
  validateEngineeringReview(review);
  const s = review.acceptance;
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api("actions/workflows/cef-runtime-acceptance.yml"),
    api(`actions/runs/${s.runId}`),
  ]);
  need(
    repo.full_name === REPOSITORY &&
      repo.private === false &&
      typeof repo.default_branch === "string" &&
      repo.default_branch.length > 0,
    "ENGINEERING_NATIVE_REPOSITORY",
  );
  positive(repo.id);
  positive(workflow.id);
  need(
    workflow.path === NATIVE_WORKFLOW &&
      run.id === s.runId &&
      run.run_attempt === s.runAttempt &&
      run.head_sha === s.headSha &&
      run.head_branch === repo.default_branch &&
      run.workflow_id === workflow.id &&
      run.path === NATIVE_WORKFLOW &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.repository?.id === repo.id &&
      run.head_repository?.id === repo.id &&
      run.repository?.full_name === REPOSITORY &&
      run.head_repository?.full_name === REPOSITORY,
    "ENGINEERING_NATIVE_RUN",
  );
  const [artifact, commit] = await Promise.all([
    api(`actions/artifacts/${s.artifactId}`),
    api(`git/commits/${s.headSha}`),
  ]);
  need(
    artifact.id === s.artifactId &&
      artifact.name ===
        `cef-native-acceptance-seal-${review.target}-${s.runId}-${s.runAttempt}` &&
      artifact.expired === false &&
      artifact.digest === `sha256:${s.artifactSha256}` &&
      artifact.workflow_run?.id === s.runId &&
      artifact.workflow_run?.head_sha === s.headSha &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes < 1024 ** 2,
    "ENGINEERING_NATIVE_ARTIFACT",
  );
  need(
    commit.sha === s.headSha && commit.tree?.sha === s.sourceTree,
    "ENGINEERING_NATIVE_COMMIT",
  );
  const tree = await api(`git/trees/${s.sourceTree}?recursive=1`);
  need(
    tree.sha === s.sourceTree && nativeCodeTreeDigest(tree) === s.codeSha256,
    "ENGINEERING_NATIVE_CODE",
  );
  return { repo, artifact };
}
export function verifyEngineeringNativeSeal(seal, review, repo, sourceLock) {
  validateEngineeringReview(review);
  const s = review.acceptance;
  need(
    seal.target === review.target &&
      seal.sourceLockIdentity === review.sourceLockIdentity &&
      seal.descriptorSha256 === review.descriptorSha256 &&
      canonical(seal.producer) === canonical(review.producer) &&
      seal.report?.path === "native-acceptance.json" &&
      seal.report.sha256 === s.nativeReportSha256,
    "ENGINEERING_NATIVE_BINDING",
  );
  const execution = seal.execution;
  need(
    execution.repository === REPOSITORY &&
      execution.repositoryId === repo.id &&
      execution.runId === s.runId &&
      execution.runAttempt === s.runAttempt &&
      execution.sourceSha === s.headSha &&
      execution.sourceTree === s.sourceTree &&
      execution.codeSha256 === s.codeSha256 &&
      execution.ref === `refs/heads/${repo.default_branch}` &&
      execution.workflowRef ===
        `${REPOSITORY}/${NATIVE_WORKFLOW}@refs/heads/${repo.default_branch}`,
    "ENGINEERING_NATIVE_EXECUTION",
  );
  const { sourceTree, codeSha256, codeDigestFormat, ...identity } = execution;
  const result = {
    schemaVersion: seal.schemaVersion,
    kind: "sorng-cef-native-acceptance-run",
    ...(seal.schemaVersion === 2
      ? { capabilities: seal.capabilities, bridgePatchId: seal.bridgePatchId }
      : {}),
    target: seal.target,
    producer: { ...seal.producer, sourceLockIdentity: seal.sourceLockIdentity },
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
    sourceLock,
  });
  need(canonical(checked) === canonical(seal), "ENGINEERING_NATIVE_SEAL");
  return seal;
}
export function verifyEngineeringCompletion(completion, review, repo) {
  validateEngineeringReview(review);
  validateSdkCompletion(completion);
  need(
    completion.target === review.target &&
      completion.sourceLockSha256 === review.sourceLockIdentity &&
      completion.identity.producer === ENGINEERING_PRODUCERS[review.target] &&
      completionSha(completion) === review.producer.completionSha256 &&
      completion.bundleAssets.find((x) => x.name === "runtime.json").sha256 ===
        review.descriptorSha256 &&
      canonical(completion.producer) ===
        canonical({
          repository: REPOSITORY,
          repositoryId: repo.id,
          runId: review.producer.runId,
          attempt: review.producer.runAttempt,
          head: review.producer.headSha,
          branch: repo.default_branch,
          workflow: ".github/workflows/cef-engineering-checkpoint.yml",
        }),
    "ENGINEERING_SDK_COMPLETION",
  );
  return completion;
}
export async function recheckEngineeringSdk(api, sdkSeal, review, repo) {
  validateSdkSeal(sdkSeal, sdkSeal.producer);
  verifyEngineeringCompletion(sdkSeal.completion, review, repo);
  need(sdkSeal.schemaVersion === 2, "ENGINEERING_SDK_TRANSPORT");
  const run = await verifyProducer(api, sdkSeal.producer);
  need(
    run.id === review.producer.runId &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.path === ".github/workflows/cef-engineering-checkpoint.yml" &&
      run.repository?.id === repo.id &&
      run.repository?.full_name === REPOSITORY &&
      run.head_repository?.full_name === REPOSITORY,
    "ENGINEERING_SDK_RUN",
  );
  const [listing, commit, release, assets] = await Promise.all([
    api(`actions/runs/${review.producer.runId}/artifacts?per_page=100`),
    api(`git/commits/${review.producer.headSha}`),
    api(`releases/${sdkSeal.release.id}`),
    api(`releases/${sdkSeal.release.id}/assets?per_page=100`),
  ]);
  need(
    Number.isSafeInteger(listing.total_count) &&
      listing.total_count > 0 &&
      listing.total_count <= 100 &&
      Array.isArray(listing.artifacts) &&
      listing.artifacts.length === listing.total_count,
    "ENGINEERING_SDK_ARTIFACTS",
  );
  const artifact = listing.artifacts.find(
    (row) => row.id === review.producer.artifactId,
  );
  need(
    artifact &&
      artifact.id === review.producer.artifactId &&
      artifact.name === sdkSealName(sdkSeal.producer, review.target) &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes < 1024 ** 2 &&
      artifact.expired === false &&
      artifact.digest === `sha256:${review.producer.artifactSha256}` &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run?.head_sha === run.head_sha,
    "ENGINEERING_SDK_ARTIFACT",
  );
  need(
    commit.sha === review.producer.headSha &&
      /^[a-f0-9]{40}$/.test(commit.tree?.sha),
    "ENGINEERING_SDK_COMMIT",
  );
  const tree = await api(`git/trees/${commit.tree.sha}?recursive=1`);
  need(
    tree.truncated === false &&
      tree.sha === commit.tree.sha &&
      codeTreeDigest(tree.tree) === ENGINEERING_PRODUCERS[review.target],
    "ENGINEERING_SDK_CODE",
  );
  need(
    release.id === sdkSeal.release.id &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === sdkSeal.release.tag &&
      release.target_commitish === sdkSeal.transport.carrierHead &&
      Array.isArray(assets) &&
      assets.length === 5 &&
      new Set(assets.map((x) => x.id)).size === 5,
    "ENGINEERING_SDK_DRAFT",
  );
  for (const pin of sdkSeal.assets) {
    const actual = assets.find((x) => x.id === pin.id);
    need(
      actual &&
        actual.name === pin.name &&
        actual.size === pin.bytes &&
        actual.digest === `sha256:${pin.sha256}` &&
        actual.state === "uploaded",
      "ENGINEERING_SDK_ASSET",
    );
  }
}
export async function verifyEngineeringPublication(options, dependencies = {}) {
  const {
    review,
    api,
    sdkApi,
    token,
    destination,
    python,
    request = fetch,
    root = ROOT,
  } = options;
  validateEngineeringReview(review);
  const { repo, artifact } = await verifyEngineeringNativeMetadata(api, review);
  need(
    path.isAbsolute(destination) && path.isAbsolute(python),
    "ENGINEERING_PRIVATE_PATHS",
  );
  await mkdir(destination);
  const nativeZip = path.join(destination, "native-seal.zip");
  await (dependencies.download ?? downloadAsset)(
    REPOSITORY,
    token,
    `/actions/artifacts/${review.acceptance.artifactId}/zip`,
    nativeZip,
    { bytes: artifact.size_in_bytes, sha256: review.acceptance.artifactSha256 },
    { request, maximum: 1024 ** 2, deadline: Date.now() + 20 * 60000 },
  );
  const helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const extract = dependencies.extract ?? archiveCommand;
  const nativeSeal = await extract(
    python,
    helper,
    ["seal", "--input", nativeZip, "--output", destination],
    { timeout: 15000 },
  );
  need(
    (dependencies.rawSealSha ?? rawAcceptanceSealSha)(
      python,
      nativeZip,
      review.acceptance.artifactSha256,
    ) === review.acceptance.sealSha256,
    "ENGINEERING_NATIVE_RAW",
  );
  // Reject a forged/wrong-profile native envelope before any large SDK transfer.
  const profileLock = JSON.parse(
    await readFile(
      path.join(
        root,
        checkpointProfile(review.target).inputs,
        "source-lock.json",
      ),
      "utf8",
    ),
  );
  verifyEngineeringNativeSeal(nativeSeal, review, repo, profileLock);
  const bundle = path.join(destination, "bundle");
  await (dependencies.downloadSdk ?? downloadSdkBundle)(sdkApi, {
    selection: review.producer,
    repository: REPOSITORY,
    token,
    destination: bundle,
    python,
    helper,
    request,
  });
  const proof = await readFile(path.join(bundle, "sdk-completion-proof.json"));
  need(
    proof.length > 0 &&
      proof.length < 1024 ** 2 &&
      sha(proof) === review.producer.completionSha256,
    "ENGINEERING_SDK_PROOF_RAW",
  );
  const completion = verifyEngineeringCompletion(
    JSON.parse(proof),
    review,
    repo,
  );
  const sdkSeal = validateSdkSeal(
    await extract(
      python,
      helper,
      [
        "seal",
        "--input",
        path.join(bundle, "sdk-seal.zip"),
        "--output",
        bundle,
      ],
      { timeout: 15000 },
    ),
    completion.producer,
  );
  need(
    canonical(sdkSeal.completion) === canonical(completion) &&
      sdkSeal.completionSha256 === review.producer.completionSha256,
    "ENGINEERING_SDK_PROOF_BINDING",
  );
  const checked = await (dependencies.verifyBundle ?? verifyAcceptanceBundle)({
    bundle,
    selection: review.producer,
    repository: REPOSITORY,
    expectedLock: review.sourceLockIdentity,
  });
  need(
    checked.descriptor.target === review.target &&
      checked.descriptorSha256 === review.descriptorSha256 &&
      checked.identity.sourceLockSha256 === review.sourceLockIdentity &&
      checked.identity.key === `${review.sourceLockIdentity}-${review.target}`,
    "ENGINEERING_BUNDLE",
  );
  const sourceLock = await verifiedAcceptanceSourceLock(bundle, checked);
  verifyEngineeringNativeSeal(nativeSeal, review, repo, sourceLock);
  await verifyEngineeringNativeMetadata(api, review);
  await recheckEngineeringSdk(sdkApi, sdkSeal, review, repo);
  return {
    bundle,
    key: checked.identity.key,
    target: review.target,
    acceptance: review.acceptance,
    sdkSeal,
  };
}
export async function publishEngineeringSdk(
  options,
  client,
  dependencies = {},
) {
  digest(options.commit, 40);
  const checked = await verifyEngineeringPublication(options, dependencies);
  await dependencies.beforePublish?.();
  const result = await (dependencies.publish ?? publish)(
    {
      bundle: checked.bundle,
      repository: REPOSITORY,
      execute: true,
      commit: options.commit,
    },
    client,
  );
  need(
    result.productionReady === false && result.prerelease === true,
    "ENGINEERING_PUBLICATION_RESULT",
  );
  return {
    ...result,
    producerKind: "engineering-sdk",
    originalBuildReplayed: false,
    sourceLockIdentity: options.review.sourceLockIdentity,
    producer: options.review.producer,
    nativeAcceptance: checked.acceptance,
    productionReady: false,
  };
}
export function engineeringPublicationArguments(argv) {
  const [mode, ...args] = argv;
  need(["verify", "publish"].includes(mode), "ENGINEERING_MODE");
  const options = { mode };
  while (args.length) {
    const key = args.shift();
    if (key === "--execute" && mode === "publish" && !options.execute) {
      options.execute = true;
      continue;
    }
    const field = {
      "--reviewed": "reviewed",
      "--review-sha256": "reviewSha256",
    }[key];
    need(
      field && !Object.hasOwn(options, field) && args.length > 0,
      "ENGINEERING_ARGUMENTS",
    );
    options[field] = args.shift();
  }
  reviewPath(options.reviewed);
  digest(options.reviewSha256);
  need(mode !== "publish" || options.execute === true, "ENGINEERING_EXECUTE");
  return options;
}
function publicationPython(env) {
  return execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: env.PATH,
        ...(env.SystemRoot ? { SystemRoot: env.SystemRoot } : {}),
      },
    },
  ).trim();
}
async function publisherSource(head) {
  acceptanceCodeIdentity(head);
  const relative = "native/cef-engineering-sdk-publication/publish.mjs";
  const git = (...args) =>
    execFileSync("git", ["-C", ROOT, ...args], {
      timeout: 10000,
      maxBuffer: 1024 ** 2,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const entry = git("ls-tree", "-z", "HEAD", "--", relative).toString();
  need(
    /^100644 blob [a-f0-9]{40}\t/.test(entry) &&
      entry.endsWith(relative + "\0"),
    "ENGINEERING_SOURCE_BLOB",
  );
  need(
    git("show", "HEAD:" + relative).equals(
      await readFile(fileURLToPath(import.meta.url)),
    ),
    "ENGINEERING_SOURCE_BYTES",
  );
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = engineeringPublicationArguments(argv),
    api = publicationApi(env.GH_TOKEN);
  await publicationAuthority(env, api, { write: options.mode === "publish" });
  await publisherSource(env.GITHUB_SHA);
  const review = await readCommittedPublicationReview(
    ROOT,
    options.reviewed,
    options.reviewSha256,
    env.GITHUB_SHA,
  );
  // Fixed code paths only; committed JSON selects a closed data kind, never code.
  if (review.kind === "sorng-cef-owned-publication-review")
    return ownedMain(argv, env);
  const parameters = {
    review,
    api,
    sdkApi: apiClient(REPOSITORY, env.GH_TOKEN, fetch, {
      sdk: true,
      readOnly: true,
      target: review.target,
    }),
    token: env.GH_TOKEN,
    destination: await privatePublicationOutput(
      env.RUNNER_TEMP,
      env.CEF_PUBLICATION_OUTPUT,
    ),
    python: publicationPython(env),
    commit: env.GITHUB_SHA,
  };
  const result =
    options.mode === "publish"
      ? await publishEngineeringSdk(
          parameters,
          githubClient(REPOSITORY, env.GH_TOKEN),
          {
            beforePublish: async () => {
              await publicationAuthority(env, api, { write: true });
              await publisherSource(env.GITHUB_SHA);
              await readCommittedPublicationReview(
                ROOT,
                options.reviewed,
                options.reviewSha256,
                env.GITHUB_SHA,
              );
            },
          },
        )
      : await verifyEngineeringPublication(parameters);
  if (options.mode === "verify" && env.GITHUB_OUTPUT)
    await appendFile(
      env.GITHUB_OUTPUT,
      `key=${result.key}\ntarget=${result.target}\n`,
    );
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-publication-result",
    mode: options.mode,
    sourceSha: env.GITHUB_SHA,
    reviewed: options.reviewed,
    reviewSha256: options.reviewSha256,
    producerKind: "engineering-sdk",
    originalBuildReplayed: false,
    nativeExecutionPerformed: false,
    productionReady: false,
    publicationPerformed: options.mode === "publish",
    ...(options.mode === "publish"
      ? { publication: result }
      : {
          target: result.target,
          key: result.key,
          nativeAcceptance: result.acceptance,
        }),
  };
  await writeFile(
    path.join(parameters.destination, "publication-result.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx" },
  );
  return receipt;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((value) => console.log(JSON.stringify(value)))
    .catch(() => {
      console.error(
        "Reviewed SDK publication failed; no runtime catalog admission granted",
      );
      process.exitCode = 1;
    });
