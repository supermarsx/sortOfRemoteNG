import { useCallback, useRef, useState } from "react";

export const ECP_LOGIN_STOPPED = {
  text: "Automatic sign-in stopped; use manual sign-in.",
  detail:
    "The page helper did not find a ready supported sign-in form before its timeout. Continue manually in the page. This does not identify MFA or establish whether you are signed in, and does not retry sign-in.",
};

/** Advisory only. The caller supplies its already validated current document. */
export function useEcpLoginNotice(currentDocument: () => object | null) {
  const latest = useRef(currentDocument);
  latest.current = currentDocument;
  const [stoppedDocument, setStoppedDocument] = useState<object | null>(null);
  const receive = useCallback((result: unknown) => {
    if (
      !result ||
      typeof result !== "object" ||
      (result as { reason?: unknown }).reason !== "form-not-found-timeout" ||
      (result as { ok?: unknown }).ok !== false
    )
      return;
    const current = latest.current();
    if (current) setStoppedDocument(current);
  }, []);
  const current = currentDocument();
  return {
    receive,
    presentation:
      current && current === stoppedDocument ? ECP_LOGIN_STOPPED : null,
  };
}
