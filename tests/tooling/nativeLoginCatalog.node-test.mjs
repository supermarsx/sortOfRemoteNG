// Tooling suite for scripts/generate-native-login-catalog.mjs: the native login
// catalog and the steps registry are generated from the TypeScript catalog plus
// src/data/loginSteps, and a stale copy of either fails the check. While
// declarative login is switched off, steps files are validated and not emitted.
// Run with: node --test tests/tooling/nativeLoginCatalog.node-test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(repo, "scripts/generate-native-login-catalog.mjs");
const {
  NATIVE_LOGIN_CATALOG_PATH,
  generateNativeLoginCatalog,
  renderNativeLoginCatalog,
} = await import(pathToFileURL(script).href);

const committedCatalog = path.join(repo, NATIVE_LOGIN_CATALOG_PATH);
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const PROFILE_FIELDS = [
  "capability",
  "loginFlow",
  "emailOnly",
  "selectors",
  "sameOriginLoginFrames",
  "scriptDefaults",
  "requestDefaults",
];

/** A reviewed two-origin, identifier-first login with a frame-free pre-step. */
const stepsFile = (id, patch = {}) => ({
  $schema: "../../../types/connection/httpLoginSteps.schema.json",
  version: 1,
  id,
  evidence: {
    class: "B",
    source: "https://source.example.test/login.html",
    reviewed: "2026-10-12",
  },
  credentialOrigins: ["https://login.example.com"],
  loginSteps: [
    { kind: "click", selectors: { control: "#open-sign-in" } },
    {
      kind: "identifier",
      paths: ["/login"],
      selectors: { username: "#account" },
    },
    { kind: "submit", submission: "spa", selectors: { control: "#next" } },
    {
      kind: "password",
      origin: "https://login.example.com",
      pathPrefixes: ["/oauth/"],
      waitFor: "form#password",
      selectors: { password: "#secret" },
    },
    { kind: "submit", submission: "enter" },
  ],
  totpChallenges: [
    {
      id: `${id}-totp`,
      label: "Authenticator code",
      codeSelector: "#otp",
      submitSelector: "#otp-go",
      paths: ["/oauth/otp"],
      submission: "post",
      origins: ["https://login.example.com"],
    },
  ],
  ...patch,
});
const passwordOnlyFile = (id) =>
  stepsFile(id, {
    evidence: {
      class: "A",
      source: "https://source.example.test/device.html",
      reviewed: "2026-10-11",
    },
    credentialOrigins: [],
    passwordOnly: true,
    loginSteps: [
      { kind: "password", frame: "appFrame", selectors: { password: "#pw" } },
      { kind: "submit", submission: "click", selectors: { control: "#go" } },
    ],
    totpChallenges: undefined,
  });

/** A scratch tree: its own steps directory and its own two generated files. */
function workspace(t, files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sorng-login-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stepsDirectory = path.join(root, "loginSteps");
  mkdirSync(stepsDirectory);
  const scratch = {
    stepsDirectory,
    catalogPath: path.join(root, "native_login_catalog.json"),
    registryPath: path.join(root, "httpLoginStepsRegistry.ts"),
    totpCatalogPath: path.join(root, "origin_browser_totp_catalog.json"),
  };
  for (const [relative, content] of Object.entries(files))
    land(scratch, relative, content);
  return scratch;
}
/** A steps file arrives in (or is rewritten in) the steps directory. */
function land(scratch, relative, content) {
  const target = path.join(scratch.stepsDirectory, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    typeof content === "string" ? content : JSON.stringify(content),
  );
}
const generated = (scratch) => [
  read(scratch.totpCatalogPath),
  read(scratch.catalogPath),
  read(scratch.registryPath),
];
const OFF = { declarativeLoginSupported: false };
const ON = { declarativeLoginSupported: true };

test("the committed native catalog and steps registry are what the generator produces", async () => {
  const result = await generateNativeLoginCatalog({ check: true });
  assert.deepEqual(result.stale, []);
  assert.equal(result.profiles, 160);
});

test("--check passes on the tree and the command line takes nothing else", () => {
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: "utf8",
    });
  const checked = run("--check");
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(
    checked.stdout,
    /^Checked the native login catalog: 160 profiles; \d+ login steps files validated, \d+ emitted/u,
  );
  for (const args of [["--force"], ["--check", "extra"]]) {
    const refused = run(...args);
    assert.equal(refused.status, 1);
    assert.match(
      refused.stderr,
      /Usage: node scripts\/generate-native-login-catalog\.mjs \[--check\]/u,
    );
  }
});

