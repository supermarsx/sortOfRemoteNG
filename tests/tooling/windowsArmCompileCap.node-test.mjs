import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (p) =>
  readFileSync(new URL(p, root), "utf8").replaceAll("\r\n", "\n");
const workflow = read(".github/workflows/windows-arm-full-sdk.yml");
const controller = read("native/windows-arm-full-sdk/full_sdk_control.mjs");

test("compile_cap_minutes defaults to the reviewed behaviour and is validated before any work", () => {
  assert.match(
    workflow,
    /compile_cap_minutes:\n {8}description: [^\n]+\n {8}type: string\n {8}required: false\n {8}default: "0"\n/,
  );
  assert.match(
    workflow,
    /CEF_FULLSDK_COMPILE_CAP_MINUTES: \$\{\{ inputs\.compile_cap_minutes \}\}/,
  );
  assert.ok(
    workflow.includes(
      "'^(?:0|[3-9][0-9]|1[0-7][0-9]|180)$') { throw 'FULL_SDK_COMPILE_CAP_INPUT' }",
    ),
  );
  // The sampler starts before the producer step and the upload is unconditional.
  const start = workflow.indexOf(
    "Start detached off-box runner telemetry sampler",
  );
  assert.ok(start > 0 && start < workflow.indexOf("id: producer"));
  assert.match(workflow, /Retain runner telemetry samples\n {8}if: always\(\)/);
});

function capFor(value) {
  const body = controller.slice(
    controller.indexOf("// BEGIN COMPILE CAP INPUT"),
    controller.indexOf("// END COMPILE CAP INPUT"),
  );
  const run = `const process = { env: ${JSON.stringify(value === undefined ? {} : { CEF_FULLSDK_COMPILE_CAP_MINUTES: value })} };
const need = (ok, code) => { if (!ok) throw new Error(code); };
${body.replace("const ENGINE_CAPS_MS = Object.freeze([900000, 900000, compileCapMs(), 2400000]);", "")}
try { console.log(compileCapMs()); } catch (e) { console.log(e.message); }`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=commonjs", "-e", run],
    {
      encoding: "utf8",
      timeout: 20000,
    },
  );
  return result.stdout.trim();
}

test("controller compile cap only shortens the reviewed 180 minute slice", () => {
  assert.equal(capFor(undefined), "10800000");
  assert.equal(capFor("0"), "10800000");
  assert.equal(capFor("180"), "10800000");
  assert.equal(capFor("150"), "9000000");
  assert.equal(capFor("30"), "1800000");
  for (const bad of [
    "29",
    "181",
    "5",
    "-1",
    "150.5",
    " 150",
    "0150",
    "abc",
    "1e2",
  ])
    assert.equal(capFor(bad), "COMPILE_CAP_MINUTES", bad);
  assert.ok(
    controller.includes(
      "const ENGINE_CAPS_MS = Object.freeze([900000, 900000, compileCapMs(), 2400000]);",
    ),
  );
});
