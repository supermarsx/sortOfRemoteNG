import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const config = (id: string): Partial<Connection> => ({
  protocol: "https",
  hostname: id === "claude" ? "claude.ai" : "chatgpt.com",
  port: 443,
  username: "fixture@example.test",
  password: "do-not-copy",
  httpApplication: { version: 1, id, loginMode: "form" },
});
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe.each(["chatgpt", "claude"])("%s bounded hosted assistance", (id) => {
  const label = id === "claude" ? "Claude" : "ChatGPT";
  it("retains the stable icon/id, exact entry, manual default and fixture qualification", () => {
    const profile = getHttpApplicationProfile(id)!;
    expect(profile).toMatchObject({
      capability: "known-form",
      loginFlow: id,
      usernameLabel: "Email",
      loginModes: ["manual", "form"],
      hostedLoginUrl:
        id === "claude"
          ? "https://claude.ai/login"
          : "https://chatgpt.com/auth/login",
    });
    expect(profile.description).toMatch(/fixture-tested/);
    expect(profile.selectors).toBeUndefined();
    expect(profile.totpChallenges).toBeUndefined();
    expect(getHttpApplicationIconSuggestion(config(id))?.icon).toBeDefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id })?.loginMode,
    ).toBe("manual");
    expect(getReviewedApplicationProfile(config(id))).toBe(id);
    expect(
      getReviewedApplicationProfile({
        ...config(id),
        httpApplication: { version: 1, id, loginMode: "form", invalid: true },
      }),
    ).toBeUndefined();
  });
  it.each(["", "custom.example.test"])(
    "preserves custom address %s and requires fresh manual consent",
    (hostname) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...config(id),
          hostname,
          protocol: "http",
          port: 8443,
          httpVerifySsl: false,
          httpApplication: {
            version: 1,
            id: "generic-form",
            loginMode: "form",
          },
          httpAutoLogin: true,
          httpAutoLoginSelectors: { usernameSelector: "#old" },
          httpFormAutomation: {
            version: 1,
            formSelector: "#previous-app",
            fillDelayMs: 0,
            submitDelayMs: 0,
            detectionTimeoutMs: 8000,
            submit: true,
            fields: [],
          },
          httpAutoMfa: { version: 1, enabled: true },
        });
        return (
          <>
            <HTTPOptions
              formData={formData}
              setFormData={setFormData}
              sections={["application"]}
            />
            <output data-testid="state">{JSON.stringify(formData)}</output>
          </>
        );
      }
      render(<Fixture />);
      const value = () =>
        JSON.parse(
          screen.getByTestId("state").textContent!,
        ) as Partial<Connection>;
      choose("Website application", label);
      expect(value()).toMatchObject({
        hostname: hostname || config(id).hostname,
        port: hostname ? 8443 : 443,
        protocol: hostname ? "http" : "https",
        httpVerifySsl: false,
        password: "do-not-copy",
        httpApplication: { version: 1, id, loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(value().httpFormAutomation).toBeUndefined();
      expect(resolveHttpApplicationLogin(value()).credentials).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: `Use ${label} login address` }),
      );
      expect(value()).toMatchObject({
        hostname: config(id).hostname,
        protocol: "https",
        port: 443,
        httpVerifySsl: false,
      });
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(resolveHttpApplicationLogin(value()).autoLogin).toBe(true);
      expect(
        screen.queryByText("Selector overrides (optional)"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Enable automatic codes for this origin"),
      ).not.toBeInTheDocument();
      if (id === "claude") {
        expect(
          screen.queryByLabelText("Website password"),
        ).not.toBeInTheDocument();
        expect(screen.getByText(/Submit your email once/)).toHaveTextContent(
          "emailed link or code manually",
        );
        fireEvent.change(screen.getByLabelText("Website email"), {
          target: { value: "changed@example.test" },
        });
        expect(value().basicAuthPassword).toBeUndefined();
        expect(value().password).toBe("do-not-copy");
        expect(resolveHttpApplicationLogin(value()).credentials).toEqual({
          username: "changed@example.test",
          password: "",
        });
      } else
        expect(screen.getByLabelText("Website password")).toHaveValue(
          "do-not-copy",
        );
    },
  );
  it("uses saved/vault credentials without HTTP Basic fallback", () => {
    const input = config(id);
    expect(
      resolveHttpApplicationLogin({ ...input, authType: "basic" }),
    ).toEqual({
      credentials: {
        username: input.username,
        password: id === "claude" ? "" : input.password,
      },
      autoLogin: true,
      loginFlow: id,
      upstreamAuthMode: `${id}-form`,
    });
    const vault = {
      ...input,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(vault).credentials).toBeNull();
    expect(
      resolveHttpApplicationLogin(vault, {
        username: "vault@example.test",
        password: "vault-secret",
      }).credentials,
    ).toEqual({
      username: "vault@example.test",
      password: id === "claude" ? "" : "vault-secret",
    });
    expect(
      resolveHttpApplicationLogin(
        { ...vault, httpApplication: { version: 1, id, loginMode: "manual" } },
        { username: "vault@example.test", password: "vault-secret" },
      ),
    ).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
  });
  it.each(["basic", "digest"] as const)("rejects imported %s", (loginMode) => {
    expect(() =>
      resolveHttpApplicationLogin({
        ...config(id),
        httpApplication: { version: 1, id, loginMode },
      }),
    ).toThrow(/invalid/i);
  });
  it("rejects selector/advanced/MFA imports and foreign or insecure entry origins", () => {
    expect(() =>
      resolveHttpApplicationLogin({
        ...config(id),
        httpAutoLoginSelectors: { usernameSelector: "#unsafe" },
      }),
    ).toThrow(/selector overrides/);
    expect(() =>
      resolveHttpApplicationLogin({
        ...config(id),
        httpAutoMfa: { version: 1, enabled: true },
      }),
    ).toThrow(/automatic MFA/);
    expect(() =>
      resolveHttpApplicationLogin({
        ...config(id),
        httpFormAutomation: {
          version: 1,
          fillDelayMs: 0,
          submitDelayMs: 0,
          detectionTimeoutMs: 1000,
          submit: true,
          fields: [],
        },
      }),
    ).toThrow(/advanced form/);
    for (const url of [
      `http://${config(id).hostname}/`,
      `https://${config(id).hostname}:8443/`,
      `https://${config(id).hostname}.evil.test/`,
      `https://user:pass@${config(id).hostname}/`,
    ])
      expect(() => validateHttpApplicationTarget(config(id), url)).toThrow(
        /requires HTTPS/,
      );
    expect(() =>
      validateHttpApplicationTarget(
        config(id),
        getHttpApplicationProfile(id)!.hostedLoginUrl!,
      ),
    ).not.toThrow();
  });
});

