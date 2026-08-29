import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

function readWorkflow(url) {
  return readFileSync(url, "utf8").replace(/\r\n?/g, "\n");
}

const releaseWorkflow = readWorkflow(
  new URL("../../.github/workflows/release.yml", import.meta.url),
);
const ciWorkflow = readWorkflow(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
);
const e2eWorkflow = readWorkflow(
  new URL("../../.github/workflows/e2e.yml", import.meta.url),
);
const actionlintConfig = readFileSync(
  new URL("../../.github/actionlint.yaml", import.meta.url),
  "utf8",
);
const dependabotConfig = readFileSync(
  new URL("../../.github/dependabot.yml", import.meta.url),
  "utf8",
);
const cargoConfig = readFileSync(
  new URL("../../src-tauri/.cargo/config.toml", import.meta.url),
  "utf8",
);
const cargoManifest = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const rdpVendorManifest = readFileSync(
  new URL(
    "../../src-tauri/crates/sorng-rdp-vendor/Cargo.toml",
    import.meta.url,
  ),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const flatpakManifest = readFileSync(
  new URL("../../packaging/flatpak/com.sortofremote.ng.yml", import.meta.url),
  "utf8",
);
const flatpakDesktop = readFileSync(
  new URL(
    "../../packaging/flatpak/com.sortofremote.ng.desktop",
    import.meta.url,
  ),
  "utf8",
);
const flatpakMetainfo = readFileSync(
  new URL(
    "../../packaging/flatpak/com.sortofremote.ng.metainfo.xml",
    import.meta.url,
  ),
  "utf8",
);
const linuxDesktopTemplate = readFileSync(
  new URL("../../src-tauri/packaging/linux.desktop", import.meta.url),
  "utf8",
);
const opksshBinarySource = readFileSync(
  new URL("../../src-tauri/crates/sorng-opkssh/src/binary.rs", import.meta.url),
  "utf8",
);
const stateRegistryOpsSource = readFileSync(
  new URL("../../src-tauri/src/state_registry/ops.rs", import.meta.url),
  "utf8",
);
const updaterSetupDocumentation = readFileSync(
  new URL("../../docs/release/updater-setup.md", import.meta.url),
  "utf8",
);
const releaseDocumentation = readFileSync(
  new URL("../../docs/releases.md", import.meta.url),
  "utf8",
);
const appleEnrollmentDocumentation = readFileSync(
  new URL("../../docs/release/apple-developer-enrollment.md", import.meta.url),
  "utf8",
);
const readme = readFileSync(
  new URL("../../readme.md", import.meta.url),
  "utf8",
);
const workflowCall = releaseWorkflow.slice(
  releaseWorkflow.indexOf("  workflow_call:"),
  releaseWorkflow.indexOf("  workflow_dispatch:"),
);

function assertOrdered(source, before, after, message) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.notEqual(beforeIndex, -1, `missing ordered marker: ${before}`);
  assert.notEqual(afterIndex, -1, `missing ordered marker: ${after}`);
  assert.ok(beforeIndex < afterIndex, message);
}

function activeTomlSection(source, sectionName) {
  const marker = `[${sectionName}]`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const nextSection = source.indexOf("\n[", start + marker.length);
  return source
    .slice(start, nextSection < 0 ? source.length : nextSection)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .join("\n");
}

function extractLiteralRunScript(step) {
  const marker = "        run: |";
  const markerIndex = step.indexOf(marker);
  assert.ok(markerIndex >= 0, "workflow step must contain a literal run block");

  return step
    .slice(markerIndex + marker.length)
    .replace(/^\r?\n/, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => {
      assert.ok(
        line === "" || line.startsWith("          "),
        `unexpected workflow script indentation: ${JSON.stringify(line)}`,
      );
      return line.slice(10);
    })
    .join("\n");
}

function extractNodeHeredoc(script) {
  const match = script.match(/(?:^|\n)node <<'NODE'\n([\s\S]*?)\nNODE(?:\n|$)/);
  assert.ok(match, "workflow script must contain a quoted Node heredoc");
  return match[1];
}

function extractQuotedHeredoc(script, delimiter) {
  const escapedDelimiter = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = script.match(
    new RegExp(
      `(?:^|\\n)[^\\n]*<<'${escapedDelimiter}'\\n([\\s\\S]*?)\\n${escapedDelimiter}(?:\\n|$)`,
    ),
  );
  assert.ok(
    match,
    `workflow script must contain the quoted ${delimiter} heredoc`,
  );
  return match[1];
}

function extractShellFunction(script, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = script.match(
    new RegExp(`^([ \\t]*)${escapedName}\\(\\) \\{\\n[\\s\\S]*?^\\1\\}`, "m"),
  );
  assert.ok(match, `workflow script must define ${functionName}`);
  return match[0];
}

function runBashSnippet(program) {
  const command = process.platform === "win32" ? "wsl.exe" : "bash";
  const args = process.platform === "win32" ? ["--exec", "bash", "-s"] : ["-s"];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: `${program}\n`,
    env: process.env,
  });
  assert.ifError(result.error);
  return result;
}

function runWorkflowBashStep(program, variableNames, environment = {}) {
  const exports = Object.entries(environment)
    .map(
      ([name, value]) =>
        `export ${name}='${String(value).replaceAll("'", String.raw`'"'"'`)}'`,
    )
    .join("\n");
  return runBashSnippet(`
output=$(mktemp)
summary=$(mktemp)
trap 'rm -f "$output" "$summary"' EXIT
export GITHUB_OUTPUT="$output"
export GITHUB_STEP_SUMMARY="$summary"
unset ${variableNames.join(" ")}
${exports}
${program}
echo "---GITHUB_OUTPUT---"
cat "$output"
echo "---GITHUB_STEP_SUMMARY---"
cat "$summary"
`);
}

function releaseIdHelperProgram() {
  const helperStart = releaseWorkflow.indexOf(
    "- name: Install immutable release-ID helpers",
  );
  const helperEnd = releaseWorkflow.indexOf(
    "- name: Inspect existing release and protect signed assets",
    helperStart,
  );
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  return extractQuotedHeredoc(
    extractLiteralRunScript(releaseWorkflow.slice(helperStart, helperEnd)),
    "RELEASE_ID_HELPERS",
  );
}

const releaseApiMock = String.raw`
gh() {
  local endpoint="" argument method=GET
  for argument in "$@"; do
    case "$argument" in
      repos/*) endpoint="$argument" ;;
    esac
  done
  if [[ " $* " == *" --method PATCH "* ]]; then
    method=PATCH
  fi
  printf '%s\t%s\n' "$method" "$endpoint" >> "$GH_CALL_LOG"

  if [ "$endpoint" = "repos/example/project/releases?per_page=100" ]; then
    printf '%s\n' "$MOCK_RELEASES_JSON" | jq -c '.[]'
    return
  fi
  if [[ "$endpoint" =~ ^repos/example/project/releases/([0-9]+)/assets\?per_page=100$ ]]; then
    printf '%s\n' "$MOCK_ASSETS_JSON" | jq -c '.[]'
    return
  fi
  if [[ "$endpoint" =~ ^repos/example/project/releases/assets/([0-9]+)$ ]]; then
    printf '%s' "$MOCK_ASSET_BODY"
    return
  fi
  if [[ "$endpoint" =~ ^repos/example/project/releases/([0-9]+)$ ]]; then
    local release_id
    release_id=$(printf '%s' "$endpoint" | sed 's#.*/##')
    if [ "$method" = PATCH ]; then
      printf '%s\n' "$MOCK_RELEASES_JSON" |
        jq -c --argjson release_id "$release_id" \
          '.[] | select(.id == $release_id) | .draft = false'
    else
      printf '%s\n' "$MOCK_RELEASES_JSON" |
        jq -c --argjson release_id "$release_id" \
          '.[] | select(.id == $release_id)'
    fi
    return
  fi
  echo "Unexpected mocked gh endpoint: $endpoint" >&2
  return 98
}
`;

function runReleaseIdHelper(script, environment = {}) {
  const bashEnvironment = {
    GITHUB_REPOSITORY: "example/project",
    ...environment,
  };
  const exports = Object.entries(bashEnvironment)
    .map(
      ([name, value]) =>
        `export ${name}='${String(value).replaceAll("'", String.raw`'"'"'`)}'`,
    )
    .join("\n");
  const program = `${exports}\n${releaseIdHelperProgram()}\n${releaseApiMock}\n${script}`;
  const command = process.platform === "win32" ? "wsl.exe" : "bash";
  const args = process.platform === "win32" ? ["--exec", "bash", "-s"] : ["-s"];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: program,
  });
  assert.ifError(result.error);
  return result;
}

let releaseCallLogSequence = 0;
function releaseCallLog(label) {
  releaseCallLogSequence += 1;
  return `/tmp/sorng-${label}-${process.pid}-${releaseCallLogSequence}.log`;
}

test("RDP vendor builds only the rlib consumed by the application", () => {
  const libSection = rdpVendorManifest.slice(
    rdpVendorManifest.indexOf("[lib]"),
    rdpVendorManifest.indexOf("[features]"),
  );
  const crateType = libSection.match(/^crate-type = .+$/m)?.[0] ?? "";

  assert.equal(crateType, 'crate-type = ["rlib"]');
  assert.doesNotMatch(crateType, /(?:c?dylib)/);

  const bundledResources = Object.keys(tauriConfig.bundle?.resources ?? {});
  assert.equal(
    bundledResources.some((resource) =>
      /sorng[-_]rdp[-_]vendor/i.test(resource),
    ),
    false,
  );
});

test("rolling releases are reusable, explicit, serialized, and not tag-triggered", () => {
  assert.match(workflowCall, /source_sha:/);
  assert.match(workflowCall, /mode:/);
  assert.match(workflowCall, /release_tier:/);
  assert.doesNotMatch(releaseWorkflow, /push:\s*\n\s+tags:/);
  assert.match(
    releaseWorkflow,
    /concurrency:\s*\n\s+group: rolling-release\s*\n(?:\s*#.*\n)*\s+queue: max\s*\n\s+cancel-in-progress: false/,
  );
  assert.match(
    releaseWorkflow,
    /metadata:[\s\S]*?runs-on: ubuntu-latest\s*\n\s+timeout-minutes: 100/,
  );
});

test("actionlint suppression is scoped to its pre-queue schema diagnostic", () => {
  assert.match(actionlintConfig, /\.github\/workflows\/ci\.yml:/);
  assert.match(actionlintConfig, /\.github\/workflows\/release\.yml:/);
  assert.equal(
    (actionlintConfig.match(/- '\^unexpected key/g) ?? []).length,
    2,
  );
  assert.match(
    actionlintConfig,
    /unexpected key "queue" for "concurrency" section\\\. expected one of "cancel-in-progress", "group"/,
  );
  assert.doesNotMatch(
    actionlintConfig,
    /\.\*|syntax-check|shellcheck|pyflakes/,
  );
});

test("privileged release actions are immutable and Dependabot-managed", () => {
  const actionLines = releaseWorkflow.match(/^\s+-?\s*uses:\s+.+$/gm) ?? [];
  assert.ok(actionLines.length > 0);
  for (const actionLine of actionLines) {
    assert.match(
      actionLine,
      /uses:\s+[^@\s]+@[0-9a-f]{40}\s+#\s+\S+/,
      `action must use an audited SHA and readable version comment: ${actionLine}`,
    );
  }
  assert.match(dependabotConfig, /package-ecosystem: github-actions/);
  assert.match(dependabotConfig, /interval: weekly/);
});

test("release actions use audited Node 24-compatible immutable releases", () => {
  const expectedActions = [
    ["actions/checkout", "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09", "v5.1.0"],
    [
      "actions/setup-node",
      "820762786026740c76f36085b0efc47a31fe5020",
      "v7.0.0",
    ],
    ["actions/setup-go", "924ae3a1cded613372ab5595356fb5720e22ba16", "v6.5.0"],
    [
      "actions/upload-artifact",
      "b7c566a772e6b6bfb58ed0dc250532a479d7789f",
      "v6.0.0",
    ],
    [
      "actions/download-artifact",
      "37930b1c2abaa49bbe596cd826c3c89aef350131",
      "v7.0.0",
    ],
    [
      "softprops/action-gh-release",
      "3d0d9888cb7fd7b750713d6e236d1fcb99157228",
      "v3.0.2",
    ],
  ];
  const actionLines = releaseWorkflow.match(/^\s+-?\s*uses:\s+.+$/gm) ?? [];

  for (const [action, sha, tag] of expectedActions) {
    const matchingLines = actionLines.filter((line) =>
      line.includes(`uses: ${action}@`),
    );
    assert.ok(matchingLines.length > 0, `${action} must be used`);
    assert.deepEqual(
      new Set(matchingLines.map((line) => line.trim())),
      new Set([`uses: ${action}@${sha} # ${tag}`]),
    );
  }

  const metadataJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  metadata:"),
    releaseWorkflow.indexOf("  build:"),
  );
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const publishJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  publish:"),
  );
  assert.match(
    metadataJob,
    /Install Node toolchain[\s\S]*?package-manager-cache: false/,
  );
  assert.match(buildJob, /Install Node toolchain[\s\S]*?cache: npm/);
  assert.match(
    publishJob,
    /Install Node toolchain[\s\S]*?package-manager-cache: false/,
  );
});

test("rolling snapshots atomically synchronize package versions back to main", () => {
  const snapshotStep = releaseWorkflow.slice(
    releaseWorkflow.indexOf(
      "- name: Create or reuse immutable release snapshot",
    ),
    releaseWorkflow.indexOf(
      "- name: Verify immutable release snapshot integrity",
    ),
  );

  assert.match(
    readme,
    /\[!\[Latest release\]\(https:\/\/img\.shields\.io\/github\/v\/release\/supermarsx\/sortOfRemoteNG\?display_name=tag&style=flat-square\)\]\(https:\/\/github\.com\/supermarsx\/sortOfRemoteNG\/releases\/latest\)/,
  );
  assert.doesNotMatch(readme, /img\.shields\.io\/badge\/version-/);
  assert.match(
    readme,
    /allocated tags and hidden drafts[\s\S]*?never presented as the current release[\s\S]*?atomically advances `main`[\s\S]*?package metadata[\s\S]*?\[skip ci\]/,
  );
  assert.match(
    releaseDocumentation,
    /README badge resolves GitHub's latest public Release directly[\s\S]*?snapshot and its bare tag are pushed atomically[\s\S]*?fast-forwarding `main`[\s\S]*?\[skip ci\]/,
  );
  assert.equal((releaseWorkflow.match(/\bpush --atomic\b/g) ?? []).length, 1);
  assert.match(
    releaseWorkflow,
    /git commit --allow-empty --no-gpg-sign[\s\S]*?chore\(release\): snapshot \$PUBLIC_TAG \[skip ci\][\s\S]*?Release-Source-SHA: \$SOURCE_SHA/,
  );
  assert.match(
    releaseWorkflow,
    /push --atomic[\s\S]*?--force-with-lease="refs\/heads\/main:\$SOURCE_SHA"[\s\S]*?"refs\/tags\/\$PUBLIC_TAG:refs\/tags\/\$PUBLIC_TAG"[\s\S]*?"\$snapshot_commit:refs\/heads\/main"/,
  );
  assert.match(
    releaseWorkflow,
    /main advanced beyond release source \$SOURCE_SHA; neither the version-synchronized main update nor tag was published/,
  );
  assertOrdered(
    snapshotStep,
    'node scripts/sync-version.mjs --write --version "$PUBLIC_VERSION"',
    "git add -A",
    "every version projection must be generated before the snapshot is staged",
  );
  assertOrdered(
    snapshotStep,
    "node scripts/sync-version.mjs --check",
    "git commit --allow-empty",
    "the generated package, lockfile, Cargo, and UI versions must verify before commit",
  );
  assertOrdered(
    snapshotStep,
    "verify-release-snapshot.mjs",
    "push --atomic",
    "the exact snapshot tree must verify before main and its tag move",
  );
});

test("main and rolling release entry points reject allocated version regression", () => {
  const versionJob = ciWorkflow.slice(
    ciWorkflow.indexOf("  version:"),
    ciWorkflow.indexOf("  updater-signature-verifier:"),
  );
  assert.match(versionJob, /actions\/checkout@v5[\s\S]*?fetch-depth: 0/);
  assert.match(
    versionJob,
    /Reject allocated release version regression[\s\S]*?npm run version:floor:check/,
  );

  const metadataJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  metadata:"),
    releaseWorkflow.indexOf("  build:"),
  );
  assert.match(
    metadataJob,
    /Reject rolling source version regression[\s\S]*?if: inputs\.mode == 'rolling'[\s\S]*?npm run version:floor:check/,
  );
});

