import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { AMAZON_SHOPPING_MARKETS } from "../../src/utils/connection/amazonProfiles";

// Independent expected URLs: selecting a menu item must update the real editor
// record, not merely display a correct address in the preset's explanatory text.
const destinations = [
  ["amazon-shopping", "https://www.amazon.com/"],
  ["aws-console", "https://console.aws.amazon.com/"],
  ["aws-console-china", "https://console.amazonaws.cn/"],
  ["aws-console-govcloud", "https://console.amazonaws-us-gov.com/"],
] as const;

function Fixture({ initial }: { initial: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="amazon-record">{JSON.stringify(formData)}</output>
    </>
  );
}
const read = () =>
  JSON.parse(
    screen.getByTestId("amazon-record").textContent!,
  ) as Partial<Connection>;
const address = () => {
  const record = read();
  return new URL(`${record.protocol}://${record.hostname}:${record.port}/`)
    .href;
};
function choosePreset(id: string) {
  fireEvent.click(screen.getByLabelText("Website application"));
  fireEvent.mouseDown(
    screen.getByRole("option", {
      name: getHttpApplicationProfile(id)!.label,
    }),
  );
}

describe("Amazon shopping and AWS rendered preset selection", () => {
  it.each(destinations)(
    "%s fills the blank editor address with %s",
    (id, url) => {
      render(
        <Fixture
          initial={{
            hostname: "",
            protocol: "http",
            port: 80,
            icon: "star",
            httpVerifySsl: true,
            username: "fixture-account",
            password: "fixture-secret",
            httpAutoLogin: true,
            httpAutoLoginSelectors: { passwordSelector: "#old-password" },
            httpAutoMfa: { version: 1, enabled: true },
          }}
        />,
      );
      choosePreset(id);
      expect(address()).toBe(url);
      expect(read()).toMatchObject({
        icon: "star",
        httpVerifySsl: true,
        httpApplication: { version: 1, id, loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(read().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(read())).toMatchObject({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
      expect(
        screen.getByText(
          /Blank connections use this built-in address automatically|blank connections start at/,
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Application login mode"));
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(
        screen.getByRole("option", {
          name: "Manual browsing — no saved credentials sent",
        }),
      ).toBeInTheDocument();
    },
  );

  it.each(destinations)(
    "%s preserves a custom address until explicit replacement",
    (id, url) => {
      render(
        <Fixture
          initial={{
            hostname: "custom.example.test",
            protocol: "http",
            port: 9443,
            httpVerifySsl: false,
          }}
        />,
      );
      choosePreset(id);
      expect(address()).toBe("http://custom.example.test:9443/");
      expect(read().httpVerifySsl).toBe(false);
      fireEvent.click(
        screen.getByRole("button", {
          name: `Use ${getHttpApplicationProfile(id)!.label} login address`,
        }),
      );
      expect(address()).toBe(url);
      expect(read().httpVerifySsl).toBe(false);
      expect(read().httpApplication?.loginMode).toBe("manual");
    },
  );

  it("treats whitespace as blank without silently switching populated markets or consoles", () => {
    render(
      <Fixture initial={{ hostname: " \t ", protocol: "http", port: 80 }} />,
    );
    choosePreset("amazon-shopping");
    expect(address()).toBe("https://www.amazon.com/");
    choosePreset("aws-console");
    expect(address()).toBe("https://www.amazon.com/");
    expect(read().httpAutoLogin).toBe(false);
  });

  it("shows one shopping option, detects the existing URL and leaves it untouched", () => {
    render(
      <Fixture
        initial={{
          hostname: "https://www.amazon.de/ap/signin",
          protocol: "https",
          port: 443,
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Website application"));
    expect(
      screen.getAllByRole("option", { name: /^Amazon Shopping/ }),
    ).toHaveLength(1);
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Amazon Shopping" }),
    );
    expect(read().hostname).toBe("https://www.amazon.de/ap/signin");
    expect(screen.getByLabelText("Amazon marketplace")).toHaveTextContent(
      "Auto-detect from URL",
    );
    expect(screen.getByText(/^Detected: Germany/)).toHaveAttribute(
      "role",
      "status",
    );
  });

  it.each(AMAZON_SHOPPING_MARKETS)(
    "selects $country with a themed searchable marketplace picker",
    (market) => {
      render(
        <Fixture
          initial={{
            hostname: "www.amazon.com",
            protocol: "https",
            port: 443,
            icon: "star",
            httpVerifySsl: true,
            httpApplication: {
              version: 1,
              id: "amazon-shopping",
              loginMode: "manual",
            },
          }}
        />,
      );
      const picker = screen.getByLabelText("Amazon marketplace");
      expect(picker.tagName).toBe("BUTTON");
      expect(picker).toHaveClass("sor-form-select");
      fireEvent.click(picker);
      fireEvent.change(
        screen.getByPlaceholderText("Search countries or storefronts…"),
        { target: { value: market.hostname } },
      );
      fireEvent.mouseDown(
        screen.getByRole("option", {
          name: new RegExp(
            market.country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ),
        }),
      );
      expect(address()).toBe(`https://${market.hostname}/`);
      expect(read()).toMatchObject({
        icon: "star",
        httpVerifySsl: true,
        httpApplication: {
          id: "amazon-shopping",
          amazonMarketplace: market.code,
          loginMode: "manual",
        },
      });
      fireEvent.click(screen.getByLabelText("Amazon marketplace"));
      fireEvent.mouseDown(
        screen.getByRole("option", { name: "Auto-detect from URL" }),
      );
      expect(address()).toBe(`https://${market.hostname}/`);
      expect(read().httpApplication?.amazonMarketplace).toBe("auto");
    },
  );

  it("preserves a saved legacy regional choice and canonicalizes it when edited", () => {
    render(
      <Fixture
        initial={{
          hostname: "www.amazon.co.uk",
          protocol: "https",
          port: 443,
          httpApplication: {
            version: 1,
            id: "amazon-shopping-gb",
            loginMode: "manual",
          },
        }}
      />,
    );
    expect(screen.getByLabelText("Website application")).toHaveTextContent(
      "Amazon Shopping",
    );
    expect(screen.getByLabelText("Amazon marketplace")).toHaveTextContent(
      "United Kingdom",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use Amazon Shopping login address" }),
    );
    expect(read().httpApplication).toEqual({
      version: 1,
      id: "amazon-shopping",
      loginMode: "manual",
      amazonMarketplace: "GB",
    });
    expect(address()).toBe("https://www.amazon.co.uk/");
  });
});
