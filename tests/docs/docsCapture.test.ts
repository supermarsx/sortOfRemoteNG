import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { startDocsServer } from "../../scripts/docs-visual-capture.mjs";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
it("serves built docs only under the real Pages base path with module MIME types", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sorng-docs-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "index.html"), "<h1>Fixture docs</h1>");
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "site.js"), "export {};");
  const server = await startDocsServer(root);
  cleanups.push(server.close);
  expect(await (await fetch(`${server.url}/`)).text()).toBe(
    "<h1>Fixture docs</h1>",
  );
  expect(
    (await fetch(`${server.url}/assets/site.js`)).headers.get("content-type"),
  ).toBe("text/javascript");
  expect((await fetch(`${server.url}/../outside`)).status).toBe(404);
  expect((await fetch(`${server.url}/%2e%2e%2foutside`)).status).toBe(403);
  expect((await fetch(`${server.url}/missing`)).status).toBe(404);
});
