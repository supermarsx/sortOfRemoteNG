// t65-e5 — disposable Nginx Proxy Manager fixture for the e2e compose stack.
//
// Subcommands (same contract as scripts/ci/e2e-portainer-fixture.mjs):
//   prepare   validate the credentials that compose will hand to the
//             container. Unlike Portainer's fixture nothing is written to
//             disk: NPM provisions its admin from INITIAL_ADMIN_EMAIL /
//             INITIAL_ADMIN_PASSWORD, so `prepare` is purely a preflight.
//   validate  same checks, run again after compose (kept so the workflow can
//             mirror the http/portainer prepare+validate pairs).
//   wait      poll NPM_URL until GET /api/ answers, then make sure the
//             configured account can actually log in:
//               * INITIAL_ADMIN_* honoured (v2.10+) → login just works;
//               * older tags ignore them and create the classic
//                 admin@example.com / changeme account, which NPM marks as
//                 "must change password". This resolves that by logging in
//                 with the default password, renaming the account to
//                 NPM_ADMIN_EMAIL when it differs (PUT /api/users/{id}) and
//                 setting NPM_ADMIN_PASSWORD (PUT /api/users/{id}/auth),
//                 then re-logging in with the configured credentials.
//             Prints the NPM version and the admin email.
//   seed      ensure one deterministic proxy host exists (e2e-seed.local →
//             127.0.0.1:8080) so the Proxy Hosts tab is never empty for the
//             WDIO panel spec. Idempotent.
//   verify-login-form
//             download the login page's JavaScript and report which login-form
//             variant the running image ships, so NPM_AUTO_LOGIN_SELECTORS in
//             src/components/integrations/nginxProxyMgr/webUiLaunch.ts can be
//             checked against a real container instead of being assumed.
//
// Nothing is ever written to the repo: the container's SQLite database lives
// in the container layer and dies with `docker compose down`.

import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

export const DEFAULT_NPM_URL = "http://127.0.0.1:18181";
export const DEFAULT_NPM_ADMIN_EMAIL = "admin@example.com";
export const DEFAULT_NPM_ADMIN_PASSWORD = "npm-e2e-pass1234";

/** NPM's own factory-default credentials (used before the first change). */
const NPM_FACTORY_EMAIL = "admin@example.com";
const NPM_FACTORY_PASSWORD = "changeme";

/** NPM rejects admin passwords shorter than 8 characters. */
const MIN_PASSWORD_LENGTH = 8;

export const SEED_PROXY_HOST_DOMAIN = "e2e-seed.local";

const TAG = "[e2e-npm-fixture]";

const resolveEnv = () => ({
  url: (process.env.NPM_URL || DEFAULT_NPM_URL).replace(/\/+$/u, ""),
  email: process.env.NPM_ADMIN_EMAIL || DEFAULT_NPM_ADMIN_EMAIL,
  password: process.env.NPM_ADMIN_PASSWORD || DEFAULT_NPM_ADMIN_PASSWORD,
});