test("normal main CI calls release only after every internal job", () => {
  const releaseJob = ciWorkflow.slice(ciWorkflow.indexOf("  rolling-release:"));
  for (const job of [
    "docs",
    "version",
    "format",
    "lint",
    "test",
    "coverage",
    "updater-signature-verifier",
    "rust-check-linux",
    "rust-check-windows",
    "rust-opkssh-targeted",
    "rust-rdp-targeted",
    "rust-check-all-features-linux",
    "rust-lint",
  ]) {
    assert.match(releaseJob, new RegExp(`\\n\\s+- ${job}\\n`));
  }
  assert.match(releaseJob, /github\.ref == 'refs\/heads\/main'/);
  assert.match(releaseJob, /uses: \.\/\.github\/workflows\/release\.yml/);
  assert.match(releaseJob, /source_sha: \$\{\{ github\.sha \}\}/);
  assert.match(releaseJob, /mode: rolling/);
  assert.match(releaseJob, /release_tier: production/);
  assert.doesNotMatch(releaseJob, /secrets: inherit/);
  for (const secret of [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "APPLE_CERT_P12_BASE64",
    "APPLE_CERT_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "WINDOWS_CERT_THUMBPRINT",
  ]) {
    assert.match(
      releaseJob,
      new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`),
    );
  }
});

test("main pushes enter an ordered non-cancelling queue before CI work", () => {
  assert.match(
    ciWorkflow,
    /concurrency:[\s\S]*?rolling-main-ci-order[\s\S]*?queue: max[\s\S]*?cancel-in-progress: false[\s\S]*?jobs:/,
  );
});

test("main Docker E2E gates are SHA-scoped while PR refreshes cancel", () => {
  assert.match(
    e2eWorkflow,
    /github\.event_name == 'push'[\s\S]*?format\('e2e-main-\{0\}', github\.sha\)/,
  );
  assert.match(
    e2eWorkflow,
    /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
  );
  assert.doesNotMatch(e2eWorkflow, /cancel-in-progress: true/);
});

test("release builds distinct macOS architectures through static Kafka", () => {
  assert.match(
    releaseWorkflow,
    /artifact_id: darwin-aarch64[\s\S]*?os: macos-15[\s\S]*?rust_target: aarch64-apple-darwin/,
  );
  assert.match(
    releaseWorkflow,
    /artifact_id: darwin-x86_64[\s\S]*?os: macos-15-intel[\s\S]*?rust_target: x86_64-apple-darwin/,
  );
  assert.match(releaseWorkflow, /kafka-static/);
  assert.doesNotMatch(releaseWorkflow, /--features full(?:\s|$)/m);
});

test("release builds force the npm Tauri runner instead of lockfile autodetection", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const tauriBuild = buildJob.slice(
    buildJob.indexOf("- name: Build native bundles"),
    buildJob.indexOf("- name: Notarize and staple macOS disk image"),
  );

  assert.match(buildJob, /Install JavaScript dependencies[\s\S]*?run: npm ci/);
  assert.match(tauriBuild, /tauriScript: npm run tauri/);
  assert.doesNotMatch(tauriBuild, /tauriScript:\s+(?:bun|pnpm|yarn)\b/);
});

test("release Tauri builds give the inherited Next build a 4 GiB Node heap", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const nativeBuildStart = buildJob.indexOf("- name: Build native bundles");
  const nextStepStart = buildJob.indexOf(
    "- name: Preserve native Linux outputs and prune build intermediates",
    nativeBuildStart,
  );
  const tauriBuild = buildJob.slice(nativeBuildStart, nextStepStart);

  assert.ok(nativeBuildStart >= 0);
  assert.ok(nextStepStart > nativeBuildStart);
  assert.match(
    tauriBuild,
    /uses: tauri-apps\/tauri-action@[0-9a-f]{40}[\s\S]*?env:\r?\n(?:\s+#.*\r?\n)*\s+NODE_OPTIONS: --max-old-space-size=4096[\s\S]*?tauriScript: npm run tauri/,
    "NODE_OPTIONS must be on the Tauri action so its beforeBuildCommand inherits the larger heap",
  );
  assert.equal(
    (buildJob.match(/^\s+NODE_OPTIONS: --max-old-space-size=4096$/gm) ?? [])
      .length,
    1,
    "the heap override must remain scoped to the native release-build step",
  );
  assert.equal(
    tauriConfig.build.beforeBuildCommand,
    "npm run build && npm run stage:opkssh-vendor -- --release --enable",
  );
});

test("Windows ARM64 QuickJS builds map alloca to the MSVC intrinsic", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));

  assert.match(
    buildDefinition,
    /# QuickJS calls the POSIX spelling `alloca`, while MSVC ARM64 exposes the\r?\n\s+# stack-allocation intrinsic as `_alloca`\. Use the compiler-neutral `-D`\r?\n\s+# spelling because this target also builds ring assembly with clang\.\r?\n\s+CFLAGS_aarch64_pc_windows_msvc: -Dalloca=_alloca/,
  );
  assert.equal(
    (
      releaseWorkflow.match(
        /^\s+CFLAGS_aarch64_pc_windows_msvc: -Dalloca=_alloca$/gm,
      ) ?? []
    ).length,
    1,
  );
  assert.doesNotMatch(
    buildDefinition,
    /^\s+CFLAGS_aarch64_pc_windows_msvc: \/Dalloca=_alloca$/m,
  );
  assertOrdered(
    buildJob,
    "CFLAGS_aarch64_pc_windows_msvc: -Dalloca=_alloca",
    "- name: Build native bundles",
    "the ARM64 alloca compatibility flag must be configured before building",
  );
});

test("release matrix maps exact hosted-runner resource profiles", () => {
  const buildStart = releaseWorkflow.indexOf("  build:");
  const publishStart = releaseWorkflow.indexOf("  publish:");
  const buildJob = releaseWorkflow.slice(buildStart, publishStart);
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const buildSteps = buildJob.slice(buildJob.indexOf("    steps:"));
  const matrixDefinition = buildDefinition.slice(
    buildDefinition.indexOf("      matrix:"),
    buildDefinition.indexOf("    runs-on:"),
  );
  const profilesByArtifact = Object.fromEntries(
    matrixDefinition
      .split(/^          - artifact_id: /m)
      .slice(1)
      .map((entry) => {
        const [artifactId, ...entryLines] = entry.split("\n");
        const fields = Object.fromEntries(
          entryLines.flatMap((line) => {
            const match = line.match(/^\s+([a-z_]+):\s+(?:"([^"]+)"|(\S+))$/);
            return match ? [[match[1], match[2] ?? match[3]]] : [];
          }),
        );
        return [artifactId.trim(), fields];
      }),
  );

  assert.match(cargoConfig, /^jobs = 28$/m);
  assert.deepEqual(profilesByArtifact, {
    "linux-x86_64": {
      os: "ubuntu-24.04",
      platform: "linux",
      rust_target: "x86_64-unknown-linux-gnu",
      rust_toolchain: "stable",
      bundles: "appimage,deb,rpm",
      cargo_build_jobs: "1",
      release_lto: "off",
      release_codegen_units: "16",
      release_opt_level: "0",
    },
    "linux-aarch64": {
      os: "ubuntu-24.04-arm",
      platform: "linux",
      rust_target: "aarch64-unknown-linux-gnu",
      rust_toolchain: "stable",
      bundles: "appimage,deb,rpm",
      cargo_build_jobs: "1",
      release_lto: "off",
      release_codegen_units: "16",
      release_opt_level: "0",
    },
    "darwin-aarch64": {
      os: "macos-15",
      platform: "macos",
      rust_target: "aarch64-apple-darwin",
      rust_toolchain: "stable",
      bundles: "dmg,app",
      cargo_build_jobs: "1",
      release_lto: "off",
      release_codegen_units: "32",
      release_opt_level: "0",
    },
    "darwin-x86_64": {
      os: "macos-15-intel",
      platform: "macos",
      rust_target: "x86_64-apple-darwin",
      rust_toolchain: "stable",
      bundles: "dmg,app",
      cargo_build_jobs: "1",
      release_lto: "off",
      release_codegen_units: "32",
      release_opt_level: "0",
    },
    "windows-x86_64": {
      os: "windows-2022",
      platform: "windows",
      rust_target: "x86_64-pc-windows-msvc",
      rust_toolchain: "1.95.0",
      bundles: "msi,nsis",
      cargo_build_jobs: "1",
      release_lto: "off",
      release_codegen_units: "16",
      release_opt_level: "0",
      windows_sdk_arch: "x64",
    },
    "windows-aarch64": {
      os: "windows-11-arm",
      platform: "windows",
      rust_target: "aarch64-pc-windows-msvc",
      rust_toolchain: "1.95.0",
      bundles: "msi,nsis",
      cargo_build_jobs: "1",
      release_lto: "off",
      release_codegen_units: "16",
      release_opt_level: "0",
      windows_sdk_arch: "arm64",
    },
  });
  assert.equal(
    (
      matrixDefinition.match(
        /^\s+(?:rust_toolchain|cargo_build_jobs|release_lto|release_codegen_units|release_opt_level): "[^"]+"$/gm,
      ) ?? []
    ).length,
    30,
  );
  assert.match(
    buildDefinition,
    /# release builds use bounded LLVM profiles instead:\r?\n\s+# Linux splits final codegen into 16 smaller units after repeated\r?\n\s+# 90-minute single-CGU builds ended in runner loss; it retains one job\.\r?\n\s+# Windows also uses split codegen after a direct LLVM allocation failure\r?\n\s+# in the final app crate\. Both macOS runners use 32 unoptimized units after\r?\n\s+# the arm64 final app crate was SIGKILLed with opt-level 1 and 16 units\./,
  );
  assert.equal(
    (matrixDefinition.match(/^\s+release_codegen_units: "16"$/gm) ?? []).length,
    4,
  );
  assert.equal(
    (matrixDefinition.match(/^\s+release_codegen_units: "32"$/gm) ?? []).length,
    2,
  );
  assert.equal(
    (matrixDefinition.match(/^\s+release_codegen_units: "1"$/gm) ?? []).length,
    0,
  );
  assert.equal(
    (matrixDefinition.match(/^\s+release_opt_level: "0"$/gm) ?? []).length,
    6,
  );
  assert.equal(
    (matrixDefinition.match(/^\s+release_opt_level: "1"$/gm) ?? []).length,
    0,
  );
  for (const artifactId of Object.keys(profilesByArtifact)) {
    assert.equal(profilesByArtifact[artifactId].release_opt_level, "0");
  }
  for (const [environmentName, matrixField] of Object.entries({
    CARGO_BUILD_JOBS: "cargo_build_jobs",
    CARGO_PROFILE_RELEASE_LTO: "release_lto",
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "release_codegen_units",
    CARGO_PROFILE_RELEASE_OPT_LEVEL: "release_opt_level",
  })) {
    assert.match(
      buildDefinition,
      new RegExp(
        `^      ${environmentName}: \\$\\{\\{ matrix\\.${matrixField} \\}\\}$`,
        "m",
      ),
    );
    assert.equal(
      (
        releaseWorkflow.match(new RegExp(`^\\s+${environmentName}:`, "gm")) ??
        []
      ).length,
      1,
    );
    assert.doesNotMatch(buildSteps, new RegExp(environmentName));
    assert.doesNotMatch(
      releaseWorkflow.slice(0, buildStart),
      new RegExp(environmentName),
    );
    assert.doesNotMatch(
      releaseWorkflow.slice(publishStart),
      new RegExp(environmentName),
    );
  }
  assert.doesNotMatch(buildJob, /CARGO_BUILD_JOBS:\s*["']?28/);
});

test("Windows release compiler is pinned and verified without changing other platforms", () => {
  const buildStart = releaseWorkflow.indexOf("  build:");
  const publishStart = releaseWorkflow.indexOf("  publish:");
  const buildJob = releaseWorkflow.slice(buildStart, publishStart);
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const buildSteps = buildJob.slice(buildJob.indexOf("    steps:"));
  const toolchainStart = buildJob.indexOf("- name: Install Rust target");
  const checkoutStart = buildJob.indexOf(
    "- name: Check out pinned OPKSSH source",
  );
  const toolchainSteps = buildJob.slice(toolchainStart, checkoutStart);
  const verifierStart = toolchainSteps.indexOf(
    "- name: Verify pinned Windows release compiler",
  );
  const verifierStep = toolchainSteps.slice(verifierStart);
  const verifierScript = extractLiteralRunScript(verifierStep);

  assert.ok(toolchainStart >= 0);
  assert.ok(checkoutStart > toolchainStart);
  assert.equal(
    (buildJob.match(/^\s+rust_toolchain: "stable"$/gm) ?? []).length,
    4,
  );
  assert.equal(
    (buildJob.match(/^\s+rust_toolchain: "1\.95\.0"$/gm) ?? []).length,
    2,
  );
  assert.match(
    buildJob,
    /# Hosted stable advanced to 1\.97\.1 and produced an app archive that\r?\n\s+# MSVC rejected with LNK4003\.[\s\S]*?rust_toolchain: "1\.95\.0"/,
  );
  assert.match(
    toolchainSteps,
    /with:\s+toolchain: \$\{\{ matrix\.rust_toolchain \}\}\s+targets: \$\{\{ matrix\.rust_target \}\}/,
  );
  assert.match(
    toolchainSteps,
    /- name: Verify pinned Windows release compiler\s+if: matrix\.platform == 'windows'\s+shell: pwsh/,
  );
  assert.match(
    toolchainSteps,
    /EXPECTED_RUST_RELEASE: \$\{\{ matrix\.rust_toolchain \}\}/,
  );
  assert.match(
    toolchainSteps,
    /EXPECTED_RUST_HOST: \$\{\{ matrix\.rust_target \}\}/,
  );
  assert.match(
    buildDefinition,
    /^      RUSTUP_TOOLCHAIN: \$\{\{ matrix\.rust_toolchain \}\}$/m,
  );
  assert.equal(
    (releaseWorkflow.match(/^\s+RUSTUP_TOOLCHAIN:/gm) ?? []).length,
    1,
  );
  assert.doesNotMatch(buildSteps, /^\s+RUSTUP_TOOLCHAIN:/m);
  assert.match(toolchainSteps, /& rustc --version --verbose/);
  assert.match(verifierScript, /\$hostLines = @\(/);
  assert.doesNotMatch(verifierScript, /^\s*\$host\s*=/im);
  assert.match(
    toolchainSteps,
    /\$actualRelease -ne \$env:EXPECTED_RUST_RELEASE/,
  );
  assert.match(toolchainSteps, /\$actualHost -ne \$env:EXPECTED_RUST_HOST/);
  assert.doesNotMatch(toolchainSteps, /rust-lld|lld-link|rustup update/i);

  const harness = String.raw`
    $ErrorActionPreference = "Stop"
    function rustc {
      if (($args -join " ") -ne "--version --verbose") {
        throw "Unexpected rustc arguments: $args"
      }
      @(
        "rustc 1.95.0 (59807616e 2026-04-14)"
        "binary: rustc"
        "commit-hash: 59807616e1fa2540724bfbac14d7976d7e4a3860"
        "commit-date: 2026-04-14"
        "host: x86_64-pc-windows-msvc"
        "release: 1.95.0"
        "LLVM version: 22.1.2"
      )
      $global:LASTEXITCODE = 0
    }
    $env:EXPECTED_RUST_HOST = "x86_64-pc-windows-msvc"
    $env:EXPECTED_RUST_RELEASE = "1.95.0"
    $verifier = [Console]::In.ReadToEnd()
    & ([ScriptBlock]::Create($verifier))
    Write-Output "WINDOWS_RELEASE_COMPILER_VERIFIER_OK"
  `;
  const result = spawnSync(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(harness, "utf16le").toString("base64"),
    ],
    {
      encoding: "utf8",
      input: verifierScript,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /WINDOWS_RELEASE_COMPILER_VERIFIER_OK/);
});

test("resource controls preserve platform release features and signing inputs", () => {
  const bundledReleaseFeatures = releaseWorkflow.match(
    /^  RELEASE_FEATURES_BUNDLED: >-\r?\n    ([^\r\n]+)$/m,
  )?.[1];
  const windowsReleaseFeatures = releaseWorkflow.match(
    /^  RELEASE_FEATURES_WINDOWS: >-\r?\n    ([^\r\n]+)$/m,
  )?.[1];
  assert.equal(
    bundledReleaseFeatures,
    "cert-auth,cloud,collab,db-mongo,db-mssql,db-mysql,db-postgres,db-redis,db-sqlite,kafka-static,logs-json,opkssh-vendored-wrapper,ops,platform,protocol-serial-dynamic,rdp,rdp-mf-decode,rdp-software-decode-dynamic,rdp-snapshot,script-engine,tls-cert-details,vpn-softether",
  );
  assert.equal(
    windowsReleaseFeatures,
    "cert-auth,cloud,collab,db-mongo,db-mssql,db-mysql,db-postgres,db-redis,db-sqlite-dynamic,kafka-dynamic,logs-json,opkssh-vendored-wrapper,ops,platform,protocol-serial-dynamic,rdp,rdp-mf-decode,rdp-software-decode-dynamic,rdp-snapshot,script-engine,tls-cert-details,vpn-softether",
  );
  assert.equal(
    (releaseWorkflow.match(/^  RELEASE_FEATURES_(?:BUNDLED|WINDOWS):/gm) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(releaseWorkflow, /^  RELEASE_FEATURES:/m);
  const bundledFeatureSet = new Set(bundledReleaseFeatures.split(","));
  const windowsFeatureSet = new Set(windowsReleaseFeatures.split(","));
  assert.equal(bundledFeatureSet.has("kafka-static"), true);
  assert.equal(bundledFeatureSet.has("db-sqlite"), true);
  assert.equal(bundledFeatureSet.has("kafka-dynamic"), false);
  assert.equal(bundledFeatureSet.has("db-sqlite-dynamic"), false);
  assert.equal(windowsFeatureSet.has("kafka-dynamic"), true);
  assert.equal(windowsFeatureSet.has("db-sqlite-dynamic"), true);
  assert.equal(windowsFeatureSet.has("kafka-static"), false);
  assert.equal(windowsFeatureSet.has("db-sqlite"), false);
  assert.equal(bundledFeatureSet.has("rdp-software-decode-dynamic"), true);
  assert.equal(windowsFeatureSet.has("rdp-software-decode-dynamic"), true);
  assert.equal(bundledFeatureSet.has("rdp-software-decode"), false);
  assert.equal(windowsFeatureSet.has("rdp-software-decode"), false);

  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const tauriBuild = buildJob.slice(
    buildJob.indexOf("- name: Build native bundles"),
    buildJob.indexOf("- name: Notarize and staple macOS disk image"),
  );
  const macosEnvironmentStep = buildJob.slice(
    buildJob.indexOf("- name: Export enabled macOS signing environment"),
    buildJob.indexOf("- name: Bound and inspect Linux release resources"),
  );
  const macosEnvironmentProgram = extractNodeHeredoc(
    extractLiteralRunScript(macosEnvironmentStep),
  );
  const signingEnvironment = tauriBuild.slice(
    tauriBuild.indexOf("        env:"),
    tauriBuild.indexOf("        with:"),
  );
  assert.equal(
    signingEnvironment.trimEnd(),
    [
      "        env:",
      "          # Next's TypeScript worker can exceed Node's default heap on the",
      "          # macOS Intel runner. Scope the larger heap to Tauri and its",
      "          # beforeBuildCommand instead of widening every release step.",
      "          NODE_OPTIONS: --max-old-space-size=4096",
      "          TAURI_SIGNING_PRIVATE_KEY: ${{ needs.metadata.outputs.updater_enabled == 'true' && secrets.TAURI_SIGNING_PRIVATE_KEY || '' }}",
      "          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ needs.metadata.outputs.updater_enabled == 'true' && secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' }}",
    ].join("\n"),
  );
  assert.doesNotMatch(signingEnvironment, /APPLE_/);
  assert.doesNotMatch(buildDefinition, /APPLE_/);
  assert.match(
    macosEnvironmentStep,
    /- name: Export enabled macOS signing environment\s+if: matrix\.platform == 'macos' && steps\.macos_signing\.outputs\.enabled == 'true'\s+shell: bash/,
  );
  for (const [name, source] of [
    ["APPLE_ID", "secrets.APPLE_ID"],
    ["APPLE_PASSWORD", "secrets.APPLE_PASSWORD"],
    ["APPLE_TEAM_ID", "secrets.APPLE_TEAM_ID"],
    ["APPLE_SIGNING_IDENTITY", "steps.apple_certificate.outputs.identity"],
  ]) {
    assert.ok(
      macosEnvironmentStep.includes(
        "          " + name + ": ${{ " + source + " }}",
      ),
    );
  }

  const executeMacosEnvironmentExport = (enabled, values) => {
    const writes = [];
    if (enabled) {
      runInNewContext(macosEnvironmentProgram, {
        process: {
          env: {
            GITHUB_ENV: "test-github-env",
            ...values,
          },
        },
        require(specifier) {
          assert.equal(specifier, "node:fs");
          return {
            appendFileSync(path, data, encoding) {
              writes.push({ path, data, encoding });
            },
          };
        },
      });
    }
    return writes;
  };
  assert.deepEqual(executeMacosEnvironmentExport(false, {}), []);
  assert.throws(
    () => executeMacosEnvironmentExport(true, {}),
    /APPLE_ID must be nonempty when macOS signing is enabled/,
  );
  assert.deepEqual(
    executeMacosEnvironmentExport(true, {
      APPLE_ID: "builder@example.test",
      APPLE_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
      APPLE_TEAM_ID: "ABCDE12345",
      APPLE_SIGNING_IDENTITY:
        "Developer ID Application: Example Builder (ABCDE12345)",
    }),
    [
      {
        path: "test-github-env",
        data: [
          "APPLE_ID=builder@example.test",
          "APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx",
          "APPLE_TEAM_ID=ABCDE12345",
          "APPLE_SIGNING_IDENTITY=Developer ID Application: Example Builder (ABCDE12345)",
          "",
        ].join("\n"),
        encoding: "utf8",
      },
    ],
  );
  assert.match(
    tauriBuild,
    /args: >-\s+--target \$\{\{ matrix\.rust_target \}\}\s+--bundles \$\{\{ matrix\.bundles \}\}\s+--config src-tauri\/tauri\.release\.conf\.json\s+--features \$\{\{ matrix\.platform == 'windows' && env\.RELEASE_FEATURES_WINDOWS \|\| env\.RELEASE_FEATURES_BUNDLED \}\}\s+-- --no-default-features/,
  );
});

test("Windows releases stage, map, and validate the exact dynamic native runtime", () => {
  const expectedDllNames = [
    "libcrypto-3-x64.dll",
    "libssh2.dll",
    "libssl-3-x64.dll",
    "lz4.dll",
    "openh264-8.dll",
    "rdkafka.dll",
    "sqlite3.dll",
    "z.dll",
    "zstd.dll",
  ];
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const cacheStart = buildJob.indexOf(
    "- name: Cache pinned Windows native runtime",
  );
  const installJavaScriptStart = buildJob.indexOf(
    "- name: Install JavaScript dependencies",
  );
  const stageStart = buildJob.indexOf(
    "- name: Stage Windows dynamic native runtime",
  );
  const configureStart = buildJob.indexOf(
    "- name: Configure updater and OS signing",
  );
  const buildStart = buildJob.indexOf("- name: Build native bundles");
  const importValidationStart = buildJob.indexOf(
    "- name: Verify Windows dynamic native imports",
  );
  const preserveLinuxStart = buildJob.indexOf(
    "- name: Preserve native Linux outputs and prune build intermediates",
  );

  assert.ok(cacheStart >= 0);
  assert.ok(installJavaScriptStart > cacheStart);
  assert.ok(stageStart > installJavaScriptStart);
  assert.ok(configureStart > stageStart);
  assert.ok(buildStart > configureStart);
  assert.ok(importValidationStart > buildStart);
  assert.ok(preserveLinuxStart > importValidationStart);

  const cacheStep = buildJob.slice(cacheStart, installJavaScriptStart);
  assert.match(
    cacheStep,
    /if: matrix\.platform == 'windows'\s+uses: actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0/,
  );
  assert.match(
    cacheStep,
    /path: \.cache\/vcpkg-installed\/\$\{\{ matrix\.rust_target \}\}/,
  );
  assert.match(
    cacheStep,
    /key: windows-native-\$\{\{ matrix\.rust_target \}\}-\$\{\{ hashFiles\('src-tauri\/native\/vcpkg\.json', 'src-tauri\/native\/ports\/\*\*\/\*', 'src-tauri\/native\/triplets\/\*', 'scripts\/stage-windows-native-runtime\.mjs', 'scripts\/probe-rdkafka-runtime\.ps1'\) \}\}/,
  );

  const stageStep = buildJob.slice(stageStart, configureStart);
  assert.match(stageStep, /if: matrix\.platform == 'windows'/);
  assert.match(stageStep, /RUST_TARGET: \$\{\{ matrix\.rust_target \}\}/);
  assert.match(
    stageStep,
    /node scripts\/stage-windows-native-runtime\.mjs `\s+--target \$env:RUST_TARGET `\s+--github-env \$env:GITHUB_ENV/,
  );

  const releaseConfigStep = buildJob.slice(
    configureStart,
    buildJob.indexOf("- name: Export enabled macOS signing environment"),
  );
  const releaseConfigProgram = extractNodeHeredoc(
    extractLiteralRunScript(releaseConfigStep),
  );
  const inspectedPaths = [];
  let releaseConfigWrite;
  runInNewContext(releaseConfigProgram, {
    process: {
      env: {
        GITHUB_WORKSPACE: process.cwd(),
        PLATFORM: "windows",
        ARTIFACT_ID: "windows-x86_64",
        UPDATER_ENABLED: "false",
        WINDOWS_CERT_THUMBPRINT: "",
      },
    },
    require(specifier) {
      if (specifier === "node:fs") {
        return {
          statSync(path) {
            inspectedPaths.push(path);
            return { isFile: () => true };
          },
          writeFileSync(path, contents) {
            releaseConfigWrite = { path, contents };
          },
        };
      }
      if (specifier === "node:path") {
        return { resolve };
      }
      throw new Error(`Unexpected module request: ${specifier}`);
    },
  });
  assert.equal(releaseConfigWrite?.path, "src-tauri/tauri.release.conf.json");
  const windowsReleaseConfig = JSON.parse(releaseConfigWrite.contents);
  assert.deepEqual(windowsReleaseConfig.bundle.resources, {
    "crates/sorng-opkssh-vendor/bundle/opkssh/": "opkssh/",
    "../src/i18n/locales/": "locales/",
    "resources/native-runtime-licenses/": "native-runtime-licenses/",
    "resources/native-runtime/libcrypto-3-x64.dll": "libcrypto-3-x64.dll",
    "resources/native-runtime/libssh2.dll": "libssh2.dll",
    "resources/native-runtime/libssl-3-x64.dll": "libssl-3-x64.dll",
    "resources/native-runtime/lz4.dll": "lz4.dll",
    "resources/native-runtime/openh264-8.dll": "openh264-8.dll",
    "resources/native-runtime/rdkafka.dll": "rdkafka.dll",
    "resources/native-runtime/sqlite3.dll": "sqlite3.dll",
    "resources/native-runtime/z.dll": "z.dll",
    "resources/native-runtime/zstd.dll": "zstd.dll",
  });
  assert.deepEqual(inspectedPaths, [
    resolve("src-tauri", "resources/native-runtime-licenses/openh264.txt"),
    ...expectedDllNames.map((filename) =>
      resolve("src-tauri", `resources/native-runtime/${filename}`),
    ),
  ]);
  const adjacentRuntimeResources = Object.entries(
    windowsReleaseConfig.bundle.resources,
  ).filter(([source]) => source.startsWith("resources/native-runtime/"));
  assert.deepEqual(
    adjacentRuntimeResources,
    expectedDllNames.map((filename) => [
      `resources/native-runtime/${filename}`,
      filename,
    ]),
  );
  assert.equal(
    windowsReleaseConfig.bundle.resources["resources/native-runtime-licenses/"],
    "native-runtime-licenses/",
  );

  const importValidationStep = buildJob.slice(
    importValidationStart,
    preserveLinuxStart,
  );
  const expectedDllBlock = importValidationStep.match(
    /\$expectedDllNames = @\(\s*([\s\S]*?)\s*\)/,
  )?.[1];
  assert.ok(expectedDllBlock);
  assert.deepEqual(
    [...expectedDllBlock.matchAll(/"([^"]+\.dll)"/g)].map((match) =>
      match[1].replace("$opensslArchitecture", "x64"),
    ),
    expectedDllNames,
  );
  assert.match(
    importValidationStep,
    /Compare-Object \(\$expectedDllNames \| Sort-Object\) \$actualDllNames[\s\S]*?staged Windows native runtime does not match the exact DLL contract/,
  );
  assert.match(
    importValidationStep,
    /"windows-x86_64" \{ 0x8664 \}[\s\S]*?"windows-aarch64" \{ 0xAA64 \}[\s\S]*?Get-PeMachine -Path \$dll\.FullName/,
  );
  assert.match(
    importValidationStep,
    /foreach \(\$requiredImport in @\("libssh2\.dll", "openh264-8\.dll", "rdkafka\.dll", "sqlite3\.dll"\)\)[\s\S]*?does not import required dynamic library/,
  );
  assert.match(
    importValidationStep,
    /Copy-Item -LiteralPath \$dll\.FullName -Destination \$destination -Force[\s\S]*?Get-FileHash \$dll\.FullName -Algorithm SHA256[\s\S]*?Get-FileHash \$destination -Algorithm SHA256/,
  );
});

test("macOS releases hard-link and package the exact OpenH264 framework", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const configureStart = buildJob.indexOf(
    "- name: Configure updater and OS signing",
  );
  const configureEnd = buildJob.indexOf(
    "- name: Export enabled macOS signing environment",
  );
  const releaseConfigProgram = extractNodeHeredoc(
    extractLiteralRunScript(buildJob.slice(configureStart, configureEnd)),
  );
  const inspectedPaths = [];
  let releaseConfigWrite;
  runInNewContext(releaseConfigProgram, {
    process: {
      env: {
        GITHUB_WORKSPACE: process.cwd(),
        PLATFORM: "macos",
        ARTIFACT_ID: "darwin-aarch64",
        UPDATER_ENABLED: "true",
        WINDOWS_CERT_THUMBPRINT: "",
      },
    },
    require(specifier) {
      if (specifier === "node:fs") {
        return {
          statSync(path) {
            inspectedPaths.push(path);
            return { isFile: () => true };
          },
          writeFileSync(path, contents) {
            releaseConfigWrite = { path, contents };
          },
        };
      }
      if (specifier === "node:path") return { resolve };
      throw new Error(`Unexpected module request: ${specifier}`);
    },
  });
  const macReleaseConfig = JSON.parse(releaseConfigWrite.contents);
  assert.equal(macReleaseConfig.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(macReleaseConfig.bundle.macOS.frameworks, [
    "resources/native-runtime/libopenh264.8.dylib",
  ]);
  assert.equal(
    macReleaseConfig.bundle.resources["resources/native-runtime-licenses/"],
    "native-runtime-licenses/",
  );
  assert.deepEqual(inspectedPaths, [
    resolve("src-tauri", "resources/native-runtime-licenses/openh264.txt"),
    resolve("src-tauri", "resources/native-runtime/libopenh264.8.dylib"),
  ]);

  assertOrdered(
    buildJob,
    "- name: Build native bundles",
    "- name: Verify macOS dynamic OpenH264 bundle",
    "macOS OpenH264 linkage must be inspected after bundling",
  );
  assertOrdered(
    buildJob,
    "- name: Verify macOS dynamic OpenH264 bundle",
    "- name: Notarize and staple macOS disk image",
    "the complete nested framework must be verified before notarization",
  );
  const verificationStep = buildJob.slice(
    buildJob.indexOf("- name: Verify macOS dynamic OpenH264 bundle"),
    buildJob.indexOf(
      "- name: Preserve native Linux outputs and prune build intermediates",
    ),
  );
  assert.match(
    verificationStep,
    /darwin-aarch64\) expected_arch=arm64[\s\S]*?darwin-x86_64\) expected_arch=x86_64/,
  );
  assert.match(
    verificationStep,
    /Contents\/Frameworks\/libopenh264\.8\.dylib[\s\S]*?lipo -archs "\$source_dylib"[\s\S]*?lipo -archs "\$framework"/,
  );
  assert.match(
    verificationStep,
    /otool -L "\$executable"[\s\S]*?@rpath\/libopenh264\.8\.dylib[\s\S]*?otool -D "\$framework"/,
  );
  assert.match(
    verificationStep,
    /otool -l "\$executable"[\s\S]*?LC_RPATH[\s\S]*?@executable_path\/\.\.\/Frameworks/,
  );
  assert.match(
    verificationStep,
    /shasum -a 256 "\$source_dylib"[\s\S]*?shasum -a 256 "\$framework"[\s\S]*?codesign --verify --strict --verbose=2 "\$framework"[\s\S]*?codesign --verify --deep --strict --verbose=2 "\$app"/,
  );
  assert.match(
    verificationStep,
    /UPDATER_ENABLED[\s\S]*?\.app\.tar\.gz[\s\S]*?tar -xzf "\$updater"[\s\S]*?updater_framework="\$updater_app\/Contents\/Frameworks\/libopenh264\.8\.dylib"[\s\S]*?shasum -a 256 "\$updater_framework"[\s\S]*?\$framework_hash/,
  );
});

test("Windows release artifacts keep portable ISA and supported linker flags", () => {
  for (const target of [
    "target.x86_64-pc-windows-gnu",
    "target.x86_64-pc-windows-msvc",
  ]) {
    assert.doesNotMatch(
      activeTomlSection(cargoConfig, target),
      /\btarget-(?:cpu|feature)\s*=/,
      `${target} must not assume the hosted runner's optional CPU features`,
    );
  }

  assert.equal(
    activeTomlSection(cargoConfig, "target.x86_64-pc-windows-msvc"),
    "",
  );
  assert.doesNotMatch(cargoConfig, /link-arg=\/threads:/i);
});

