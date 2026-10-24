#!/usr/bin/env node
import {
  ownedSdkHandoffPlan,
  readOwnedSdkReview,
  checkOwnedSdkHandoff,
} from "./lib/cef-owned-sdk-handoff.mjs";
try {
  const args = process.argv.slice(2),
    mode = args.shift(),
    options = {};
  if (!["plan", "check"].includes(mode)) throw Error("Closed mode required");
  const fields = {
    "--reviewed": "reviewed",
    "--bundle": "bundle",
    "--inputs": "inputs",
    "--evidence": "evidence",
    "--output": "output",
  };
  while (args.length) {
    const key = args.shift();
    if (key === "--execute") {
      if (options.execute) throw Error("Duplicate");
      options.execute = true;
      continue;
    }
    if (!fields[key] || !args.length || Object.hasOwn(options, fields[key]))
      throw Error("Unknown/duplicate field");
    options[fields[key]] = args.shift();
  }
  if (
    !options.reviewed ||
    (mode === "plan" && Object.keys(options).some((key) => key !== "reviewed"))
  )
    throw Error("Explicit closed review input required");
  const review = await readOwnedSdkReview(options.reviewed);
  const result =
    mode === "plan"
      ? ownedSdkHandoffPlan(review)
      : await checkOwnedSdkHandoff({ ...options, review });
  console.log(JSON.stringify(result, null, 2));
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        "Owned SDK review failed; no upload, hosted-build or native-acceptance authority granted",
    }),
  );
  process.exitCode = 1;
}
