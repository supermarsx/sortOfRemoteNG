# NAS file viewers

In a native Synology File Station session, select one file and choose **Preview file**. Use **Viewer settings** beside the file actions to configure app-wide preferences. No file is downloaded or opened merely by selecting it.

Built-in previews support UTF-8 text, PDF, PNG, JPEG, GIF and WebP in a separate restricted viewer process. HTML, SVG and source files are shown only as inert text. The main application receives a viewer handle and file metadata, not file contents, image data or a PDF document. No in-app PDF/image renderer is used for NAS previews. This is OS-backed WebView process isolation, not a VM or a guarantee against every sandbox escape.

The isolated preview implementation currently supports Windows. Unsupported platforms or unavailable sandbox helpers report an error and refuse preview; they do not fall back to an unrestricted in-app renderer. Viewer settings are shared across platforms but do not override this restriction.

Settings include independent preview and external-opening switches for each file type, a 1–16 MiB preview limit, text wrapping and font size, and image fit or actual-size display. The default preview limit is 4 MiB. A failed download or unsupported format displays an error without opening another application. Changing folder, selected file, session, owner access or viewer policy closes the captured viewer, including a viewer whose launch completes late. **Close preview** closes that exact viewer; if closing fails, the action remains available to retry. The separate viewer window can also be closed directly.

At most four separate previews can run at once. Startup has a 20-second limit, and previews automatically close after 30 minutes or when their NAS session is revoked. Each viewer uses a new private browser profile; its process tree is terminated on close and profile cleanup is retried briefly. Cleanup is best effort if Windows keeps a filesystem handle open, not a promise of secure erasure.

## External applications

External opening is disabled by default. Enable the required type in **Viewer settings**, then use **Open externally** for the configured system-default or choose-each-time mode. **Open with…** always opens the native application picker. Application command templates and custom arguments are not accepted.

By default, each action asks for confirmation before a file is downloaded. The external-file limit is configurable from 1–32 MiB (default 16 MiB). A unique temporary plaintext local copy is created, with a safe canonical extension. Text is always saved as `.txt`, never as an executable script. Files are not overwritten and edits are not sent back to the NAS.

An external application is not sandboxed by this app; it may activate PDF actions or other file features and may retain its own copies. Cleanup is attempted after the configured 5–1440 minutes (default 30 minutes) or when the NAS session closes. An application holding a file open may prevent cleanup. This is not a guarantee of secure erasure or removal of copies created by other applications. Cancelling the picker does not report a successful open.
