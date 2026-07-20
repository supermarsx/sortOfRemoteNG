import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareHttpFixtures,
  validateHttpFixtures,
} from "../../scripts/ci/e2e-http-fixtures.mjs";

const temporaryFixtureDirectory = (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sorng-e2e-http-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test("prepares disposable basic-auth and matching TLS fixtures", (context) => {
  const outputDir = temporaryFixtureDirectory(context);
  const paths = prepareHttpFixtures({ outputDir });

  assert.deepEqual(validateHttpFixtures({ outputDir }), paths);
  assert.match(readFileSync(paths.nginxConfig, "utf8"), /listen 443 ssl/);
  assert.match(
    readFileSync(paths.htpasswd, "utf8"),
    /^testuser:\$apr1\$sorng123\$/,
  );
  assert.match(readFileSync(paths.certificate, "utf8"), /BEGIN CERTIFICATE/);
  assert.match(readFileSync(paths.privateKey, "utf8"), /BEGIN PRIVATE KEY/);
});

test("preflight names a missing fixture before Docker Compose runs", (context) => {
  const outputDir = temporaryFixtureDirectory(context);
  const paths = prepareHttpFixtures({ outputDir });
  rmSync(paths.htpasswd);

  assert.throws(
    () => validateHttpFixtures({ outputDir }),
    /Missing required HTTP basic-auth file: .*\.htpasswd.*prepare.*before Docker Compose/s,
  );
});

test("preparation rejects a directory where a mounted file is required", (context) => {
  const outputDir = temporaryFixtureDirectory(context);
  mkdirSync(path.join(outputDir, "nginx.conf"), { recursive: true });

  assert.throws(
    () => prepareHttpFixtures({ outputDir }),
    /Cannot prepare nginx configuration; expected a file path but found another filesystem entry/,
  );
});
