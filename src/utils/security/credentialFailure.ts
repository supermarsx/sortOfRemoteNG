/** Every way a credential copy or typing action can stop, with the one sentence
 * shown for it. Sentences are fixed literals: a failure never carries native
 * error text, a credential, or anything read from a page. */
const sentences = {
  // Resolving the credential.
  busy: "Another credential action is still running. Wait for it to finish, then try again.",
  "database-unavailable":
    "The owning database is closed or locked. Open and unlock it, then try again.",
  "connection-changed":
    "The saved connection changed while its credential was being read. Reopen Credentials & 2FA and try again.",
  "session-changed":
    "The session, its database or its saved connection changed before the credential could be used. Reopen Credentials & 2FA and try again.",
  "app-hidden":
    "The app was hidden before the credential could be used. Bring it to the front and try again.",
  "vault-unavailable":
    "The vault entry could not be read. Unlock the owning database and check that the entry still holds this field.",
  "username-empty": "No username is saved for this credential.",
  "password-empty": "No password is saved for this credential.",
  "resolution-timed-out":
    "Reading the credential took too long and was stopped. Check the owning database, then try again.",
  // Authenticator codes.
  "authenticator-unavailable":
    "The selected authenticator changed or was removed. Reopen Credentials & 2FA.",
  "authenticator-invalid":
    "This authenticator's digits, period or algorithm are not supported, so no code was generated.",
  "code-not-generated":
    "The code could not be generated safely. Check the authenticator secret, then try again.",
  "code-window-closing":
    "The current code is about to expire. Wait for the next code, then try again.",
  "code-expired":
    "The code expired before it could be used. Try again for a fresh code.",
  // Clipboard. The first four mirror the codes `secure_clip_copy` rejects with.
  "clipboard-locked":
    "Nothing was copied because the app is locked. Unlock it and try again.",
  "clipboard-busy":
    "Nothing was copied because another program is using the clipboard. Try again in a moment.",
  "clipboard-too-large":
    "Nothing was copied because the value is too large for the secure clipboard.",
  "clipboard-unavailable":
    "The clipboard could not be updated. Check the secure clipboard settings and try again.",
  "clipboard-timed-out":
    "The secure clipboard did not respond in time. Check whether the value was copied before trying again.",
  "clipboard-empty": "There is nothing to copy.",
  // Text that cannot be sent as key input.
  "text-empty": "There is nothing to type.",
  "text-too-long":
    "This value is longer than 1024 characters, so it cannot be typed. Copy it instead.",
  "text-control-character":
    "This value contains a tab, line break or another control character, so it cannot be typed. Copy it instead.",
  // Typing into a session or a website field.
  "typing-target-lost":
    "The typing target changed or is unavailable. Focus the session field and reopen Credentials & 2FA.",
  "typing-rejected":
    "The session did not accept the input. Review the field before trying again.",
  "typing-not-confirmed": "Typing stopped or was not confirmed.",
  "typing-unavailable":
    "Typing is unavailable for this website field. Choose Type to try again in an empty field on an allowed origin. HTTP typing is limited to the configured origin, including its port.",
  // The last six mirror the reasons `origin_browser_manual_input` rejects with.
  "typing-timed-out":
    "Typing timed out waiting for an empty website field. Choose Type to try again.",
  "typing-unsupported-frame":
    "This field is inside an embedded frame, where Type is not supported. Copy the value and paste it instead.",
  "typing-field-not-empty":
    "The selected website field already contains text. Clear it, then choose Type again.",
  "typing-focus-lost":
    "The app or the website field lost focus. Click the field, then choose Type again.",
  "typing-cancelled": "Typing was cancelled before it finished.",
  "typing-stale":
    "This website's browser session is no longer current. Reopen the website, then choose Type again.",
} as const;

export type CredentialFailureCode = keyof typeof sentences;
export const credentialFailureCodes = Object.keys(
  sentences,
) as CredentialFailureCode[];

const maybePartial =
  "Some characters may have been entered; review the field before trying again.";

/** `message` is always a catalogue sentence, so callers may show it as is. */
export class CredentialFailure extends Error {
  readonly code: CredentialFailureCode;
  /** Typing had started, so the destination may hold part of the value. */
  readonly partial: boolean;
  constructor(code: CredentialFailureCode, partial = false) {
    super(partial ? `${sentences[code]} ${maybePartial}` : sentences[code]);
    this.name = "CredentialFailure";
    this.code = code;
    this.partial = partial;
  }
}

/** What a copy or typing action reports instead of rejecting. */
export type CredentialOutcome =
  { ok: true } | { ok: false; code: CredentialFailureCode; message: string };

/** The failure itself when its cause is already known, otherwise `fallback`.
 * An unknown error's own text is never kept. */
export function toCredentialFailure(
  error: unknown,
  fallback: CredentialFailureCode,
  partial = false,
): CredentialFailure {
  return error instanceof CredentialFailure
    ? error
    : new CredentialFailure(fallback, partial);
}

export function failedOutcome(failure: CredentialFailure): CredentialOutcome {
  return { ok: false, code: failure.code, message: failure.message };
}

/** Stop waiting for `work` after `milliseconds`. This only bounds the wait: the
 * caller still revokes whatever `work` could do if it settles later. */
export function settleWithin<T>(
  work: T | PromiseLike<T>,
  milliseconds: number,
  failure: () => CredentialFailure,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(failure()),
      Math.max(0, milliseconds),
    );
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