const assertPassword = (password) => {
  if (!password || /[\r\n]/u.test(password)) {
    throw new Error(
      `${TAG} NPM_ADMIN_PASSWORD must be non-empty and cannot contain a newline.`,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${TAG} NPM_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (Nginx Proxy Manager rejects shorter admin passwords).`,
    );
  }
  if (password === NPM_FACTORY_PASSWORD) {
    throw new Error(
      `${TAG} NPM_ADMIN_PASSWORD must not be the factory default '${NPM_FACTORY_PASSWORD}' — NPM forces a change on first login.`,
    );
  }
};

const assertEmail = (email) => {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
    throw new Error(
      `${TAG} NPM_ADMIN_EMAIL must be a valid email address (got ${JSON.stringify(email)}).`,
    );
  }
};

export function validateNpmFixture({
  email = resolveEnv().email,
  password = resolveEnv().password,
} = {}) {
  assertEmail(email);
  assertPassword(password);
  return { email, password };
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

const authed = (token) => ({ authorization: `Bearer ${token}` });

/** `POST /api/tokens` — returns the token string, or null on 401/403. */
const login = async (url, identity, secret) => {
  const res = await request(`${url}/api/tokens`, {
    method: "POST",
    body: JSON.stringify({ identity, secret }),
  });
  if (res.status === 200 && res.body && typeof res.body.token === "string") {
    return res.body.token;
  }
  if (res.status === 401 || res.status === 403 || res.status === 400) {
    return null;
  }
  throw new Error(
    `${TAG} POST /api/tokens returned an unexpected HTTP ${res.status}: ${JSON.stringify(res.body)}`,
  );
};

const versionString = (body) => {
  const v = body && typeof body === "object" ? body.version : null;
  if (!v || typeof v !== "object") return "unknown";
  return [v.major, v.minor, v.revision]
    .map((part) => (typeof part === "number" ? part : 0))
    .join(".");
};

async function waitForApi(url, deadline) {
  for (;;) {
    try {
      const res = await request(`${url}/api/`);
      if (res.status === 200 && res.body && typeof res.body === "object") {
        // `setup: false` = the instance has no user at all yet.
        return { version: versionString(res.body), setup: res.body.setup };
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${TAG} Nginx Proxy Manager at ${url} did not answer GET /api/ in time.`,
      );
    }
    await sleep(1000);
  }
}

/**
 * Fresh instance with no user at all (`GET /api/` → `setup: false`, i.e. the
 * container was started without INITIAL_ADMIN_*). While setup is incomplete
 * NPM accepts an unauthenticated `POST /api/users` to create the first admin.
 */
async function createFirstAdmin(url, email, password, log) {
  log(`${TAG} No user exists yet (setup: false); creating the first admin.`);
  const created = await request(`${url}/api/users`, {
    method: "POST",
    body: JSON.stringify({
      name: "Administrator",
      nickname: "Admin",
      email,
      roles: ["admin"],
      is_disabled: false,
      auth: { type: "password", secret: password },
    }),
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(
      `${TAG} POST /api/users (first admin) failed with HTTP ${created.status}: ${JSON.stringify(created.body)}`,
    );
  }
}

/**
 * Legacy path: the image ignored INITIAL_ADMIN_* and still has the factory
 * admin. Rename it to `email` if needed and set `password`.
 */
async function migrateFactoryAdmin(url, token, email, password, log) {
  const me = await request(`${url}/api/users/me`, { headers: authed(token) });
  if (me.status !== 200 || !me.body || typeof me.body.id !== "number") {
    throw new Error(
      `${TAG} GET /api/users/me failed with HTTP ${me.status}: ${JSON.stringify(me.body)}`,
    );
  }
  const userId = me.body.id;

  if (me.body.email !== email) {
    log(`${TAG} Renaming factory admin ${me.body.email} → ${email}`);
    const renamed = await request(`${url}/api/users/${userId}`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({
        email,
        name: me.body.name || "Administrator",
        nickname: me.body.nickname || "Admin",
        roles: me.body.roles || ["admin"],
      }),
    });
    if (renamed.status !== 200) {
      throw new Error(
        `${TAG} PUT /api/users/${userId} failed with HTTP ${renamed.status}: ${JSON.stringify(renamed.body)}`,
      );
    }
  }

  log(`${TAG} Setting the admin password via PUT /api/users/${userId}/auth`);
  const changed = await request(`${url}/api/users/${userId}/auth`, {
    method: "PUT",
    headers: authed(token),
    body: JSON.stringify({
      type: "password",
      current: NPM_FACTORY_PASSWORD,
      secret: password,
    }),
  });
  if (changed.status !== 200 && changed.status !== 201) {
    throw new Error(
      `${TAG} PUT /api/users/${userId}/auth failed with HTTP ${changed.status}: ${JSON.stringify(changed.body)}`,
    );
  }
}

