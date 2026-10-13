import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A window without a host cannot show a prompt: every request in it is
// refused and nothing runs. Each window root must therefore mount exactly one.
const occurrences = (source: string, pattern: RegExp) =>
  source.match(pattern)?.length ?? 0;

const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
};

describe("prompt host mounts", () => {
  it("is mounted once in the main window, beside the app's error boundary", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(occurrences(app, /<PromptHost\b/g)).toBe(1);
    expect(
      occurrences(
        app,
        /^import \{ PromptHost \} from "\.\/components\/ui\/dialogs\/PromptHost";\r?$/gm,
      ),
    ).toBe(1);

    const root = between(
      app,
      "const App: React.FC = () => (",
      "export default App;",
    );
    expect(root).toContain("<PromptHost />");
    // Inside the providers, and outside the boundary that replaces the app on
    // a crash, so the host that was registered at startup stays registered.
    const insideProviders = between(
      root,
      "<SessionFullscreenProvider>",
      "</SessionFullscreenProvider>",
    );
    expect(insideProviders).toContain("<PromptHost />");
    expect(between(root, "<ErrorBoundary>", "</ErrorBoundary>")).not.toContain(
      "PromptHost",
    );
  });

  it("is mounted once in a detached window, inside its security boundary", () => {
    const detached = readFileSync("app/detached/DetachedClient.tsx", "utf8");
    expect(occurrences(detached, /<PromptHost\b/g)).toBe(1);
    expect(
      occurrences(
        detached,
        /^import \{ PromptHost \} from "\.\.\/\.\.\/src\/components\/ui\/dialogs\/PromptHost";\r?$/gm,
      ),
    ).toBe(1);

    const root = between(
      detached,
      "const DetachedClient: React.FC = () => {",
      "export default DetachedClient;",
    );
    expect(
      between(
        root,
        "<DetachedSecurityBoundary>",
        "</DetachedSecurityBoundary>",
      ),
    ).toContain("<PromptHost />");
  });
});
