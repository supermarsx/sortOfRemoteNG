import { describe, expect, it } from "vitest";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
describe("reviewed TP-Link EAP profile", () => {
  it("targets the visible hydrated password clone and site-owned login button", () => {
    const profile = getHttpApplicationProfile("tplink-eap");
    expect(profile?.capability).toBe("known-form");
    document.body.innerHTML =
      '<form id="form-login" method="post" action="/"><input id="login-username" name="username"><div class="password-container"><span class="password-wrap"><input class="password-text password-hidden" type="password"><input class="password-text password-visible hidden" type="text"><input id="login-password" name="password" class="hidden" type="password"></span></div><button id="login-btn" type="button">LOGIN</button></form>';
    expect(
      document.querySelectorAll(profile!.selectors!.usernameSelector!),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(profile!.selectors!.passwordSelector!),
    ).toHaveLength(1);
    expect(
      document.querySelector(profile!.selectors!.passwordSelector!),
    ).not.toHaveAttribute("id", "login-password");
    expect(
      document.querySelector(profile!.selectors!.submitSelector!),
    ).toHaveAttribute("type", "button");
  });
  it("does not match the first-time credential creation wizard", () => {
    const profile = getHttpApplicationProfile("tplink-eap")!;
    document.body.innerHTML =
      '<form><input id="new-username"><input id="new-password"><input id="confirm-password"><button>Save</button></form>';
    expect(
      document.querySelector(profile.selectors!.passwordSelector!),
    ).toBeNull();
  });
});
