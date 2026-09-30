import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CloudSyncProviderIcon } from "../../src/components/sync/CloudSyncProviderIcon";
import { CloudSyncProviders } from "../../src/types/settings/cloudSyncSettings";
import { providerIcons } from "../../src/hooks/settings/useCloudSyncSettings";

describe("cloud provider SVG icons", () => {
  it.each(CloudSyncProviders)(
    "renders a themed SVG instead of emoji for %s",
    (provider) => {
      const { container, rerender } = render(
        <CloudSyncProviderIcon provider={provider} />,
      );
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("data-cloud-sync-provider", provider);
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveClass("text-primary", "shrink-0");
      expect(
        svg?.querySelector("path, circle, rect, line, polyline, polygon"),
      ).not.toBeNull();
      expect(container.textContent).toBe("");
      rerender(<>{providerIcons[provider]}</>);
      expect(container.querySelector("svg")).toHaveAttribute(
        "data-cloud-sync-provider",
        provider,
      );
      expect(container.textContent).toBe("");
    },
  );
});
