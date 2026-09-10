import { S } from "../../helpers/selectors";
import { selectCustomOption } from "../../helpers/forms";
import { resetAppState, createCollection } from "../../helpers/app";

/** Offline saved-editor smoke. No credentials, Connect clicks,
 * network requests, or live NAS acceptance claims. Backend behavior is covered
 * by isolated loopback Rust fixtures and scoped React IPC fixtures. */
describe("Synology saved connection — offline route", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection("Synthetic Synology route");
    await $(S.connectionTree).waitForExist({ timeout: 10_000 });
  });

  it("saves a native File Station target with its actual protocol and HTTPS port", async () => {
    await $(S.toolbarNewConnection).click();
    await $(S.editorPanel).waitForDisplayed({ timeout: 5_000 });
    await $(S.editorName).setValue("Offline NAS fixture");
    await $(S.editorHostname).setValue("nas.example.invalid");
    await selectCustomOption(S.editorProtocol, "Synology File Station");
    expect(await $(S.editorProtocol).getText()).toContain(
      "Synology File Station",
    );
    expect(await $(S.editorPort).getValue()).toBe("5001");
    await $(S.editorSave).click();
    await browser.waitUntil(async () =>
      (await $(S.connectionTree).getText()).includes("Offline NAS fixture"),
    );
    expect(await $(S.connectionTree).getText()).toContain(
      "Offline NAS fixture",
    );
    // Do not double-click: the real connector can start health checks. The
    // embedded session handoff is exercised with mocked IPC in the React suite.
  });
});
