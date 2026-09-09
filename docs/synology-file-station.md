---
title: Synology File Station
eyebrow: Use the app
description: Browse and manage NAS files with session-scoped DSM login and one-time-code authentication.
permalink: /synology-file-station/
---

Open **Synology NAS Manager**, enter the NAS hostname, DSM port, username and password, then choose **Connect**. File Station opens at the shared-folder list; open a share to manage files. The existing administration tabs remain available when your account has permission.

## Sign in and two-factor authentication

HTTPS is enabled by default on port **5001** and verifies the server certificate. Use the hostname covered by the certificate and a trusted certificate chain. Certificate errors are not bypassed. Explicitly choosing HTTP leaves the port unchanged and sends credentials without TLS encryption.

If DSM requests a one-time password, enter the current code in the **Two-factor authentication** popup. An invalid code can be retried; Cancel clears the pending password and code. Codes are cleared after every attempt. This form does not save credentials, enroll authenticators, generate website recovery codes, or remember a device to bypass future 2FA.

The API supports DSM one-time-code authentication. **Approve sign-in, security keys and other browser-only authentication are not completed by this explorer.** If DSM requires an unsupported method, review your account's available methods in DSM using your browser. Signing into that browser does not authenticate this API session. See Synology's [DSM login API guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Os/DSM/All/enu/DSM_Login_Web_API_Guide_enu.pdf) and [two-factor authentication documentation](https://kb.synology.com/en-global/DSM/help/DSM/SecureSignIn/2factor_authentication?version=7).

## Manage files

- Browse with folder names, breadcrumbs, the parent-folder button, or an absolute NAS folder path. Lists use pages of up to **100** entries with name, size, type and modified-time sorting.
- Search within an open shared folder. Search results are paginated; clear the search field and choose **Search** to return to the folder list.
- Select individual entries or the current page. Create folders, rename one entry, or review a multi-selection before copying, moving or deleting it. Copy and move require an existing absolute destination inside a share.
- **Upload** opens the native local-file chooser. **Download** saves one selected file through the native Save dialog: choose a **new filename**, because existing local files are never overwritten, even if the operating-system dialog offers overwrite confirmation. Cancelling the dialog is not reported as a successful transfer. Existing destination files are not overwritten or silently skipped.

Copy, move, delete and search wait for the NAS task's completion, not merely acceptance of the request. Known progress is shown; **Cancel task** requests cancellation without undoing changes already made. Inspect the NAS afterward. Failed cancellation remains visible and can be retried. No file operation is automatically retried.

Delete recovery depends on the NAS shared-folder recycle-bin configuration and is not guaranteed. NAS shares themselves cannot be created or deleted from this file explorer. Permissions, quotas, application availability and DSM version can limit individual operations.

Changing or disconnecting the NAS invalidates open file-action reviews. Native operations are tied to the captured session, including after local file dialogs; stale callbacks cannot operate on a replacement NAS session. Closing the panel clears pending login secrets and requests cleanup of owned tasks and sessions.