test("switched off, a steps file is validated and nothing of it is emitted", async (t) => {
  const empty = workspace(t);
  assert.deepEqual(await generateNativeLoginCatalog({ ...empty, ...OFF }), {
    stale: [],
    profiles: 160,
    steps: 0,
    emitted: 0,
  });
  const scratch = workspace(t, {
    "self-hosted/zulip.json": stepsFile("zulip"),
    "appliances/idrac.json": passwordOnlyFile("idrac"),
  });
  assert.deepEqual(await generateNativeLoginCatalog({ ...scratch, ...OFF }), {
    stale: [],
    profiles: 160,
    steps: 2,
    emitted: 0,
  });
  // Byte for byte what an empty steps directory gives: no key, no import.
  assert.deepEqual(generated(scratch), generated(empty));
  const catalog = JSON.parse(read(scratch.catalogPath));
  assert.deepEqual(Object.keys(catalog), ["profiles", "joomla", "droneScm"]);
  for (const profile of Object.values(catalog.profiles))
    for (const key of Object.keys(profile))
      assert.ok(PROFILE_FIELDS.includes(key), key);
  assert.equal(/^import /mu.test(read(scratch.registryPath)), false);
  assert.equal(read(scratch.catalogPath).includes("#open-sign-in"), false);

  // More files landing, and files being revised or withdrawn, leave the two
  // generated files current: nobody has to regenerate while it is off.
  land(scratch, "portals/namecheap.json", stepsFile("namecheap"));
  land(
    scratch,
    "self-hosted/zulip.json",
    stepsFile("zulip", {
      credentialOrigins: [],
      loginSteps: [
        { kind: "form", selectors: { username: "#user", password: "#pass" } },
      ],
      totpChallenges: undefined,
    }),
  );
  rmSync(path.join(scratch.stepsDirectory, "appliances/idrac.json"));
  const checked = await generateNativeLoginCatalog({
    ...scratch,
    ...OFF,
    check: true,
  });
  assert.deepEqual(checked, { stale: [], profiles: 160, steps: 2, emitted: 0 });

  // Still validated: a file the catalog cannot use fails the check.
  land(scratch, "self-hosted/zulip.json", {
    ...stepsFile("zulip"),
    macro: "run",
  });
  await assert.rejects(
    generateNativeLoginCatalog({ ...scratch, ...OFF, check: true }),
    /self-hosted\/zulip\.json: invalid-format: unknown-field at macro/u,
  );
});

test("the committed catalog holds the five fields the native engine reads today, plus only emitted steps", async (t) => {
  const scratch = workspace(t);
  await generateNativeLoginCatalog({ ...scratch, ...OFF });
  const committed = JSON.parse(read(committedCatalog));
  for (const profile of Object.values(committed.profiles))
    delete profile.declarativeLogin;
  delete committed.declarativeLoginSupported;
  // A steps file never changes, adds or removes anything else in an entry.
  assert.deepEqual(committed, JSON.parse(read(scratch.catalogPath)));
});

