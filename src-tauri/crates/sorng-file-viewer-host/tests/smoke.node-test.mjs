import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const executable = process.env.SORNG_VIEWER_TEST_EXE;
const enabled = process.platform === "win32" && !!executable;

function simplePdf() {
  const content = "0 0 1 rg 10 10 20 20 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += "xref\n0 5\n0000000000 65535 f \n";
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

for (const [kind, bytes] of [
  [
    "text",
    Buffer.from(
      "<script>throw new Error('must remain text')</script>\nSynthetic viewer fixture",
    ),
  ],
  ["text", Buffer.alloc(0)],
  [
    "image",
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  ],
  ["pdf", simplePdf()],
]) {
  test(
    `hidden real WebView2 ${kind} (${bytes.length} bytes), no IPC, auto-close`,
    { skip: !enabled, timeout: 25000 },
    async () => {
      const profile = await mkdtemp(join(tmpdir(), "sorng-viewer-smoke-"));
      const environment = {};
      for (const key of [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "LOCALAPPDATA",
      ]) {
        if (process.env[key]) environment[key] = process.env[key];
      }
      const child = spawn(
        resolve(executable),
        ["--profile-dir", profile, "--smoke-test"],
        {
          env: environment,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      child.stdin.on("error", () => {});
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 15000);
      try {
        const header = Buffer.from(
          JSON.stringify({
            version: 1,
            kind,
            name: "Synthetic fixture",
            byteLength: bytes.length,
          }),
        );
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32LE(header.length);
        child.stdin.write(Buffer.concat([prefix, header, bytes]));
        const exit = await new Promise((accept, reject) => {
          child.once("error", reject);
          child.once("exit", (code) => accept(code));
        });
        assert.equal(timedOut, false, "helper exceeded fixed smoke deadline");
        assert.equal(exit, 0, stderr);
        assert.equal(
          stdout,
          "SORNG_VIEWER_READY_V1\nSORNG_VIEWER_SMOKE_PASSED_V1\n",
        );
        assert.equal(stderr, "");
      } finally {
        clearTimeout(timer);
        child.stdin.destroy();
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      }
    },
  );
}
