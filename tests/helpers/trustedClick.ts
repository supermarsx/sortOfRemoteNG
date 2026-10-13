import { act } from "@testing-library/react";
import { expect } from "vitest";

/**
 * A click as the browser itself delivers it: trusted, with `detail` 0 when it
 * was made from a key (Enter, Space, an arrow key in a radio group) or an
 * assistive action, 1 for a pointer, 2 for the second click of a double click.
 *
 * Everything a test dispatches with `fireEvent` is untrusted, and the in-app
 * prompt deliberately grants nothing on an untrusted event, so this goes
 * through jsdom's own dispatch. The checks at the end fail loudly if jsdom
 * stops allowing that. Taken from `tests/ui/AppPromptDialog.test.tsx`
 * (`browserClick`, t103-e1).
 *
 * A lasting choice in the prompt also needs the dialog to be armed: confirm
 * at least 300 ms (by `performance.now()`) after the prompt was shown.
 */
export const trustedClick = (target: Element, detail: 0 | 1 | 2 = 1) => {
  const implOf = (wrapper: object) => {
    const symbol = Object.getOwnPropertySymbols(wrapper).find(
      (candidate) => candidate.description === "impl",
    );
    expect(symbol, "jsdom no longer exposes its implementation").toBeDefined();
    return (wrapper as Record<symbol, any>)[symbol!];
  };
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail,
  });
  implOf(event).isTrusted = true;
  act(() => {
    implOf(target)._dispatch(implOf(event));
  });
  expect(event.isTrusted).toBe(true);
  expect(event.detail).toBe(detail);
  return event;
};
