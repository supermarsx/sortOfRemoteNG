---
title: Documents, spreadsheets and linked records
description: Keep private documents and simple service records in their owning database.
---

# Documents, spreadsheets and linked records

Open **Documents** from the top bar's right-hand **Management** group for a
dedicated browser tab. Show or hide this button under **Settings → Layout →
Documents** (search for “documents button”). The browser lists names and folders,
supports metadata-only search and folder filtering, and pages larger lists.
Opening a record reuses the protected editor; **Browse** returns to the list
without discarding your draft. Reopening the toolbar tab preserves your current
record and section.

Without a ready database the tab shows an actionable locked state. An initially
unbound tab belongs to the first database it opens; it never follows a switch to
a different database. Open Documents again for that other database. Documents,
attachments, people and tickets remain scoped to their original database.

Right-click a folder and choose **New document** or browse that folder's
documents. The Documents workspace also has People and Tickets sections for
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
