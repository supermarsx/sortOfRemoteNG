import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const releaseWorkflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const e2eWorkflow = readFileSync(
  new URL("../../.github/workflows/e2e.yml", import.meta.url),
  "utf8",
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
const opksshBinarySource = readFileSync(
  new URL("../../src-tauri/crates/sorng-opkssh/src/binary.rs", import.meta.url),
  "utf8",
);
const updaterSetupDocumentation = readFileSync(
  new URL("../../docs/release/updater-setup.md", import.meta.url),
  "utf8",
);
const workflowCall = releaseWorkflow.slice(
  releaseWorkflow.indexOf("  workflow_call:"),
  releaseWorkflow.indexOf("  workflow_dispatch:"),
);

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
    buildJob.indexOf("- name: Build native bundles with static Kafka"),
    buildJob.indexOf("- name: Notarize and staple macOS disk image"),
  );

  assert.match(buildJob, /Install JavaScript dependencies[\s\S]*?run: npm ci/);
  assert.match(tauriBuild, /tauriScript: npm run tauri/);
  assert.doesNotMatch(tauriBuild, /tauriScript:\s+(?:bun|pnpm|yarn)\b/);
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

test("resource controls preserve release features and signing inputs", () => {
  const releaseFeatures = releaseWorkflow.match(
    /^  RELEASE_FEATURES: >-\r?\n    ([^\r\n]+)$/m,
  )?.[1];
  assert.equal(
    releaseFeatures,
    "cert-auth,cloud,collab,db-mongo,db-mssql,db-mysql,db-postgres,db-redis,db-sqlite,kafka-static,logs-json,opkssh-vendored-wrapper,ops,platform,protocol-serial-dynamic,rdp,rdp-mf-decode,rdp-software-decode,rdp-snapshot,script-engine,tls-cert-details,vpn-softether",
  );
  assert.equal(
    (releaseWorkflow.match(/^  RELEASE_FEATURES:/gm) ?? []).length,
    1,
  );

  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const tauriBuild = buildJob.slice(
    buildJob.indexOf("- name: Build native bundles with static Kafka"),
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
    /args: >-\s+--target \$\{\{ matrix\.rust_target \}\}\s+--bundles \$\{\{ matrix\.bundles \}\}\s+--config src-tauri\/tauri\.release\.conf\.json\s+--features \$\{\{ env\.RELEASE_FEATURES \}\}\s+-- --no-default-features/,
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

  const portableStep = buildJob.slice(portableStart, macVerifyStart);
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
  for (const archivePath of [
    "sortOfRemoteNG.exe",
    ".portable",
    "resources/opkssh",
  ]) {
    assert.match(portableStep, new RegExp(archivePath.replaceAll(".", "\\.")));
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
  assert.match(
    releaseWorkflow,
    /Native Linux x64 and ARM64 AppImage, Debian, RPM, and Flatpak bundles are included, together with Windows x64 and ARM64 installers and portable archives\./,
  );
});

test("Linux release builds and validates native RPM and Flatpak assets on both architectures", () => {
  const buildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  build:"),
    releaseWorkflow.indexOf("  publish:"),
  );
  const nativePrerequisites = buildJob.slice(
    buildJob.indexOf("- name: Install native Linux build prerequisites"),
    buildJob.indexOf("- name: Install macOS static Kafka prerequisites"),
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
    ["LINUX_PACKAGE_MAIN_BINARY", "app"],
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
  assert.match(flatpakManifest, /cp -a resources \/app\/bin\/resources/);
  assert.match(flatpakManifest, /path: \.\.\/\.\.\/\.ci\/flatpak-payload/);
  assert.match(flatpakDesktop, /^Exec=sortOfRemoteNG$/m);
  assert.match(flatpakDesktop, /^Icon=com\.sortofremote\.ng$/m);
  assert.match(flatpakMetainfo, /<id>com\.sortofremote\.ng<\/id>/);
  assert.match(
    flatpakMetainfo,
    /<launchable type="desktop-id">com\.sortofremote\.ng\.desktop<\/launchable>/,
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
  assert.match(
    flatpakSetup,
    /test "\$\(flatpak-builder --version\)" = "flatpak-builder \$FLATPAK_BUILDER_VERSION"/,
  );
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
  assert.ok(
    buildJob.indexOf("- name: Build native bundles with static Kafka") <
      buildJob.indexOf(
        "- name: Install pinned Flatpak toolchain and GNOME runtime",
      ),
    "the GNOME runtime must not consume disk until after native bundles are built",
  );

  assert.match(
    preserveLinux,
    /executable="\$release_root\/app"[\s\S]*?install -m 0755 "\$executable" "\$payload\/sortOfRemoteNG"/,
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
    /test "\$\{FLATPAK_ID:-\}" = com\.sortofremote\.ng[\s\S]*?test -x \/app\/bin\/sortOfRemoteNG[\s\S]*?test -d \/app\/bin\/resources\/opkssh[\s\S]*?ldd \/app\/bin\/sortOfRemoteNG[\s\S]*?grep -F "not found"/,
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
  assert.equal(tauriConfig.productName, "sortOfRemoteNG");
  assert.deepEqual(tauriConfig.bundle.resources, {
    "crates/sorng-opkssh-vendor/bundle/opkssh/": "opkssh/",
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
  assert.match(releaseWorkflow, /expected_asset_count=31/);
  assert.doesNotMatch(updaterFeed, /\.(?:rpm|flatpak)/);
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
  const nativeBuildStart = buildJob.indexOf(
    "- name: Build native bundles with static Kafka",
  );

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
  assert.match(resourceStep, /sudo fallocate -l "\$swap_size_bytes" "\$swap_file"/);
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
    /Build native bundles with static Kafka[\s\S]*?env:[\s\S]*?TAURI_SIGNING_PRIVATE_KEY:/,
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
  assert.ok(
    createSnapshot.indexOf('[ "$SOURCE_GUARD" != "passed" ]') <
      createSnapshot.indexOf("git update-ref"),
    "monotonic source guard must fail before tag creation",
  );
  assert.ok(
    createSnapshot.indexOf("verify-release-snapshot.mjs") <
      createSnapshot.indexOf('push origin "refs/tags/$PUBLIC_TAG'),
    "new snapshots must verify before the immutable public tag is pushed",
  );
  assert.ok(
    releaseWorkflow.indexOf("Sign updater trust challenge") <
      releaseWorkflow.indexOf("git update-ref"),
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

test("updater setup documents the six canonical updater payload names", () => {
  for (const filename of [
    "sortOfRemoteNG_26.1.0_windows-x86_64-setup.exe",
    "sortOfRemoteNG_26.1.0_windows-aarch64-setup.exe",
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
  assert.match(
    updaterSetupDocumentation,
    /only package types compatible with the\s+feed payload may use them: Linux AppImage, Windows NSIS, and the macOS app\s+bundle/,
  );
  assert.match(
    updaterSetupDocumentation,
    /Debian, RPM, Flatpak, MSI, and the\s+architecture-matched Windows x64 and ARM64 portable ZIP builds therefore use\s+externally managed updates/,
  );
  assert.match(
    updaterSetupDocumentation,
    /flatpak install --user --reinstall \.\/sortOfRemoteNG_<version>_linux-<arch>\.flatpak/,
  );
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
    /RELEASE_ID: \$\{\{ steps\.staged_release\.outputs\.release_id \}\}[\s\S]*?expected_asset_count=22[\s\S]*?expected_asset_count=31[\s\S]*?download_release_assets "\$RELEASE_ID"[\s\S]*?verify-published-release-assets\.mjs/,
  );
  const promotion = releaseWorkflow.slice(promoteIndex);
  assert.ok(
    promotion.indexOf("source_guard=passed") <
      promotion.indexOf("promote_release_by_id"),
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
