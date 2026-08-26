// t64-e5 — disposable Portainer CE fixture for the e2e compose stack.
//
// Subcommands (same contract as scripts/ci/e2e-http-fixtures.mjs):
//   prepare   write e2e/.generated/portainer/admin_password from
//             PORTAINER_ADMIN_PASSWORD (plaintext; Portainer's
//             `--admin-password-file` hashes it itself).
//   validate  assert the generated file exists and is a usable password.
//   wait      poll PORTAINER_URL until /api/system/status answers, make sure
//             an admin exists (POST /api/users/admin/init if not — belt and
//             braces on top of --admin-password-file), then prove the admin
//             login works via POST /api/auth. Prints the Portainer version.
//
// The Portainer image is FROM scratch (no shell), so compose cannot run a
// healthcheck inside the container; `wait` is the readiness gate instead.
//
// Nothing here is ever committed: e2e/.generated/ is gitignored.

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..");

export const DEFAULT_PORTAINER_FIXTURE_DIR = path.join(
  repoRoot,
  "e2e",
  ".generated",
  "portainer",
);

export const DEFAULT_PORTAINER_URL = "http://127.0.0.1:19000";
export const DEFAULT_PORTAINER_USER = "admin";
// Portainer enforces a 12-character minimum for the admin password.
export const DEFAULT_PORTAINER_ADMIN_PASSWORD = "portainer-e2e-pass1234";
const MIN_PASSWORD_LENGTH = 12;

const TAG = "[e2e-portainer-fixture]";

const fixturePaths = (outputDir) => ({
  outputDir,
  adminPasswordFile: path.join(outputDir, "admin_password"),
});

const resolveEnv = () => ({
  url: (process.env.PORTAINER_URL || DEFAULT_PORTAINER_URL).replace(
    /\/+$/u,
    "",
  ),
  username: process.env.PORTAINER_USER || DEFAULT_PORTAINER_USER,
  password:
    process.env.PORTAINER_ADMIN_PASSWORD || DEFAULT_PORTAINER_ADMIN_PASSWORD,
});

const assertPassword = (password) => {
  if (!password || /[\r\n]/u.test(password)) {
    throw new Error(
      `${TAG} PORTAINER_ADMIN_PASSWORD must be non-empty and cannot contain a newline.`,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${TAG} PORTAINER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (Portainer rejects shorter admin passwords).`,
    );
  }
};

const ensureDirectory = (directoryPath) => {
  if (existsSync(directoryPath) && !lstatSync(directoryPath).isDirectory()) {
    throw new Error(
      `${TAG} Expected a directory path but found another filesystem entry: ${directoryPath}`,
    );
  }
  mkdirSync(directoryPath, { recursive: true });
};

export function preparePortainerFixture({
  outputDir = DEFAULT_PORTAINER_FIXTURE_DIR,
  password = resolveEnv().password,
} = {}) {
  assertPassword(password);
  const paths = fixturePaths(path.resolve(outputDir));
  ensureDirectory(paths.outputDir);
  if (
    existsSync(paths.adminPasswordFile) &&
    !lstatSync(paths.adminPasswordFile).isFile()
  ) {
    // A missing bind-mount source makes Docker create a *directory* there;
    // refuse to write over it so the operator notices the ordering bug.
    throw new Error(
      `${TAG} ${paths.adminPasswordFile} exists but is not a regular file (did Docker Compose run before 'prepare'?). Remove it and re-run.`,
    );
  }
  // No trailing newline: Portainer trims one, but be exact anyway.
  writeFileSync(paths.adminPasswordFile, password, "utf8");
  if (process.platform !== "win32") {
    chmodSync(paths.adminPasswordFile, 0o644);
  }
  validatePortainerFixture({ outputDir: paths.outputDir });
  return paths;
}

export function validatePortainerFixture({
  outputDir = DEFAULT_PORTAINER_FIXTURE_DIR,
} = {}) {
  const paths = fixturePaths(path.resolve(outputDir));
  if (!existsSync(paths.adminPasswordFile)) {
    throw new Error(
      `${TAG} Missing ${paths.adminPasswordFile}. Run \`node scripts/ci/e2e-portainer-fixture.mjs prepare\` before Docker Compose.`,
    );
  }
  const stat = lstatSync(paths.adminPasswordFile);
  if (!stat.isFile()) {
    throw new Error(
      `${TAG} ${paths.adminPasswordFile} must be a regular file, but found another filesystem entry.`,
    );
  }
  assertPassword(readFileSync(paths.adminPasswordFile, "utf8"));
  return paths;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
};

export async function waitForPortainer({
  url = resolveEnv().url,
  username = resolveEnv().username,
  password = resolveEnv().password,
  timeoutMs = Number(process.env.PORTAINER_WAIT_TIMEOUT_MS || 120_000),
  log = (line) => console.log(line),
} = {}) {
  assertPassword(password);
  const deadline = Date.now() + timeoutMs;

  let status = null;
  for (;;) {
    try {
      const res = await request(`${url}/api/system/status`);
      if (res.status === 200 && res.body && typeof res.body === "object") {
        status = res.body;
        break;
      }
      // Pre-2.19 images serve the same document at /api/status.
      const legacy = await request(`${url}/api/status`);
      if (
        legacy.status === 200 &&
        legacy.body &&
        typeof legacy.body === "object"
      ) {
        status = legacy.body;
        break;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${TAG} Portainer at ${url} did not answer /api/system/status within ${timeoutMs}ms.`,
      );
    }
    await sleep(1000);
  }
  const version = status.Version ?? status.version ?? "unknown";
  log(`${TAG} Portainer ${version} is listening at ${url}`);

  // 204 = admin exists, 404 = no admin yet (only possible if
  // --admin-password-file was not honoured).
  const check = await request(`${url}/api/users/admin/check`);
  if (check.status === 404) {
    log(
      `${TAG} No admin user yet; initialising '${username}' via /api/users/admin/init`,
    );
    const init = await request(`${url}/api/users/admin/init`, {
      method: "POST",
      body: JSON.stringify({ Username: username, Password: password }),
    });
    if (init.status !== 200) {
      throw new Error(
        `${TAG} /api/users/admin/init failed with HTTP ${init.status}: ${JSON.stringify(init.body)}`,
      );
    }
  } else if (check.status !== 204 && check.status !== 200) {
    throw new Error(
      `${TAG} Unexpected HTTP ${check.status} from /api/users/admin/check.`,
    );
  }

  const auth = await request(`${url}/api/auth`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (auth.status !== 200 || !auth.body || typeof auth.body.jwt !== "string") {
    throw new Error(
      `${TAG} Admin login as '${username}' failed with HTTP ${auth.status}: ${JSON.stringify(auth.body)}`,
    );
  }
  log(`${TAG} Admin login OK (jwt length ${auth.body.jwt.length})`);
  return { url, version, username };
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isCli) {
  const command = process.argv[2] || "validate";
  const outputDir = process.argv[3] || DEFAULT_PORTAINER_FIXTURE_DIR;
  try {
    if (command === "prepare") {
      const paths = preparePortainerFixture({ outputDir });
      console.log(`${TAG} Prepared admin password file in ${paths.outputDir}`);
    } else if (command === "validate") {
      const paths = validatePortainerFixture({ outputDir });
      console.log(`${TAG} Validated admin password file in ${paths.outputDir}`);
    } else if (command === "wait") {
      await waitForPortainer();
    } else {
      throw new Error(
        `${TAG} Unknown command '${command}'. Expected 'prepare', 'validate' or 'wait'.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