test("switched on, the generated catalog equals the TypeScript catalog plus the steps files", async (t) => {
  const scratch = workspace(t, {
    "self-hosted/zulip.json": stepsFile("zulip"),
    "appliances/idrac.json": passwordOnlyFile("idrac"),
  });
  const result = await generateNativeLoginCatalog({ ...scratch, ...ON });
  assert.deepEqual(result, { stale: [], profiles: 160, steps: 2, emitted: 2 });
  const empty = workspace(t);
  await generateNativeLoginCatalog({ ...empty, ...OFF });
  const before = JSON.parse(read(empty.catalogPath));
  const after = JSON.parse(read(scratch.catalogPath));
  const file = stepsFile("zulip");
  assert.deepEqual(after.profiles.zulip, {
    // The capability the native authority reads is not touched.
    capability: "manual",
    declarativeLogin: {
      // No automatic login before: only the steps may type.
      mode: "exclusive",
      credentialOrigins: file.credentialOrigins,
      passwordOnly: false,
      loginSteps: file.loginSteps,
    },
  });
  assert.deepEqual(after.profiles.idrac, {
    capability: "generic-form",
    declarativeLogin: {
      // On generic detection today, which stays the fallback.
      mode: "additive",
      credentialOrigins: [],
      passwordOnly: true,
      loginSteps: [
        { kind: "password", frame: "appFrame", selectors: { password: "#pw" } },
        { kind: "submit", submission: "click", selectors: { control: "#go" } },
      ],
    },
  });
  // Nothing else moved: same profiles, same order, same content.
  assert.deepEqual(Object.keys(after.profiles), Object.keys(before.profiles));
  for (const [id, profile] of Object.entries(before.profiles))
    if (id !== "zulip" && id !== "idrac")
      assert.deepEqual(after.profiles[id], profile, id);
  assert.deepEqual(after.joomla, before.joomla);
  assert.deepEqual(after.droneScm, before.droneScm);
  // The announcement the native engine waits for, after everything else.
  assert.deepEqual(Object.keys(after), [
    "profiles",
    "joomla",
    "droneScm",
    "declarativeLoginSupported",
  ]);
  assert.equal(after.declarativeLoginSupported, true);

  // The registry imports each file once, in a stable order.
  const registry = read(scratch.registryPath);
  assert.match(
    registry,
    /Generated by scripts\/generate-native-login-catalog\.mjs/u,
  );
  assert.equal(registry.match(/^import /gmu).length, 2);
  assert.ok(registry.indexOf('["idrac"') < registry.indexOf('["zulip"'));
  assert.match(registry, /appliances\/idrac\.json"/u);
  assert.match(registry, /self-hosted\/zulip\.json"/u);

  // Generating again changes nothing, and the check agrees.
  const again = await generateNativeLoginCatalog({
    ...scratch,
    ...ON,
    check: true,
  });
  assert.deepEqual(again.stale, []);
});

test("the check fails when the catalog or the registry is stale", async (t) => {
  const stale = async (scratch, flag) =>
    (await generateNativeLoginCatalog({ ...scratch, ...flag, check: true }))
      .stale;
  // Switching on adds the reviewed steps' challenge to the native OTP table.
  const scratch = workspace(t, {
    "self-hosted/zulip.json": stepsFile("zulip"),
  });
  await generateNativeLoginCatalog({ ...scratch, ...OFF });
  const switchedOff = generated(scratch);
  assert.deepEqual(await stale(scratch, ON), [
    scratch.totpCatalogPath,
    scratch.catalogPath,
    scratch.registryPath,
  ]);
  // A check never writes.
  assert.deepEqual(generated(scratch), switchedOff);

  await generateNativeLoginCatalog({ ...scratch, ...ON });
  assert.deepEqual(await stale(scratch, ON), []);
  // Switched on, a steps file that lands or changes needs a new run.
  land(scratch, "appliances/idrac.json", passwordOnlyFile("idrac"));
  assert.deepEqual(await stale(scratch, ON), [
    scratch.catalogPath,
    scratch.registryPath,
  ]);
  await generateNativeLoginCatalog({ ...scratch, ...ON });
  // One edited selector in the generated catalog is enough.
  writeFileSync(
    scratch.catalogPath,
    read(scratch.catalogPath).replace("#open-sign-in", "#open-sign-up"),
  );
  assert.deepEqual(await stale(scratch, ON), [scratch.catalogPath]);
  // So is a missing file.
  rmSync(scratch.registryPath);
  assert.deepEqual(await stale(scratch, ON), [
    scratch.catalogPath,
    scratch.registryPath,
  ]);
  // CRLF checkouts are not stale.
  await generateNativeLoginCatalog({ ...scratch, ...ON });
  for (const file of [scratch.catalogPath, scratch.registryPath])
    writeFileSync(file, read(file).replaceAll("\n", "\r\n"));
  assert.deepEqual(await stale(scratch, ON), []);
  // Switched off, a hand-edited catalog is stale too.
  await generateNativeLoginCatalog({ ...scratch, ...OFF });
  writeFileSync(
    scratch.catalogPath,
    read(scratch.catalogPath).replace('"manual"', '"known-form"'),
  );
  assert.deepEqual(await stale(scratch, OFF), [scratch.catalogPath]);
});

test("the generator refuses steps it cannot use and writes nothing, switched on or off", async (t) => {
  const cases = [
    [
      "a file that breaks the format",
      { "self-hosted/zulip.json": { ...stepsFile("zulip"), macro: "run" } },
      /self-hosted\/zulip\.json: invalid-format: unknown-field at macro/u,
    ],
    [
      "a file named after another application",
      { "self-hosted/zulip.json": stepsFile("zabbix") },
      /self-hosted\/zulip\.json: invalid-format: id-mismatch at id/u,
    ],
    [
      "an application outside the catalog",
      { "self-hosted/nextgen.json": stepsFile("nextgen") },
      /self-hosted\/nextgen\.json: unknown-profile/u,
    ],
    [
      "an application that is automatic today",
      { "self-hosted/portainer.json": stepsFile("portainer") },
      /self-hosted\/portainer\.json: not-eligible/u,
    ],
    [
      "a staged adapter",
      { "identity/adobe-admin-console.json": stepsFile("adobe-admin-console") },
      /identity\/adobe-admin-console\.json: not-eligible/u,
    ],
    [
      "one application in two families",
      {
        "self-hosted/zulip.json": stepsFile("zulip"),
        "portals/zulip.json": stepsFile("zulip"),
      },
      /zulip has more than one steps file: portals\/zulip\.json, self-hosted\/zulip\.json/u,
    ],
    [
      "text that is not JSON",
      { "self-hosted/zulip.json": "{ not json" },
      /self-hosted\/zulip\.json: not valid JSON/u,
    ],
    [
      "a steps file outside a family directory",
      { "zulip.json": stepsFile("zulip") },
      /zulip\.json: steps files live in src\/data\/loginSteps\/<family>\/<id>\.json/u,
    ],
  ];
  for (const flag of [OFF, ON])
    for (const [name, files, expected] of cases) {
      const scratch = workspace(t, files);
      await assert.rejects(
        generateNativeLoginCatalog({ ...scratch, ...flag }),
        (error) => {
          assert.match(error.message, expected, name);
          // Rule codes and paths only: never text copied out of a steps file.
          assert.doesNotMatch(
            error.message,
            /#account|#secret|source\.example/u,
          );
          return true;
        },
        name,
      );
      assert.equal(existsSync(scratch.catalogPath), false, name);
      assert.equal(existsSync(scratch.registryPath), false, name);
      assert.equal(existsSync(scratch.totpCatalogPath), false, name);
    }
});

test("a rendered entry keeps its five fields and adds only the steps it is given", () => {
  const profiles = [
    { id: "zulip", capability: "manual" },
    {
      id: "portainer",
      capability: "known-form",
      selectors: {
        usernameSelector: "#u",
        passwordSelector: "#p",
        submitSelector: "#s",
      },
    },
  ];
  const input = {
    profiles,
    joomla: { auto: { usernameSelector: "#j" } },
    modeOf: (profile) =>
      profile.capability === "manual" ? "exclusive" : "additive",
    steps: new Map([
      [
        "zulip",
        {
          version: 1,
          id: "zulip",
          evidence: stepsFile("zulip").evidence,
          credentialOrigins: [],
          passwordOnly: false,
          loginSteps: [
            { kind: "form", selectors: { username: "#u", password: "#p" } },
          ],
        },
      ],
    ]),
  };
  const on = renderNativeLoginCatalog({ ...input, ...ON });
  assert.deepEqual(on, {
    profiles: {
      zulip: {
        capability: "manual",
        declarativeLogin: {
          mode: "exclusive",
          credentialOrigins: [],
          passwordOnly: false,
          loginSteps: [
            { kind: "form", selectors: { username: "#u", password: "#p" } },
          ],
        },
      },
      portainer: { capability: "known-form", selectors: profiles[1].selectors },
    },
    joomla: input.joomla,
    declarativeLoginSupported: true,
  });
  // Evidence and authenticator challenges are not login-engine input.
  assert.equal(JSON.stringify(on).includes("source.example"), false);
  // No steps given, nothing announced: an absent key means off.
  assert.deepEqual(
    renderNativeLoginCatalog({ ...input, steps: new Map(), ...OFF }),
    {
      profiles: {
        zulip: { capability: "manual" },
        portainer: {
          capability: "known-form",
          selectors: profiles[1].selectors,
        },
      },
      joomla: input.joomla,
    },
  );
});

test("the Drone CI provider table carries only what native binds: flow, origins and the reviewed form", () => {
  const droneScm = {
    gitea: {
      label: "Gitea",
      flow: "oauth",
      authorizePath: "/login/oauth/authorize",
      signIn: {
        selectors: { usernameSelector: "#u", passwordSelector: "#p" },
        evidence: "go-gitea",
      },
      totp: { id: "t", codeSelector: "#c" },
      consent: { buttonSelector: "#authorize-app", evidence: "grant.tmpl" },
    },
    github: {
      label: "GitHub",
      flow: "oauth",
      defaultOrigin: "https://github.com",
      signIn: {
        selectors: { usernameSelector: "#l" },
        onlyOrigin: "https://github.com",
        evidence: "x",
      },
      totp: null,
      consent: null,
    },
    bitbucket: {
      label: "Bitbucket Cloud",
      flow: "oauth",
      defaultOrigin: "https://bitbucket.org",
      fixedOrigin: true,
      signIn: null,
      totp: null,
      consent: null,
    },
  };
  const rendered = renderNativeLoginCatalog({
    profiles: [{ id: "drone-ci", capability: "known-form" }],
    joomla: {},
    droneScm,
    steps: new Map(),
    modeOf: () => "exclusive",
    ...OFF,
  });
  assert.deepEqual(rendered.droneScm, {
    gitea: {
      flow: "oauth",
      selectors: { usernameSelector: "#u", passwordSelector: "#p" },
      consent: { buttonSelector: "#authorize-app" },
    },
    github: {
      flow: "oauth",
      defaultOrigin: "https://github.com",
      onlyOrigin: "https://github.com",
      selectors: { usernameSelector: "#l" },
    },
    bitbucket: {
      flow: "oauth",
      defaultOrigin: "https://bitbucket.org",
      fixedOrigin: true,
    },
  });
  // Reviewed consent controls are carried; challenge/evidence text is separate.
  for (const absent of ["grant.tmpl", "go-gitea", "#c", "Gitea"])
    assert.equal(JSON.stringify(rendered).includes(absent), false, absent);
});
