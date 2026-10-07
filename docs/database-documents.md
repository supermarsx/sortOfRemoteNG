---
title: Documents, spreadsheets and linked records
description: Keep private documents and simple service records in their owning database.
---

# Documents, spreadsheets and linked records

Open **Documents** from the top bar's right-hand **Management** group for a
dedicated browser tab. Show or hide this button under **Settings → Layout →
Documents** (search for “documents button”). The browser lists names and folders,
supports search and folder filtering, and pages larger lists.
Opening a record reuses the protected editor; **Browse** returns to the list
without discarding your draft. Reopening the toolbar tab preserves your current
record and section.

Without a ready database the tab shows an actionable locked state. An initially
unbound tab belongs to the first database it opens; it never follows a switch to
a different database. Open Documents again for that other database. Documents,
attachments, people and tickets remain scoped to their original database.

Right-click a folder and choose **New document** or browse that folder's
documents. The creation dialog lets you choose a name, icon, folder and starting
layout; cancelling does not create a record, and Create adds an unsaved draft.
Database-specific document-type settings restrict new layouts, blocks and imports,
without removing or hiding existing content. Blank creates an empty container and
requires at least one enabled block type.

Settings → Current Database → Document types controls the 13 block types plus
People and Tickets for that database. Legacy databases enable all 15 by default.
The preference travels with database backups and imports, not with global app
settings. Disabling a type limits creation, adding blocks and imports; existing
records can still be read, edited, exported or deleted. These content preferences
do not replace the required encryption protection.

The Documents workspace also has People and Tickets sections for
simple local service records. These are database-owned records, not a separate
cloud service. Open the owning database in the desktop app with at least one
verified protection layer: either unlocked managed database protection or active
global **Connections** encryption with its key unlocked and the existing file
encrypted. An OS-vaulted global key is supported. A stored/unlocked key or an
encryption preference alone is not proof that this database file is protected;
native storage checks the applicable policy and authenticated encrypted file.
If its key is unavailable, unlock it under **Settings → Security**, reopen the
database and retry. No plaintext fallback library is created. A locked managed
database remains locked even when an outer global encryption layer exists.

Give a document a name, icon and folder, then add blocks: formatted text,
Markdown, notes, passwords, Wi-Fi details and QR codes, accounts, identification
details, attachments, links, diagrams or spreadsheets. Sensitive fields are
hidden until explicitly revealed. Save commits the whole draft to the owning
database. A failed save retains your edits. Switching databases or closing the
workspace warns about unsaved changes; locking storage hides private content.

The document editor header keeps the editable title and icon together, with a
searchable folder selector showing nested folder paths. Click the icon to open
the focused icon-library chooser; Escape closes it without changing the icon.
The command bar groups Browse, Print, Export text, Delete and Save, and remains
visible while scrolling in wider editor panes. Smaller panes wrap the controls
instead of pinning a tall header over the document. Ctrl+S / Cmd+S saves from
inside the document editor. The status refers to the **whole library draft**, not
only the selected document; a failed save retains the draft and requires review.

### Writing and edit history

**Write** is the compact, inline editing view. Type ordinary paragraphs and use
Markdown shortcuts for headings, lists and formatting. Type `/` at the start of
a paragraph to search the insert menu, then choose a spreadsheet, diagram,
attachment or another enabled block. Arrow keys navigate, Enter inserts and
Escape dismisses. Attachment and reference pickers leave your text unchanged
when cancelled. **Blocks** retains the explicit block management view.

The header's **Undo** and **Redo** controls restore document edits, including
title, icon, folder and content. Their dropdowns list named changes and let you
step through several changes at once. Normal text-editor keyboard undo remains
local to the text being edited. Header history is temporary and bounded to 50
steps and approximately 32 MiB per editor; it is cleared when the owning document
or storage changes, locks, or becomes stale. Restoring a step changes the draft;
use Save to persist it. Save still commits the entire library draft. Older steps
may be released for large documents, with a notice in the history controls.

### Search and the connection tree

Under **Settings → Layout → Documents**, enable **Show documents in connection
tree** to include the current database's documents alongside its connections.
Tree filters select connections, documents or both, and can narrow document
types. Documents remain in their database folder hierarchy; they are not
connectable sessions or draggable connections. App-wide documents remain in
the Documents workspace. Tree visibility is off by default.

**Search document contents** is also **off by default**. Enabling it adds ordinary
document text, captions, labels, diagrams and spreadsheet contents to document
search in the workspace and tree. Structured passwords and identity/account
fields are excluded. Ordinary prose and spreadsheet cells may still contain
private information: they are searched only in available, unlocked storage,
without creating a persistent content index. Formulas are searched as text,
not evaluated. Disabling the option immediately returns to name search.

## Spreadsheets and links

The spreadsheet editor supports multiple sheets, cell editing, formatting,
supported formulas, sorting, filters and validation. You can link a document or
cell to a connection, another document or cell, a person or a ticket. Adding a
link never opens a connection automatically. Links are scoped to their database;
opening a different database does not redirect them to an unrelated record.

Spreadsheet engines load only when needed. Network formulas, macros, external
workbook references and arbitrary active content are not enabled. This is not a
complete Excel replacement. Review import warnings before saving; advanced Excel
formatting, validation and filter features may not survive conversion.

### Network scan results

In Network Scanner, use **Export to Documents** on a completed/stopped scan or a
saved history entry. Choose all hosts or the current filtered hosts (across all
pages), a document name, and its storage and folder. Database storage is the
default; available App-wide storage can be chosen explicitly. Saving adds a new
spreadsheet document with **Scan**, **Hosts**, **Services** and **Probes** sheets,
including timestamps, the executed scan configuration and identification
evidence. Scanned text is stored as literal cell values, never as formulas.

The export preserves existing documents and requires available, unlocked storage
and permission to create spreadsheets. Save or discard any pending Documents
draft in the chosen storage before exporting; the dialog provides an action to
open that workspace. A storage switch or lock invalidates the export dialog.
After a successful save, **Open document** opens the new spreadsheet. Oversized
exports are rejected without truncation; narrow the host filter or export CSV.

## Import, export and printing

- Protected document archives use a separate export password. Imports are
  reviewed before they add records, and do not silently replace existing ones.
- CSV and XLSX import/export are available for spreadsheets. CSV is values-only;
  app-specific record links are not portable spreadsheet relationships.
- Markdown and text can be imported as document content. PDF and supported image
  attachments are previewed locally. PDF preview is not a PDF editing tool.
- Text/Markdown export and system printing produce a readable text rendition,
  not a pixel-perfect export of every interactive block. Structured secrets are
  masked by default; including them requires an explicit choice.

Unprotected exports can still include private ordinary notes and cell contents,
even when structured secrets are masked. Review the warning and choose a trusted
destination in the native save dialog. Cancelling that dialog does not save a
file. Attachments and diagrams are bounded and sanitized; HTML/script imports
are not executable document blocks.

People and Tickets provide basic local records and links only. They do not
provision operating-system accounts, synchronize an external ITSM platform or
execute actions just because a document contains a connection reference.

People and tickets support up to 32 tags of 64 UTF-8 bytes each. Tags are trimmed
and deduplicated without case sensitivity, saved with the protected database, and
preserved in protected document archives. Suggestions come only from the current
database. Service Desk combines text, status, priority and exact-tag filters with
matching counts and Clear filters; these filters do not remove records and reset
when the owning database changes. Full-text document search is a separate,
opt-in setting and does not expand People or Tickets searches.
