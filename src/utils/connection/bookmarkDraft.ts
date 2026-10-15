import type { Dispatch, SetStateAction } from "react";
import type {
  Connection,
  HttpBookmarkItem,
} from "../../types/connection/connection";
import { resolveHttpBookmarkUrl } from "../protocol/httpBookmarkUrl";

export interface BookmarkDraft {
  source: Connection["httpBookmarks"];
  connectionId: string | undefined;
  protocol: Connection["protocol"] | undefined;
  parents: number[];
  index: number | null;
  item: HttpBookmarkItem;
  name: string;
  path: string;
  error?: string;
}
export interface BookmarkDraftControl {
  edit: BookmarkDraft | null;
  setEdit: Dispatch<SetStateAction<BookmarkDraft | null>>;
}

/** Validate against the exact draft tree reviewed by this editor. */
export function applyBookmarkDraft(
  data: Partial<Connection>,
  edit: BookmarkDraft | null,
): Partial<Connection> {
  if (!edit) return data;
  if (
    edit.source !== data.httpBookmarks ||
    edit.connectionId !== data.id ||
    edit.protocol !== data.protocol
  )
    throw new Error(
      "The bookmarks changed. Reopen this bookmark before saving.",
    );
  const name = edit.name.trim();
  if (!name) throw new Error("Enter a bookmark name.");
  let path = edit.path.trim();
  if (!edit.item.isFolder) {
    if (!resolveHttpBookmarkUrl(path, "https://bookmark-draft.invalid/"))
      throw new Error(
        "Enter a valid HTTP(S) URL or website path without embedded credentials.",
      );
    if (!path.startsWith("/") && !resolveHttpBookmarkUrl(path, path))
      path = `/${path}`;
  }
  const replacement: HttpBookmarkItem = edit.item.isFolder
    ? { ...edit.item, name }
    : { ...edit.item, name, path };
  const update = (
    rows: HttpBookmarkItem[],
    parents: number[],
  ): HttpBookmarkItem[] => {
    if (parents.length) {
      const [index, ...rest] = parents;
      const folder = rows[index];
      if (!folder?.isFolder)
        throw new Error(
          "The bookmark folder changed. Reopen it before saving.",
        );
      return rows.map((item, i) =>
        i === index
          ? { ...folder, children: update(folder.children, rest) }
          : item,
      );
    }
    if (edit.index === null) return [...rows, replacement];
    if (rows[edit.index] !== edit.item)
      throw new Error("The bookmark changed. Reopen it before saving.");
    return rows.map((item, i) => (i === edit.index ? replacement : item));
  };
  return {
    ...data,
    httpBookmarks: update(data.httpBookmarks ?? [], edit.parents),
  };
}
