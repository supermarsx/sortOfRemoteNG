# Verified master-key recovery

Create an offline backup while the profile is healthy: Settings → Security → Encryption at rest → Export portable master key. Choose a native file-picker destination and a strong, separate export password. The `.dek` file is authenticated and password protected using the existing Argon2id/AES-GCM portable format. Anyone with both the file and its password can recover the key; store them separately. A backup made before a master-key rotation may no longer prove membership of the current profile.

If the vault receipt cannot be loaded, the local password receipt is damaged, or the loaded key contradicts current encrypted evidence, the unlock screen offers **Recover from portable .dek**. Select the original backup, enter its export password, and enter and confirm a new local master password.

Native recovery authenticates the backup and then checks current canonical profile evidence. The authenticated artifact policy and key ring are preferred authority; canonical encrypted settings or the database index can provide evidence where those are absent. Historical `.bak` files, retired keys and unauthenticated headers cannot alone authorize recovery. Conflicting primary evidence refuses recovery; independently damaged secondary artifacts are reported without pretending that restoring a key repairs their contents. A fresh profile without proof uses normal setup/import, not this same-profile recovery operation.

After verification, wait for the native 10-second safety delay and explicitly confirm. The one-use challenge expires after two minutes and is bound to the window, profile, key generation, selected file, existing receipt, current proof and transaction-control fingerprints. Cancellation, expiry, native lock or key replacement discards the pending candidate. The countdown is a confirmation safeguard, not a brute-force defense; native enforcement cannot be bypassed by changing the UI timer.

Recovery changes only `dek.enc`, wrapping the verified original key under the new local password. Existing receipt bytes are retained in a uniquely named `dek.enc.recovery-….bak` before replacement. Verification or write failures do not report success; rollback failure explicitly asks you to preserve the recovery backup. The OS vault, artifact protection policy, database key slots and encrypted user data are not replaced or reset. Password-only recovery therefore does not require a functioning OS vault. Use the new local password on subsequent starts.

Recognized interrupted artifact/database security transactions remain untouched and fingerprint-bound during key restoration. Restoring their original key permits their existing coordinated recovery; it is not a claim that all storage is immediately usable. When an artifact transaction prevents settings from loading, the blocking settings notice offers **Recover interrupted storage operation** after the master key is loaded. Database transaction recovery remains in the existing database access path. Unfinished master-key rotation sidecars refuse this recovery flow and require preserving the existing files for diagnosis.

Settings also offers **Inspect master-key health**. This is an explicit bounded inspection of canonical evidence, not a periodic scan or a complete integrity check of every backup, database and recording. Ordinary status reports cached last-inspected health. A confirmed loaded-key mismatch locks native key state and revokes dependent sessions before displaying the critical failure; it does not merely cover the UI.

The generic vault secret APIs cannot read or mutate the application's master-key receipt or internal key slots. The legacy direct key-creation command refuses, and legacy vault storage writes require an already existing receipt rather than creating a replacement key on failure.

Recovery backups and external exports are not securely erased. Filesystem snapshots, previous exports and other external copies remain outside this operation. Keep the original profile and backup files until access has been independently confirmed.

## Existing setup and locking

Fresh setup never replaces an existing password receipt (`dek.enc`) or a profile with encrypted or unverifiable managed artifacts. Startup may read an existing OS-vault key, but creates one only when the vault confirms that the key is absent and the local profile passes its bounded evidence check. Permission, DPAPI, Keychain and filesystem errors are not proof of an empty profile. A password receipt can unlock without a functioning OS vault; a new key cannot decrypt existing ciphertext.

The read-only fresh-profile probe checks bounded file headers in the application profile and known managed directories, with limits of 16,384 entries and 16 nested levels. Unreadable, linked, damaged or over-limit managed data fails closed. This is not a search of arbitrary external backup destinations and is separate from recovery's authenticated current-key proof.

Master setup, unlock, lock, password changes, portable import/export and representation changes share the native transaction coordinator. Trust-store I/O derives the current key at operation time, not from renderer refresh events. Locking revokes access, including creating new plaintext trust stores. Protocol-thread trust I/O fails closed during a key/storage transaction; asynchronous database activation waits, and failed activation clears the active trust scope rather than reusing another database's trust. Password changes retain the DEK and artifact formats; temporary password-wrap keys and plaintext DEK buffers are zeroized on drop.

## Separate replacement and rotation limitations

The legacy portable **replacement import** is not the verified same-profile recovery operation above. It retains its local-data-loss acknowledgment guard, persists replacement receipts before installing the live key, and attempts to restore previous local/vault receipts on handled errors. Rollback failures are explicit. It does not claim process-crash or power-loss atomicity across the filesystem and OS vault.

Full master-key rotation stages files and keeps rollback copies for handled errors. It still lacks a durable, application-wide phase journal and automatic crash recovery spanning all artifacts and both key receipts. A crash may leave mixed generations requiring preserved receipts/backups. Neither the per-database security journal nor verified same-DEK receipt recovery removes this global limitation. Do not interrupt these operations; keep a verified backup and portable key before changing master-key material.

Automated checks use temporary profile files and injected vault operations, not real credentials. Windows error classification is tested locally; macOS Keychain classification still requires its platform build/runtime for end-to-end verification.
