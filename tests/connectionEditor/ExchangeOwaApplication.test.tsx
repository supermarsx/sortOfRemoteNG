import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  EXCHANGE_OWA_PROFILE,
  EXCHANGE_OWA_LOGIN_SELECTORS,
} from "../../src/utils/connection/exchangeOwaProfile";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "mail.example.test",
  port: 8443,
  username: "DOMAIN\\user",
  password: "fixture-password",
  domain: "DO-NOT-INVENT",
  httpVerifySsl: true,
  authType: "basic",
  httpAutoLogin: true,
  httpApplication: { version: 1, id: "exchange-owa", loginMode: "form" },
};

function MailboxFixture({
  initial = saved,
}: {
  initial?: Partial<Connection>;
}) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="mailbox-value">{JSON.stringify(formData)}</output>
    </>
  );
}

const mailboxValue = () =>
  JSON.parse(
    screen.getByTestId("mailbox-value").textContent!,
  ) as Partial<Connection>;

describe("on-premises Exchange OWA application", () => {
  it.each(["manual", "form"] as const)(
    "edits the optional target without changing %s login consent or primary credentials",
    (loginMode) => {
      const initial = {
        ...saved,
        httpApplication: { ...saved.httpApplication!, loginMode },
      };
      render(<MailboxFixture initial={initial} />);
      const field = screen.getByRole("textbox", {
        name: "Secondary mailbox (optional)",
      });
      expect(field).toHaveValue("");
      expect(field).toHaveClass("sor-form-input");
      expect(field).toHaveAccessibleDescription(
        /saved address.*own mailbox by default/,
      );
      expect(field).toHaveAccessibleDescription(
        /admin role alone does not grant/,
      );
      fireEvent.change(field, {
        target: { value: " service+invoices@example.test " },
      });
      fireEvent.blur(field);
      expect(field).toHaveValue("service+invoices@example.test");
      expect(mailboxValue()).toEqual({
        ...initial,
        httpApplication: {
          ...initial.httpApplication,
          exchangeOwaMailbox: "service+invoices@example.test",
        },
      });
      expect(resolveHttpApplicationLogin(mailboxValue())).toMatchObject({
        credentials:
          loginMode === "form"
            ? { username: saved.username, password: saved.password }
            : null,
        autoLogin: loginMode === "form",
        upstreamAuthMode: "none",
      });
      fireEvent.change(field, { target: { value: "" } });
      expect(
        normalizeHttpApplicationSettings(mailboxValue().httpApplication),
      ).toEqual(initial.httpApplication);
    },
  );

  it("shows validation and allows repairing a typed target without changing consent", () => {
    render(<MailboxFixture />);
    const field = screen.getByRole("textbox", {
      name: "Secondary mailbox (optional)",
    });
    fireEvent.change(field, {
      target: { value: "https://other.test/owa/shared@example.test/" },
    });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/not a URL or path/);
    expect(() => resolveHttpApplicationLogin(mailboxValue())).toThrow(
      /invalid/,
    );
    fireEvent.change(field, { target: { value: "shared@example.test" } });
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(
      screen.queryByText(/Enter a mailbox email address/),
    ).not.toBeInTheDocument();
    expect(resolveHttpApplicationLogin(mailboxValue()).credentials).toEqual({
      username: saved.username,
      password: saved.password,
    });
  });

  it("does not revive persistently invalid imported metadata by editing the mailbox", () => {
    render(
      <MailboxFixture
        initial={{
          ...saved,
          httpApplication: { ...saved.httpApplication!, invalid: true },
        }}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Secondary mailbox (optional)" }),
      { target: { value: "shared@example.test" } },
    );
    expect(mailboxValue().httpApplication?.invalid).toBe(true);
    expect(() => resolveHttpApplicationLogin(mailboxValue())).toThrow(
      /invalid/,
    );
  });

  it("keeps the vault reference and requires its explicit disclosure for the primary account", () => {
    const initial: Partial<Connection> = {
      ...saved,
      credentialSource: {
        kind: "vault",
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    render(<MailboxFixture initial={initial} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Secondary mailbox (optional)" }),
      { target: { value: "shared@example.test" } },
    );
    expect(mailboxValue().credentialSource).toEqual(initial.credentialSource);
    expect(resolveHttpApplicationLogin(mailboxValue()).credentials).toBeNull();
    const disclosed = {
      username: "DOMAIN\\primary-admin",
      password: "synthetic-vault-password",
    };
    expect(
      resolveHttpApplicationLogin(mailboxValue(), disclosed).credentials,
    ).toEqual(disclosed);
  });

  it("keeps its stable profile, manual default and own destination capability", () => {
    expect(getHttpApplicationProfile("exchange-owa")).toBe(
      EXCHANGE_OWA_PROFILE,
    );
    expect(EXCHANGE_OWA_PROFILE).toMatchObject({
      requiresHttps: true,
      loginPath: "/owa/",
      loginModes: ["manual", "form"],
      selectors: EXCHANGE_OWA_LOGIN_SELECTORS,
    });
    expect(EXCHANGE_OWA_PROFILE.hostedLoginUrl).toBeUndefined();
    expect(EXCHANGE_OWA_PROFILE.totpChallenges).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "exchange-owa" }),
    ).toEqual({ version: 1, id: "exchange-owa", loginMode: "manual" });
    expect(getReviewedApplicationProfile(saved)).toBe("exchange-owa");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
  });

  it("requires fresh form consent without changing the mail host, port, TLS or credentials", () => {
    function Fixture() {
      const [formData, setFormData] = React.useState<Partial<Connection>>({
        ...saved,
        httpApplication: { version: 1, id: "generic-form", loginMode: "form" },
        httpAutoLoginSelectors: { passwordSelector: "#old" },
        httpAutoMfa: { version: 1, enabled: true },
      });
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
    const value = () =>
      JSON.parse(
        screen.getByTestId("value").textContent!,
      ) as Partial<Connection>;
    const choose = (label: string, option: string) => {
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.mouseDown(screen.getByRole("option", { name: option }));
    };
    choose("Website application", EXCHANGE_OWA_PROFILE.label);
    expect(value()).toMatchObject({
      hostname: saved.hostname,
      port: saved.port,
      protocol: "https",
      username: saved.username,
      password: saved.password,
      domain: saved.domain,
      httpVerifySsl: true,
      httpAutoLogin: false,
      httpApplication: { version: 1, id: "exchange-owa", loginMode: "manual" },
      httpAutoMfa: { version: 1, enabled: false },
    });
    expect(value().httpAutoLoginSelectors).toBeUndefined();
    expect(resolveHttpApplicationLogin(value())).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    choose(
      "Application login mode",
      "Automatic form login — explicitly opt in",
    );
    expect(resolveHttpApplicationLogin(value())).toEqual({
      credentials: { username: saved.username, password: saved.password },
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: EXCHANGE_OWA_LOGIN_SELECTORS,
    });
  });

  it.each(["DOMAIN\\user", "user@example.test", "shortname"])(
    "preserves exact account %s without Basic",
    (username) => {
      const input = { ...saved, username };
      const before = structuredClone(input);
      expect(resolveHttpApplicationLogin(input)).toEqual({
        credentials: { username, password: saved.password },
        upstreamAuthMode: "none",
        autoLogin: true,
        selectors: EXCHANGE_OWA_LOGIN_SELECTORS,
      });
      expect(input).toEqual(before);
    },
  );

  it("requires vault disclosure and never falls back to stale inline credentials", () => {
    const input = {
      ...saved,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(input).credentials).toBeNull();
    const vault = { username: "VAULT\\exact", password: "vault-fixture" };
    expect(resolveHttpApplicationLogin(input, vault).credentials).toEqual(
      vault,
    );
    expect(
      resolveHttpApplicationLogin(
        {
          ...input,
          httpApplication: {
            ...input.httpApplication!,
            loginMode: "manual",
          },
        },
        vault,
      ),
    ).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
  });

  it.each(["basic", "digest"] as const)(
    "rejects imported %s mode",
    (loginMode) => {
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          httpApplication: {
            ...saved.httpApplication!,
            loginMode,
          },
        }),
      ).toThrow(/invalid/);
    },
  );

  it("cannot bypass the reviewed adapter with selectors or automatic MFA", () => {
    expect(() =>
      resolveHttpApplicationLogin({
        ...saved,
        httpAutoLoginSelectors: { usernameSelector: "#username" },
      }),
    ).toThrow(/reviewed form selectors/);
    expect(() =>
      resolveHttpApplicationLogin({
        ...saved,
        httpAutoMfa: { version: 1, enabled: true },
      }),
    ).toThrow(/interactive MFA/);
  });

  it("requires HTTPS and does not enable Microsoft 365 or generic Exchange automation", () => {
    expect(() =>
      validateHttpApplicationTarget(
        saved,
        "https://mail.example.test:8443/owa/",
      ),
    ).not.toThrow();
    for (const url of [
      "http://mail.example.test/owa/",
      "https://user:secret@mail.example.test/owa/",
    ])
      expect(() => validateHttpApplicationTarget(saved, url)).toThrow(/HTTPS/);
    for (const id of ["outlook-online", "exchange"]) {
      expect(getHttpApplicationProfile(id)?.capability).toBe("manual");
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          httpApplication: {
            version: 1,
            id,
            loginMode: "form",
          },
        }),
      ).toThrow(/invalid/);
    }
  });
});
