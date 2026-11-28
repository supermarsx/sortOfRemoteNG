# Interactive shell scripts over SSH

On POSIX servers, multiline Bash, sh and Auto scripts run as uploaded files in the connection's
existing SSH PTY. The reviewed text keeps its shebang and normalizes CRLF to LF;
the kernel selects that interpreter when present. Otherwise the selected shell
uses the existing interpreter resolution. Single-line commands keep their
existing direct-shell behavior. PowerShell and batch execution keep their
existing captured execution path.

Deployment captures the original backend session and shell ID, validates a
bounded script, uploads it with mode 0700, then queues one launch through that
shell's bounded mailbox. Upload does not hold the global SSH service guard.
Mode, timeout, I/O exclusion and shell-reader suspension are restored on every
worker exit. A closed or replaced shell cannot receive the command through a
replacement actor. There is no automatic retry or fallback to a non-PTY exec
channel.

The launched child inherits terminal stdin/stdout, so TTY tests, prompts,
progress displays, keyboard input, resize and Ctrl+C use the normal terminal
path. A subshell protects the login shell from a script's exit/settings. Its
cleanup trap removes the temporary file on normal completion and prints the
actual exit status. An abrupt remote disconnect can leave the mode-0700 file
in the remote temporary directory (or the SFTP home location); reconnect never retries the script automatically.
Launch acknowledgement records dispatch only, not confirmed completion; output
and the exit marker remain in the terminal. An ambiguous launch must be checked
there before another run.

The local optional POSIX PTY acceptance test uses the production launch builder
with a sh file that requires both TTY descriptors, prints progress, reads input
and exits 7. It runs via Cygwin script(1) on Windows or script(1) on Unix, with a
10-second timeout. This validates POSIX launch behavior; it is separate from a
physical SSH server or application-specific CLI acceptance run.

## SCP rejection and Windows servers

A completed SCP protocol rejection (-28) no longer quarantines the SSH actor.
The bundled libssh2 SCP error path frees its channel and resets its send state.
An interrupted or unknown open still quarantines it. Before any script executes,
a rejected SCP open can fall back to SFTP on the same original SSH session;
there is no direct connection or script replay. Failed partial SFTP uploads
remove only the file created by that upload.

SFTP resolves the target user's home instead of assuming `/tmp`; Windows drive
paths are normalized and PowerShell files receive a `.ps1` extension. Windows
launchers use an encoded PowerShell command, quote the remote path, honor the
selected interpreter and preserve its exit status. POSIX scripts on Windows
require the selected `bash.exe` or `sh.exe` to be installed. Windows execution
policy is retained. Interactive launches keep the existing PTY and clean up in
a `finally` block. Captured PowerShell launches keep their existing output path.

These changes have local launcher and gate regression coverage. A live Windows
OpenSSH server behind a Windows SSH tunnel is separate acceptance evidence.
