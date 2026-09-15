import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The HTTPS fixture served by compose service `test-dsm-web`, forked on a free
// port with a throwaway certificate from scripts/ci/e2e-http-fixtures.mjs.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
let tlsDir: string;
let ca: Buffer;
let child: ChildProcess | undefined;
let port = 0;

interface Reply {
  status: number;
  type: string;
  text: string;
}

function request(
  method: "GET" | "HEAD" | "POST",
  pathname: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "127.0.0.1", port, path: pathname, method, ca, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers["content-type"] ?? ""),
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const json = async (reply: Promise<Reply>) => JSON.parse((await reply).text);
const form = (params: Record<string, string>) =>
  request("POST", "/webapi/entry.cgi", new URLSearchParams(params).toString(), {
    "Content-Type": "application/x-www-form-urlencoded",
  });

beforeAll(async () => {
  tlsDir = mkdtempSync(path.join(os.tmpdir(), "sorng-dsm-web-"));
  execFileSync(
    process.execPath,
    [path.join(repo, "scripts/ci/e2e-http-fixtures.mjs"), "prepare", tlsDir],
    { stdio: "pipe" },
  );
  ca = readFileSync(path.join(tlsDir, "ssl", "server.crt"));
  const server = fork(path.join(here, "server.mjs"), [], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      TLS_CERT: path.join(tlsDir, "ssl", "server.crt"),
      TLS_KEY: path.join(tlsDir, "ssl", "server.key"),
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child = server;
  port = await new Promise<number>((resolve, reject) => {
    let stderr = "";
    server.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    server.once("message", (message: { type?: string; port?: number }) =>
      message.type === "dsm-web-ready" && message.port
        ? resolve(message.port)
        : reject(new Error(`unexpected message ${JSON.stringify(message)}`)),
    );
    server.once("exit", (code) =>
      reject(new Error(`fixture exited ${code}: ${stderr}`)),
    );
  });
}, 30_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child!.once("exit", resolve));
    child.kill();
    await exited;
  }
  if (tlsDir) rmSync(tlsDir, { recursive: true, force: true });
});

