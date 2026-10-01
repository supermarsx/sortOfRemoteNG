import { useCallback, useRef, useState } from "react";

export const CLAUDE_EMAIL_VERIFICATION = {
  text: "Continue with Claude’s email verification.",
  detail:
    "If Claude sent a sign-in link or code, follow its instructions to continue. The email helper does not read your inbox or complete verification. This advisory does not confirm that an email was sent or that you are signed in.",
};

/** Advisory only: the caller validates source, provider and active document. */
export function useClaudeLoginNotice(currentDocument: () => object | null) {
  const latest = useRef(currentDocument);
  latest.current = currentDocument;
  const [handoffDocument, setHandoffDocument] = useState<object | null>(null);
  const receive = useCallback((result: unknown) => {
    if (
      !result ||
      typeof result !== "object" ||
      (result as { reason?: unknown }).reason !==
        "manual-email-verification-required" ||
      (result as { ok?: unknown }).ok !== false
    )
      return;
    const current = latest.current();
    if (current) setHandoffDocument(current);
  }, []);
  const current = currentDocument();
  return {
    receive,
    presentation:
      current && current === handoffDocument ? CLAUDE_EMAIL_VERIFICATION : null,
  };
}
