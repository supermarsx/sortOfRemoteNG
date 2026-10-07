import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const resolve = (file) => new URL(`../../${file}`, import.meta.url);
const read = (file) => readFileSync(resolve(file), "utf8");

test("Kafka is absent from the locked graph and every former Cargo boundary", () => {
  for (const file of [
    "src-tauri/Cargo.lock",
    "src-tauri/Cargo.toml",
    "src-tauri/crates/sorng-app-domains/Cargo.toml",
    "src-tauri/crates/sorng-app-domains-ops/Cargo.toml",
    "src-tauri/crates/sorng-commands-ops/Cargo.toml",
    "src-tauri/crates/sorng-commands-ops-messaging/Cargo.toml",
  ]) {
    assert.doesNotMatch(read(file), /kafka/i, file);
  }
  for (const file of [
    "src-tauri/crates/sorng-kafka/Cargo.toml",
    "src-tauri/crates/sorng-commands-ops-messaging/src/kafka_commands.rs",
    "src-tauri/crates/sorng-commands-ops-messaging/src/kafka_commands/inner.rs",
    "scripts/probe-rdkafka-runtime.ps1",
    "src-tauri/native/ports/librdkafka/vcpkg.json",
  ]) {
    assert.equal(existsSync(resolve(file)), false, file);
  }
});

test("operations startup count excludes Kafka and RabbitMQ still owns its commands", () => {
  const startup = read("src-tauri/src/state_registry/ops.rs");
  assert.doesNotMatch(startup, /kafka/i);
  const count = Number(
    startup.match(/MANAGED_STATE_REGISTRATIONS: usize = (\d+);/)[1],
  );
  assert.equal(startup.split("app.manage(").length - 1, count);
  const inventory = JSON.parse(
    read("src-tauri/crates/sorng-commands-ops-messaging/commands.json"),
  );
  assert.equal(inventory.commands.length, 58);
  assert.ok(
    inventory.commands.every(({ path }) =>
      path.startsWith("rabbitmq_commands::"),
    ),
  );
  assert.doesNotMatch(
    read("src-tauri/crates/sorng-commands-ops-messaging/src/handler.rs"),
    /kafka/i,
  );
});

test("build, packaging and visible integration credits no longer advertise Kafka", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    ".github/workflows/coverage.yml",
    ".github/workflows/release.yml",
    ".github/workflows/cargo-update.yml",
    "Dockerfile.prod",
    "packaging/alpine/APKBUILD",
    "packaging/arch/PKGBUILD",
    "scripts/stage-windows-native-runtime.mjs",
    "src-tauri/native/vcpkg.json",
    "src/components/SettingsDialog/sections/AboutSettings.tsx",
    "src/components/SettingsDialog/settingsSearchIndex/about.ts",
    "src/i18n/glossary.json",
  ]) {
    // The CI command runs kafkaRemoval.node-test.mjs; that is a removal guard,
    // not a dependency or advertised capability.
    assert.doesNotMatch(
      read(file),
      /\b(?:sorng-kafka|librdkafka|rdkafka|kafka)\b/i,
      file,
    );
  }
});
