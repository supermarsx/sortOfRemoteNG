import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";

function Fixture({ initial }: { initial: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="gtm-record">{JSON.stringify(formData)}</output>
    </>
  );
}
const read = () =>
  JSON.parse(
    screen.getByTestId("gtm-record").textContent!,
  ) as Partial<Connection>;
function choosePreset(name: string) {
  fireEvent.click(screen.getByLabelText("Website application"));
  fireEvent.mouseDown(screen.getByRole("option", { name }));
}

describe("Google Tag Manager application editor", () => {
  it("offers the dashboard, fills a blank address and never inherits auto-login consent", () => {
    render(
      <Fixture
        initial={{
          protocol: "http",
          hostname: "",
          port: 80,
          icon: "star",
          httpVerifySsl: true,
          httpAutoLogin: true,
          httpAutoLoginSelectors: { passwordSelector: "#old" },
          httpAutoMfa: { version: 1, enabled: true },
        }}
      />,
    );
    choosePreset("Google Tag Manager");
    expect(read()).toMatchObject({
      protocol: "https",
      hostname: "tagmanager.google.com",
      port: 443,
      icon: "star",
      httpVerifySsl: true,
      httpApplication: {
        version: 1,
        id: "google-tag-manager",
        loginMode: "manual",
      },
      httpAutoLogin: false,
      httpAutoMfa: { version: 1, enabled: false },
    });
    expect(read().httpAutoLoginSelectors).toBeUndefined();
    expect(
      screen.getByText(/Tag Manager website dashboard/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use suggested icon" }));
    expect(read().icon).toBe("google-tag-manager");
    expect(read().httpApplication?.loginMode).toBe("manual");
  });

  it("switches between managed Google addresses but preserves an explicit custom address", () => {
    const { unmount } = render(
      <Fixture
        initial={{
          protocol: "https",
          hostname: "analytics.google.com",
          port: 443,
          httpApplication: {
            version: 1,
            id: "google-analytics",
            loginMode: "form",
          },
        }}
      />,
    );
    choosePreset("Google Tag Manager");
    expect(read().hostname).toBe("tagmanager.google.com");
    choosePreset("Google Analytics");
    expect(read().hostname).toBe("analytics.google.com");
    unmount();
    render(
      <Fixture
        initial={{
          protocol: "https",
          hostname: "custom.example.test",
          port: 9443,
        }}
      />,
    );
    choosePreset("Google Tag Manager");
    expect(read()).toMatchObject({
      hostname: "custom.example.test",
      port: 9443,
    });
  });
});
