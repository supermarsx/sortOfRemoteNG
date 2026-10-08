import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { OriginBrowserFindResult } from "../../types/protocols/originBrowser";

/** Already fenced by the parent to the exact owner, attempt and native view. */
export type OriginFindResult = OriginBrowserFindResult;

export interface OriginFindControls {
  find(
    text: string,
    forward?: boolean,
    matchCase?: boolean,
    findNext?: boolean,
    requestId?: string,
  ): Promise<boolean>;
  stopFind(clearSelection?: boolean): Promise<boolean>;
}

export interface OriginFindOptions {
  controls: OriginFindControls;
  enabled: boolean;
  /** Include the full owner/attempt and selected root/popup ID. */
  scopeKey: string;
  documentKey?: string;
  loading?: boolean;
  result?: OriginFindResult | null;
  /** Increment to open/refocus from a menu or shell keyboard shortcut. */
  openRequest?: number;
}

interface FindState {
  scopeKey: string;
  open: boolean;
  text: string;
  matchCase: boolean;
  pending: boolean;
  submitted: boolean;
  result: OriginFindResult | null;
  error: string | null;
  focusRevision: number;
}

const blank = (scopeKey: string): FindState => ({
  scopeKey,
  open: false,
  text: "",
  matchCase: false,
  pending: false,
  submitted: false,
  result: null,
  error: null,
  focusRevision: 0,
});

export function validOriginFindText(text: string): boolean {
  return (
    !!text &&
    !text.includes("\0") &&
    new TextEncoder().encode(text).length <= 1024
  );
}

interface FindActions {
  open(): void;
  close(): void;
  text(value: string): void;
  matchCase(value: boolean): void;
  search(forward: boolean): void;
  composing(value: boolean): void;
  refresh(): void;
  result(value: OriginFindResult | null | undefined): void;
}

