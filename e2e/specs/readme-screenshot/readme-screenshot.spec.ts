import fs from "node:fs";
import path from "node:path";
import {
  assertCaptureIsSettled,
  readLaunchArgs,
  renderReadmeTerminal,
  saveReadmeScreenshot,
  seedReadmeDemo,
  setReadmeViewport,
  settleReadmeCapture,
} from "../../helpers/readme-screenshot";

const phase = process.env.README_CAPTURE_PHASE;
const seedFile = process.env.README_CAPTURE_SEED_FILE;
const screenshotPath = process.env.README_CAPTURE_OUTPUT;

describe("README screenshot", () => {
  if (phase === "seed") {
    it("persists the deterministic collection and SSH fixture", async () => {
      if (!seedFile) {
        throw new Error(
          "README_CAPTURE_SEED_FILE is required during seed phase",
        );
      }

      const seed = await seedReadmeDemo();
      const resolvedSeedFile = path.resolve(seedFile);
      fs.mkdirSync(path.dirname(resolvedSeedFile), { recursive: true });
      fs.writeFileSync(
        resolvedSeedFile,
        `${JSON.stringify(seed, null, 2)}\n`,
        "utf8",
      );
    });
    return;
  }

  if (phase === "capture") {
    it("relaunches directly into the deterministic connected terminal", async () => {
      if (!screenshotPath) {
        throw new Error(
          "README_CAPTURE_OUTPUT is required during capture phase",
        );
      }

      const expectedCollectionId = process.env.README_COLLECTION_ID;
      const expectedConnectionId = process.env.README_CONNECTION_ID;
      if (!expectedCollectionId || !expectedConnectionId) {
        throw new Error(
          "README collection and connection IDs are required during capture phase",
        );
      }

      const launchArgs = await readLaunchArgs();
      expect(launchArgs.collection_id).toBe(expectedCollectionId);
      expect(launchArgs.connection_id).toBe(expectedConnectionId);

      await setReadmeViewport();
      await renderReadmeTerminal();
      await settleReadmeCapture();
      await assertCaptureIsSettled();
      await saveReadmeScreenshot(screenshotPath);
    });
    return;
  }

  it("requires an explicit capture phase", () => {
    throw new Error(
      `README_CAPTURE_PHASE must be "seed" or "capture"; received ${String(phase)}`,
    );
  });
});
