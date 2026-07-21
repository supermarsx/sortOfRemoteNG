import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
const workflowCall = releaseWorkflow.slice(
  releaseWorkflow.indexOf("  workflow_call:"),
  releaseWorkflow.indexOf("  workflow_dispatch:"),
);

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

test("release matrix bounds Cargo parallelism below the workstation default", () => {
  const buildStart = releaseWorkflow.indexOf("  build:");
  const publishStart = releaseWorkflow.indexOf("  publish:");
  const buildJob = releaseWorkflow.slice(buildStart, publishStart);
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const buildSteps = buildJob.slice(buildJob.indexOf("    steps:"));
  const matrixDefinition = buildDefinition.slice(
    buildDefinition.indexOf("      matrix:"),
    buildDefinition.indexOf("    runs-on:"),
  );
  const jobsByArtifact = Object.fromEntries(
    matrixDefinition
      .split(/^          - artifact_id: /m)
      .slice(1)
      .map((entry) => {
        const [artifactId, ...entryLines] = entry.split("\n");
        const jobCount = entryLines
          .join("\n")
          .match(/^\s+cargo_build_jobs: (\d+)$/m)?.[1];
        return [artifactId.trim(), jobCount];
      }),
  );

  assert.match(cargoConfig, /^jobs = 28$/m);
  assert.deepEqual(jobsByArtifact, {
    "linux-x86_64": "1",
    "darwin-aarch64": "2",
    "darwin-x86_64": "2",
    "windows-x86_64": "2",
  });
  assert.match(
    buildDefinition,
    /^      CARGO_BUILD_JOBS: \$\{\{ matrix\.cargo_build_jobs \}\}$/m,
  );
  assert.equal(
    (releaseWorkflow.match(/^\s+CARGO_BUILD_JOBS:/gm) ?? []).length,
    1,
  );
  assert.doesNotMatch(buildJob, /CARGO_BUILD_JOBS:\s*["']?28/);
  assert.doesNotMatch(buildSteps, /CARGO_BUILD_JOBS/);
  assert.doesNotMatch(releaseWorkflow.slice(0, buildStart), /CARGO_BUILD_JOBS/);
  assert.doesNotMatch(releaseWorkflow.slice(publishStart), /CARGO_BUILD_JOBS/);
});

test("Linux release bounds final optimization, swap, and linking immediately before building", () => {
  const buildStart = releaseWorkflow.indexOf("  build:");
  const publishStart = releaseWorkflow.indexOf("  publish:");
  const buildJob = releaseWorkflow.slice(buildStart, publishStart);
  const buildDefinition = buildJob.slice(0, buildJob.indexOf("    steps:"));
  const resourceStepStart = buildJob.indexOf(
    "- name: Bound and inspect Linux release resources",
  );
  const nativeBuildStart = buildJob.indexOf(
    "- name: Build native bundles with static Kafka",
  );

  assert.ok(resourceStepStart >= 0);
  assert.ok(nativeBuildStart > resourceStepStart);

  const resourceStep = buildJob.slice(resourceStepStart, nativeBuildStart);
  assert.equal(
    resourceStep.trimEnd(),
    [
      "- name: Bound and inspect Linux release resources",
      "        if: matrix.platform == 'linux'",
      "        shell: bash",
      "        run: |",
      "          set -euo pipefail",
      '          linker_wrapper="$RUNNER_TEMP/sorng-linux-linker"',
      '          linker_probe_source="$RUNNER_TEMP/sorng-linux-linker-probe.c"',
      '          linker_probe_binary="$RUNNER_TEMP/sorng-linux-linker-probe"',
      '          swap_file="$RUNNER_TEMP/sorng-release.swap"',
      "          swap_size_bytes=$((16 * 1024 * 1024 * 1024))",
      "          disk_floor_bytes=$((32 * 1024 * 1024 * 1024))",
      "",
      "          # Linux hosted runners were lost twice under final release codegen.",
      "          # Keep 32 GiB of disk free for build outputs after adding bounded swap.",
      "          available_bytes=$(df -B1 --output=avail \"$RUNNER_TEMP\" | tail -n 1 | tr -d '[:space:]')",
      '          [[ "$available_bytes" =~ ^[0-9]+$ ]]',
      "          required_bytes=$((swap_size_bytes + disk_floor_bytes))",
      "          if (( available_bytes < required_bytes )); then",
      '            echo "::error::Linux release requires $required_bytes free bytes before provisioning swap; found $available_bytes."',
      "            exit 1",
      "          fi",
      '          if [ -e "$swap_file" ] || [ -L "$swap_file" ]; then',
      '            echo "::error::Refusing to replace unexpected pre-existing swap path $swap_file."',
      "            exit 1",
      "          fi",
      '          sudo fallocate -l "$swap_size_bytes" "$swap_file"',
      "          remaining_bytes=$(df -B1 --output=avail \"$RUNNER_TEMP\" | tail -n 1 | tr -d '[:space:]')",
      '          [[ "$remaining_bytes" =~ ^[0-9]+$ ]]',
      "          if (( remaining_bytes < disk_floor_bytes )); then",
      '            echo "::error::Linux release requires $disk_floor_bytes free bytes after provisioning swap; found $remaining_bytes."',
      "            exit 1",
      "          fi",
      '          sudo chmod 0600 "$swap_file"',
      '          test "$(stat -c \'%a\' "$swap_file")" = 600',
      '          test "$(stat -c \'%s\' "$swap_file")" -eq "$swap_size_bytes"',
      "          page_size_bytes=$(getconf PAGESIZE)",
      '          [[ "$page_size_bytes" =~ ^[0-9]+$ ]]',
      "          expected_active_swap_size=$((swap_size_bytes - page_size_bytes))",
      '          sudo mkswap "$swap_file"',
      '          sudo swapon "$swap_file"',
      "          active_swap_size=$(\n            sudo swapon --show=NAME,SIZE --bytes --noheadings --raw |\n              awk -v path=\"$swap_file\" '$1 == path { print $2 }'\n          )",
      '          test "$active_swap_size" -eq "$expected_active_swap_size"',
      "",
      "          # Hosted runners are ephemeral; keep the verified swap active through",
      "          # bundle staging so both LLVM and LLD retain the added headroom.",
      "",
      "          command -v clang-18",
      "          command -v ld.lld-18",
      "          /usr/bin/clang-18 --version",
      "          /usr/bin/ld.lld-18 --version",
      "",
      "          cat > \"$linker_wrapper\" <<'LINKER'",
      "          #!/usr/bin/env bash",
      "          set -euo pipefail",
      '          exec /usr/bin/clang-18 -fuse-ld=lld-18 -Wl,--threads=1 "$@"',
      "          LINKER",
      '          chmod 0755 "$linker_wrapper"',
      "",
      "          printf '%s\\n' 'int main(void) { return 0; }' > \"$linker_probe_source\"",
      '          linker_probe_output=$(\n            "$linker_wrapper" -Wl,-v "$linker_probe_source" -o "$linker_probe_binary" 2>&1\n          )',
      "          printf '%s\\n' \"$linker_probe_output\"",
      "          grep -Eq 'LLD 18(\\.|[[:space:]])' <<< \"$linker_probe_output\"",
      "          readelf -h \"$linker_probe_binary\" | grep -Eq 'Class:[[:space:]]+ELF64'",
      '          "$linker_probe_binary"',
      "",
      '          echo "CARGO_PROFILE_RELEASE_LTO=off" >> "$GITHUB_ENV"',
      '          echo "CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16" >> "$GITHUB_ENV"',
      '          echo "CARGO_PROFILE_RELEASE_OPT_LEVEL=1" >> "$GITHUB_ENV"',
      '          echo "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=$linker_wrapper" >> "$GITHUB_ENV"',
      "          free -h",
      '          df -h "$GITHUB_WORKSPACE"',
    ].join("\n"),
  );
  assert.equal(
    (releaseWorkflow.match(/CARGO_PROFILE_RELEASE_LTO/g) ?? []).length,
    1,
  );
  assert.equal(
    (releaseWorkflow.match(/CARGO_PROFILE_RELEASE_CODEGEN_UNITS/g) ?? [])
      .length,
    1,
  );
  assert.equal(
    (releaseWorkflow.match(/CARGO_PROFILE_RELEASE_OPT_LEVEL/g) ?? []).length,
    1,
  );
  assert.equal(
    (
      releaseWorkflow.match(/CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER/g) ??
      []
    ).length,
    1,
  );
  assert.doesNotMatch(
    buildDefinition,
    /CARGO_PROFILE_RELEASE_(?:LTO|CODEGEN_UNITS|OPT_LEVEL)|CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER/,
  );
  const outsideResourceStep =
    releaseWorkflow.slice(0, buildStart + resourceStepStart) +
    releaseWorkflow.slice(buildStart + nativeBuildStart);
  assert.doesNotMatch(
    outsideResourceStep,
    /sorng-release\.swap|\b(?:fallocate|mkswap|swapon)\b/,
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
    /add darwin-aarch64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_darwin-aarch64\.app\.tar\.gz"[\s\S]*?add darwin-x86_64 "sortOfRemoteNG_\$\{MACHINE_VERSION\}_darwin-x86_64\.app\.tar\.gz"/,
  );
  const signedUpload = releaseWorkflow.slice(
    releaseWorkflow.indexOf(
      "Upload exact signed assets and root updater feed to draft release",
    ),
    releaseWorkflow.indexOf("Re-download and validate complete draft release"),
  );
  for (const target of [
    "linux-x86_64.AppImage",
    "darwin-aarch64.app.tar.gz",
    "darwin-x86_64.app.tar.gz",
    "windows-x86_64-setup.exe",
  ]) {
    assert.match(
      signedUpload,
      new RegExp(`${target.replaceAll(".", "\\.")}\\.sig`),
    );
  }
  assert.match(signedUpload, /^\s+dist\/latest\.json$/m);
  assert.doesNotMatch(releaseWorkflow, /gh release delete-asset/);
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
    /\.draft == true[\s\S]*?--paginate[\s\S]*?--method DELETE/,
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
  const promotion = releaseWorkflow.slice(promoteIndex);
  assert.ok(
    promotion.indexOf("source_guard=passed") <
      promotion.indexOf("--method PATCH"),
  );
  assert.match(promotion, /-F draft=false/);
  assert.match(promotion, /-f make_latest=true/);
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
  const finalPatchIndex = releaseWorkflow.indexOf(
    "--method PATCH",
    finalGuardIndex,
  );
  assert.ok(liveGuardIndex > 0 && liveGuardIndex < firstReleaseMutation);
  assert.ok(
    finalGuardIndex > firstReleaseMutation && finalGuardIndex < finalPatchIndex,
  );
  assert.match(
    releaseWorkflow.slice(liveGuardIndex, firstReleaseMutation),
    /source_guard=passed/,
  );
  assert.match(
    releaseWorkflow.slice(finalGuardIndex, finalPatchIndex),
    /source_guard=passed/,
  );
  assert.match(
    releaseWorkflow,
    /Verify immutable release snapshot integrity[\s\S]*?id: verify_snapshot/,
  );
});
