import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import type { Connection } from "../../src/types/connection/connection";

describe("Webmin HTTP and HTTPS application", () => {
  it.each(["http", "https"] as const)(
    "selects manual %s without rewriting port, policy or credentials",
    (protocol) => {
      const initial: Partial<Connection> = {
        protocol,
        hostname: "webmin.example.test",
        port: 81,
        httpVerifySsl: false,
        username: "account",
        password: "fixture-only",
      };
      function Fixture() {
        const [formData, setFormData] = React.useState(initial);
        return (
          <>
            <HTTPOptions
              formData={formData}
              setFormData={setFormData}
              sections={["application"]}
            />
            <output data-testid="value">{JSON.stringify(formData)}</output>
          </>
        );
      }
      render(<Fixture />);
      fireEvent.click(screen.getByLabelText("Website application"));
      fireEvent.mouseDown(screen.getByRole("option", { name: "Webmin" }));
      const selected = JSON.parse(screen.getByTestId("value").textContent!);
      expect(selected).toMatchObject({
        ...initial,
        httpApplication: { version: 1, id: "webmin", loginMode: "manual" },
      });
      expect(
        screen.getByText(/commonly uses HTTPS port 10000/),
      ).toBeInTheDocument();
      expect(resolveHttpApplicationLogin(selected)).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
    },
  );
  it("uses reviewed classic/Authentic forms without selecting OTP or reset controls", () => {
    const profile = getHttpApplicationProfile("webmin")!;
    for (const submit of [
      '<input type="submit" id="login">',
      '<button type="submit" data-submit="login" id="login"></button><button type="submit" data-submit="2fa" id="otp"></button>',
    ]) {
      const doc = new DOMParser().parseFromString(
        `<form action="/webmin/session_login.cgi"><input name="user"><input name="pass" type="password"><input name="twofactor" autocomplete="one-time-code">${submit}<input type="reset"></form><form action="/forgot_form.cgi"><button type="submit"></button></form>`,
        "text/html",
      );
      expect(
        doc.querySelectorAll(profile.selectors!.usernameSelector!),
      ).toHaveLength(1);
      expect(
        doc
          .querySelector(profile.selectors!.usernameSelector!)!
          .getAttribute("name"),
      ).toBe("user");
      expect(
        doc
          .querySelector(profile.selectors!.passwordSelector!)!
          .getAttribute("name"),
      ).toBe("pass");
      expect(
        doc.querySelectorAll(profile.selectors!.submitSelector!),
      ).toHaveLength(1);
      expect(doc.querySelector(profile.selectors!.submitSelector!)!.id).toBe(
        "login",
      );
    }
    const config = {
      version: 1 as const,
      id: "webmin",
      loginMode: "form" as const,
    };
    expect(
      normalizeHttpApplicationSettings(JSON.parse(JSON.stringify(config))),
    ).toEqual(config);
    expect(
      resolveHttpApplicationLogin({
        httpApplication: config,
        username: "account",
        password: "fixture-only",
        port: 10000,
      }),
    ).toMatchObject({
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: profile.selectors,
    });
  });
});
