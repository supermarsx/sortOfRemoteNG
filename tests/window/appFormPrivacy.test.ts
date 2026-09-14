import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppFormPrivacy } from "../../src/hooks/window/useAppFormPrivacy";
import { installAppFormPrivacy } from "../../src/utils/window/appFormPrivacy";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("application form privacy", () => {
  it("covers forms and existing fields while preserving typed values and app suggestions", () => {
    document.body.innerHTML = `<form autocomplete="on">
      <input name="username" autocomplete="username" list="hosts" value="typed-host">
      <input type="password" autocomplete="current-password" value="typed-secret">
      <textarea autocomplete="on">typed-note</textarea>
      <select autocomplete="on"><option selected>typed-choice</option></select>
      <datalist id="hosts"><option value="app-owned-host"></datalist>
      <div contenteditable="true" role="textbox">editor-text</div>
    </form>`;
    const storage = vi.spyOn(Storage.prototype, "setItem");
    stop = installAppFormPrivacy(document);
    for (const element of document.querySelectorAll(
      "form,input,textarea,select",
    )) {
      expect(element.getAttribute("autocomplete")).toBe("off");
      expect(element.getAttribute("data-lpignore")).toBe("true");
      expect(element.getAttribute("data-1p-ignore")).toBe("true");
      expect(element.getAttribute("data-bwignore")).toBe("true");
    }
    expect(
      document.querySelector<HTMLInputElement>("[name=username]")!.value,
    ).toBe("typed-host");
    expect(
      document.querySelector<HTMLInputElement>("[type=password]")!.value,
    ).toBe("typed-secret");
    expect(document.querySelector("textarea")!.value).toBe("typed-note");
    expect(document.querySelector("select")!.value).toBe("typed-choice");
    expect(
      document.querySelector("[name=username]")!.getAttribute("list"),
    ).toBe("hosts");
    expect(
      document.querySelector("datalist option")!.getAttribute("value"),
    ).toBe("app-owned-host");
    expect(document.querySelector("[contenteditable]")!.outerHTML).toBe(
      '<div contenteditable="true" role="textbox">editor-text</div>',
    );
    expect(storage).not.toHaveBeenCalled();
  });

  it("protects dynamically mounted fields and repairs autocomplete re-enabled by rendering", async () => {
    stop = installAppFormPrivacy(document);
    const form = document.createElement("form");
    form.innerHTML = '<input name="host" autocomplete="on">';
    document.body.append(form);
    const field = form.querySelector("input")!;
    await waitFor(() => expect(field.autocomplete).toBe("off"));
    expect(form.getAttribute("autocomplete")).toBe("off");
    field.autocomplete = "username";
    field.removeAttribute("data-lpignore");
    await waitFor(() => {
      expect(field.autocomplete).toBe("off");
      expect(field.getAttribute("data-lpignore")).toBe("true");
    });
  });

  it("protects a synchronously focused or submitted new field before observer delivery", () => {
    stop = installAppFormPrivacy(document);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    expect(field.autocomplete).toBe("off");
    const form = document.createElement("form");
    form.innerHTML = '<input autocomplete="on">';
    document.body.append(form);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    expect(form.dispatchEvent(submit)).toBe(true);
    expect(form.getAttribute("autocomplete")).toBe("off");
    expect(form.querySelector("input")!.autocomplete).toBe("off");
  });

  it("does not rescan the application for unrelated text changes or newly added controls", async () => {
    document.body.innerHTML =
      '<section id="existing"><input></section><div id="stream"></div>';
    stop = installAppFormPrivacy(document);
    const rootSearch = vi.spyOn(document.documentElement, "querySelectorAll");
    const existingSearch = vi.spyOn(
      document.querySelector("#existing")!,
      "querySelectorAll",
    );
    document
      .querySelector("#stream")!
      .append(document.createTextNode("terminal-output"));
    const field = document.createElement("input");
    document.body.append(field);
    await waitFor(() => expect(field.autocomplete).toBe("off"));
    expect(rootSearch).not.toHaveBeenCalled();
    expect(existingSearch).not.toHaveBeenCalled();
  });

  it("never changes the upstream DSM form inside an iframe", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const upstream = frame.contentDocument!;
    upstream.body.innerHTML =
      '<form id="dsm-user-fieldset"><input syno-id="username" type="text" name="username" autocomplete="username"></form>';
    const original = upstream.body.innerHTML;
    stop = installAppFormPrivacy(document);
    const field = document.createElement("input");
    document.body.append(field);
    await waitFor(() => expect(field.autocomplete).toBe("off"));
    expect(upstream.body.innerHTML).toBe(original);
  });

  it("installs for a mounted application and stops observing when its hook unmounts", async () => {
    document.body.innerHTML = '<input autocomplete="on">';
    const mounted = renderHook(() => useAppFormPrivacy());
    expect(document.querySelector("input")!.autocomplete).toBe("off");
    mounted.unmount();
    const later = document.createElement("input");
    document.body.append(later);
    later.focus();
    await Promise.resolve();
    expect(later.hasAttribute("autocomplete")).toBe(false);
  });
});
