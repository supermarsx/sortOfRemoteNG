/** Isolated local native-adapter proof. Test keys stay in memory and child env. */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = `sorng-vault-inline-${randomUUID()}`;
const password = "isolated-fixture-password",
  passphrase = "isolated-fixture-key-passphrase";
const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const good = pair(),
  bad = pair();
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const word = (value) => {
  const bytes = Buffer.from(value);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  return Buffer.concat([size, bytes]);
};
const integer = (value) => {
  const bytes = Buffer.from(value, "base64url");
  return word(
    bytes[0] & 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes,
  );
};
const jwk = good.publicKey.export({ format: "jwk" });
const publicKey = `ssh-rsa ${Buffer.concat([word("ssh-rsa"), integer(jwk.e), integer(jwk.n)]).toString("base64")} isolated-fixture`;
const ecJwk = ec.publicKey.export({ format: "jwk" });
const ecPublic = `ecdsa-sha2-nistp256 ${Buffer.concat([word("ecdsa-sha2-nistp256"), word("nistp256"), word(Buffer.concat([Buffer.from([4]), Buffer.from(ecJwk.x, "base64url"), Buffer.from(ecJwk.y, "base64url")]))]).toString("base64")}`;
const docker = (...args) => {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  if (result.status !== 0)
    throw new Error(`Docker fixture command failed: ${args[0]}`);
  return result.stdout.trim();
};
let created = false;
try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::2222",
    "--publish",
    "127.0.0.1::2223",
    "--tmpfs",
    "/config",
    "--env",
    "USER_NAME=vaultfixture",
    "--env",
    `USER_PASSWORD=${password}`,
    "--env",
    "PASSWORD_ACCESS=true",
    "--env",
    "SUDO_ACCESS=false",
    "--env",
    `PUBLIC_KEY=${publicKey}`,
    "lscr.io/linuxserver/openssh-server:latest",
  );
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const check = spawnSync(
      "docker",
      ["exec", name, "test", "-f", "/config/sshd/sshd_config"],
      { windowsHide: true, stdio: "ignore" },
    );
    if (
      check.status === 0 &&
      spawnSync("docker", ["exec", name, "nc", "-z", "localhost", "2222"], {
        windowsHide: true,
        stdio: "ignore",
      }).status === 0
    ) {
      ready = true;
      break;
    }
    await delay(1000);
  }
  if (!ready) throw new Error("Isolated SSH fixture did not become ready.");
  docker(
    "exec",
    "--detach",
    name,
    "/usr/sbin/sshd.pam",
    "-D",
    "-e",
    "-f",
    "/config/sshd/sshd_config",
    "-p",
    "2223",
    "-o",
    "AuthenticationMethods=publickey,password",
  );
  const port = (key) => {
    const value = docker("port", name, key);
    if (!/^127\.0\.0\.1:\d+$/u.test(value))
      throw new Error("Fixture port must remain loopback-only.");
    return value.split(":")[1];
  };
  const env = {
    ...process.env,
    SSH_HOST: "127.0.0.1",
    SSH_PORT: port("2222/tcp"),
    SSH_MULTI_PORT: port("2223/tcp"),
    SSH_USER: "vaultfixture",
    SSH_PASSWORD: password,
    SSH_KEY_PASSPHRASE: passphrase,
    SSH_INLINE_KEY: good.privateKey
      .export({
        format: "pem",
        type: "pkcs8",
        cipher: "aes-256-cbc",
        passphrase,
      })
      .toString(),
    SSH_BAD_INLINE_KEY: bad.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    SSH_LEGACY_RSA_KEY: good.privateKey
      .export({
        format: "pem",
        type: "pkcs1",
        cipher: "aes-256-cbc",
        passphrase,
      })
      .toString(),
    SSH_EC_INLINE_KEY: ec.privateKey
      .export({
        format: "pem",
        type: "sec1",
        cipher: "aes-256-cbc",
        passphrase,
      })
      .toString(),
    SSH_EC_PKCS8_KEY: ec.privateKey
      .export({
        format: "pem",
        type: "pkcs8",
        cipher: "aes-256-cbc",
        passphrase,
      })
      .toString(),
    SSH_EC_PUBLIC_KEY: ecPublic,
    SSH_LEGACY_RSA_3DES_KEY: good.privateKey
      .export({
        format: "pem",
        type: "pkcs1",
        cipher: "des-ede3-cbc",
        passphrase,
      })
      .toString(),
  };
  console.log(
    "Running native inline-key and key-plus-password tests against isolated loopback SSH.",
  );
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "../scripts/native-build-env.mjs",
        "cargo",
        "test",
        "-p",
        "sorng-ssh",
        "--features",
        "docker-e2e",
        "--test",
        "vault_inline_key",
        "--locked",
        "--target-dir",
        "../.artifacts/cargo-synology",
        "--",
        "--ignored",
      ],
      {
        cwd: path.join(root, "src-tauri"),
        env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.on("exit", resolve);
    child.on("error", () => resolve(1));
  });
  for (const key of [
    "SSH_INLINE_KEY",
    "SSH_BAD_INLINE_KEY",
    "SSH_PASSWORD",
    "SSH_KEY_PASSPHRASE",
    "SSH_LEGACY_RSA_KEY",
    "SSH_LEGACY_RSA_3DES_KEY",
    "SSH_EC_INLINE_KEY",
    "SSH_EC_PKCS8_KEY",
  ])
    delete env[key];
  if (result !== 0) throw new Error("Native inline-key fixture failed.");
} finally {
  if (created) {
    docker("rm", "--force", name);
    console.log(
      "Removed only the isolated SSH test container; no volumes or other containers changed.",
    );
  }
}