describe("Claude password isolation", () => {
  it("never reads local or disclosed vault password properties", () => {
    const input = config("claude");
    Object.defineProperties(input, {
      password: {
        get() {
          throw new Error("local password read");
        },
      },
      basicAuthPassword: {
        get() {
          throw new Error("basic password read");
        },
      },
    });
    expect(resolveHttpApplicationLogin(input).credentials).toEqual({
      username: "fixture@example.test",
      password: "",
    });
    input.credentialSource = {
      kind: "vault",
      credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
    };
    const vault = {
      username: "email-only@example.test",
      get password(): string {
        throw new Error("vault password read");
      },
    };
    expect(resolveHttpApplicationLogin(input, vault).credentials).toEqual({
      username: vault.username,
      password: "",
    });
  });
  it("accepts no password, rejects absent email, and keeps ChatGPT password validation", () => {
    expect(
      resolveHttpApplicationLogin({ ...config("claude"), password: undefined })
        .credentials?.password,
    ).toBe("");
    expect(() =>
      resolveHttpApplicationLogin({ ...config("claude"), username: "" }),
    ).toThrow(/requires.*email/);
    expect(() =>
      resolveHttpApplicationLogin({ ...config("chatgpt"), password: "" }),
    ).toThrow(/username and password/);
  });
});