test("Windows signing is architecture-aware and both portable archives are complete", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const verifyStart = buildJob.indexOf(
    "- name: Verify Windows Authenticode signatures",
  );
  const portableStart = buildJob.indexOf(
    "- name: Package portable Windows archive",
  );
  const macVerifyStart = buildJob.indexOf(
    "- name: Verify macOS Developer ID, notarization, and stapling",
  );
  const stageStart = buildJob.indexOf(
    "- name: Stage architecture-specific release assets",
  );
  assert.ok(verifyStart >= 0);
  assert.ok(portableStart > verifyStart);
  assert.ok(macVerifyStart > portableStart);
  assert.ok(stageStart > macVerifyStart);

  const signingStep = buildJob.slice(verifyStart, portableStart);
  assert.match(
    signingStep,
    /WINDOWS_SDK_ARCH: \$\{\{ matrix\.windows_sdk_arch \}\}/,
  );
  assert.match(
    signingStep,
    /\$windowsKits = Join-Path \$\{env:ProgramFiles\(x86\)\} "Windows Kits\\10\\bin"/,
  );
  assert.match(
    signingStep,
    /Get-ChildItem "\$windowsKits\\\*\\\$env:WINDOWS_SDK_ARCH\\signtool\.exe"/,
  );
  assert.match(
    signingStep,
    /\$portableExecutable = Get-Item -LiteralPath "src-tauri\/target\/\$env:RUST_TARGET\/release\/app\.exe"[\s\S]*?\$files \+= \$portableExecutable/,
  );
  assert.doesNotMatch(signingStep, /ARTIFACT_ID -eq "windows-x86_64"/);
  assert.doesNotMatch(signingStep, /\\x64\\signtool\.exe/);
  assert.match(
    signingStep,
    /Get-ChildItem "src-tauri\/resources\/native-runtime\/\*\.dll" -File[\s\S]*?\$runtimeDlls\.Count -ne 9[\s\S]*?\$files \+= \$runtimeDlls/,
  );

  const portableStep = buildJob.slice(portableStart, macVerifyStart);
  const expectedNativeDllNames = [
    "libcrypto-3-$opensslArchitecture.dll",
    "libssh2.dll",
    "libssl-3-$opensslArchitecture.dll",
    "lz4.dll",
    "openh264-8.dll",
    "rdkafka.dll",
    "sqlite3.dll",
    "z.dll",
    "zstd.dll",
  ];
  const expectedNativeLicenseNames = [
    "librdkafka.txt",
    "libssh2.txt",
    "lz4.txt",
    "openh264.txt",
    "openssl.txt",
    "sqlite3.txt",
    "zlib.txt",
    "zstd.txt",
  ];
  assert.match(portableStep, /if: matrix\.platform == 'windows'/);
  assert.match(portableStep, /ARTIFACT_ID: \$\{\{ matrix\.artifact_id \}\}/);
  assert.match(
    portableStep,
    /sourceExecutable = "src-tauri\/target\/\$env:RUST_TARGET\/release\/app\.exe"/,
  );
  assert.match(
    portableStep,
    /Copy-Item -LiteralPath \$sourceExecutable -Destination \(Join-Path \$portableRoot "sortOfRemoteNG\.exe"\)/,
  );
  assert.match(
    portableStep,
    /New-Item -ItemType File -Path \(Join-Path \$portableRoot "\.portable"\)/,
  );
  assert.match(
    portableStep,
    /sorng-opkssh-vendor\/bundle\/opkssh[\s\S]*?resources[\s\S]*?Copy-Item -LiteralPath \$opksshSource/,
  );
  assert.match(
    portableStep,
    /\$localeSource = "src\/i18n\/locales"[\s\S]*?\$expectedLocaleHashes = @\(Get-RelativeFileHashes -Root \$localeSource\)/,
  );
  assert.match(
    portableStep,
    /Copy-Item -LiteralPath \$localeSource -Destination \(Join-Path \$resourceRoot "locales"\) -Recurse/,
  );
  const nativeDllBlock = portableStep.match(
    /\$expectedNativeDllNames = @\(\s*([\s\S]*?)\s*\)/,
  )?.[1];
  assert.ok(nativeDllBlock);
  assert.deepEqual(
    [...nativeDllBlock.matchAll(/"([^"]+\.dll)"/g)].map((match) => match[1]),
    expectedNativeDllNames,
  );
  const nativeLicenseBlock = portableStep.match(
    /\$expectedNativeLicenseNames = @\(\s*([\s\S]*?)\s*\)/,
  )?.[1];
  assert.ok(nativeLicenseBlock);
  assert.deepEqual(
    [...nativeLicenseBlock.matchAll(/"([^"]+\.txt)"/g)].map(
      (match) => match[1],
    ),
    expectedNativeLicenseNames,
  );
  assert.match(
    portableStep,
    /Compare-Object `\s+-ReferenceObject \(\$expectedNativeDllNames \| Sort-Object\) `\s+-DifferenceObject \(\$nativeRuntimeFiles\.Name \| Sort-Object\)[\s\S]*?Portable native DLL sources do not match the exact runtime contract/,
  );
  assert.match(
    portableStep,
    /Get-PeMachine -Path \$nativeDll\.FullName[\s\S]*?\$nativeMachine -ne \$expectedMachine[\s\S]*?\$expectedNativeRuntimeHashes\[\$nativeDll\.Name\][\s\S]*?Get-FileHash -LiteralPath \$nativeDll\.FullName -Algorithm SHA256/,
  );
  assert.match(
    portableStep,
    /Copy-Item -LiteralPath \$nativeLicenseSource -Destination \(Join-Path \$resourceRoot "native-runtime-licenses"\) -Recurse/,
  );
  assert.match(
    portableStep,
    /sortOfRemoteNG_\$\(\$env:MACHINE_VERSION\)_\$\(\$env:ARTIFACT_ID\)-portable\.zip/,
  );
  assert.match(
    portableStep,
    /Compress-Archive -LiteralPath \$portableContents[\s\S]*?Expand-Archive -LiteralPath \$archive/,
  );
  assert.match(
    portableStep,
    /"windows-x86_64" \{ 0x8664 \}[\s\S]*?"windows-aarch64" \{ 0xAA64 \}/,
  );
  assert.match(
    portableStep,
    /sourceMachine = Get-PeMachine[\s\S]*?sourceMachine -ne \$expectedMachine[\s\S]*?verifiedMachine = Get-PeMachine[\s\S]*?verifiedMachine -ne \$expectedMachine/,
  );
  assert.match(
    portableStep,
    /sourceExecutableHash[\s\S]*?verifiedExecutableHash[\s\S]*?verifiedExecutableHash -ne \$sourceExecutableHash/,
  );
  assert.match(
    portableStep,
    /sourceMarkerHash[\s\S]*?verifiedMarkerHash[\s\S]*?verifiedMarkerHash -ne \$sourceMarkerHash/,
  );
  assert.match(
    portableStep,
    /expectedResourceHashes[\s\S]*?verifiedResourceHashes[\s\S]*?Compare-Object[\s\S]*?Extracted OPKSSH resources do not match/,
  );
  assert.match(
    portableStep,
    /verifiedLocaleRoot[\s\S]*?resources\/locales[\s\S]*?verifiedLocaleHashes[\s\S]*?Compare-Object[\s\S]*?Extracted locale resources do not match/,
  );
  assert.match(
    portableStep,
    /Compare-Object `\s+-ReferenceObject \(\$expectedNativeDllNames \| Sort-Object\) `\s+-DifferenceObject \(\$verifiedNativeDlls\.Name \| Sort-Object\)[\s\S]*?Extracted portable DLLs do not match the exact runtime contract/,
  );
  assert.match(
    portableStep,
    /Get-PeMachine -Path \$verifiedNativeDll\.FullName[\s\S]*?wrong PE machine[\s\S]*?Get-FileHash -LiteralPath \$verifiedNativeDll\.FullName -Algorithm SHA256[\s\S]*?\$expectedNativeRuntimeHashes\[\$verifiedNativeDll\.Name\][\s\S]*?changed after staging/,
  );
  assert.match(
    portableStep,
    /verifiedNativeLicenseRoot = Join-Path \$verificationRoot "resources\/native-runtime-licenses"[\s\S]*?Portable archive is missing the native runtime license directory/,
  );
  assert.match(
    portableStep,
    /verifiedNativeLicenseHashes = @\(Get-RelativeFileHashes -Root \$verifiedNativeLicenseRoot\)[\s\S]*?Compare-Object `\s+-ReferenceObject \$expectedNativeLicenseHashes `\s+-DifferenceObject \$verifiedNativeLicenseHashes[\s\S]*?Extracted native runtime license notices do not match/,
  );
  assert.match(portableStep, /openh264-8\.dll/);
  assert.match(portableStep, /openh264\.txt/);
  for (const archivePath of [
    "sortOfRemoteNG.exe",
    ".portable",
    ...expectedNativeDllNames,
    "resources/opkssh",
    "resources/locales",
    "resources/native-runtime-licenses",
  ]) {
    assert.match(
      portableStep,
      new RegExp(archivePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  const stageStep = buildJob.slice(stageStart);
  assert.match(
    stageStep,
    /windows\)[\s\S]*?one "\$bundle\/portable" '\*-portable\.zip' "sortOfRemoteNG_\$\{MACHINE_VERSION\}_\$\{ARTIFACT_ID\}-portable\.zip"/,
  );
  assert.match(
    releaseWorkflow,
    /sortOfRemoteNG_\$\{MACHINE_VERSION\}_windows-aarch64-portable\.zip/,
  );
  assert.match(
    releaseWorkflow,
    /dist\/sortOfRemoteNG_\$\{\{ needs\.metadata\.outputs\.machine_version \}\}_windows-aarch64-portable\.zip/,
  );

  const updaterFeed = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Generate signed updater feed"),
    releaseWorkflow.indexOf(
      "- name: Cryptographically verify every updater payload",
    ),
  );
  assert.doesNotMatch(updaterFeed, /portable\.zip/);
  for (const arch of ["x86_64", "aarch64"]) {
    assert.match(
      updaterFeed,
      new RegExp(
        `^\\s+add windows-${arch}-msi "sortOfRemoteNG_\\$\\{MACHINE_VERSION\\}_windows-${arch}\\.msi"$`,
        "m",
      ),
      `the updater feed must publish a windows-${arch}-msi platform key pointing at the .msi`,
    );
    assert.match(
      updaterFeed,
      new RegExp(
        `^\\s+add windows-${arch} "sortOfRemoteNG_\\$\\{MACHINE_VERSION\\}_windows-${arch}-setup\\.exe"$`,
        "m",
      ),
      `windows-${arch} must keep pointing at the NSIS setup.exe for existing installs`,
    );
    assert.match(
      updaterFeed,
      new RegExp(`--require-platform windows-${arch}-msi`),
      `the feed validator must require the windows-${arch}-msi platform key`,
    );
  }
  assert.doesNotMatch(updaterFeed, /windows-(?:x86_64|aarch64)-nsis/);
  assert.match(
    releaseWorkflow,
    /Native Linux x64 and ARM64 AppImage, Debian, RPM, and Flatpak bundles are included, together with Windows x64 and ARM64 installers and portable archives\./,
  );
});

