#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptanceCodeIdentity } from "./cef-runtime-acceptance-ci.mjs";
import { githubClient } from "./cef-runtime-ci.mjs";
import {
  OWNED_REPOSITORY,
  ownedImportApi,
} from "./lib/cef-owned-sdk-import.mjs";
import {
  publicationApi,
  publicationAuthority,
  publicationReviewPath,
  privatePublicationOutput,
  readPublicationReview,
  verifyOwnedPublication,
  publishOwnedSdk,
} from "./lib/cef-owned-sdk-publish.mjs";
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function publicationArguments(argv) {
  const [mode, ...args] = argv;
  if (!["verify", "publish"].includes(mode))
    throw new Error("Explicit owned publication mode required");
  const value = { mode };
  while (args.length) {
    const key = args.shift();
    if (key === "--execute" && mode === "publish" && !value.execute) {
      value.execute = true;
      continue;
    }
    const field = {
      "--reviewed": "reviewed",
      "--review-sha256": "reviewSha256",
    }[key];
    if (!field || Object.hasOwn(value, field) || !args.length)
      throw new Error("Unknown/duplicate publication argument");
    value[field] = args.shift();
  }
  publicationReviewPath(value.reviewed);
  if (
    !/^[a-f0-9]{64}$/.test(value.reviewSha256 ?? "") ||
    /^0+$/.test(value.reviewSha256) ||
    (mode === "publish" && !value.execute)
  )
    throw new Error("Explicit independent review digest/execution required");
  return value;
}

function python(environment) {
  return execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      env: {
        PATH: environment.PATH,
        ...(environment.SystemRoot
          ? { SystemRoot: environment.SystemRoot }
          : {}),
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = publicationArguments(argv);
  const api = publicationApi(env.GH_TOKEN);
  await publicationAuthority(env, api, { write: options.mode === "publish" });
  acceptanceCodeIdentity(env.GITHUB_SHA);
  const review = await readPublicationReview(
    ROOT,
    options.reviewed,
    options.reviewSha256,
    env.GITHUB_SHA,
  );
  const destination = await privatePublicationOutput(
    env.RUNNER_TEMP,
    env.CEF_PUBLICATION_OUTPUT,
  );
  const parameters = {
    review,
    api,
    ownedApi: ownedImportApi(OWNED_REPOSITORY, env.GH_TOKEN),
    token: env.GH_TOKEN,
    destination,
    python: python(env),
    commit: env.GITHUB_SHA,
  };
  const result =
    options.mode === "publish"
      ? await publishOwnedSdk(
          parameters,
          githubClient(OWNED_REPOSITORY, env.GH_TOKEN),
          {
            beforePublish: async () => {
              await publicationAuthority(env, api, { write: true });
              acceptanceCodeIdentity(env.GITHUB_SHA);
              await readPublicationReview(
                ROOT,
                options.reviewed,
                options.reviewSha256,
                env.GITHUB_SHA,
              );
            },
          },
        )
      : await verifyOwnedPublication(parameters);
  if (options.mode === "verify") {
    // Only closed, validated output identifiers; no JSON/paths/tokens in GHA outputs.
    if (
      !/^[a-f0-9]{64}-(?:x86_64-pc-windows-msvc|x86_64-unknown-linux-gnu)$/.test(
        result.key,
      )
    )
      throw new Error("Invalid immutable publication key");
    if (env.GITHUB_OUTPUT)
      await appendFile(
        env.GITHUB_OUTPUT,
        `key=${result.key}\ntarget=${result.target}\n`,
      );
  }
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-owned-publication-result",
    mode: options.mode,
    sourceSha: env.GITHUB_SHA,
    reviewed: options.reviewed,
    reviewSha256: options.reviewSha256,
    hostedBuild: false,
    originalBuildReplayed: false,
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
    path.join(destination, "publication-result.json"),
    JSON.stringify(receipt, null, 2),
    { flag: "wx" },
  );
  return receipt;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        `[cef-owned-sdk-publish] ${error?.code === "OWNED_PUBLICATION_GUARD" ? error.message : "External verification/transport failure"}; preserve private evidence, no retry or fallback authorized`,
      );
      process.exitCode = 1;
    });
