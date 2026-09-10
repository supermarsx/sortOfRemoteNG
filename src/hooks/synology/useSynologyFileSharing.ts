import { useEffect, useRef, useState } from "react";
import { toSafeManagementError } from "../../utils/security/managementInvoke";
export interface SynologyShareLink {
  id: string;
  path: string;
  url: string;
  dateExpired?: string | null;
  hasPassword?: boolean | null;
}
interface SharePage {
  links: SynologyShareLink[];
  total: number;
  offset: number;
}
export function useSynologyFileSharing({
  scopeKey,
  invoke,
}: {
  scopeKey: string;
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [data, setData] = useState<SharePage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [created, setCreated] = useState<SynologyShareLink | null>(null);
  const [review, setReview] = useState<
    | { kind: "create"; path: string }
    | { kind: "revoke"; link: SynologyShareLink }
    | null
  >(null);
  const current = useRef({ scopeKey, invoke });
  current.current = { scopeKey, invoke };
  const alive = useRef(true),
    pending = useRef(false),
    generation = useRef(0),
    reviewRef = useRef(review),
    previous = useRef(scopeKey);
  if (previous.current !== scopeKey) {
    previous.current = scopeKey;
    generation.current++;
    pending.current = false;
    reviewRef.current = null;
  }
  useEffect(() => {
    setOpen(false);
    setData(null);
    setCreated(null);
    setReview(null);
    setError(null);
    setBusy(false);
    setPage(0);
  }, [scopeKey]);
  useEffect(() => {
    alive.current = true;
    const attempts = generation;
    return () => {
      alive.current = false;
      attempts.current++;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return false;
    const token = generation.current,
      key = current.current.scopeKey;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return (
        alive.current &&
        token === generation.current &&
        key === current.current.scopeKey
      );
    } catch (e) {
      if (alive.current && token === generation.current)
        setError(toSafeManagementError(e));
      return false;
    } finally {
      if (alive.current && token === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const load = async (nextPage: number) => {
    const key = current.current.scopeKey,
      token = generation.current;
    const result = await current.current.invoke<SharePage>(
      "syn_fs_list_share_links",
      { offset: nextPage * 50, limit: 50 },
    );
    if (
      !Array.isArray(result?.links) ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      result.links.some(
        (link) =>
          !link ||
          typeof link.id !== "string" ||
          typeof link.path !== "string" ||
          typeof link.url !== "string",
      )
    )
      throw new Error("The NAS returned an invalid share-link list.");
    if (
      alive.current &&
      current.current.scopeKey === key &&
      generation.current === token
    ) {
      setData(result);
      setPage(nextPage);
    }
  };
  const show = () => {
    if (pending.current) return;
    setOpen(true);
    setCreated(null);
    void run(() => load(0));
  };
  const requestCreate = (path: string) => {
    if (pending.current) return;
    const next = { kind: "create" as const, path };
    reviewRef.current = next;
    setReview(next);
    setCreated(null);
    setError(null);
    setOpen(true);
  };
  const requestRevoke = (link: SynologyShareLink) => {
    if (pending.current) return;
    const next = { kind: "revoke" as const, link: { ...link } };
    reviewRef.current = next;
    setReview(next);
    setError(null);
  };
  const confirm = async (password: string, expireDate: string) => {
    const captured = review,
      token = generation.current;
    if (!captured || reviewRef.current !== captured) return false;
    return run(async () => {
      if (reviewRef.current !== captured)
        throw new Error("Review this action again.");
      if (captured.kind === "create") {
        if (password.length > 16)
          throw new Error("Sharing passwords must be 16 characters or fewer.");
        if (expireDate && !/^\d{4}-\d{2}-\d{2}$/.test(expireDate))
          throw new Error("Use an expiry date in YYYY-MM-DD format.");
        const result = await current.current.invoke<SynologyShareLink>(
          "syn_fs_create_share_link",
          {
            path: captured.path,
            password: password || null,
            expireDate: expireDate || null,
          },
        );
        if (
          !result ||
          typeof result.url !== "string" ||
          typeof result.id !== "string"
        )
          throw new Error("The NAS did not return a valid sharing link.");
        if (alive.current && token === generation.current) setCreated(result);
      } else
        await current.current.invoke("syn_fs_delete_share_links", {
          ids: [captured.link.id],
        });
      if (alive.current && token === generation.current) {
        reviewRef.current = null;
        setReview(null);
        await load(page);
      }
    });
  };
  return {
    open,
    page,
    data,
    busy,
    error,
    created,
    review,
    show,
    requestCreate,
    requestRevoke,
    confirm,
    refresh: () => run(() => load(page)),
    changePage: (next: number) => run(() => load(Math.max(0, next))),
    cancelReview: () => {
      if (!pending.current) {
        reviewRef.current = null;
        setReview(null);
        setError(null);
      }
    },
    close: () => {
      if (!pending.current) {
        generation.current++;
        reviewRef.current = null;
        setReview(null);
        setCreated(null);
        setData(null);
        setOpen(false);
      }
    },
  };
}