function windowsStagingFragment() {
  const stageStart = releaseWorkflow.indexOf(
    "- name: Stage architecture-specific release assets",
  );
  const stageEnd = releaseWorkflow.indexOf(
    "- name: Validate staged version metadata",
    stageStart,
  );
  assert.ok(stageStart >= 0 && stageEnd > stageStart);
  const stageScript = extractLiteralRunScript(
    releaseWorkflow.slice(stageStart, stageEnd),
  );
  const start = stageScript.indexOf("one() {");
  const end = stageScript.indexOf('OS_SIGNING="$os_signing" node');
  assert.ok(start >= 0 && end > start);
  return stageScript.slice(start, end);
}

function runWindowsStaging({ updaterEnabled, msiSignature = true }) {
  const emitMsiSignature = msiSignature
    ? "printf 'msi-signature' > \"$bundle/msi/sortOfRemoteNG_26.1.0_x64_en-US.msi.sig\""
    : ": # the bundler produced no .msi.sig";
  const result = runBashSnippet(`
set -euo pipefail
workdir=$(mktemp -d)
cd "$workdir"
export bundle="$workdir/bundle"
mkdir -p "$bundle/msi" "$bundle/nsis" "$bundle/portable" artifacts
printf 'msi-payload' > "$bundle/msi/sortOfRemoteNG_26.1.0_x64_en-US.msi"
printf 'nsis-payload' > "$bundle/nsis/sortOfRemoteNG_26.1.0_x64-setup.exe"
printf 'nsis-signature' > "$bundle/nsis/sortOfRemoteNG_26.1.0_x64-setup.exe.sig"
printf 'portable-payload' > "$bundle/portable/sortOfRemoteNG_26.1.0-portable.zip"
${emitMsiSignature}
export ARTIFACT_ID=windows-x86_64
export MACHINE_VERSION=26.1.0
export PLATFORM=windows
export UPDATER_ENABLED=${updaterEnabled}
export WINDOWS_SIGNED=false
export MACOS_SIGNED=false
cat > staging.sh <<'STAGING_FRAGMENT'
set -euo pipefail
${windowsStagingFragment()}
STAGING_FRAGMENT
staging_status=0
bash ./staging.sh || staging_status=$?
echo "---STATUS---"
echo "$staging_status"
echo "---ARTIFACTS---"
find artifacts -maxdepth 1 -type f -printf '%f\\n' | LC_ALL=C sort
`);
  const stdout = result.stdout ?? "";
  const status = Number(
    stdout.split("---STATUS---")[1]?.split("---ARTIFACTS---")[0]?.trim(),
  );
  const artifacts = (stdout.split("---ARTIFACTS---")[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { status, artifacts, stdout, stderr: result.stderr ?? "" };
}

test("Windows staging emits an MSI updater signature only alongside a signing key", () => {
  const signed = runWindowsStaging({ updaterEnabled: true });
  assert.equal(
    signed.status,
    0,
    `signed Windows staging must succeed: ${signed.stderr}`,
  );
  assert.deepEqual(
    signed.artifacts.filter((name) => name.endsWith(".sig")),
    [
      "sortOfRemoteNG_26.1.0_windows-x86_64-setup.exe.sig",
      "sortOfRemoteNG_26.1.0_windows-x86_64.msi.sig",
    ],
  );
  assert.ok(
    signed.artifacts.includes("sortOfRemoteNG_26.1.0_windows-x86_64.msi"),
    "the MSI payload itself must still be staged",
  );

  const unsigned = runWindowsStaging({
    updaterEnabled: false,
    msiSignature: false,
  });
  assert.equal(
    unsigned.status,
    0,
    `unsigned Windows staging must succeed: ${unsigned.stderr}`,
  );
  assert.deepEqual(
    unsigned.artifacts.filter((name) => name.endsWith(".sig")),
    [],
    "no updater signature may be staged without a signing key",
  );
  assert.ok(
    unsigned.artifacts.includes("sortOfRemoteNG_26.1.0_windows-x86_64.msi"),
    "the unsigned release still publishes the MSI installer",
  );

  const missingSignature = runWindowsStaging({
    updaterEnabled: true,
    msiSignature: false,
  });
  assert.notEqual(
    missingSignature.status,
    0,
    "a signed release whose bundler emitted no .msi.sig must fail staging",
  );
  assert.ok(
    !missingSignature.artifacts.includes(
      "sortOfRemoteNG_26.1.0_windows-x86_64.msi.sig",
    ),
    "no MSI signature may be invented when the bundler produced none",
  );
});

test("the Windows MSI updater signature travels from staging to the signed release", () => {
  const validateSet = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Validate complete public installer set"),
    releaseWorkflow.indexOf("- name: Generate signed updater feed"),
  );
  const unsignedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Upload exact unsigned assets"),
    releaseWorkflow.indexOf(
      "- name: Upload exact signed assets and root updater feed",
    ),
  );
  const signedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf(
      "- name: Upload exact signed assets and root updater feed",
    ),
    releaseWorkflow.indexOf(
      "- name: Resolve immutable staged release identity",
    ),
  );
  const updaterOnlyRequirements = validateSet.slice(
    validateSet.indexOf('if [ "$UPDATER_ENABLED" = true ]; then'),
  );

  for (const arch of ["x86_64", "aarch64"]) {
    assert.match(
      updaterOnlyRequirements,
      new RegExp(
        `"sortOfRemoteNG_\\$\\{MACHINE_VERSION\\}_windows-${arch}\\.msi\\.sig"`,
      ),
      `the ${arch} MSI signature must be required only when the updater key is present`,
    );
    assert.match(
      signedUpload,
      new RegExp(
        `^\\s+dist/sortOfRemoteNG_\\$\\{\\{ needs\\.metadata\\.outputs\\.machine_version \\}\\}_windows-${arch}\\.msi\\.sig$`,
        "m",
      ),
      `the ${arch} MSI signature must be uploaded with the signed asset set`,
    );
  }
  assert.doesNotMatch(unsignedUpload, /\.msi\.sig/);
  assert.doesNotMatch(unsignedUpload, /\.sig/);
});

test("custom locale package layouts match the native runtime fallback", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const portableStart = buildJob.indexOf(
    "- name: Package portable Windows archive",
  );
  const macVerifyStart = buildJob.indexOf(
    "- name: Verify macOS Developer ID, notarization, and stapling",
  );
  const preserveStart = buildJob.indexOf(
    "- name: Preserve native Linux outputs and prune build intermediates",
  );
  const flatpakSetupStart = buildJob.indexOf(
    "- name: Install pinned Flatpak toolchain and GNOME runtime",
  );
  const flatpakBuildStart = buildJob.indexOf(
    "- name: Build and verify native Flatpak bundle",
  );
  const flatpakEnd = buildJob.indexOf(
    "- name: Notarize and staple macOS disk image",
  );

  const portableStep = buildJob.slice(portableStart, macVerifyStart);
  const preserveLinux = buildJob.slice(preserveStart, flatpakSetupStart);
  const flatpakBuild = buildJob.slice(flatpakBuildStart, flatpakEnd);

  assert.match(
    stateRegistryOpsSource,
    /const LOCALES_DIRECTORY_NAME: &str = "locales";[\s\S]*?const PORTABLE_RESOURCES_DIRECTORY_NAME: &str = "resources";[\s\S]*?const DEFAULT_LOCALE_CATALOG_NAME: &str = "en-US\.json";/,
  );
  assert.match(
    stateRegistryOpsSource,
    /let mut candidates = vec!\[resource_dir\.join\(LOCALES_DIRECTORY_NAME\)\];[\s\S]*?\.join\(PORTABLE_RESOURCES_DIRECTORY_NAME\)[\s\S]*?\.join\(LOCALES_DIRECTORY_NAME\)[\s\S]*?candidates\.push\(adjacent_resources\)/,
  );
  assert.match(
    stateRegistryOpsSource,
    /let executable_path = std::env::current_exe\(\)\.ok\(\);[\s\S]*?packaged_locales_candidates\(&resource_dir, executable_path\.as_deref\(\)\)[\s\S]*?candidate\.join\(DEFAULT_LOCALE_CATALOG_NAME\)\.is_file\(\)/,
  );

  assert.match(
    portableStep,
    /Copy-Item -LiteralPath \$localeSource -Destination \(Join-Path \$resourceRoot "locales"\) -Recurse/,
  );
  assert.match(
    portableStep,
    /verifiedLocaleRoot = Join-Path \$verificationRoot "resources\/locales"/,
  );
  assert.match(
    preserveLinux,
    /cp -a "\$locale_source" "\$payload\/resources\/locales"/,
  );
  assert.match(
    flatpakBuild,
    /test -d \/app\/bin\/resources\/locales[\s\S]*?cd \/app\/bin\/resources\/locales && sha256sum \.\/\*\.json/,
  );
});

