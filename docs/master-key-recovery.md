# Master-key recovery and locking

Fresh setup never replaces an existing password receipt (`dek.enc`) or a profile with encrypted or unverifiable managed artifacts. Startup may read an existing OS-vault key, but may create one only when the vault confirms that the key is absent and the local profile passes the bounded evidence check. Permission, DPAPI, Keychain and filesystem errors are not treated as proof of an empty profile.

A password receipt can unlock a password-only profile without an OS vault. It also provides hybrid recovery when the original vault entry is missing or inaccessible. When neither receipt is usable, restore the original key or a verified backup; generating a new key cannot decrypt existing ciphertext.

Master setup, unlock, lock, password changes, portable import/export and storage representation changes share a native transaction coordinator. Trust-store reads and writes derive the current key at native I/O time: they do not depend on a renderer refresh event. Locking revokes that access, including creation of new plaintext trust stores. Protocol-thread trust operations fail closed while a key/storage transaction is running. Async database activation waits for the transaction; failed activation clears the active trust scope rather than reusing another database's trust.

Portable key import retains its existing local-data-loss acknowledgment guard. It persists replacement receipts before installing the live key and restores prior local/vault receipts on handled failures. Any rollback failure is reported explicitly. Password changes preserve the DEK and artifact formats; temporary password-wrap keys and plaintext DEK buffers are zeroized when dropped.

## Limits

The fresh-profile probe is read-only and examines bounded file headers in the application profile and known managed artifact directories. Its limit is 16,384 entries and 16 nested levels; unreadable, linked, damaged or over-limit managed data fails closed. It is not a search of arbitrary external backup destinations or a substitute for keeping recovery copies.

Full master-key rotation uses staged files and rollback copies for handled errors. It does **not** currently have a durable, application-wide phase journal and automatic crash recovery spanning all artifacts and both key receipts. Portable key import likewise does not claim process-crash or power-loss atomicity across the filesystem and OS vault. A crash during replacement can leave mixed generations requiring recovery from preserved receipts/backups. The separate per-database security journal does not remove this global-rotation limitation. Avoid interrupting these operations and keep a verified backup and portable recovery key before changing master-key material.

Automated checks use temporary profile files and injected vault operations, not actual user credentials. Windows error classification is tested locally; macOS Keychain classification requires its platform build/runtime for end-to-end verification.
