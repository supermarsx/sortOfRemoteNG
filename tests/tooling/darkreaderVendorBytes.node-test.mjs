import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getFileInfo } from "prettier";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vendor = "src-tauri/crates/sorng-protocols/src/vendor/darkreader";
const hashes = {
  "darkreader.js":
    "bc589aeb7cc9aabd9fc8a20594d364666b72fec9620fe6304a5521b4e545f3c1",
  LICENSE: "f0a5f835174494f8981b2cbb1a34054d4f887a5c865318650d6a17afe1c7850e",
  "provenance.json":
    "92a7e6a00a9d8e1143c8eafc37980f38a7651b073c8a04f8080c5462d1cb37c8",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("official API/license and generated provenance retain exact pinned bytes and are formatter-excluded", async () => {
  for (const [name, hash] of Object.entries(hashes)) {
    const file = path.join(root, vendor, name);
    assert.equal(digest(fs.readFileSync(file)), hash, name);
    assert.equal(
      (
        await getFileInfo(file, {
          ignorePath: path.join(root, ".prettierignore"),
        })
      ).ignored,
      true,
      `${name} must not be reformatted`,
    );
  }
  assert.equal(
    (
      await getFileInfo(
        path.join(
          root,
          "src-tauri/crates/sorng-protocols/src/web_automation_client.js",
        ),
        { ignorePath: path.join(root, ".prettierignore") },
      )
    ).ignored,
    false,
    "Our own injected client must still be formatted",
  );
});

for (const clean of ["true", "false"])
  for (const checkout of ["true", "false"]) {
    test(`isolated Git clean autocrlf=${clean}, checkout autocrlf=${checkout} preserves vendor bytes`, () => {
      const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "sorng-darkreader-checkout-"),
      );
      try {
        const emptyConfig = path.join(temporary, "empty-config");
        fs.writeFileSync(emptyConfig, "");
        // Never read/write user Git configuration or inherit a caller's index,
        // object store, hooks, worktree or repository-selection environment.
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.toUpperCase().startsWith("GIT_"),
          ),
        );
        Object.assign(env, {
          GIT_CONFIG_GLOBAL: emptyConfig,
          GIT_CONFIG_SYSTEM: emptyConfig,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_ATTR_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        });
        const git = (autocrlf, ...args) =>
          execFileSync(
            "git",
            [
              "-c",
              `core.autocrlf=${autocrlf}`,
              "-c",
              `core.attributesFile=${emptyConfig}`,
              "-c",
              `core.excludesFile=${emptyConfig}`,
              ...args,
            ],
            {
              cwd: temporary,
              env,
              timeout: 10000,
              maxBuffer: 2 * 1024 * 1024,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
        git(clean, "init", "--quiet");
        fs.copyFileSync(
          path.join(root, ".gitattributes"),
          path.join(temporary, ".gitattributes"),
        );
        fs.mkdirSync(path.join(temporary, vendor), { recursive: true });
        const files = Object.keys(hashes).map((name) => `${vendor}/${name}`);
        for (const file of files)
          fs.copyFileSync(path.join(root, file), path.join(temporary, file));
        fs.writeFileSync(
          path.join(temporary, "line-ending-probe.txt"),
          "one\ntwo\n",
        );
        git(
          clean,
          "add",
          "--",
          ".gitattributes",
          "line-ending-probe.txt",
          ...files,
        );
        // Upstream CRLF must survive without failing the staged whitespace gate.
        git(clean, "diff", "--cached", "--check");
        for (const [name, expected] of Object.entries(hashes)) {
          const file = `${vendor}/${name}`;
          assert.match(
            git(clean, "check-attr", "text", "--", file).toString(),
            /: text: unset\s*$/,
          );
          assert.equal(
            digest(git(clean, "show", `:${file}`)),
            expected,
            `${name} index clean bytes`,
          );
        }
        const output = path.join(temporary, "fresh-checkout");
        fs.mkdirSync(output);
        git(
          checkout,
          "checkout-index",
          "--all",
          `--prefix=${output.replaceAll("\\", "/")}/`,
        );
        for (const [name, expected] of Object.entries(hashes))
          assert.equal(
            digest(fs.readFileSync(path.join(output, vendor, name))),
            expected,
            `${name} checked-out bytes`,
          );
        assert.equal(
          fs.readFileSync(path.join(output, "line-ending-probe.txt"), "utf8"),
          checkout === "true" ? "one\r\ntwo\r\n" : "one\ntwo\n",
          "Control proves the requested checkout conversion actually ran",
        );
      } finally {
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        assert.ok(
          path.basename(temporary).startsWith("sorng-darkreader-checkout-"),
        );
        fs.rmSync(temporary, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    });
  }
