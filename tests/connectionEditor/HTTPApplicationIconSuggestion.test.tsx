import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { ConnectionEditorMgr } from "../../src/hooks/connection/useConnectionEditor";
import { HTTP_APPLICATION_PROFILES } from "../../src/utils/connection/httpApplicationProfiles";
import {
  getHttpApplicationIconSuggestion,
  HTTP_APPLICATION_ICON_SUGGESTIONS,
} from "../../src/utils/icons/httpApplicationIconSuggestions";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import ApplicationIconSuggestion from "../../src/components/connectionEditor/httpOptions/ApplicationIconSuggestion";
import { IconPicker } from "../../src/components/connection/editor/OrganizeSection";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";

vi.mock("../../src/components/connection/editor/ConnectionIconPicker", () => ({
  ConnectionIconPicker: ({ connection }: { connection: { icon?: string } }) => (
    <span data-testid="existing-picker">{connection.icon ?? "Automatic"}</span>
  ),
}));

const initial: Partial<Connection> = {
  id: "icon-suggestion-fixture",
  protocol: "https",
  hostname: "application.example.test",
  port: 9443,
  icon: "custom:fixture-existing-art",
  basicAuthUsername: "fixture-user",
  basicAuthPassword: "fixture-secret",
  httpVerifySsl: false,
  httpApplication: { version: 1, id: "portainer", loginMode: "manual" },
};

function Fixture({
  section = "suggestion",
}: {
  section?: "suggestion" | "organize" | "application";
}) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      {section === "organize" ? (
        <IconPicker mgr={{ formData, setFormData } as ConnectionEditorMgr} />
      ) : section === "application" ? (
        <HTTPOptions
          formData={formData}
          setFormData={setFormData}
          sections={["application"]}
        />
      ) : (
        <ApplicationIconSuggestion
          formData={formData}
          setFormData={setFormData}
        />
      )}
      <output data-testid="value">{JSON.stringify(formData)}</output>
    </>
  );
}
const readValue = () =>
  JSON.parse(screen.getByTestId("value").textContent!) as Partial<Connection>;

describe("HTTP application icon suggestions", () => {
  it("covers exactly the selectable application profiles with stable existing keys", () => {
    expect(Object.keys(HTTP_APPLICATION_ICON_SUGGESTIONS).sort()).toEqual(
      HTTP_APPLICATION_PROFILES.filter(
        (profile) => profile.capability !== "none",
      )
        .map((profile) => profile.id)
        .sort(),
    );
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS.custom).toBe("web-application");
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS.lxd).toBe("boxes");
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS.ilo).toBe("hpe");
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS.idrac).toBe("dell");
    expect(HTTP_APPLICATION_ICON_SUGGESTIONS.nginxProxyMgr).toBe(
      "nginx-proxy-manager",
    );
  });

  it.each(HTTP_APPLICATION_PROFILES)(
    "uses a passive unframed existing choice for selectable $id only",
    (profile) => {
      const suggestion = getHttpApplicationIconSuggestion({
        ...initial,
        httpApplication: { version: 1, id: profile.id, loginMode: "manual" },
      });
      if (profile.capability === "none") {
        expect(suggestion).toBeUndefined();
        return;
      }
      expect(suggestion?.applicationId).toBe(profile.id);
      expect(suggestion?.icon).toBe(
        getConnectionIconDefinition(suggestion?.icon.key),
      );
      const Icon = suggestion!.icon.icon;
      const svg = renderToStaticMarkup(<Icon size={24} />);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain("currentColor");
      expect(svg).not.toMatch(/data-role-frame|<image|<script|<foreignObject/);
    },
  );

  it.each([
    { httpApplication: undefined },
    { httpApplication: null },
    { httpApplication: { version: 1, id: "missing", loginMode: "manual" } },
    { httpApplication: { version: 2, id: "portainer", loginMode: "manual" } },
    {
      httpApplication: {
        version: 1,
        id: "portainer",
        loginMode: "manual",
        invalid: true,
      },
    },
    { protocol: "ssh" },
    { isGroup: true },
  ])(
    "does not offer suggestions outside a valid website application",
    (patch) => {
      const setFormData = vi.fn();
      const { container } = render(
        <ApplicationIconSuggestion
          formData={{ ...initial, ...patch } as Partial<Connection>}
          setFormData={setFormData}
        />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(setFormData).not.toHaveBeenCalled();
    },
  );

  it("never changes an existing icon on render or profile change", () => {
    const setFormData = vi.fn();
    const { rerender } = render(
      <ApplicationIconSuggestion
        formData={initial}
        setFormData={setFormData}
      />,
    );
    expect(screen.getByText(/Suggested for Portainer/)).toBeInTheDocument();
    expect(screen.queryByText("fixture-secret")).not.toBeInTheDocument();
    rerender(
      <ApplicationIconSuggestion
        formData={{
          ...initial,
          httpApplication: { version: 1, id: "grafana", loginMode: "manual" },
        }}
        setFormData={setFormData}
      />,
    );
    expect(screen.getByText(/Suggested for Grafana/)).toBeInTheDocument();
    expect(setFormData).not.toHaveBeenCalled();
  });

  it.each(["suggestion", "organize", "application"] as const)(
    "only explicitly changes the icon from the %s control",
    (section) => {
      render(<Fixture section={section} />);
      expect(readValue()).toEqual(initial);
      fireEvent.click(
        screen.getByRole("button", { name: "Use suggested icon" }),
      );
      expect(readValue()).toEqual({ ...initial, icon: "portainer" });
      expect(
        screen.getByRole("button", { name: "Suggested icon selected" }),
      ).toBeDisabled();
      expect(
        screen.getByText("This icon is already selected."),
      ).toBeInTheDocument();
      if (section === "organize")
        expect(screen.getByTestId("existing-picker")).toHaveTextContent(
          "portainer",
        );
    },
  );

  it("a queued action cannot assign an old application's icon to a new profile", () => {
    let pending: React.SetStateAction<Partial<Connection>> | undefined;
    render(
      <ApplicationIconSuggestion
        formData={initial}
        setFormData={(update) => {
          pending = update;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use suggested icon" }));
    expect(typeof pending).toBe("function");
    const next: Partial<Connection> = {
      ...initial,
      httpApplication: { version: 1, id: "grafana", loginMode: "manual" },
    };
    const update = pending as (
      value: Partial<Connection>,
    ) => Partial<Connection>;
    expect(update(next)).toBe(next);
    const folder = { ...initial, isGroup: true };
    expect(update(folder)).toBe(folder);
  });

  it("does not change the protocol's automatic icon precedence", () => {
    const connection = {
      protocol: "https" as const,
      httpApplication: initial.httpApplication,
    };
    expect(getHttpApplicationIconSuggestion(connection)?.icon.key).toBe(
      "portainer",
    );
    expect(resolveEffectiveConnectionIcon(connection).key).toBe("https");
    expect(
      resolveEffectiveConnectionIcon({ ...connection, icon: "star" }).key,
    ).toBe("star");
  });
});
