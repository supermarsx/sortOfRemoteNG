---
layout: default
title: Icon Explorer and custom icons
permalink: /guides/icon-library/
---

# Icon Explorer and custom icons

Use **Icon Explorer** to browse the built-in catalog, add personal labels and notes, and import your own vector icons. Built-in artwork and stable keys remain unchanged; your labels and notes are personal overrides. Imported artwork uses a new `custom:<uuid>` key, which saved connections and folders retain.

Custom icons also appear in the connection and folder icon pickers. Replacing or deleting an imported icon updates existing views. Deletion does not rewrite saved connections: an unavailable key remains saved, and the automatic icon is displayed until that icon is restored or another is selected.

## Import and review

Choose an SVG or a versioned JSON icon pack. Review the entries before applying them. For every conflicting key, explicitly choose whether to replace its artwork/metadata or skip it. A library change or global lock invalidates an open review; inspect the file again instead of applying an old decision.

SVG imports accept passive drawing elements only: paths, groups, circles, ellipses, rectangles, lines, polygons and nested SVG viewports. Scripts, event handlers, stylesheets, inline style, external resources, images, `use`, text, `foreignObject`, declarations and entities are rejected. Geometry must be finite and bounded. Files that rely on unsupported features need to be simplified in a vector editor first.

Limits are 64 KiB per SVG, 256 drawing nodes, 16 nesting levels, 250 custom icons and 1 MiB per JSON pack/library. Labels are limited to 120 characters and notes to 2,000. Import errors leave the current library unchanged.

## Export and portability

JSON packs preserve custom keys, validated vector artwork, labels and notes. Built-in selections are explicit catalog references with their labels and notes, not empty packs or bundled copies of built-in artwork. A receiving app needs those built-in keys in its own catalog. An individual SVG export contains the selected icon's artwork.

**Exported SVG and JSON files are plaintext.** JSON can contain your personal notes. Save them only to a destination appropriate for that information. Sharing a saved connection alone does not bundle its custom artwork; export the corresponding icon pack as well.

## Storage, locking and reset

In the desktop app, the library is stored through the existing global settings pipeline and follows the Settings artifact protection policy. It is not stored in a separate plaintext file or browser localStorage. Browser-only previews use the existing temporary, in-memory settings fallback; they do not provide desktop disk persistence.

A failed save does not install the new artwork or metadata. Global settings lock clears custom vectors and personal overrides from the active icon registry. Unlock reloads the stored library. Invalid stored icon data is withheld with an error, not treated as valid artwork or overwritten by an unrelated preference change.

Import icon libraries through Icon Explorer's reviewed pack workflow. Ordinary settings imports/saves cannot replace a different icon library and report that requirement. **Reset all settings** clears the custom library and personal overrides together with other settings; built-in artwork remains available.