export async function waitForNpm({
  url = resolveEnv().url,
  email = resolveEnv().email,
  password = resolveEnv().password,
  timeoutMs = Number(process.env.NPM_WAIT_TIMEOUT_MS || 180_000),
  log = (line) => console.log(line),
} = {}) {
  validateNpmFixture({ email, password });
  const deadline = Date.now() + timeoutMs;

  const { version, setup } = await waitForApi(url, deadline);
  log(`${TAG} Nginx Proxy Manager ${version} is listening at ${url}`);

  if (setup === false) {
    await createFirstAdmin(url, email, password, log);
  }

  // NPM creates the admin row a moment after the API starts answering, so
  // retry the login until the deadline before concluding it is the factory
  // account (or a genuine credential mismatch).
  let token = null;
  for (;;) {
    token = await login(url, email, password);
    if (token) break;

    const factoryToken = await login(
      url,
      NPM_FACTORY_EMAIL,
      NPM_FACTORY_PASSWORD,
    );
    if (factoryToken) {
      log(
        `${TAG} INITIAL_ADMIN_* was not honoured by this image tag; migrating the factory admin account.`,
      );
      await migrateFactoryAdmin(url, factoryToken, email, password, log);
      token = await login(url, email, password);
      if (!token) {
        throw new Error(
          `${TAG} Admin login as '${email}' still failed after the factory-account migration.`,
        );
      }
      break;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `${TAG} Admin login as '${email}' failed and the factory account (${NPM_FACTORY_EMAIL}/${NPM_FACTORY_PASSWORD}) was rejected too. Is NPM_ADMIN_PASSWORD in sync with the running container?`,
      );
    }
    await sleep(1000);
  }

  const me = await request(`${url}/api/users/me`, { headers: authed(token) });
  if (me.status !== 200 || !me.body || typeof me.body.email !== "string") {
    throw new Error(
      `${TAG} GET /api/users/me failed with HTTP ${me.status}: ${JSON.stringify(me.body)}`,
    );
  }
  log(
    `${TAG} Admin login OK as ${me.body.email} (token length ${token.length})`,
  );
  return { url, version, email: me.body.email, token };
}

/**
 * Ensure a deterministic proxy host exists so the panel's Proxy Hosts tab has
 * at least one row. Idempotent: re-running is a no-op.
 */