describe("synthetic DSM website HTTPS fixture", () => {
  it("serves the DSM document at both reviewed paths and records each load", async () => {
    await json(request("POST", "/__fixture/reset?variant=standard"));
    expect(await json(request("GET", "/__fixture/health"))).toEqual({
      status: "ok",
      variant: "standard",
    });

    for (const pathname of ["/", "/webman/index.cgi"]) {
      const page = await request("GET", pathname);
      expect(page.status).toBe(200);
      expect(page.type).toContain("text/html");
      expect(page.text).toMatch(/<head>[\s\S]*<\/head>/);
      // Scripts run in this order before the proxy's injection at </body>.
      const order = [
        "/webman/dsm-runtime.js",
        "/webman/fixture-config.js",
        "/webman/modules/boot.js?chunk=1",
        "/webman/app.js",
        "</body>",
      ].map((marker) => page.text.indexOf(marker));
      expect(order.every((index) => index > 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    const head = await request("HEAD", "/", undefined, {
      "Sec-Fetch-Dest": "iframe",
    });
    expect([head.status, head.text]).toEqual([200, ""]);
    const hits = await json(request("GET", "/__fixture/hits"));
    expect(hits.documents).toEqual([
      expect.objectContaining({ method: "GET", path: "/", dest: null }),
      expect.objectContaining({ method: "GET", path: "/webman/index.cgi" }),
      expect.objectContaining({ method: "HEAD", path: "/", dest: "iframe" }),
    ]);
  });

  it("serves an evaluable DSM runtime and a per-variant timeline", async () => {
    const runtime = await request("GET", "/webman/dsm-runtime.js");
    expect(runtime.type).toContain("javascript");
    const defined = new Function(
      `${runtime.text}\nreturn [typeof createDsmMarkup, typeof createDsmPage];`,
    )();
    expect(defined).toEqual(["function", "function"]);

    const expectations = {
      standard: ["vue-router-slash-normalisation", "", 0],
      slow: ["quickconnect-slow-boot-splash", "#/", 16_000],
      otp: ["vue-router-slash-normalisation", "", 0],
    } as const;
    for (const [variant, [timeline, hash, delay]] of Object.entries(
      expectations,
    )) {
      const scenario = await json(
        request("POST", `/__fixture/reset?variant=${variant}`),
      );
      expect(scenario).toMatchObject({
        variant,
        timeline,
        bootChunkDelayMs: delay,
      });
      const config = await request("GET", "/webman/fixture-config.js");
      const value = JSON.parse(
        config.text
          .replace(/^window\.__DSM_FIXTURE__ = /, "")
          .replace(/;\n$/, ""),
      );
      expect(value.variant).toBe(variant);
      expect(value.timeline).toMatchObject({ name: timeline, hash });
    }
  });

  it("answers the DSM login API and records submissions without secret values", async () => {
    const { account } = await json(
      request("POST", "/__fixture/reset?variant=standard"),
    );
    expect(
      await json(
        form({
          api: "SYNO.API.Auth.Type",
          method: "get",
          account: account.username,
        }),
      ),
    ).toEqual({ success: true, data: [{ type: "passwd" }] });
    expect(
      await json(
        form({
          api: "SYNO.API.Auth",
          method: "login",
          account: account.username,
          passwd: account.password,
        }),
      ),
    ).toMatchObject({ success: true, data: { sid: "synthetic-dsm-session" } });
    expect(
      await json(
        form({
          api: "SYNO.API.Auth",
          method: "login",
          account: account.username,
          passwd: "wrong",
        }),
      ),
    ).toEqual({ success: false, error: { code: 400 } });
    expect(
      await json(
        request("GET", "/webapi/entry.cgi?api=SYNO.API.Info&method=query"),
      ),
    ).toEqual({ success: false, error: { code: 102 } });

    const hits = await json(request("GET", "/__fixture/hits"));
    expect(hits.authType).toEqual([
      expect.objectContaining({ method: "POST", accountMatches: true }),
    ]);
    expect(
      hits.login.map((entry: { outcome: string }) => entry.outcome),
    ).toEqual(["signed-in", "rejected"]);
    expect(hits.other).toEqual([
      expect.objectContaining({ api: "SYNO.API.Info", method: "GET" }),
    ]);
    expect(JSON.stringify(hits)).not.toContain(account.password);
  });

  it("requires a 2FA code in the otp variant and never accepts one", async () => {
    const { account, expected } = await json(
      request("POST", "/__fixture/reset?variant=otp"),
    );
    expect(expected).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
      handoff: "otp",
    });
    const login = {
      api: "SYNO.API.Auth",
      method: "login",
      account: account.username,
      passwd: account.password,
    };
    expect(await json(form(login))).toMatchObject({
      success: false,
      error: { code: 403 },
    });
    expect(await json(form({ ...login, otp_code: "000000" }))).toEqual({
      success: false,
      error: { code: 404 },
    });
    const hits = await json(request("GET", "/__fixture/hits"));
    expect(
      hits.login.map((entry: { outcome: string; otpCode: boolean }) => [
        entry.outcome,
        entry.otpCode,
      ]),
    ).toEqual([
      ["otp-required", false],
      ["otp-rejected", true],
    ]);
  });

  it("chains boot chunks and holds them only in the slow variant", async () => {
    await json(request("POST", "/__fixture/reset?variant=standard"));
    // Chunk 1 writes chunk 2, so a preload scanner cannot fetch both at once.
    expect((await request("GET", "/webman/modules/boot.js?chunk=1")).text).toBe(
      `document.write('<script src="/webman/modules/boot.js?chunk=2"><\\/script>');\n`,
    );
    expect((await request("GET", "/webman/modules/boot.js?chunk=2")).text).toBe(
      "/* synthetic DSM boot chunk */\n",
    );

    await json(request("POST", "/__fixture/reset?variant=slow"));
    const pending = request("GET", "/webman/modules/boot.js?chunk=1");
    const early = await Promise.race([
      pending.then(() => "answered"),
      new Promise((resolve) => setTimeout(() => resolve("held"), 750)),
    ]);
    expect(early).toBe("held");
    pending.catch(() => undefined);
    const hits = await json(request("GET", "/__fixture/hits"));
    expect(hits.bootChunks).toEqual([expect.objectContaining({ chunk: "1" })]);
  });

  it("records closed page milestones and rejects malformed ones", async () => {
    await json(request("POST", "/__fixture/reset?variant=standard"));
    const post = (value: unknown) =>
      request("POST", "/webman/fixture-event.cgi", JSON.stringify(value), {
        "Content-Type": "application/json",
      });
    expect(
      (await post({ event: "step", detail: "route #/signin", t: 12 })).status,
    ).toBe(200);
    expect((await post({ event: "Bad Event" })).status).toBe(400);
    expect(
      (await post({ event: "step", detail: "<script>", t: 1 })).status,
    ).toBe(200);
    expect(
      (await request("POST", "/__fixture/reset?variant=nope")).status,
    ).toBe(400);
    expect((await request("GET", "/missing")).status).toBe(404);

    const hits = await json(request("GET", "/__fixture/hits"));
    expect(
      hits.page.map(
        (entry: { event: string; detail: string | null; t: number }) => [
          entry.event,
          entry.detail,
          entry.t,
        ],
      ),
    ).toEqual([
      ["step", "route #/signin", 12],
      ["step", null, 1],
    ]);
  });
});
