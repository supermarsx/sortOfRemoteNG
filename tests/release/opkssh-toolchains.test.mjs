import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );

test("Windows CI and releases provision a real GNU bridge without changing the app MSVC host", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ]) {
    const workflow = read(file);
    assert.match(
      workflow,
      /rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal/,
    );
    assert.match(workflow, /gcc -dumpmachine/);
    assert.match(workflow, /x86_64-w64-mingw32/);
    const start = workflow.indexOf(
      "rustup toolchain install stable-x86_64-pc-windows-gnu",
    );
    const step = workflow.slice(start, workflow.indexOf("\n      - ", start));
    assert.doesNotMatch(step, /rustup default .*windows-gnu/);
  }
});

test("ARM64 release compiler is native and hash verified before extraction", () => {
  const workflow = read(".github/workflows/release.yml");
  const start = workflow.indexOf("- name: Provision verified ARM64 LLVM-MinGW");
  assert.ok(start > 0);
  const step = workflow.slice(
    start,
    workflow.indexOf("\n      - name:", start + 1),
  );
  assert.match(step, /matrix.rust_target == 'aarch64-pc-windows-msvc'/);
  assert.match(step, /rustup target add aarch64-pc-windows-gnullvm/);
  assert.match(step, /llvm-mingw-20260616-ucrt-aarch64.zip/);
  assert.match(
    step,
    /312593669435bd0bfc1a43ac3fba23c8b27e0610bade88b2738e5a01702a99ba/,
  );
  assert.ok(step.indexOf("Get-FileHash") < step.indexOf("Expand-Archive"));
  assert.ok(step.indexOf("Expand-Archive") < step.indexOf("GITHUB_ENV"));
  assert.match(step, /aarch64-w64-mingw32-clang.exe/);
  assert.match(
    step,
    /"SORNG_OPKSSH_LLVM_MINGW_BIN=\$compilerBin" \| Out-File -FilePath \$env:GITHUB_ENV/,
  );
  assert.doesNotMatch(
    step,
    /GITHUB_PATH|\$env:(?:PATH|CC|CXX)\s*=|rustup default|Invoke-Expression/i,
  );
});
