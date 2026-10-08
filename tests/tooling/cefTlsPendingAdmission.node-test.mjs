import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("handshake retry accepts a pending app admission after native verification completes", () => {
  const patch = readFileSync(
    new URL(
      "../../native/cef-patches/154.0.8037.58-682c378/0001-chromium-socket-admission.patch",
      import.meta.url,
    ),
    "utf8",
  );
  const section = patch
    .split("diff --git a/net/socket/ssl_client_socket_impl.cc ")[1]
    .split("\ndiff --git ")[0];
  const after = section
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        line.startsWith(" "),
    )
    .map((line) => line.slice(1))
    .join("\n");
  assert.match(
    after,
    /SSL_ERROR_WANT_CERTIFICATE_VERIFY[\s\S]*DCHECK\(cert_verifier_request_ \|\|\s*\(context_->tls_admission_delegate\(\) &&\s*tls_admission_state_ == TlsAdmissionState::kPending\)\);\s*next_handshake_state_ = STATE_HANDSHAKE;\s*return ERR_IO_PENDING;/,
  );
  // Keep independent admission and payload checks, not a certificate bypass.
  assert.match(
    after,
    /tls_admission_state_ = TlsAdmissionState::kPending;\s*admission->Verify/,
  );
  assert.match(after, /tls_admission_state_ != TlsAdmissionState::kAllowed/);
  assert.match(after, /weak_factory_\.GetWeakPtr\(\)/);
});
