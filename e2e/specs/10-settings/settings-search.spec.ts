import {
  S,
  settingsTab,
  settingsSearchResultFor,
  settingAnchor,
} from "../../helpers/selectors";
import {
  resetAppState,
  createCollection,
  openSettings,
  closeSettings,
} from "../../helpers/app";

/**
 * Settings search — searching by **value**, not just by label.
 *
 * This is the capability t75 delivered and the one the user actually asked for:
 * "possible values, keywords and etc related to settings in the settings
 * themselves". Before t75 every query below returned zero results — four whole
 * tabs (`vpn`, `api`, `ai`, `recovery`) had no index entry at all, and none of
 * the 107 option/select controls had its values indexed.
 *
 * Each test therefore picks a setting whose **label does not contain the
 * query** — `wireguard` finds "Default VPN Type", `AES` finds "Algorithm",
 * `self-signed` finds "Certificate Mode" — so a pass can only come from the
 * `values` field, never from a label substring match.
 *
 * Three things are asserted end to end:
 *
 * 1. the owning tab appears in the search-filtered sidebar (and non-matching
 *    tabs disappear);
 * 2. clicking the result switches to that tab — only one tab is mounted at a
 *    time (`SettingsDialog/index.tsx`), so the anchor's presence proves it;
 * 3. `useSettingHighlight` actually resolved the anchor — the highlighted
 *    element carries the queried `data-setting-key` and is in the viewport.
 *
 * (3) is what makes this spec able to fail: an index entry naming a key no
 * control renders scrolls to nothing, which was true of 82 entries before t75.
 */

/**
 * `useSettingHighlight` tags the element ~100 ms after the click and untags it
 * `HIGHLIGHT_MS` (2 s) later, so the wait has to poll tightly inside that
 * window rather than sit on the default interval.
 */
const HIGHLIGHT_TIMEOUT = 4_000;
const HIGHLIGHT_POLL = 50;

/** A setting rendered only by the `general` tab, which opens by default. */
const GENERAL_ANCHOR = settingAnchor("confirmMainAppClose");

async function search(query: string): Promise<void> {
  const input = await $(S.settingsSearch);
  await input.waitForDisplayed({ timeout: 5_000 });
  await input.setValue(query);
  await browser.pause(400);
}

/** ids of the tabs currently listed in the (filtered) sidebar. */
async function visibleTabIds(): Promise<string[]> {
  const tabs = await $$(S.settingsTabButton);
  const ids: string[] = [];
  for (const tab of tabs) {
    const testId = (await tab.getAttribute("data-testid")) ?? "";
    ids.push(testId.replace("settings-tab-", ""));
  }
  return ids;
}

/**
 * Click a tab in the filtered sidebar, then the search result for `settingKey`
 * underneath it, and assert the highlight landed on that exact control.
 */
async function openResult(tabId: string, settingKey: string): Promise<void> {
  const tab = await $(settingsTab(tabId));
  await tab.waitForDisplayed({ timeout: 5_000 });
  await tab.click();

  const result = await $(settingsSearchResultFor(settingKey));
  await result.waitForDisplayed({ timeout: 5_000 });
  await result.click();

  // The tab switched: only the active tab is mounted, so this anchor exists
  // only while that panel is on screen.
  const anchor = await $(settingAnchor(settingKey));
  await anchor.waitForExist({ timeout: 5_000 });

  // The result navigated somewhere: the highlight resolved to this control.
  const highlight = await $(S.settingsSearchHighlight);
  await highlight.waitForExist({
    timeout: HIGHLIGHT_TIMEOUT,
    interval: HIGHLIGHT_POLL,
  });
  expect(await highlight.getAttribute("data-setting-key")).toBe(settingKey);
  expect(await highlight.isDisplayed({ withinViewport: true })).toBe(true);
}

describe("Settings — search by value", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection("Settings Search Test");
  });

  it('finds the VPN tab from the value "wireguard"', async () => {
    await openSettings();

    // The VPN tab is not mounted yet, and had zero index entries before t75.
    expect(
      await (await $(settingAnchor("vpnSettings.defaultVpnType"))).isExisting(),
    ).toBe(false);
    expect(await (await $(GENERAL_ANCHOR)).isExisting()).toBe(true);

    await search("wireguard");

    const ids = await visibleTabIds();
    expect(ids).toContain("vpn");
    expect(ids).not.toContain("general");
    expect(ids.length).toBeLessThan(27);

    // "Default VPN Type" contains neither "wireguard" in its label nor in its
    // description — it matches purely on its indexed option values.
    await openResult("vpn", "vpnSettings.defaultVpnType");

    expect(await (await $(GENERAL_ANCHOR)).isExisting()).toBe(false);

    await closeSettings();
  });

  it('finds the encryption algorithm from the value "AES"', async () => {
    await openSettings();
    await search("AES");

    const ids = await visibleTabIds();
    expect(ids).toContain("security");
    expect(ids).not.toContain("general");

    // Labelled "Algorithm"; only its AES-256-GCM/AES-256-CBC option values
    // carry the query string.
    await openResult("security", "encryptionAlgorithm");

    await closeSettings();
  });

  it('finds the API certificate mode from the value "self-signed"', async () => {
    await openSettings();
    await search("self-signed");

    // The narrowest query in the suite: one tab, one result. The `api` tab was
    // entirely absent from the index before t75.
    const ids = await visibleTabIds();
    expect(ids).toEqual(["api"]);

    // Labelled "Certificate Mode"; "Self-Signed" is one of its option labels,
    // and the hyphen only matches because the matcher squashes punctuation.
    await openResult("api", "restApi.sslMode");

    await closeSettings();
  });

  it('finds the theme setting from the value "dark"', async () => {
    await openSettings();
    await search("dark");

    const ids = await visibleTabIds();
    expect(ids).toContain("theme");
    expect(ids).not.toContain("general");

    await openResult("theme", "theme");

    await closeSettings();
  });

  it("shows the empty state for a query that matches nothing", async () => {
    await openSettings();
    await search("zzqqxx nonsense query");

    expect(await visibleTabIds()).toEqual([]);

    const dialog = await $(S.settingsDialog);
    expect(await dialog.getText()).toContain("No settings match");

    // Clearing the query restores the full, unfiltered sidebar.
    const input = await $(S.settingsSearch);
    await input.clearValue();
    await browser.pause(400);
    const restored = await visibleTabIds();
    expect(restored).toContain("general");
    expect(restored).toContain("vpn");
    expect(restored.length).toBeGreaterThan(20);

    await closeSettings();
  });
});
