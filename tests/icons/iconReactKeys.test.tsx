import { spawnSync } from "node:child_process";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";

const repositoryRoot = process.cwd();
const missingKeyWarning =
  /Each child in a list should have a unique ["']key["'] prop/;

function renderInFreshProcess(body: string) {
  // React deduplicates key warnings by owner. A new renderer/process is required
  // so another test rendering Lucide's shared Icon owner cannot hide a warning.
  // Transpile the REAL local catalog in memory: no fixture files or app edits.
  const bootstrap = `
    const fs = require('node:fs');
    const ts = require('typescript');
    for (const extension of ['.ts', '.tsx']) {
      require.extensions[extension] = (module, filename) => {
        const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
        });
        module._compile(outputText, filename);
      };
    }
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    ${body}
  `;
  return spawnSync(process.execPath, ["-e", bootstrap], {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: "development" },
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function OrganizeNavigation() {
  const [open, setOpen] = React.useState(true);
  const [icon, setIcon] = React.useState<string | undefined>("folder-switch");
  return (
    <>
      <button onClick={() => setOpen((current) => !current)}>
        Toggle Organize
      </button>
      {open && (
        <ConnectionIconPicker
          connection={{ protocol: "rdp", isGroup: true, icon }}
          onChange={setIcon}
        />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("real catalog React list keys", () => {
  it("detects a deliberately unkeyed real Lucide fixture in a fresh renderer", () => {
    const result = renderInFreshProcess(`
      const { createLucideIcon } = require('lucide-react');
      const BrokenIcon = createLucideIcon('DeliberatelyUnkeyed', [
        ['path', { d: 'M2 2h20v20H2Z' }],
        ['circle', { cx: '12', cy: '12', r: '3' }],
      ]);
      process.stdout.write(renderToStaticMarkup(React.createElement(BrokenIcon)));
    `);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<svg");
    expect(result.stderr).toMatch(missingKeyWarning);
  });

  it("renders every real catalog icon without warnings in a fresh renderer", () => {
    const result = renderInFreshProcess(`
      const { CONNECTION_ICON_CATALOG } = require('./src/utils/icons/connectionIconCatalog.ts');
      const { FOLDER_OPEN_ICONS } = require('./src/utils/icons/catalog/folders.ts');
      for (const entry of CONNECTION_ICON_CATALOG) {
        const markup = renderToStaticMarkup(React.createElement(entry.icon, { size: 16 }));
        if (!markup.includes('<svg')) throw new Error('No SVG: ' + entry.key);
      }
      for (const [key, Icon] of Object.entries(FOLDER_OPEN_ICONS)) {
        const markup = renderToStaticMarkup(React.createElement(Icon, { size: 16 }));
        if (!markup.includes('<svg')) throw new Error('No open folder SVG: ' + key);
      }
      process.stdout.write(JSON.stringify({ count: CONNECTION_ICON_CATALOG.length }));
    `);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      count: CONNECTION_ICON_CATALOG.length,
    });
    // Do not suppress console errors: any React/runtime warning is a failure.
    expect(result.stderr).toBe("");
  });

  it("keeps real Organize picker filtering, selection and remounts warning-free", () => {
    // Call-through spies observe rather than suppress warnings/errors.
    const errors = vi.spyOn(console, "error");
    const warnings = vi.spyOn(console, "warn");
    render(
      <React.StrictMode>
        <OrganizeNavigation />
      </React.StrictMode>,
    );
    const search = screen.getByRole("combobox", {
      name: "Search folder icons",
    });
    fireEvent.change(search, { target: { value: "nas folder" } });
    fireEvent.click(
      screen.getByRole("option", { name: /NAS folder \(folder-nas\)/ }),
    );
    expect(
      screen.getByLabelText("Current effective icon: NAS folder"),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "cisco" } });
    fireEvent.click(screen.getByRole("option", { name: /^Cisco \(cisco\)/ }));
    expect(
      screen.getByLabelText("Current effective icon: Cisco"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Organize" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Organize" }));
    expect(
      screen.getByLabelText("Current effective icon: Cisco"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use automatic icon" }));
    expect(
      screen.getByLabelText("Current effective icon: Folder"),
    ).toBeInTheDocument();
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });
});
