import { resetAppState, createCollection } from "../../helpers/app";

/**
 * t49 — the database open/switch loading animation.
 *
 * The treatment is deliberately short-lived: the handoff is one
 * --animation-duration (200ms) and the panel unmounts the moment the load
 * resolves. A WebDriver poll loop round-trips slower than that and would
 * flake or miss it outright. So we install a MutationObserver in the page,
 * click for real, and read back the recorded timeline afterwards. Nothing is
 * stubbed — this observes the real app driving the real hook.
 */

type Frame = {
  t: number;
  announcement: string;
  rows: {
    name: string;
    busy: string | null;
    handoff: boolean;
    sweep: boolean;
    bystander: boolean;
    text: string;
  }[];
};

const ROW_SELECTOR = "div[aria-busy]";

async function installRecorder(): Promise<void> {
  await browser.execute((rowSelector: string) => {
    const w = globalThis as unknown as {
      __t49frames?: unknown[];
      __t49observer?: MutationObserver;
      __t49start?: number;
    };
    w.__t49frames = [];
    w.__t49start = performance.now();

    const snapshot = () => {
      const announcementEl = document.querySelector(
        '[data-testid="database-loading-announcement"]',
      );
      const rows = [...document.querySelectorAll(rowSelector)].map((row) => {
        const cls = row.className;
        return {
          name: row.textContent?.trim().split("\n")[0] ?? "",
          busy: row.getAttribute("aria-busy"),
          handoff: cls.includes("animate-row-handoff"),
          sweep: row.querySelector(".animate-row-sweep") !== null,
          bystander: cls.includes("pointer-events-none"),
          text: row.textContent?.trim() ?? "",
        };
      });
      w.__t49frames!.push({
        t: Math.round(performance.now() - w.__t49start!),
        announcement: announcementEl?.textContent ?? "",
        rows,
      });
    };

    snapshot();
    const observer = new MutationObserver(snapshot);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    w.__t49observer = observer;
  }, ROW_SELECTOR);
}

async function readFrames(): Promise<Frame[]> {
  return browser.execute(() => {
    const w = globalThis as unknown as {
      __t49frames?: Frame[];
      __t49observer?: MutationObserver;
    };
    w.__t49observer?.disconnect();
    return (w.__t49frames ?? []) as Frame[];
  }) as unknown as Frame[];
}

async function openDatabasePanel(): Promise<void> {
  const create = await $('[data-testid="database-create"]');
  if (await create.isDisplayed().catch(() => false)) {
    return;
  }
  const toolbarButton = await $('[data-testid="toolbar-collection"]');
  await toolbarButton.waitForClickable({ timeout: 10_000 });
  await toolbarButton.click();
  await create.waitForDisplayed({ timeout: 10_000 });
}

async function rowByName(name: string) {
  return $(`//div[@aria-busy][.//*[normalize-space(text())="${name}"]]`);
}

/**
 * The database list grows across runs, and a row low in the list lands under
 * the Next.js dev-tools badge, which swallows the click. Centre it first.
 */
async function clickRow(name: string): Promise<void> {
  const row = await rowByName(name);
  await row.waitForExist({ timeout: 10_000 });
  await row.scrollIntoView({ block: "center" });
  const button = await row.$("button");
  await button.waitForClickable({ timeout: 10_000 });
  await button.click();
}

describe("Database loading animation (t49)", () => {
  before(async () => {
    await resetAppState();
  });

  it("(b) SWITCH: hands off the outgoing row and sweeps the incoming one", async () => {
    // Two unencrypted databases. createCollection leaves the last one open,
    // so clicking the first is a genuine switch with one already open.
    await createCollection("Alpha DB");
    await createCollection("Beta DB");

    await openDatabasePanel();
    await installRecorder();

    await clickRow("Alpha DB");

    // Let the load resolve; the panel unmounts on success.
    await browser.pause(2_000);
    const frames = await readFrames();

    console.log("=== SWITCH TIMELINE ===");
    console.log(JSON.stringify(frames, null, 2));

    const loadingFrames = frames.filter((f) =>
      f.rows.some((r) => r.busy === "true"),
    );
    expect(loadingFrames.length).toBeGreaterThan(0);

    // Incoming row: busy + sweep + "Switching to Alpha DB…"
    const incoming = loadingFrames.some((f) =>
      f.rows.some(
        (r) =>
          r.busy === "true" &&
          r.sweep &&
          r.text.includes("Switching to Alpha DB"),
      ),
    );
    expect(incoming).toBe(true);

    // Outgoing row: handoff + "Closing Beta DB…"
    const outgoing = loadingFrames.some((f) =>
      f.rows.some((r) => r.handoff && r.text.includes("Closing Beta DB")),
    );
    expect(outgoing).toBe(true);

    // Exactly one aria-live region, announcing the switch once.
    const announcements = new Set(
      frames.map((f) => f.announcement).filter((a) => a.length > 0),
    );
    expect([...announcements]).toEqual(["Switching to Alpha DB…"]);
  });

  it("(a) COLD OPEN: announces 'Opening' with no handoff row", async () => {
    await resetAppState();
    await createCollection("Solo DB");

    // Close the open database so the next select is a cold open.
    await openDatabasePanel();
    const closeBtn = await $('[data-testid="database-close"]');
    if (await closeBtn.isDisplayed().catch(() => false)) {
      await closeBtn.click();
      await browser.pause(500);
    }

    await openDatabasePanel();
    await installRecorder();

    await clickRow("Solo DB");
    await browser.pause(2_000);

    const frames = await readFrames();
    console.log("=== COLD OPEN TIMELINE ===");
    console.log(JSON.stringify(frames, null, 2));

    const announcements = new Set(
      frames.map((f) => f.announcement).filter((a) => a.length > 0),
    );
    expect([...announcements]).toEqual(["Opening Solo DB…"]);
    expect(frames.some((f) => f.rows.some((r) => r.handoff))).toBe(false);
  });
});
