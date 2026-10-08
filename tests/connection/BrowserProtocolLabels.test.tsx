import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickConnect } from "../../src/components/connection/QuickConnect";

describe("Browser protocol labels", () => {
  it.each(["http", "https"] as const)(
    "Quick Connect displays Browser for %s without changing its submitted protocol",
    (protocol) => {
      const onConnect = vi.fn();
      render(
        <QuickConnect
          isOpen
          onClose={vi.fn()}
          onConnect={onConnect}
          historyEnabled={false}
          history={[]}
          onClearHistory={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId("quick-connect-type"));
      fireEvent.mouseDown(
        screen.getByRole("option", {
          name: "Browser",
        }),
      );
      if (protocol === "http") {
        fireEvent.click(screen.getByTestId("quick-connect-protocol"));
        fireEvent.mouseDown(
          screen.getByRole("option", { name: /^HTTP\s*Unencrypted$/ }),
        );
      }
      expect(screen.getByTestId("quick-connect-type")).toHaveTextContent(
        "Browser",
      );
      expect(screen.getByTestId("quick-connect-protocol")).toHaveTextContent(
        protocol.toUpperCase(),
      );
      fireEvent.change(screen.getByTestId("quick-connect-hostname"), {
        target: { value: "portal.example.test:8443" },
      });
      fireEvent.submit(screen.getByRole("form"));
      expect(onConnect).toHaveBeenCalledOnce();
      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "portal.example.test:8443",
          protocol,
        }),
      );
    },
  );
});
