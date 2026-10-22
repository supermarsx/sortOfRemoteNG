import assert from "node:assert/strict";
import { test } from "node:test";
import {
  host,
  page,
  USER,
  SECRET,
} from "../helpers/nativeDeclarativeLoginHarness.mjs";

// Anonymous https://login.brevo.com/ HTML, reviewed 2026-10-22.
// Synthetic controls only: no vendor script, content, account or network.
const brevo =
  '<form><input type="text" id="email" name="email" required><input type="password" id="password" name="password" required><button id="eyeIcon" type="button"></button><button type="button" data-testid="submit-button">Log In</button></form>';
const selectors = {
  username: 'form input#email[name="email"]',
  password: 'form input#password[name="password"][type="password"]',
  submit:
    'form:has(input#email):has(input#password) button[data-testid="submit-button"][type="button"]',
};

for (const autoSubmit of [false, true])
  test(`Brevo real native keyboard respects ${autoSubmit ? "submit" : "fill-only"}`, async (t) => {
    const h = host({ autoSubmit });
    const p = page(
      t,
      h,
      "https://login.brevo.com/",
      brevo,
      { selectors },
      { adapter: "modular-form" },
    );
    let logins = 0,
      eyes = 0;
    p.$("#eyeIcon").onclick = () => eyes++;
    p.$('[data-testid="submit-button"]').onclick = () => logins++;
    await h.advance(4000);
    assert.equal(p.$("#email").value, USER);
    assert.equal(p.$("#password").value, SECRET);
    assert.equal(logins, autoSubmit ? 1 : 0);
    assert.equal(eyes, 0);
    assert.ok(p.typed.length > 0);
    assert.ok(p.signals.includes("form-completed"));
    assert.deepEqual(h.errors, []);
  });