/** Volatile native-only find state. No page scraping, storage, or native focus. */
export function useOriginFind(options: OriginFindOptions) {
  const [state, setState] = useState(() => blank(options.scopeKey));
  const latest = useRef(options);
  const actions = useRef<FindActions | null>(null);
  const openedRequest = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useLayoutEffect(() => {
    const scopeKey = options.scopeKey;
    let active = true;
    let model = blank(scopeKey);
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let composing = false;
    let stopRequired = false;
    let queued: { forward: boolean; version: number } | null = null;
    let last: { text: string; matchCase: boolean } | null = null;
    let requestId: string | null = null;
    let documentKey = latest.current.documentKey;
    let loading = latest.current.loading;
    let enabled = latest.current.enabled;
    const current = () => active && latest.current.scopeKey === scopeKey;
    const eligible = () =>
      current() && latest.current.enabled && !latest.current.loading;
    const publish = (patch: Partial<FindState> = {}) => {
      if (!current()) return;
      model = { ...model, ...patch };
      setState(model);
    };
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const invalidate = () => {
      version++;
      clearTimer();
      queued = null;
      last = null;
      requestId = null;
    };
    const drain = async () => {
      if (!eligible() || busy) return;
      if (stopRequired) {
        stopRequired = false;
        busy = true;
        const issued = version;
        let accepted = false;
        try {
          accepted = await latest.current.controls.stopFind(true);
        } catch {
          /* fixed error below */
        }
        busy = false;
        if (!current()) return;
        if (!accepted && issued === version && eligible())
          publish({
            error:
              "Search highlights could not be cleared. Reopen Find and try again.",
          });
        void drain();
        return;
      }
      const job = queued;
      queued = null;
      if (
        !job ||
        job.version !== version ||
        !model.open ||
        composing ||
        !validOriginFindText(model.text)
      )
        return;
      const query = { text: model.text, matchCase: model.matchCase };
      const token = crypto.randomUUID();
      requestId = token;
      busy = true;
      publish({ pending: true, submitted: false, result: null, error: null });
      let accepted = false;
      try {
        accepted = await latest.current.controls.find(
          query.text,
          job.forward,
          query.matchCase,
          last?.text === query.text && last.matchCase === query.matchCase,
          token,
        );
      } catch {
        /* Never show native errors, which may contain search/page text. */
      }
      busy = false;
      if (!current()) return;
      if (job.version === version && model.open && eligible()) {
        if (accepted) last = query;
        else requestId = null;
        publish({
          pending: false,
          submitted: accepted,
          result: accepted ? model.result : null,
          error: accepted
            ? null
            : "Search was not accepted. Try again when this page is ready.",
        });
      }
      void drain();
    };
    const search = (forward: boolean) => {
      if (
        !eligible() ||
        !model.open ||
        composing ||
        !validOriginFindText(model.text)
      )
        return;
      clearTimer();
      queued = { forward, version };
      void drain();
    };
    const schedule = () => {
      clearTimer();
      if (
        eligible() &&
        model.open &&
        !composing &&
        validOriginFindText(model.text)
      )
        timer = setTimeout(() => search(true), 200);
    };
    const updateQuery = (patch: Partial<FindState>) => {
      if (!eligible() || !model.open) return;
      invalidate();
      publish({
        ...patch,
        pending: false,
        submitted: false,
        result: null,
        error: null,
      });
      if (!validOriginFindText(model.text)) {
        stopRequired = true;
        void drain();
      } else schedule();
    };
    const api: FindActions = {
      open() {
        if (!eligible()) return;
        publish({ open: true, focusRevision: model.focusRevision + 1 });
      },
      close() {
        if (!current()) return;
        invalidate();
        composing = false;
        publish({
          open: false,
          text: "",
          pending: false,
          submitted: false,
          result: null,
          error: null,
        });
        // Close immediately, but serialize clearing after any already-issued find.
        // A successor scope must never inherit this cleanup through a dynamic bridge.
        stopRequired = true;
        void drain();
      },
      text(value) {
        updateQuery({ text: value });
      },
      matchCase(value) {
        updateQuery({ matchCase: value });
      },
      search,
      composing(value) {
        composing = value;
        if (value) clearTimer();
        else schedule();
      },
      refresh() {
        const next = latest.current;
        if (
          documentKey === next.documentKey &&
          loading === next.loading &&
          enabled === next.enabled
        )
          return;
        documentKey = next.documentKey;
        loading = next.loading;
        enabled = next.enabled;
        invalidate();
        stopRequired = false;
        publish({
          pending: false,
          submitted: false,
          result: null,
          error: null,
        });
        schedule();
      },
      result(value) {
        if (
          !eligible() ||
          !model.open ||
          !value ||
          !requestId ||
          value.requestId !== requestId ||
          !Number.isSafeInteger(value.numberOfMatches) ||
          value.numberOfMatches < 0 ||
          !Number.isSafeInteger(value.activeMatchOrdinal) ||
          value.activeMatchOrdinal < 0 ||
          value.activeMatchOrdinal > value.numberOfMatches ||
          typeof value.finalUpdate !== "boolean" ||
          model.result?.finalUpdate
        )
          return;
        publish({ result: { ...value } });
      },
    };
    actions.current = api;
    publish();
    return () => {
      active = false;
      clearTimer();
      queued = null;
      requestId = null;
      // Do not call a dynamically selected controller after scope replacement.
      if (actions.current === api) actions.current = null;
    };
  }, [options.scopeKey]);

  useLayoutEffect(() => {
    actions.current?.refresh();
  }, [options.enabled, options.loading, options.documentKey, options.scopeKey]);
  useLayoutEffect(() => {
    actions.current?.result(options.result);
  }, [options.result, options.scopeKey]);
  useLayoutEffect(() => {
    if (
      options.enabled &&
      !options.loading &&
      options.openRequest &&
      options.openRequest !== openedRequest.current
    ) {
      openedRequest.current = options.openRequest;
      actions.current?.open();
    }
  }, [options.openRequest, options.enabled, options.loading]);

  const open = useCallback(() => actions.current?.open(), []);
  const close = useCallback(() => actions.current?.close(), []);
  const setText = useCallback(
    (value: string) => actions.current?.text(value),
    [],
  );
  const setMatchCase = useCallback(
    (value: boolean) => actions.current?.matchCase(value),
    [],
  );
  const search = useCallback(
    (forward = true) => actions.current?.search(forward),
    [],
  );
  const setComposing = useCallback(
    (value: boolean) => actions.current?.composing(value),
    [],
  );
  return {
    ...(state.scopeKey === options.scopeKey ? state : blank(options.scopeKey)),
    show: open,
    close,
    setText,
    setMatchCase,
    search,
    setComposing,
    valid: validOriginFindText(
      state.scopeKey === options.scopeKey ? state.text : "",
    ),
  };
}