export async function seedNpm({
  url = resolveEnv().url,
  email = resolveEnv().email,
  password = resolveEnv().password,
  log = (line) => console.log(line),
} = {}) {
  const { token } = await waitForNpm({ url, email, password, log });

  const list = await request(`${url}/api/nginx/proxy-hosts`, {
    headers: authed(token),
  });
  if (list.status !== 200 || !Array.isArray(list.body)) {
    throw new Error(
      `${TAG} GET /api/nginx/proxy-hosts failed with HTTP ${list.status}: ${JSON.stringify(list.body)}`,
    );
  }
  const existing = list.body.find((host) =>
    (host.domain_names || []).includes(SEED_PROXY_HOST_DOMAIN),
  );
  if (existing) {
    log(
      `${TAG} Seed proxy host ${SEED_PROXY_HOST_DOMAIN} already exists (id ${existing.id})`,
    );
    return { url, id: existing.id, created: false };
  }

  const created = await request(`${url}/api/nginx/proxy-hosts`, {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify({
      domain_names: [SEED_PROXY_HOST_DOMAIN],
      forward_scheme: "http",
      forward_host: "127.0.0.1",
      forward_port: 8080,
      access_list_id: 0,
      certificate_id: 0,
      ssl_forced: false,
      caching_enabled: false,
      block_exploits: false,
      allow_websocket_upgrade: false,
      http2_support: false,
      hsts_enabled: false,
      hsts_subdomains: false,
      advanced_config: "",
      locations: [],
      meta: {},
    }),
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(
      `${TAG} POST /api/nginx/proxy-hosts failed with HTTP ${created.status}: ${JSON.stringify(created.body)}`,
    );
  }
  log(
    `${TAG} Seeded proxy host ${SEED_PROXY_HOST_DOMAIN} (id ${created.body?.id})`,
  );
  return { url, id: created.body?.id, created: true };
}

/**
 * The two shapes NPM's own login form has shipped in. `NPM_AUTO_LOGIN_SELECTORS`
 * in src/components/integrations/nginxProxyMgr/webUiLaunch.ts must match one of
 * them or the panel's "Open web UI (auto-login)" silently fills nothing.
 */
// Ordered most-specific first: `identity`/`secret` appear nowhere in the modern
// bundle (verified against 2.15.1), whereas a field literally named `email` or
// `password` could plausibly show up in the legacy bundle's other forms.
export const LOGIN_FORM_VARIANTS = [
  {
    id: "backbone",
    since: "NPM <= 2.12 (Backbone/Handlebars UI)",
    usernameSelector: 'input[name="identity"]',
    passwordSelector: 'input[name="secret"]',
    submitSelector: 'button[type="submit"]',
    probes: [/name=\\?["']identity\\?["']/u, /name=\\?["']secret\\?["']/u],
  },
  {
    id: "react",
    since: "NPM 2.13+ (Vite/React/Formik UI)",
    usernameSelector: 'input[name="email"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'button[type="submit"]',
    // Minified Formik `<Field name="email">` — quote style varies by bundler.
    probes: [/name\s*:\s*[`"']email[`"']/u, /name\s*:\s*[`"']password[`"']/u],
  },
];

const fetchText = async (url) => {
  const response = await fetch(url);
  return response.ok ? await response.text() : "";
};

/**
 * Download the login page's JavaScript and report which login-form variant the
 * running image ships. Throws when neither is recognised, which is the signal
 * that `NPM_AUTO_LOGIN_SELECTORS` needs updating for a new NPM release.
 */
export async function verifyLoginForm({
  url = resolveEnv().url,
  log = (line) => console.log(line),
} = {}) {
  const index = await fetchText(`${url}/login`);
  if (!index) {
    throw new Error(`${TAG} GET ${url}/login did not return the app shell.`);
  }

  const scripts = new Set(
    [...index.matchAll(/src=["'](\/(?:assets|js)\/[^"']+\.js)["']/gu)].map(
      (m) => m[1],
    ),
  );
  let combined = "";
  for (const src of scripts) {
    combined += await fetchText(`${url}${src}`);
  }
  // The login view is a lazily imported chunk in the Vite build; the entry
  // bundle names it, so follow that reference too.
  for (const chunk of new Set(
    [...combined.matchAll(/(Login-[A-Za-z0-9_-]+\.js)/gu)].map((m) => m[1]),
  )) {
    combined += await fetchText(`${url}/assets/${chunk}`);
  }
  if (!combined) {
    throw new Error(
      `${TAG} Could not download any login-page JavaScript from ${url}.`,
    );
  }

  const variant = LOGIN_FORM_VARIANTS.find((candidate) =>
    candidate.probes.every((probe) => probe.test(combined)),
  );
  if (!variant) {
    throw new Error(
      `${TAG} The login form matches none of the known variants (${LOGIN_FORM_VARIANTS.map((v) => v.id).join(", ")}). Inspect ${url}/login and update NPM_AUTO_LOGIN_SELECTORS in src/components/integrations/nginxProxyMgr/webUiLaunch.ts.`,
    );
  }
  log(
    `${TAG} Login form variant '${variant.id}' — ${variant.since}: ${variant.usernameSelector} / ${variant.passwordSelector} / ${variant.submitSelector}`,
  );
  return variant;
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isCli) {
  const command = process.argv[2] || "validate";
  try {
    if (command === "prepare" || command === "validate") {
      const { email } = validateNpmFixture();
      console.log(
        `${TAG} ${command === "prepare" ? "Prepared" : "Validated"} credentials for '${email}' (nothing is written to disk).`,
      );
    } else if (command === "wait") {
      await waitForNpm();
    } else if (command === "seed") {
      await seedNpm();
    } else if (command === "verify-login-form") {
      await verifyLoginForm();
    } else {
      throw new Error(
        `${TAG} Unknown command '${command}'. Expected 'prepare', 'validate', 'wait', 'seed' or 'verify-login-form'.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