test("Linux release builds and validates native RPM and Flatpak assets on both architectures", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const nativePrerequisites = buildJob.slice(
    buildJob.indexOf("- name: Install native Linux build prerequisites"),
    buildJob.indexOf("- name: Install macOS native build prerequisites"),
  );
  const preserveLinux = buildJob.slice(
    buildJob.indexOf(
      "- name: Preserve native Linux outputs and prune build intermediates",
    ),
    buildJob.indexOf(
      "- name: Install pinned Flatpak toolchain and GNOME runtime",
    ),
  );
  const flatpakSetup = buildJob.slice(
    buildJob.indexOf(
      "- name: Install pinned Flatpak toolchain and GNOME runtime",
    ),
    buildJob.indexOf("- name: Build and verify native Flatpak bundle"),
  );
  const flatpakBuild = buildJob.slice(
    buildJob.indexOf("- name: Build and verify native Flatpak bundle"),
    buildJob.indexOf("- name: Notarize and staple macOS disk image"),
  );
  const releaseConfigStep = buildJob.slice(
    buildJob.indexOf("- name: Configure updater and OS signing"),
    buildJob.indexOf("- name: Export enabled macOS signing environment"),
  );
  const stageStep = buildJob.slice(
    buildJob.indexOf("- name: Stage architecture-specific release assets"),
  );
  const publicSet = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Validate complete public installer set"),
    releaseWorkflow.indexOf("- name: Generate signed updater feed"),
  );
  const updaterFeed = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Generate signed updater feed"),
    releaseWorkflow.indexOf(
      "- name: Cryptographically verify every updater payload",
    ),
  );
  const unsignedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Upload exact unsigned assets"),
    releaseWorkflow.indexOf(
      "- name: Upload exact signed assets and root updater feed",
    ),
  );
  const signedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf(
      "- name: Upload exact signed assets and root updater feed",
    ),
    releaseWorkflow.indexOf(
      "- name: Resolve immutable staged release identity",
    ),
  );

  for (const contract of [
    ["FLATPAK_APP_ID", "com.sortofremote.ng"],
    ["FLATPAK_BUILDER_PACKAGE", "1.4.2-1build2"],
    ["FLATPAK_BUILDER_VERSION", "1.4.2"],
    ["FLATPAK_MANIFEST", "packaging/flatpak/com.sortofremote.ng.yml"],
    ["FLATPAK_RUNTIME_ID", "org.gnome.Platform"],
    ["FLATPAK_RUNTIME_VERSION", '"50"'],
    ["FLATPAK_SDK_ID", "org.gnome.Sdk"],
    ["LINUX_PACKAGE_MAIN_BINARY", "com.sortofremote.ng"],
    ["LINUX_PACKAGE_PRODUCT_NAME", "sortOfRemoteNG"],
  ]) {
    assert.match(
      releaseWorkflow,
      new RegExp(`^  ${contract[0]}: ${contract[1]}$`, "m"),
    );
  }
  assert.match(
    releaseWorkflow,
    /^  FLATHUB_REPOSITORY: https:\/\/dl\.flathub\.org\/repo\/flathub\.flatpakrepo$/m,
  );

  assert.match(flatpakManifest, /^id: com\.sortofremote\.ng$/m);
  assert.match(flatpakManifest, /^runtime: org\.gnome\.Platform$/m);
  assert.match(flatpakManifest, /^runtime-version: "50"$/m);
  assert.match(flatpakManifest, /^sdk: org\.gnome\.Sdk$/m);
  assert.match(flatpakManifest, /^command: sortOfRemoteNG$/m);
  assert.match(
    flatpakManifest,
    /install -Dm755 sortOfRemoteNG \/app\/bin\/sortOfRemoteNG/,
  );
  assert.match(
    flatpakManifest,
    /install -Dm755 lib\/libopenh264\.so\.8 \/app\/lib\/sortOfRemoteNG\/libopenh264\.so\.8/,
  );
  assert.match(flatpakManifest, /cp -a resources \/app\/bin\/resources/);
  assert.match(flatpakManifest, /path: \.\.\/\.\.\/\.ci\/flatpak-payload/);
  for (const [size, stagedName, source] of [
    ["32x32", "32", "32x32.png"],
    ["128x128", "128", "128x128.png"],
    ["256x256", "256", "128x128@2x.png"],
    ["512x512", "512", "icon.png"],
  ]) {
    assert.match(
      flatpakManifest,
      new RegExp(
        `install -Dm644 com\\.sortofremote\\.ng-${stagedName}\\.png /app/share/icons/hicolor/${size}/apps/com\\.sortofremote\\.ng\\.png`,
      ),
    );
    assert.match(
      flatpakManifest,
      new RegExp(
        `path: \.\.\/\.\.\/src-tauri\/icons\/${source.replace(".", "\\.")}`,
      ),
    );
  }
  assert.match(flatpakDesktop, /^Exec=sortOfRemoteNG$/m);
  assert.match(flatpakDesktop, /^Icon=com\.sortofremote\.ng$/m);
  assert.match(flatpakMetainfo, /<id>com\.sortofremote\.ng<\/id>/);
  assert.match(
    flatpakMetainfo,
    /<launchable type="desktop-id">com\.sortofremote\.ng\.desktop<\/launchable>/,
  );
  const expectedLinuxIconFiles = {
    "/usr/share/icons/hicolor/32x32/apps/com.sortofremote.ng.png":
      "icons/32x32.png",
    "/usr/share/icons/hicolor/128x128/apps/com.sortofremote.ng.png":
      "icons/128x128.png",
    "/usr/share/icons/hicolor/256x256/apps/com.sortofremote.ng.png":
      "icons/128x128@2x.png",
    "/usr/share/icons/hicolor/512x512/apps/com.sortofremote.ng.png":
      "icons/icon.png",
  };
  assert.equal(
    tauriConfig.bundle.linux.rpm.desktopTemplate,
    "packaging/linux.desktop",
  );
  assert.deepEqual(tauriConfig.bundle.linux.rpm.files, expectedLinuxIconFiles);
  assert.equal(tauriConfig.bundle.linux.deb, undefined);
  assert.match(
    linuxDesktopTemplate,
    /^\[Desktop Entry\]\r?\nCategories=\{\{categories\}\}\r?\n/m,
  );
  assert.match(linuxDesktopTemplate, /^Icon=com\.sortofremote\.ng$/m);
  assert.match(linuxDesktopTemplate, /^Exec=\{\{exec\}\}$/m);
  assert.match(linuxDesktopTemplate, /^StartupWMClass=\{\{exec\}\}$/m);
  assert.match(linuxDesktopTemplate, /^Name=\{\{name\}\}$/m);
  assert.match(linuxDesktopTemplate, /^Terminal=false$/m);
  assert.match(linuxDesktopTemplate, /^Type=Application$/m);

  const releaseConfigProgram = extractNodeHeredoc(
    extractLiteralRunScript(releaseConfigStep),
  );
  let releaseConfigWrite;
  runInNewContext(releaseConfigProgram, {
    process: {
      env: {
        GITHUB_WORKSPACE: process.cwd(),
        FLATPAK_APP_ID: "com.sortofremote.ng",
        PLATFORM: "linux",
        UPDATER_ENABLED: "false",
        WINDOWS_CERT_THUMBPRINT: "",
      },
    },
    require(specifier) {
      if (specifier === "node:fs") {
        return {
          readFileSync,
          statSync(path) {
            if (/resources[\\/]native-runtime(?:-licenses)?[\\/]/.test(path)) {
              return { isFile: () => true };
            }
            return statSync(path);
          },
          writeFileSync(path, contents) {
            releaseConfigWrite = { path, contents };
          },
        };
      }
      if (specifier === "node:path") {
        return { resolve };
      }
      throw new Error(`Unexpected module request: ${specifier}`);
    },
  });
  assert.equal(releaseConfigWrite?.path, "src-tauri/tauri.release.conf.json");
  const linuxReleaseConfig = JSON.parse(releaseConfigWrite.contents);
  assert.equal(
    linuxReleaseConfig.bundle.linux.rpm.desktopTemplate,
    resolve(process.cwd(), "src-tauri/packaging/linux.desktop"),
  );
  assert.equal(linuxReleaseConfig.mainBinaryName, "com.sortofremote.ng");
  assert.equal(linuxReleaseConfig.bundle.createUpdaterArtifacts, false);
  assert.equal(
    linuxReleaseConfig.bundle.resources[
      "resources/native-runtime/libopenh264.so.8"
    ],
    "libopenh264.so.8",
  );
  assert.equal(
    linuxReleaseConfig.bundle.resources["resources/native-runtime-licenses/"],
    "native-runtime-licenses/",
  );

  assert.match(
    buildJob,
    /- name: Cache pinned Unix OpenH264 runtime\s+if: matrix\.platform != 'windows'[\s\S]*?path: \.cache\/vcpkg-installed\/\$\{\{ matrix\.rust_target \}\}[\s\S]*?scripts\/stage-openh264-runtime\.mjs/,
  );
  assert.match(
    buildJob,
    /- name: Stage Unix OpenH264 runtime\s+if: matrix\.platform != 'windows'[\s\S]*?node scripts\/stage-openh264-runtime\.mjs \\\s+--target "\$RUST_TARGET" \\\s+--github-env "\$GITHUB_ENV"/,
  );
  assertOrdered(
    buildJob,
    "- name: Stage Unix OpenH264 runtime",
    "- name: Build native bundles",
    "OpenH264 must be staged before Linux and macOS release linking",
  );

  assert.match(
    buildJob,
    /artifact_id: linux-x86_64[\s\S]*?os: ubuntu-24\.04[\s\S]*?bundles: appimage,deb,rpm/,
  );
  assert.match(
    buildJob,
    /artifact_id: linux-aarch64[\s\S]*?os: ubuntu-24\.04-arm[\s\S]*?bundles: appimage,deb,rpm/,
  );
  assert.doesNotMatch(nativePrerequisites, /\b(?:flatpak|appstream)\b/);
  assert.match(flatpakSetup, /"flatpak-builder=\$\{FLATPAK_BUILDER_PACKAGE\}"/);
  assert.doesNotMatch(
    flatpakSetup,
    /test "\$\(flatpak-builder --version\)" = "flatpak-builder \$FLATPAK_BUILDER_VERSION"/,
  );
  assert.match(
    flatpakSetup,
    /flatpak_builder_version_output=\$\(flatpak-builder --version\)/,
  );
  assert.match(
    flatpakSetup,
    /flatpak_builder_version_pattern='\^flatpak-builder\(\[\[:space:\]\]\+\|-\)\(\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\)\(\[\[:space:\]\]\+\\\(libflatpak version \[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\\\)\)\?\$'/,
  );
  assert.match(
    flatpakSetup,
    /"\$flatpak_builder_version_output" == \*\$'\\n'\*/,
  );
  assert.match(
    flatpakSetup,
    /actual_flatpak_builder_version=\$\{BASH_REMATCH\[2\]\}/,
  );
  assert.match(
    flatpakSetup,
    /if \[ "\$actual_flatpak_builder_version" != "\$FLATPAK_BUILDER_VERSION" \]; then/,
  );
  const flatpakBuilderVersionPattern =
    /^flatpak-builder(?:\s+|-)([0-9]+\.[0-9]+\.[0-9]+)(?:\s+\(libflatpak version [0-9]+\.[0-9]+\.[0-9]+\))?$/;
  const parseFlatpakBuilderVersion = (output) =>
    output.includes("\n")
      ? undefined
      : output.match(flatpakBuilderVersionPattern)?.[1];
  for (const accepted of [
    "flatpak-builder 1.4.2",
    "flatpak-builder-1.4.2",
    "flatpak-builder 1.4.2 (libflatpak version 1.14.6)",
    "flatpak-builder-1.4.2 (libflatpak version 1.14.6)",
  ]) {
    assert.equal(parseFlatpakBuilderVersion(accepted), "1.4.2");
  }
  for (const rejected of [
    "flatpak-builder 1.4.20",
    "flatpak-builder 1.4.2ubuntu1",
    "flatpak-builder 1.4.2 garbage",
    "flatpak-builder--1.4.2",
    "flatpak-builder v1.4.2",
    "flatpak-builder 1.4.2\nunexpected",
  ]) {
    assert.notEqual(parseFlatpakBuilderVersion(rejected), "1.4.2");
  }
  assert.match(flatpakSetup, /linux-x86_64\) flatpak_arch=x86_64/);
  assert.match(flatpakSetup, /linux-aarch64\) flatpak_arch=aarch64/);
  assert.match(
    flatpakSetup,
    /expected_runtime_ref="runtime\/\$FLATPAK_RUNTIME_ID\/\$flatpak_arch\/\$FLATPAK_RUNTIME_VERSION"/,
  );
  assert.match(
    flatpakSetup,
    /expected_sdk_ref="runtime\/\$FLATPAK_SDK_ID\/\$flatpak_arch\/\$FLATPAK_RUNTIME_VERSION"/,
  );
  assert.match(flatpakSetup, /FLATPAK_RUNTIME_COMMIT=\$runtime_commit/);
  assert.match(flatpakSetup, /FLATPAK_SDK_COMMIT=\$sdk_commit/);
  assertOrdered(
    buildJob,
    "- name: Build native bundles",
    "- name: Install pinned Flatpak toolchain and GNOME runtime",
    "the GNOME runtime must not consume disk until after native bundles are built",
  );

  assert.match(
    preserveLinux,
    /executable="\$release_root\/\$LINUX_PACKAGE_MAIN_BINARY"[\s\S]*?install -m 0755 "\$executable" "\$payload\/sortOfRemoteNG"/,
  );
  assert.match(
    preserveLinux,
    /openh264_source="\$GITHUB_WORKSPACE\/src-tauri\/resources\/native-runtime\/libopenh264\.so\.8"[\s\S]*?readelf -h "\$openh264_source"[\s\S]*?\$expected_elf_machine/,
  );
  assert.match(
    preserveLinux,
    /readelf -d "\$executable"[\s\S]*?Shared library: \[libopenh264\.so\.8\][\s\S]*?expected_runpath='\$ORIGIN\/\.\.\/lib\/sortOfRemoteNG'[\s\S]*?actual_runpath/,
  );
  assert.match(
    preserveLinux,
    /install -m 0755 "\$openh264_source" "\$payload\/lib\/libopenh264\.so\.8"[\s\S]*?cmp "\$openh264_source" "\$payload\/lib\/libopenh264\.so\.8"/,
  );
  assert.match(
    preserveLinux,
    /cp -a "\$native_license_source" "\$payload\/resources\/native-runtime-licenses"[\s\S]*?cmp "\$openh264_notice_source" "\$payload\/resources\/native-runtime-licenses\/openh264\.txt"/,
  );
  assert.match(
    preserveLinux,
    /payload="\$GITHUB_WORKSPACE\/\.ci\/flatpak-payload"/,
  );
  assert.match(
    preserveLinux,
    /cp -a "\$opkssh_source" "\$payload\/resources\/opkssh"/,
  );
  assert.match(
    preserveLinux,
    /locale_source="\$GITHUB_WORKSPACE\/src\/i18n\/locales"[\s\S]*?cp -a "\$locale_source" "\$payload\/resources\/locales"/,
  );
  assert.match(
    preserveLinux,
    /cd "\$locale_source"[\s\S]*?sha256sum \.\/\*\.json[\s\S]*?cd "\$payload\/resources\/locales"[\s\S]*?sha256sum \.\/\*\.json/,
  );
  assert.match(
    preserveLinux,
    /preserve_one appimage '\*\.AppImage'[\s\S]*?preserve_one deb '\*\.deb'[\s\S]*?preserve_one rpm '\*\.rpm'/,
  );
  assert.match(
    preserveLinux,
    /"\$target_root\/\$RUST_TARGET\/release\/deps"[\s\S]*?resolved_intermediate=\$\(realpath -m "\$intermediate"\)[\s\S]*?rm -rf -- "\$intermediate"/,
  );
  assert.doesNotMatch(preserveLinux, /rm -rf -- "\$target_root"/);
  assert.match(
    flatpakBuild,
    /payload="\$GITHUB_WORKSPACE\/\.ci\/flatpak-payload"[\s\S]*?test -x "\$payload\/sortOfRemoteNG"/,
  );
  assert.match(
    flatpakBuild,
    /test -f "\$payload\/lib\/libopenh264\.so\.8"[\s\S]*?cmp "\$openh264_source" "\$payload\/lib\/libopenh264\.so\.8"[\s\S]*?readelf -h "\$payload\/lib\/libopenh264\.so\.8"/,
  );
  assert.match(
    flatpakBuild,
    /test -d "\$payload\/resources\/locales"[\s\S]*?diff -u[\s\S]*?sha256sum \.\/\*\.json/,
  );
  assert.match(
    flatpakBuild,
    /flatpak_bundle_dir="\$GITHUB_WORKSPACE\/\.ci\/linux-native-bundles\/flatpak"/,
  );
  assert.match(flatpakBuild, /--arch="\$FLATPAK_ARCH"/);
  assert.match(flatpakBuild, /--default-branch=stable/);
  assert.match(flatpakBuild, /--disable-download/);
  assert.match(flatpakBuild, /flatpak build-bundle/);
  assert.match(flatpakBuild, /flatpak install[\s\S]*?--reinstall/);
  assert.match(
    flatpakBuild,
    /expected_app_ref="app\/\$FLATPAK_APP_ID\/\$FLATPAK_ARCH\/stable"/,
  );
  assert.match(
    flatpakBuild,
    /dbus-run-session -- flatpak run[\s\\]+--command=sh/,
  );
  assert.match(
    flatpakBuild,
    /test "\$\{FLATPAK_ID:-\}" = com\.sortofremote\.ng[\s\S]*?test -x \/app\/bin\/sortOfRemoteNG[\s\S]*?test -f \/app\/lib\/sortOfRemoteNG\/libopenh264\.so\.8[\s\S]*?test -d \/app\/bin\/resources\/opkssh[\s\S]*?test -d \/app\/bin\/resources\/locales[\s\S]*?ldd \/app\/bin\/sortOfRemoteNG[\s\S]*?grep -F "not found"[\s\S]*?openh264_ldd_path[\s\S]*?readlink -f[\s\S]*?\/app\/lib\/sortOfRemoteNG\/libopenh264\.so\.8/,
  );
  assert.match(
    flatpakBuild,
    /flatpak info --user --show-location[\s\S]*?installed_openh264="\$installed_location\/files\/lib\/sortOfRemoteNG\/libopenh264\.so\.8"[\s\S]*?sha256sum "\$installed_openh264"[\s\S]*?readelf -h "\$installed_openh264"[\s\S]*?cmp "\$openh264_notice_source" "\$installed_openh264_notice"/,
  );
  assert.match(
    flatpakBuild,
    /expected_flatpak_locale_digests[\s\S]*?cd "\$locale_source"[\s\S]*?\/app\/bin\/resources\/locales[\s\S]*?diff -u "\$expected_flatpak_locale_digests" "\$actual_flatpak_locale_digests"/,
  );
  assert.doesNotMatch(flatpakBuild, /flatpak run[^\n]*sortOfRemoteNG/);

  for (const arch of ["x86_64", "aarch64"]) {
    for (const extension of ["rpm", "flatpak"]) {
      const name = `sortOfRemoteNG_\\$\\{MACHINE_VERSION\\}_linux-${arch}\\.${extension}`;
      assert.match(publicSet, new RegExp(name));
      assert.match(
        unsignedUpload,
        new RegExp(
          `sortOfRemoteNG_\\$\\{\\{ needs\\.metadata\\.outputs\\.machine_version \\}\\}_linux-${arch}\\.${extension}`,
        ),
      );
      assert.match(
        signedUpload,
        new RegExp(
          `sortOfRemoteNG_\\$\\{\\{ needs\\.metadata\\.outputs\\.machine_version \\}\\}_linux-${arch}\\.${extension}`,
        ),
      );
    }
  }
  assert.match(stageStep, /rpm -qp --qf '%\{ARCH\}'/);
  assert.match(stageStep, /rpm -qp --qf '%\{VERSION\}'/);
  assert.match(
    stageStep,
    /expected_binary_path="\/usr\/bin\/\$LINUX_PACKAGE_MAIN_BINARY"/,
  );
  assert.match(
    stageStep,
    /expected_resource_root="\/usr\/lib\/\$LINUX_PACKAGE_PRODUCT_NAME\/opkssh"/,
  );
  assert.match(
    stageStep,
    /expected_locale_root="\/usr\/lib\/\$LINUX_PACKAGE_PRODUCT_NAME\/locales"/,
  );
  assert.match(
    stageStep,
    /expected_openh264_path="\/usr\/lib\/\$LINUX_PACKAGE_PRODUCT_NAME\/libopenh264\.so\.8"[\s\S]*?expected_openh264_notice_path="\/usr\/lib\/\$LINUX_PACKAGE_PRODUCT_NAME\/native-runtime-licenses\/openh264\.txt"/,
  );
  assert.match(
    stageStep,
    /verify_linux_openh264_payload\(\)[\s\S]*?readelf -h "\$library"[\s\S]*?sha256sum "\$library"[\s\S]*?Shared library: \[libopenh264\.so\.8\][\s\S]*?\$ORIGIN\/\.\.\/lib\/sortOfRemoteNG[\s\S]*?env -u LD_LIBRARY_PATH ldd "\$executable"[\s\S]*?ldd_openh264_path[\s\S]*?realpath "\$ldd_openh264_path"[\s\S]*?\$resolved_library/,
  );
  for (const packageKind of ["RPM", "DEB", "AppImage"]) {
    assert.match(
      stageStep,
      new RegExp(`verify_linux_openh264_payload "[^"\\n]+" ${packageKind}`),
    );
  }
  assert.match(
    stageStep,
    /expected_icon_root="\/usr\/share\/icons\/hicolor"[\s\S]*?expected_linux_icon_paths=\([\s\S]*?32x32\/apps\/\$FLATPAK_APP_ID\.png[\s\S]*?128x128\/apps\/\$FLATPAK_APP_ID\.png[\s\S]*?256x256\/apps\/\$FLATPAK_APP_ID\.png[\s\S]*?512x512\/apps\/\$FLATPAK_APP_ID\.png/,
  );
  assert.match(
    stageStep,
    /for icon_path in "\$\{expected_linux_icon_paths\[@\]\}"; do[\s\S]*?grep -Fx "\$icon_path" "\$rpm_file_list"/,
  );
  assert.match(
    stageStep,
    /rpm_extract_root="\$RUNNER_TEMP\/\$\{ARTIFACT_ID\}-rpm-extract"[\s\S]*?if \[ -e "\$rpm_extract_root" \] \|\| \[ -L "\$rpm_extract_root" \]; then[\s\S]*?Refusing to replace unexpected RPM extraction path \$rpm_extract_root\.[\s\S]*?exit 1[\s\S]*?fi[\s\S]*?mkdir -p "\$rpm_extract_root"/,
  );
  assert.match(
    stageStep,
    /rpm2archive "\$rpm_source" \| tar -xzf - --no-same-owner[\s\S]*?rpm_desktop_entry="\$rpm_extract_root\/usr\/share\/applications\/sortOfRemoteNG\.desktop"[\s\S]*?grep -Fx "Icon=\$FLATPAK_APP_ID" "\$rpm_desktop_entry"[\s\S]*?cmp "\$\{expected_linux_icon_sources\[\$index\]\}"/,
  );
  assert.doesNotMatch(stageStep, /rpm2cpio|\bcpio\s+-idm\b/);
  assert.doesNotMatch(nativePrerequisites, /\bcpio\b/);
  assert.doesNotMatch(
    stageStep,
    /expected_linux_icon_paths\[@\].*deb_payload_files/,
  );
  assert.match(
    stageStep,
    /deb_extract_root="\$RUNNER_TEMP\/\$\{ARTIFACT_ID\}-deb-extract"[\s\S]*?dpkg-deb -x "\$deb_source" "\$deb_extract_root"/,
  );
  assert.match(
    flatpakBuild,
    /sha256sum[\s\S]*?src-tauri\/icons\/icon\.png[\s\S]*?flatpak run[\s\S]*?\/app\/share\/icons\/hicolor\/512x512\/apps\/com\.sortofremote\.ng\.png[\s\S]*?diff -u "\$expected_flatpak_icon_digests" "\$actual_flatpak_icon_digests"/,
  );
  assert.match(
    flatpakBuild,
    /test -s \/app\/share\/applications\/com\.sortofremote\.ng\.desktop[\s\S]*?grep -Fx "Icon=com\.sortofremote\.ng" \/app\/share\/applications\/com\.sortofremote\.ng\.desktop/,
  );
  assert.match(
    stageStep,
    /rpm -qpl "\$rpm_source"[\s\S]*?dpkg-deb -c "\$deb_source"[\s\S]*?"\$updater_source" --appimage-extract/,
  );
  assert.equal(
    (
      stageStep.match(
        /diff -u "\$expected_resource_files" "\$(?:rpm|deb|appimage)_resource_files"/g,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(
    (
      stageStep.match(
        /diff -u "\$expected_locale_files" "\$(?:rpm|deb|appimage)_locale_files"/g,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(
    (
      stageStep.match(
        /diff -u "\$expected_locale_hashes" "\$(?:rpm|deb|appimage)_locale_hashes"/g,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(tauriConfig.productName, "sortOfRemoteNG");
  assert.deepEqual(tauriConfig.bundle.resources, {
    "crates/sorng-opkssh-vendor/bundle/opkssh/": "opkssh/",
    "../src/i18n/locales/": "locales/",
  });
  assert.match(
    opksshBinarySource,
    /const TAURI_PRODUCT_NAME: &str = "sortOfRemoteNG";/,
  );
  assert.match(
    opksshBinarySource,
    /prefix[\s\S]*?join\("lib"\)[\s\S]*?join\(TAURI_PRODUCT_NAME\)[\s\S]*?join\(BUNDLE_RESOURCE_ROOT\)/,
  );
  assert.match(
    opksshBinarySource,
    /linux_package_resource_root_uses_the_tauri_product_name[\s\S]*?\/usr\/bin\/app[\s\S]*?\/usr\/lib\/sortOfRemoteNG\/opkssh/,
  );
  assert.match(
    opksshBinarySource,
    /linux_appimage_resource_root_uses_the_mounted_prefix[\s\S]*?\/tmp\/\.mount_sortOfRemoteNG\/usr\/bin\/app[\s\S]*?\/tmp\/\.mount_sortOfRemoteNG\/usr\/lib\/sortOfRemoteNG\/opkssh/,
  );
  assert.match(stageStep, /linux_packages =/);
  for (const field of [
    "runtime_ref",
    "runtime_commit",
    "sdk_ref",
    "sdk_commit",
    "builder_version",
    "manifest_path",
    "manifest_sha256",
    "resource_path",
  ]) {
    assert.match(stageStep, new RegExp(`${field}:`));
  }
  assert.match(releaseWorkflow, /expected_asset_count=22/);
  assert.match(releaseWorkflow, /expected_asset_count=33/);
  assert.doesNotMatch(releaseWorkflow, /expected_asset_count=31/);
  assert.doesNotMatch(updaterFeed, /\.(?:rpm|flatpak)/);
});

test("DEB staging canonicalizes supported dpkg paths before exact validation", () => {
  const stageStart = releaseWorkflow.indexOf(
    "- name: Stage architecture-specific release assets",
  );
  const stageEnd = releaseWorkflow.indexOf(
    "- name: Validate staged version metadata",
    stageStart,
  );
  assert.ok(stageStart >= 0 && stageEnd > stageStart);

  const stageScript = extractLiteralRunScript(
    releaseWorkflow.slice(stageStart, stageEnd),
  );
  const normalizer = extractShellFunction(
    stageScript,
    "normalize_deb_file_list",
  );
  const resourceExtractor = extractShellFunction(
    stageScript,
    "relative_deb_files_under_exact_root",
  );
  const expectedPayload = [
    "/usr/bin/app",
    "/usr/lib/sortOfRemoteNG/opkssh/linux-amd64/libsorng_opkssh_vendor.so",
  ].join("\n");

  for (const prefix of ["usr", "./usr"]) {
    const listing = [
      `-rwxr-xr-x 0/0 42 2026-07-24 09:22 ${prefix}/bin/app`,
      `-rwxr-xr-x 0/0 17 2026-07-24 09:22 ${prefix}/lib/sortOfRemoteNG/opkssh/linux-amd64/libsorng_opkssh_vendor.so`,
    ].join("\n");
    const result = runBashSnippet(String.raw`
set -euo pipefail
${normalizer}
cat <<'DPKG_LIST' | normalize_deb_file_list
${listing}
DPKG_LIST
`);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.trim(), expectedPayload);
  }

  const exactResourceResult = runBashSnippet(String.raw`
set -euo pipefail
${resourceExtractor}
cat <<'NORMALIZED_PATHS' | relative_deb_files_under_exact_root "/usr/lib/sortOfRemoteNG/opkssh"
/opt/cache/usr/lib/sortOfRemoteNG/opkssh/linux-amd64/unrelated.so
/usr/lib/sortOfRemoteNG/opkssh-evil/linux-amd64/unrelated.so
/usr/lib/sortOfRemoteNG/opkssh/linux-amd64/libsorng_opkssh_vendor.so
NORMALIZED_PATHS
`);
  assert.equal(
    exactResourceResult.status,
    0,
    `${exactResourceResult.stdout}\n${exactResourceResult.stderr}`,
  );
  assert.equal(
    exactResourceResult.stdout.trim(),
    "linux-amd64/libsorng_opkssh_vendor.so",
  );

  const unrelatedBinaryResult = runBashSnippet(String.raw`
set -o pipefail
${normalizer}
cat <<'DPKG_LIST' | normalize_deb_file_list | grep -Fx "/usr/bin/app"
-rwxr-xr-x 0/0 42 2026-07-24 09:22 opt/cache/usr/bin/app
DPKG_LIST
`);
  assert.notEqual(unrelatedBinaryResult.status, 0);

  const traversalResult = runBashSnippet(String.raw`
set -o pipefail
${normalizer}
cat <<'DPKG_LIST' | normalize_deb_file_list
-rwxr-xr-x 0/0 42 2026-07-24 09:22 usr/lib/sortOfRemoteNG/opkssh/../escape.so
DPKG_LIST
`);
  assert.notEqual(traversalResult.status, 0);
  assert.match(traversalResult.stderr, /Unsafe DEB payload path/);

  assert.match(
    stageScript,
    /grep -Fx "\$expected_binary_path" "\$deb_payload_files"/,
  );
  assert.match(
    stageScript,
    /relative_deb_files_under_exact_root "\$expected_resource_root"[\s\\]+< "\$deb_payload_files"/,
  );
  assert.doesNotMatch(
    stageScript,
    /grep -E[qx]* "[^"]*\$\{expected_binary_path\}/,
  );
});

test("platform resource inspection is exact and immediately precedes native building", () => {
  const buildStart = releaseWorkflow.indexOf("  build:");
  const publishStart = releaseWorkflow.indexOf("  publish:");
  const buildJob = releaseWorkflow.slice(buildStart, publishStart);
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const resourceStepStart = buildJob.indexOf(
    "- name: Bound and inspect Linux release resources",
  );
  const windowsResourceStepStart = buildJob.indexOf(
    "- name: Inspect Windows release resources",
  );
  const nativeBuildStart = buildJob.indexOf("- name: Build native bundles");

  assert.ok(resourceStepStart >= 0);
  assert.ok(windowsResourceStepStart > resourceStepStart);
  assert.ok(nativeBuildStart > windowsResourceStepStart);

  const resourceStep = buildJob.slice(
    resourceStepStart,
    windowsResourceStepStart,
  );
  const documentedDiskGiB = Number(
    releaseWorkflow.match(
      /^  LINUX_STANDARD_RUNNER_DISK_GIB: "([0-9]+)"$/m,
    )?.[1],
  );
  assert.equal(documentedDiskGiB, 14);
  assert.ok(
    documentedDiskGiB <= 14,
    "the Linux resource contract cannot exceed the standard runner's documented 14 GiB SSD",
  );
  assert.match(
    resourceStep,
    /documented_capacity_bytes=\$\(\(LINUX_STANDARD_RUNNER_DISK_GIB \* 1024 \* 1024 \* 1024\)\)/,
  );
  assert.match(
    resourceStep,
    /test "\$documented_capacity_bytes" -eq \$\(\(14 \* 1024 \* 1024 \* 1024\)\)/,
  );
  assert.match(resourceStep, /df -B1 --output=size "\$RUNNER_TEMP"/);
  assert.match(resourceStep, /df -B1 --output=avail "\$RUNNER_TEMP"/);
  assert.match(
    resourceStep,
    /desired_swap_size_bytes=\$\(\(16 \* 1024 \* 1024 \* 1024\)\)/,
  );
  assert.match(resourceStep, /disk_floor_bytes=\$documented_capacity_bytes/);
  assert.match(
    resourceStep,
    /swappable_bytes=\$\(\(available_bytes - disk_floor_bytes\)\)/,
  );
  assert.match(
    resourceStep,
    /swap_size_bytes=\$\(\(swappable_bytes \/ swap_alignment_bytes \* swap_alignment_bytes\)\)/,
  );
  assert.match(
    resourceStep,
    /if \(\( swap_size_bytes >= minimum_swap_size_bytes \)\); then/,
  );
  assert.match(
    resourceStep,
    /if \(\( remaining_bytes < disk_floor_bytes \)\); then/,
  );
  assert.match(
    resourceStep,
    /sudo fallocate -l "\$swap_size_bytes" "\$swap_file"/,
  );
  assert.match(resourceStep, /sudo mkswap "\$swap_file"/);
  assert.match(resourceStep, /sudo swapon "\$swap_file"/);
  assert.match(
    resourceStep,
    /echo "LINUX_RELEASE_SWAP_FILE=\$swap_file" >> "\$GITHUB_ENV"/,
  );
  assert.doesNotMatch(
    resourceStep,
    /(?:disk_floor_bytes|required_bytes)=\$\(\([1-9][0-9]* \* 1024 \* 1024 \* 1024\)\)/,
  );
  assert.match(
    buildJob,
    /- name: Cache Cargo build\s+if: matrix\.platform != 'linux'\s+uses: Swatinem\/rust-cache@/,
  );
  assert.match(resourceStep, /command -v clang-18/);
  assert.match(resourceStep, /command -v ld\.lld-18/);
  assert.match(
    resourceStep,
    /exec \/usr\/bin\/clang-18 -fuse-ld=lld-18 -Wl,--threads=1 "\$@"/,
  );
  assert.match(
    resourceStep,
    /echo "CARGO_TARGET_\$\{cargo_target_key\}_LINKER=\$linker_wrapper" >> "\$GITHUB_ENV"/,
  );
  const windowsResourceStep = buildJob.slice(
    windowsResourceStepStart,
    nativeBuildStart,
  );
  assert.equal(
    windowsResourceStep.trimEnd(),
    [
      "- name: Inspect Windows release resources",
      "        if: matrix.platform == 'windows'",
      "        shell: pwsh",
      "        run: |",
      '          $ErrorActionPreference = "Stop"',
      "          $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem",
      "          $pageFiles = @(Get-CimInstance -ClassName Win32_PageFileUsage)",
      '          $workspaceDriveName = (Get-Item -LiteralPath $env:GITHUB_WORKSPACE).PSDrive.Name + ":"',
      "          $workspaceDrive = Get-CimInstance -ClassName Win32_LogicalDisk |",
      "            Where-Object { $_.DeviceID -eq $workspaceDriveName } |",
      "            Select-Object -First 1",
      "          if (-not $workspaceDrive) {",
      '            throw "Unable to inspect workspace drive $workspaceDriveName."',
      "          }",
      "",
      '          Write-Host "physical_total_bytes=$([uint64]$operatingSystem.TotalVisibleMemorySize * 1KB)"',
      '          Write-Host "physical_free_bytes=$([uint64]$operatingSystem.FreePhysicalMemory * 1KB)"',
      '          Write-Host "virtual_total_bytes=$([uint64]$operatingSystem.TotalVirtualMemorySize * 1KB)"',
      '          Write-Host "virtual_free_bytes=$([uint64]$operatingSystem.FreeVirtualMemory * 1KB)"',
      '          Write-Host "workspace_drive=$workspaceDriveName"',
      '          Write-Host "workspace_drive_size_bytes=$([uint64]$workspaceDrive.Size)"',
      '          Write-Host "workspace_drive_free_bytes=$([uint64]$workspaceDrive.FreeSpace)"',
      '          Write-Host "pagefile_count=$($pageFiles.Count)"',
      "          foreach ($pageFile in $pageFiles) {",
      '            Write-Host "pagefile_name=$($pageFile.Name)"',
      '            Write-Host "pagefile_allocated_bytes=$([uint64]$pageFile.AllocatedBaseSize * 1MB)"',
      '            Write-Host "pagefile_current_usage_bytes=$([uint64]$pageFile.CurrentUsage * 1MB)"',
      '            Write-Host "pagefile_peak_usage_bytes=$([uint64]$pageFile.PeakUsage * 1MB)"',
      "          }",
    ].join("\n"),
  );
  assert.doesNotMatch(
    windowsResourceStep,
    /\b(?:Set|New|Remove)-CimInstance\b|\b(?:Set|New|Remove)-Item\b|\bFormat-Volume\b|\bResize-Partition\b/,
  );
  assert.equal(
    (releaseWorkflow.match(/CARGO_TARGET_\$\{cargo_target_key\}_LINKER/g) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(releaseWorkflow, /CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU/);
  assert.doesNotMatch(
    releaseWorkflow,
    /CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU/,
  );
  const preserveStepStart = buildJob.indexOf(
    "- name: Preserve native Linux outputs and prune build intermediates",
  );
  const flatpakSetupStart = buildJob.indexOf(
    "- name: Install pinned Flatpak toolchain and GNOME runtime",
  );
  const preserveStep = buildJob.slice(preserveStepStart, flatpakSetupStart);
  assert.ok(preserveStepStart > nativeBuildStart);
  assert.ok(flatpakSetupStart > preserveStepStart);
  assert.match(
    preserveStep,
    /expected_swap_file="\$RUNNER_TEMP\/sorng-release\.swap"[\s\S]*?test "\$LINUX_RELEASE_SWAP_FILE" = "\$expected_swap_file"/,
  );
  assert.match(preserveStep, /sudo swapoff "\$LINUX_RELEASE_SWAP_FILE"/);
  assert.match(preserveStep, /sudo rm -f -- "\$LINUX_RELEASE_SWAP_FILE"/);
  const outsideSwapSteps =
    releaseWorkflow.slice(0, buildStart + resourceStepStart) +
    releaseWorkflow.slice(
      buildStart + windowsResourceStepStart,
      buildStart + preserveStepStart,
    ) +
    releaseWorkflow.slice(buildStart + flatpakSetupStart);
  assert.doesNotMatch(
    outsideSwapSteps,
    /sorng-release\.swap|\b(?:fallocate|mkswap|swapon|swapoff)\b/,
  );
  assert.doesNotMatch(
    buildJob,
    /^\s+(?:RUSTFLAGS|CC|CXX|LD|LDFLAGS|CMAKE(?:_[A-Z0-9_]+)?):/m,
  );
  assert.doesNotMatch(
    buildJob,
    /^\s*(?:export\s+)?(?:RUSTFLAGS|CC|CXX|LD|LDFLAGS|CMAKE(?:_[A-Z0-9_]+)?)=/m,
  );
  const linuxTargetConfig = cargoConfig.slice(
    cargoConfig.indexOf("[target.x86_64-unknown-linux-gnu]"),
    cargoConfig.indexOf("[target.x86_64-apple-darwin]"),
  );
  const activeLinuxTargetConfig = linuxTargetConfig
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .join("\n");
  assert.equal(
    activeLinuxTargetConfig,
    [
      "[target.x86_64-unknown-linux-gnu]",
      "rustflags = [",
      '  "-C", "target-feature=+sse3,+ssse3,+sse4.1,+sse4.2,+avx,+avx2,+fma,+f16c,+aes,+pclmulqdq,+bmi1,+bmi2,+adx,+popcnt,+lzcnt",',
      "]",
    ].join("\n"),
  );
  const releaseProfile = cargoManifest.slice(
    cargoManifest.indexOf("[profile.release]"),
    cargoManifest.indexOf("[patch.crates-io]"),
  );
  assert.match(releaseProfile, /^lto = "thin"$/m);
  assert.match(releaseProfile, /^codegen-units = 1$/m);
  // Cargo's checked-in release profile retains the production default
  // opt-level (3); every hosted release matrix entry overrides it to 0.
  assert.doesNotMatch(releaseProfile, /^opt-level\s*=/m);
  assert.doesNotMatch(buildJob, /timeout-minutes:/);
  assert.match(
    buildDefinition,
    /strategy:\s*\n\s+fail-fast: false\s*\n\s+matrix:/,
  );
  assert.doesNotMatch(buildJob, /^\s+concurrency:/m);
  assert.doesNotMatch(buildJob, /^\s+cancel-in-progress:/m);
  assert.match(
    releaseWorkflow,
    /concurrency:\s*\n\s+group: rolling-release\s*\n(?:\s*#.*\n)*\s+queue: max\s*\n\s+cancel-in-progress: false/,
  );
});

test("updater private key material is scoped to key checks and Tauri build", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const beforeSteps = buildJob.slice(0, buildJob.indexOf("    steps:"));
  assert.doesNotMatch(beforeSteps, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(
    buildJob,
    /Build native bundles[\s\S]*?env:[\s\S]*?TAURI_SIGNING_PRIVATE_KEY:/,
  );
  assert.match(
    releaseWorkflow,
    /Sign updater trust challenge[\s\S]*?env:[\s\S]*?TAURI_SIGNING_PRIVATE_KEY:/,
  );
  assert.match(
    releaseWorkflow,
    /Verify updater key matches embedded public key[\s\S]*?sorng-updater-signature-verifier/,
  );
  const publishJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  publish:"),
  );
  assert.doesNotMatch(publishJob, /\$\{\{ secrets\./);
});

test("monotonic source and immutable snapshot guards run before tag mutation", () => {
  assert.match(
    releaseWorkflow,
    /git update-ref[\s\S]*?refs\/tags\/\$PUBLIC_TAG[\s\S]*?0000000000000000000000000000000000000000/,
  );
  assert.match(
    releaseWorkflow,
    /Verify immutable release snapshot integrity[\s\S]*?verify-release-snapshot\.mjs[\s\S]*?--snapshot-commit "\$SNAPSHOT_COMMIT"[\s\S]*?--source-sha "\$SOURCE_SHA"/,
  );
  assert.match(
    releaseWorkflow,
    /snapshot_commit: \$\{\{ steps\.verify_snapshot\.outputs\.snapshot_commit \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /source_guard: \$\{\{ steps\.release_version\.outputs\.source_guard \}\}/,
  );
  const createSnapshot = releaseWorkflow.slice(
    releaseWorkflow.indexOf("Create or reuse immutable release snapshot"),
    releaseWorkflow.indexOf(
      "- name: Verify immutable release snapshot integrity",
    ),
  );
  assertOrdered(
    createSnapshot,
    '[ "$SOURCE_GUARD" != "passed" ]',
    "git update-ref",
    "monotonic source guard must fail before tag creation",
  );
  assertOrdered(
    createSnapshot,
    "verify-release-snapshot.mjs",
    "push --atomic",
    "new snapshots must verify before the immutable tag and main update are pushed",
  );
  assertOrdered(
    releaseWorkflow,
    "Sign updater trust challenge",
    "git update-ref",
    "a wrong updater private key must fail before the public tag is created",
  );
});

test("OS signing inputs are normalized and verified before updater signing", () => {
  assert.ok(
    releaseWorkflow.includes(
      "$thumbprint = ($env:WINDOWS_CERT_THUMBPRINT -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()",
    ),
  );
  assert.match(releaseWorkflow, /thumbprint -notmatch '\^\[0-9A-F\]\{40\}\$'/);
  assert.match(
    releaseWorkflow,
    /"thumbprint=\$thumbprint"[\s\S]*?WINDOWS_CERT_THUMBPRINT: \$\{\{ steps\.windows_signing\.outputs\.thumbprint \|\| '' \}\}/,
  );
  assert.match(releaseWorkflow, /Cert:\\CurrentUser\\My/);
  assert.match(releaseWorkflow, /certificate\.HasPrivateKey/);
  assert.match(releaseWorkflow, /apple-tool:,apple:,codesign:/);
  assert.match(
    releaseWorkflow,
    /Notarize and staple macOS disk image[\s\S]*?xcrun notarytool submit[\s\S]*?--wait[\s\S]*?\.status == "Accepted"[\s\S]*?xcrun stapler staple/,
  );
  assert.match(releaseWorkflow, /codesign --verify --deep --strict/);
  assert.match(releaseWorkflow, /xcrun stapler validate/);
});

test("optional signing states are annotation-clean while partial secrets fail closed", () => {
  const updaterStep = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Detect protected updater signing key"),
    releaseWorkflow.indexOf(
      "- name: Install updater-key verification toolchain",
    ),
  );
  const updaterProgram = extractLiteralRunScript(updaterStep);
  const updaterVariables = [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  ];

  assert.doesNotMatch(updaterStep, /::(?:notice|warning)::?/);
  const updaterAbsent = runWorkflowBashStep(updaterProgram, updaterVariables);
  assert.equal(
    updaterAbsent.status,
    0,
    `${updaterAbsent.stdout}\n${updaterAbsent.stderr}`,
  );
  assert.match(updaterAbsent.stdout, /enabled=false/);
  assert.match(updaterAbsent.stdout, /### Optional updater signing/);
  assert.match(
    updaterAbsent.stdout,
    /Public installers will be released without updater signatures or latest\.json/,
  );
  assert.doesNotMatch(updaterAbsent.stdout, /::(?:notice|warning)::?/);

  const updaterKeyOnly = runWorkflowBashStep(updaterProgram, updaterVariables, {
    TAURI_SIGNING_PRIVATE_KEY: "test-private-key",
  });
  assert.equal(
    updaterKeyOnly.status,
    0,
    `${updaterKeyOnly.stdout}\n${updaterKeyOnly.stderr}`,
  );
  assert.match(updaterKeyOnly.stdout, /enabled=true/);
  assert.doesNotMatch(updaterKeyOnly.stdout, /Optional updater signing/);

  const updaterOrphanPassword = runWorkflowBashStep(
    updaterProgram,
    updaterVariables,
    {
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "do-not-print-this-password",
    },
  );
  assert.notEqual(updaterOrphanPassword.status, 0);
  assert.match(
    updaterOrphanPassword.stdout,
    /::error title=Incomplete updater signing configuration::/,
  );
  assert.match(
    updaterOrphanPassword.stdout,
    /TAURI_SIGNING_PRIVATE_KEY_PASSWORD is configured without TAURI_SIGNING_PRIVATE_KEY/,
  );
  assert.doesNotMatch(
    `${updaterOrphanPassword.stdout}\n${updaterOrphanPassword.stderr}`,
    /do-not-print-this-password/,
  );

  const macosStep = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Check macOS Developer ID signing inputs"),
    releaseWorkflow.indexOf("- name: Import Apple Developer ID certificate"),
  );
  const macosProgram = extractLiteralRunScript(macosStep);
  const macosVariables = [
    "APPLE_CERT_P12_BASE64",
    "APPLE_CERT_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ];

  assert.doesNotMatch(macosStep, /::(?:notice|warning)::?/);
  const macosAbsent = runWorkflowBashStep(macosProgram, macosVariables);
  assert.equal(
    macosAbsent.status,
    0,
    `${macosAbsent.stdout}\n${macosAbsent.stderr}`,
  );
  assert.match(macosAbsent.stdout, /enabled=false/);
  assert.match(macosAbsent.stdout, /### Optional macOS signing/);
  assert.match(macosAbsent.stdout, /truthfully unsigned macOS artifacts/);
  assert.doesNotMatch(macosAbsent.stdout, /::(?:notice|warning)::?/);

  const macosComplete = runWorkflowBashStep(
    macosProgram,
    macosVariables,
    Object.fromEntries(
      macosVariables.map((name) => [name, `configured-${name}`]),
    ),
  );
  assert.equal(
    macosComplete.status,
    0,
    `${macosComplete.stdout}\n${macosComplete.stderr}`,
  );
  assert.match(macosComplete.stdout, /enabled=true/);
  assert.doesNotMatch(macosComplete.stdout, /Optional macOS signing/);

  const macosPartial = runWorkflowBashStep(macosProgram, macosVariables, {
    APPLE_ID: "do-not-print-this-apple-id",
  });
  assert.notEqual(macosPartial.status, 0);
  assert.match(
    macosPartial.stdout,
    /::error title=Incomplete macOS signing configuration::/,
  );
  assert.match(
    macosPartial.stdout,
    /missing: APPLE_CERT_P12_BASE64 APPLE_CERT_PASSWORD APPLE_PASSWORD APPLE_TEAM_ID/,
  );
  assert.doesNotMatch(
    `${macosPartial.stdout}\n${macosPartial.stderr}`,
    /do-not-print-this-apple-id/,
  );

  assert.match(
    updaterSetupDocumentation,
    /job summary rather than a\s+warning annotation[\s\S]*?password secret configured without the private key fails\s+closed/,
  );
  assert.match(
    appleEnrollmentDocumentation,
    /job summary without creating a warning annotation[\s\S]*?partially configured credential set is treated as an error/,
  );

  const windowsStep = releaseWorkflow.slice(
    releaseWorkflow.indexOf("- name: Check Windows Authenticode signing input"),
    releaseWorkflow.indexOf("- name: Configure updater and OS signing"),
  );
  assert.doesNotMatch(windowsStep, /Write-Warning|::(?:notice|warning)::?/);
  assert.match(
    windowsStep,
    /### Optional Windows signing[\s\S]*?GITHUB_STEP_SUMMARY/,
  );
});

test("signed and unsigned release sets are validated before any release mutation", () => {
  assert.match(
    releaseWorkflow,
    /Generate signed updater feed[\s\S]*?if: needs\.metadata\.outputs\.updater_enabled == 'true'/,
  );
  assert.match(
    releaseWorkflow,
    /Cryptographically verify every updater payload[\s\S]*?verify-published-release-assets\.mjs[\s\S]*?--updater-mode signed/,
  );
  assert.match(
    releaseWorkflow,
    /Verify exact unsigned release asset set[\s\S]*?--updater-mode unsigned/,
  );
  assert.match(
    releaseWorkflow,
    /one "\$bundle\/macos" '\*\.app\.tar\.gz' "sortOfRemoteNG_\$\{MACHINE_VERSION\}_\$\{ARTIFACT_ID\}\.app\.tar\.gz"/,
  );
  assert.match(
    releaseWorkflow,
    /add linux-x86_64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_linux-x86_64\.AppImage"[\s\S]*?add linux-aarch64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_linux-aarch64\.AppImage"[\s\S]*?add darwin-aarch64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_darwin-aarch64\.app\.tar\.gz"[\s\S]*?add darwin-x86_64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_darwin-x86_64\.app\.tar\.gz"[\s\S]*?add windows-x86_64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_windows-x86_64-setup\.exe"[\s\S]*?add windows-aarch64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_windows-aarch64-setup\.exe"/,
  );
  const unsignedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf("Upload exact unsigned assets to draft release"),
    releaseWorkflow.indexOf(
      "Upload exact signed assets and root updater feed to draft release",
    ),
  );
  const signedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf(
      "Upload exact signed assets and root updater feed to draft release",
    ),
    releaseWorkflow.indexOf("Re-download and validate complete draft release"),
  );
  for (const target of [
    "linux-x86_64.AppImage",
    "linux-aarch64.AppImage",
    "darwin-aarch64.app.tar.gz",
    "darwin-x86_64.app.tar.gz",
    "windows-x86_64-setup.exe",
    "windows-aarch64-setup.exe",
  ]) {
    assert.match(
      signedUpload,
      new RegExp(`${target.replaceAll(".", "\\.")}\\.sig`),
    );
  }
  for (const target of ["windows-x86_64", "windows-aarch64"]) {
    const portablePattern = new RegExp(`${target}-portable\\.zip`);
    assert.match(unsignedUpload, portablePattern);
    assert.match(signedUpload, portablePattern);
  }
  assert.match(signedUpload, /^\s+dist\/latest\.json$/m);
  assert.doesNotMatch(
    releaseWorkflow.slice(
      releaseWorkflow.indexOf("- name: Generate signed updater feed"),
      releaseWorkflow.indexOf(
        "- name: Cryptographically verify every updater payload",
      ),
    ),
    /portable\.zip/,
  );
  assert.doesNotMatch(releaseWorkflow, /gh release delete-asset/);
});

test("updater setup documents the eight canonical updater payload names", () => {
  for (const filename of [
    "sortOfRemoteNG_26.1.0_windows-x86_64-setup.exe",
    "sortOfRemoteNG_26.1.0_windows-aarch64-setup.exe",
    "sortOfRemoteNG_26.1.0_windows-x86_64.msi",
    "sortOfRemoteNG_26.1.0_windows-aarch64.msi",
    "sortOfRemoteNG_26.1.0_darwin-x86_64.app.tar.gz",
    "sortOfRemoteNG_26.1.0_darwin-aarch64.app.tar.gz",
    "sortOfRemoteNG_26.1.0_linux-x86_64.AppImage",
    "sortOfRemoteNG_26.1.0_linux-aarch64.AppImage",
  ]) {
    assert.ok(
      updaterSetupDocumentation.includes(
        `"signature": "<base64 minisign signature of ${filename}>"`,
      ),
      `${filename} must have an exact signature description`,
    );
    assert.ok(
      updaterSetupDocumentation.includes(`releases/download/26.1/${filename}`),
      `${filename} must have an exact updater URL`,
    );
  }
  assert.doesNotMatch(
    updaterSetupDocumentation,
    /sortOfRemoteNG_(?:26\.1\.0_x64_en-US\.msi|x64\.app\.tar\.gz|aarch64\.app\.tar\.gz|26\.1\.0_amd64\.AppImage)/,
  );
  for (const arch of ["x86_64", "aarch64"]) {
    assert.ok(
      updaterSetupDocumentation.includes(`"windows-${arch}-msi": {`),
      `the sample feed must carry the windows-${arch}-msi platform key`,
    );
  }
  assert.doesNotMatch(updaterSetupDocumentation, /"windows-[a-z0-9_]+-nsis"/);
  assert.match(
    updaterSetupDocumentation,
    /only package types compatible with the\s+feed payload may use them: Linux AppImage, Windows NSIS, Windows MSI, and the\s+macOS app bundle/,
  );
  assert.match(
    updaterSetupDocumentation,
    /Debian, RPM, Flatpak, and the\s+architecture-matched Windows x64 and ARM64 portable ZIP builds therefore use\s+externally managed updates/,
  );
  assert.match(
    updaterSetupDocumentation,
    /The eight updater platform keys are `windows-x86_64`, `windows-aarch64`,\s+`windows-x86_64-msi`, `windows-aarch64-msi`/,
  );
  assert.match(
    updaterSetupDocumentation,
    /flatpak install --user --reinstall \.\/sortOfRemoteNG_<version>_linux-<arch>\.flatpak/,
  );
});

test("updater setup documents the MSI elevation, exit, and upgrade contract", () => {
  assert.match(
    updaterSetupDocumentation,
    /explicit `\.target\("windows-<arch>-msi"\)`[\s\S]{0,400}?disables fallback entirely/,
    "the target pin and its purpose must be documented",
  );
  assert.match(
    updaterSetupDocumentation,
    /msiexec \/i <temp>\.msi \/passive/,
    "the exact msiexec invocation must be documented",
  );
  assert.match(
    updaterSetupDocumentation,
    /always raises a UAC administrator consent prompt/,
  );
  assert.match(
    updaterSetupDocumentation,
    /Declining UAC therefore cancels the update and\s+leaves the app closed at its current version/,
  );
  assert.match(
    updaterSetupDocumentation,
    /verifies the downloaded `\.msi` against the embedded pubkey\s+\*\*before\*\* anything is executed/,
    "signature verification must be documented as preceding msiexec",
  );
  assert.match(
    updaterSetupDocumentation,
    /`bundle\.windows\.wix\.upgradeCode`[\s\S]{0,200}?is pinned/,
  );
  assert.match(
    updaterSetupDocumentation,
    /`bundle\.windows\.wix\.enableElevatedUpdateTask` is deliberately \*\*not\*\* enabled/,
  );
  assert.match(
    updaterSetupDocumentation,
    /no CI job installs an MSI[\s\S]{0,400}?smoke-test manually/,
    "the untested-on-CI caveat and its manual smoke test must be documented",
  );
  assert.match(
    updaterSetupDocumentation,
    /it expands to `windows-x86_64-msi`, not `windows-x86_64`/,
    "the {{target}} expansion change for MSI installs must be documented",
  );
  assert.match(
    releaseDocumentation,
    /Linux\s+AppImage, Windows NSIS, Windows MSI, and macOS app-bundle installations/,
  );
  assert.match(
    releaseDocumentation,
    /Debian, RPM, Flatpak, and portable ZIP installations must\s+download and reinstall/,
  );
  assert.match(
    releaseDocumentation,
    /always prompts for administrator approval/,
  );
  assert.doesNotMatch(releaseDocumentation, /Flatpak, MSI, and portable ZIP/);
});

test("recovery distinguishes 404, no-ops valid releases, and blocks signing downgrade", () => {
  assert.match(
    releaseWorkflow,
    /api_get\(\)[\s\S]*?http_status=.*?sed[\s\S]*?\[ "\$http_status" = 404 \][\s\S]*?return 44/,
  );
  assert.match(
    releaseWorkflow,
    /GitHub API request failed for \$endpoint \(HTTP \$\{http_status:-unknown\}\)[\s\S]*?return "\$command_status"/,
  );
  assert.match(
    releaseWorkflow,
    /Existing published release is complete, current, and cryptographically valid; no mutation is needed/,
  );
  assert.match(
    releaseWorkflow,
    /Existing draft contains signed updater assets; the updater private key is required for any repair/,
  );
  assert.match(releaseWorkflow, /protect_os_downgrade darwin-aarch64/);
  assert.match(releaseWorkflow, /protect_os_downgrade windows-x86_64/);
  assert.match(releaseWorkflow, /protect_os_downgrade windows-aarch64/);
  assert.match(
    releaseWorkflow,
    /protect_latest_os_downgrade darwin-aarch64 developer-id-verified/,
  );
  assert.match(
    releaseWorkflow,
    /protect_latest_os_downgrade darwin-x86_64 developer-id-verified/,
  );
  assert.match(
    releaseWorkflow,
    /protect_latest_os_downgrade windows-x86_64 authenticode-verified/,
  );
  assert.match(
    releaseWorkflow,
    /protect_latest_os_downgrade windows-aarch64 authenticode-verified/,
  );
  assert.match(
    releaseWorkflow,
    /refusing to promote an unsigned release over it/,
  );
  assert.match(
    releaseWorkflow,
    /upload=false[\s\S]*?promote=true[\s\S]*?public_promotion=true[\s\S]*?Existing published release is complete and valid; retrying latest promotion without asset mutation/,
  );
  assert.match(
    releaseWorkflow,
    /Existing public release is incomplete or is not the latest release\. Refusing a non-atomic in-place overwrite/,
  );
  assert.doesNotMatch(releaseWorkflow, /2>\s*\/dev\/null\); then/);
});

test("hidden drafts resolve through the authenticated list to one immutable ID", () => {
  const snapshot = "e836ea423f6715c16d0676b5c280ce064e845881";
  const draft = {
    id: 358564463,
    tag_name: "26.12",
    target_commitish: snapshot,
    draft: true,
    prerelease: false,
  };
  const result = runReleaseIdHelper(
    String.raw`
      set -euo pipefail
      : > "$GH_CALL_LOG"
      output=$(mktemp)
      resolve_release_by_tag 26.12 "$EXPECTED_SNAPSHOT" draft "$output"
      [ "$(jq -r '.id' "$output")" = 358564463 ]
      ! grep -q '/releases/tags/' "$GH_CALL_LOG"
      grep -q $'^GET\trepos/example/project/releases?per_page=100$' "$GH_CALL_LOG"
      grep -q $'^GET\trepos/example/project/releases/358564463$' "$GH_CALL_LOG"
      echo HIDDEN_DRAFT_RESOLUTION_OK
    `,
    {
      EXPECTED_SNAPSHOT: snapshot,
      GH_CALL_LOG: releaseCallLog("hidden-draft"),
      MOCK_ASSETS_JSON: "[]",
      MOCK_RELEASES_JSON: JSON.stringify([draft]),
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /HIDDEN_DRAFT_RESOLUTION_OK/);
});

test("release-list resolution fails closed on zero, duplicate, and wrong-target matches", () => {
  const snapshot = "e836ea423f6715c16d0676b5c280ce064e845881";
  const draft = {
    id: 358564463,
    tag_name: "26.12",
    target_commitish: snapshot,
    draft: true,
    prerelease: false,
  };
  const duplicate = { ...draft, id: 358564464 };
  const wrongTarget = { ...draft, target_commitish: "wrong-snapshot" };
  const publicRelease = { ...draft, draft: false };
  const result = runReleaseIdHelper(
    String.raw`
      set -euo pipefail
      : > "$GH_CALL_LOG"
      output=$(mktemp)

      MOCK_RELEASES_JSON='[]'
      if resolve_release_by_tag 26.12 "$EXPECTED_SNAPSHOT" draft "$output"; then
        echo "zero matches unexpectedly resolved" >&2
        exit 1
      else
        [ "$?" -eq 44 ]
      fi

      MOCK_RELEASES_JSON="$DUPLICATE_RELEASES_JSON"
      if resolve_release_by_tag 26.12 "$EXPECTED_SNAPSHOT" draft "$output"; then
        echo "duplicate matches unexpectedly resolved" >&2
        exit 1
      else
        [ "$?" -eq 1 ]
      fi

      MOCK_RELEASES_JSON="$WRONG_TARGET_RELEASES_JSON"
      if resolve_release_by_tag 26.12 "$EXPECTED_SNAPSHOT" draft "$output"; then
        echo "wrong target unexpectedly resolved" >&2
        exit 1
      else
        [ "$?" -eq 1 ]
      fi

      MOCK_RELEASES_JSON="$PUBLIC_RELEASES_JSON"
      if resolve_release_by_tag 26.12 "$EXPECTED_SNAPSHOT" draft "$output"; then
        echo "wrong visibility unexpectedly resolved" >&2
        exit 1
      else
        [ "$?" -eq 1 ]
      fi
      echo AMBIGUOUS_DRAFTS_REJECTED_OK
    `,
    {
      DUPLICATE_RELEASES_JSON: JSON.stringify([draft, duplicate]),
      EXPECTED_SNAPSHOT: snapshot,
      GH_CALL_LOG: releaseCallLog("ambiguity"),
      MOCK_ASSETS_JSON: "[]",
      MOCK_RELEASES_JSON: "[]",
      PUBLIC_RELEASES_JSON: JSON.stringify([publicRelease]),
      WRONG_TARGET_RELEASES_JSON: JSON.stringify([wrongTarget]),
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /AMBIGUOUS_DRAFTS_REJECTED_OK/);
  const diagnosticOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(
    diagnosticOutput,
    /Expected exactly one authenticated GitHub release/,
  );
  assert.match(
    diagnosticOutput,
    /does not match the exact tag, snapshot target/,
  );
  assert.match(diagnosticOutput, /must remain a hidden draft/);
});

test("release assets download by ID with size and digest checks before same-ID promotion", () => {
  const snapshot = "e836ea423f6715c16d0676b5c280ce064e845881";
  const body = "draft-asset-payload";
  const digest = createHash("sha256").update(body).digest("hex");
  const draft = {
    id: 358564463,
    tag_name: "26.12",
    target_commitish: snapshot,
    draft: true,
    prerelease: false,
  };
  const asset = {
    id: 486989584,
    name: "sortOfRemoteNG_26.12.0_linux-x86_64.provenance.json",
    size: Buffer.byteLength(body),
    state: "uploaded",
    digest: `sha256:${digest}`,
  };
  const result = runReleaseIdHelper(
    String.raw`
      set -euo pipefail
      : > "$GH_CALL_LOG"
      manifest=$(mktemp)
      destination=$(mktemp -d)
      promoted=$(mktemp)

      list_release_assets 358564463 "$manifest"
      download_release_assets 358564463 "$manifest" "$destination"
      [ "$(cat "$destination/sortOfRemoteNG_26.12.0_linux-x86_64.provenance.json")" = "$MOCK_ASSET_BODY" ]
      promote_release_by_id 358564463 26.12 "$EXPECTED_SNAPSHOT" draft "$promoted"
      jq -e '.id == 358564463 and .draft == false' "$promoted" > /dev/null

      ! grep -q '/releases/tags/' "$GH_CALL_LOG"
      grep -q $'^GET\trepos/example/project/releases/358564463/assets?per_page=100$' "$GH_CALL_LOG"
      grep -q $'^GET\trepos/example/project/releases/assets/486989584$' "$GH_CALL_LOG"
      grep -q $'^PATCH\trepos/example/project/releases/358564463$' "$GH_CALL_LOG"
      echo RELEASE_ID_DOWNLOAD_AND_PROMOTION_OK
    `,
    {
      EXPECTED_SNAPSHOT: snapshot,
      GH_CALL_LOG: releaseCallLog("assets"),
      MOCK_ASSET_BODY: body,
      MOCK_ASSETS_JSON: JSON.stringify([asset]),
      MOCK_RELEASES_JSON: JSON.stringify([draft]),
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RELEASE_ID_DOWNLOAD_AND_PROMOTION_OK/);

  const invalidMetadata = runReleaseIdHelper(
    String.raw`
      set -euo pipefail
      : > "$GH_CALL_LOG"
      manifest=$(mktemp)
      if list_release_assets 358564463 "$manifest"; then
        echo "invalid asset metadata unexpectedly passed" >&2
        exit 1
      fi
      echo INVALID_ASSET_METADATA_REJECTED_OK
    `,
    {
      GH_CALL_LOG: releaseCallLog("invalid-assets"),
      MOCK_ASSET_BODY: body,
      MOCK_ASSETS_JSON: JSON.stringify([
        { ...asset, size: 0, digest: "sha256:not-a-digest" },
      ]),
      MOCK_RELEASES_JSON: JSON.stringify([draft]),
    },
  );
  assert.equal(
    invalidMetadata.status,
    0,
    `${invalidMetadata.stdout}\n${invalidMetadata.stderr}`,
  );
  assert.match(invalidMetadata.stdout, /INVALID_ASSET_METADATA_REJECTED_OK/);
});

test("publication stays draft until remote validation and a final live guard", () => {
  const cleanupIndex = releaseWorkflow.indexOf(
    "Reconcile stale assets in the hidden draft",
  );
  const unsignedUploadIndex = releaseWorkflow.indexOf(
    "Upload exact unsigned assets to draft release",
  );
  const signedUploadIndex = releaseWorkflow.indexOf(
    "Upload exact signed assets and root updater feed to draft release",
  );
  const validateIndex = releaseWorkflow.indexOf(
    "Re-download and validate complete draft release",
  );
  const promoteIndex = releaseWorkflow.indexOf(
    "Publish and promote the validated draft atomically",
  );
  assert.ok(cleanupIndex > 0 && cleanupIndex < unsignedUploadIndex);
  assert.ok(unsignedUploadIndex < signedUploadIndex);
  assert.ok(signedUploadIndex < validateIndex);
  assert.ok(validateIndex < promoteIndex);
  assert.match(
    releaseWorkflow.slice(cleanupIndex, unsignedUploadIndex),
    /load_release_by_id[\s\S]*?\bdraft\b[\s\S]*?list_release_assets[\s\S]*?--method DELETE/,
  );
  assert.match(
    releaseWorkflow.slice(unsignedUploadIndex, validateIndex),
    /draft: true[\s\S]*?make_latest: false[\s\S]*?draft: true[\s\S]*?make_latest: false/,
  );
  for (const uploadBlock of [
    releaseWorkflow.slice(unsignedUploadIndex, signedUploadIndex),
    releaseWorkflow.slice(signedUploadIndex, validateIndex),
  ]) {
    assert.match(
      uploadBlock,
      /name: \$\{\{ needs\.metadata\.outputs\.public_version \}\}/,
    );
    assert.doesNotMatch(uploadBlock, /name: sortOfRemoteNG/);
  }
  assert.match(
    releaseWorkflow.slice(unsignedUploadIndex, signedUploadIndex),
    /id: upload_unsigned/,
  );
  assert.match(
    releaseWorkflow.slice(signedUploadIndex, validateIndex),
    /id: upload_signed/,
  );
  assert.match(
    releaseWorkflow,
    /UNSIGNED_UPLOAD_RELEASE_ID: \$\{\{ steps\.upload_unsigned\.outputs\.id \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /SIGNED_UPLOAD_RELEASE_ID: \$\{\{ steps\.upload_signed\.outputs\.id \}\}/,
  );
  const stagedIdentity = releaseWorkflow.slice(
    releaseWorkflow.indexOf("Resolve immutable staged release identity"),
    validateIndex,
  );
  assert.match(stagedIdentity, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(
    stagedIdentity,
    /if resolve_release_by_tag[\s\S]*?then[\s\S]*?list_release_id=.*?[\s\S]*?else\s+status=\$\?[\s\S]*?\[ "\$status" -eq 44 \]/,
  );
  assert.doesNotMatch(releaseWorkflow, /releases\/tags\/\$PUBLIC_TAG/);
  assert.doesNotMatch(releaseWorkflow, /gh release download "\$PUBLIC_TAG"/);
  assert.match(
    releaseWorkflow.slice(validateIndex, promoteIndex),
    /RELEASE_ID: \$\{\{ steps\.staged_release\.outputs\.release_id \}\}[\s\S]*?expected_asset_count=22[\s\S]*?expected_asset_count=33[\s\S]*?download_release_assets "\$RELEASE_ID"[\s\S]*?verify-published-release-assets\.mjs/,
  );
  const promotion = releaseWorkflow.slice(promoteIndex);
  assertOrdered(
    promotion,
    "source_guard=passed",
    "promote_release_by_id",
    "the live source guard must pass before release promotion",
  );
  assert.match(
    releaseIdHelperProgram(),
    /promote_release_by_id\(\)[\s\S]*?releases\/\$release_id[\s\S]*?-F draft=false[\s\S]*?-f make_latest=true/,
  );
  assert.match(
    releaseWorkflow,
    /Summarize idempotent production no-op[\s\S]*?no_op == 'true'/,
  );
});

test("every release mutation is downstream of exact snapshot and source guards", () => {
  const liveGuardIndex = releaseWorkflow.indexOf(
    "Recheck live monotonic release state before publication",
  );
  const firstReleaseMutation = releaseWorkflow.indexOf(
    "Reconcile stale assets in the hidden draft",
  );
  const finalGuardIndex = releaseWorkflow.indexOf(
    "Publish and promote the validated draft atomically",
  );
  const finalPromotionIndex = releaseWorkflow.indexOf(
    "promote_release_by_id",
    finalGuardIndex,
  );
  assert.ok(liveGuardIndex > 0 && liveGuardIndex < firstReleaseMutation);
  assert.ok(
    finalGuardIndex > firstReleaseMutation &&
      finalGuardIndex < finalPromotionIndex,
  );
  assert.match(
    releaseWorkflow.slice(liveGuardIndex, firstReleaseMutation),
    /source_guard=passed/,
  );
  assert.match(
    releaseWorkflow.slice(finalGuardIndex, finalPromotionIndex),
    /source_guard=passed/,
  );
  assert.match(
    releaseWorkflow,
    /Verify immutable release snapshot integrity[\s\S]*?id: verify_snapshot/,
  );
});
