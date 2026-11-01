// One empty technical draft only. No checkpoint, SDK, seal or publication.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiClient,
  verifyProducer,
  resolveTechnicalTransport,
} from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

export const ORIGINAL_PRODUCER = Object.freeze({
  repository: "supermarsx/sortOfRemoteNG",
  repositoryId: 1010282954,
  runId: 41323982797,
  attempt: 1,
  head: "1cfeff9ecedf84460a040c70badfabcac607b8dd",
  branch: "main",
  workflow: ".github/workflows/cef-engineering-checkpoint.yml",
});
export function authority(env, event) {
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY === ORIGINAL_PRODUCER.repository &&
      env.GITHUB_REPOSITORY_ID === String(ORIGINAL_PRODUCER.repositoryId) &&
      env.GITHUB_REF === "refs/heads/main" &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF ===
        ORIGINAL_PRODUCER.repository +
          "/.github/workflows/cef-upload-authorization.yml@refs/heads/main" &&
      /^[1-9][0-9]{0,15}$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "TRANSPORT_PROBE_AUTHORITY",
  );
  assert(
    event?.repository?.id === ORIGINAL_PRODUCER.repositoryId &&
      event.repository.full_name === ORIGINAL_PRODUCER.repository &&
      event.repository.private === false &&
      event.repository.visibility === "public" &&
      event.repository.default_branch === "main" &&
      event.inputs &&
      Object.getPrototypeOf(event.inputs) === Object.prototype &&
      Object.keys(event.inputs).join() === "proof" &&
      event.inputs.proof === "transport-v2",
    "TRANSPORT_PROBE_EVENT",
  );
  return `cef-upload-authorization-probe-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
}
export async function run(env, event, request = fetch, observe = () => {}) {
  let phase = "authority";
  const publish = (value) => {
    try {
      observe(Object.freeze(value));
    } catch {
      /* Diagnostics never change admission. */
    }
  };
  const stage = (value) => {
    phase = value;
    publish({ phase });
  };
  stage("authority");
  const tag = authority(env, event);
  assert(
    typeof env.GH_TOKEN === "string" &&
      env.GH_TOKEN.length > 0 &&
      env.GH_TOKEN.length <= 4096,
    "TRANSPORT_PROBE_TOKEN",
  );
  const started = performance.now(),
    end = started + 180000;
  const check = () =>
    assert(performance.now() < end, "TRANSPORT_PROBE_DEADLINE");
  let postSent = false;
  const requestOnce = (url, options) => {
    if (options.method === "POST") {
      assert(!postSent, "TRANSPORT_PROBE_POST_REPLAY");
      postSent = true;
    }
    return request(url, options);
  };
  const api = apiClient(
    ORIGINAL_PRODUCER.repository,
    env.GH_TOKEN,
    requestOnce,
    {
      milliseconds: 180000,
      log: () => {},
      observer: (record) => {
        if (
          record.event === "response" &&
          Number.isInteger(record.httpStatus) &&
          record.httpStatus >= 100 &&
          record.httpStatus <= 599
        )
          publish({ phase, httpStatus: record.httpStatus });
      },
    },
  );
  // This authenticates the immutable historical source without treating its
  // failed upload or diagnostic metadata as a recoverable checkpoint.
  stage("producer");
  await verifyProducer(api, ORIGINAL_PRODUCER);
  check();
  stage("carrier");
  const transport = await resolveTechnicalTransport(api, ORIGINAL_PRODUCER);
  assert(
    transport.carrierHead !== ORIGINAL_PRODUCER.head,
    "TRANSPORT_PROBE_NOT_SEPARATED",
  );
  check();
  stage("draft-create");
  const created = await api("releases", {
    method: "POST",
    body: {
      tag_name: tag,
      name: tag,
      target_commitish: transport.carrierHead,
      draft: true,
      prerelease: true,
      make_latest: "false",
      generate_release_notes: false,
      body: `Unpublished technical transport diagnostic. Historical source commit: ${ORIGINAL_PRODUCER.head}. Container commit: ${transport.carrierHead}. No checkpoint, SDK, seal, native acceptance or application release. The original failed run remains unrestorable.`,
    },
  });
  const validate = (value) =>
    assert(
      Number.isSafeInteger(value?.id) &&
        value.id > 0 &&
        value.tag_name === tag &&
        value.target_commitish === transport.carrierHead &&
        value.draft === true &&
        value.prerelease === true &&
        value.published_at === null &&
        Array.isArray(value.assets) &&
        value.assets.length === 0,
      "TRANSPORT_PROBE_READBACK",
    );
  validate(created);
  check();
  stage("draft-readback");
  const final = await api(`releases/${created.id}`);
  validate(final);
  assert(final.id === created.id, "TRANSPORT_PROBE_READBACK");
  check();
  return {
    kind: "cef-source-separated-transport-authorization-proof",
    complete: true,
    sourceCommit: ORIGINAL_PRODUCER.head,
    sourceRun: ORIGINAL_PRODUCER.runId,
    transport,
    release: { id: created.id, tag, draft: true, prerelease: true, assets: 0 },
    elapsedMs: Math.floor(performance.now() - started),
    sealCreated: false,
    checkpointRecovered: false,
    nativeAcceptance: false,
    runtimeReady: false,
    applicationPublication: false,
  };
}
async function main() {
  let report,
    phase = "authority";
  const responses = [];
  const observe = (record) => {
    phase = record.phase;
    if (record.httpStatus !== undefined && responses.length < 16)
      responses.push(record);
  };
  try {
    assert(process.argv.length === 2, "TRANSPORT_PROBE_ARGUMENTS");
    const raw = await fs.readFile(process.env.GITHUB_EVENT_PATH);
    assert(raw.length <= 16384, "TRANSPORT_PROBE_EVENT");
    const event = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    );
    report = await run(process.env, event, fetch, observe);
  } catch {
    report = {
      kind: "cef-source-separated-transport-authorization-proof",
      complete: false,
      failure: "TRANSPORT_PROBE_DENIED",
      failurePhase: phase,
      sealCreated: false,
      checkpointRecovered: false,
      nativeAcceptance: false,
      runtimeReady: false,
      applicationPublication: false,
    };
    process.exitCode = 1;
  }
  report.responses = responses;
  await fs.mkdir("cef-upload-authorization-result");
  const raw = JSON.stringify(report, null, 2) + "\n";
  assert(Buffer.byteLength(raw) <= 16384, "TRANSPORT_PROBE_REPORT");
  await fs.writeFile("cef-upload-authorization-result/result.json", raw, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error("TRANSPORT_PROBE_DENIED");
    process.exitCode = 1;
  });
}
