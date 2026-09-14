/** Pure checks: source checks inspect the Liquid contract; only --site validates rendered JSON. */
export function validateSearchSource(source) {
  if (source === null)
    return ["docs/search.json: search index template is missing"];
  const errors = [];
  const require = (pattern, message) => {
    if (!pattern.test(source)) errors.push(`docs/search.json: ${message}`);
  };
  require(/^---\r?\n[\s\S]*?\r?\n---/, "index needs Jekyll front matter");
  require(/^layout:\s*null\s*$/m, "index must not use an HTML layout");
  require(/^permalink:\s*['"]?\/search\.json['"]?\s*$/m, "index must publish /search.json");
  require(/^search:\s*false\s*$/m, "index must exclude itself from search");
  require(/site\.pages\s*\|\s*sort:\s*['"]url['"]/, "index must enumerate sorted site.pages, not sidebar-only links");
  require(/entry\.title\s+and\s+entry\.layout\s*==\s*['"]default['"]/, "index must require titled default-layout pages");
  for (const property of ["search", "published"])
    require(new RegExp(
      `entry\\.${property}\\s*!=\\s*false`,
    ), `index must honor ${property}: false`);
  for (const directory of ["plans", "cedar-reference", "assets"])
    require(new RegExp(
      `directory\\s*==\\s*['"]${directory}['"]`,
    ), `index must exclude ${directory}`);
  require(/entry\.path\s*==\s*['"]README\.md['"]/, "index must exclude README.md");
  require(/entry\.url\s*==\s*['"]\/404\.html['"]/, "index must exclude the error page");
  require(/url_tail\s*==\s*['"]\/['"]\s+or\s+url_extension\s*==\s*['"]\.html['"]/, "index must limit entries to HTML page routes");
  require(/"url"\s*:\s*\{\{\s*entry\.url\s*\|\s*relative_url\s*\|\s*jsonify\s*\}\}/, "URLs must use relative_url and jsonify");
  for (const field of ["title", "description", "content"])
    require(new RegExp(
      `"${field}"\\s*:\\s*\\{\\{\\s*entry\\.${field}[^}]*\\|\\s*strip_html[^}]*\\|\\s*normalize_whitespace[^}]*\\|\\s*jsonify\\s*\\}\\}`,
    ), `${field} must be plain normalized JSON text`);
  require(/entry\.content\s*\|\s*markdownify/, "content must include rendered page text");
  if (/\|\s*(?:truncate|truncatewords)\b/.test(source))
    errors.push(
      "docs/search.json: index must not truncate searchable page content",
    );
  return errors;
}

/** Mirrors the documented generator eligibility, without attempting to render Liquid. */
export function isSearchableDocument({
  relativePath,
  route,
  data,
  hasFrontMatter,
}) {
  return !!(
    hasFrontMatter &&
    route &&
    data.title?.trim() &&
    (data.layout === undefined || data.layout === "default") &&
    data.search !== "false" &&
    data.published !== "false" &&
    !relativePath.startsWith("_") &&
    !["plans", "cedar-reference", "assets"].includes(
      relativePath.split("/")[0],
    ) &&
    relativePath !== "README.md" &&
    route !== "/404.html" &&
    (route.endsWith("/") || route.endsWith(".html"))
  );
}

function indexedRoute(url, baseUrl) {
  if (
    typeof url !== "string" ||
    !url.startsWith("/") ||
    url.startsWith("//") ||
    /[\\?#\s\u0000-\u001f\u007f]/u.test(url) ||
    /%(?:2f|5c)/i.test(url)
  )
    return null;
  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return null;
  }
  if (
    /[\\?#\u0000-\u001f\u007f]/u.test(decoded) ||
    decoded.includes("//") ||
    decoded.split("/").some((part) => part === "." || part === "..")
  )
    return null;
  if (baseUrl && !decoded.startsWith(`${baseUrl}/`)) return null;
  const route = baseUrl ? decoded.slice(baseUrl.length) : decoded;
  return route.endsWith("/") || route.endsWith(".html") ? route : null;
}

export function validateGeneratedSearch(
  source,
  { baseUrl = "", generatedRoutes, expectedRoutes },
) {
  if (source === null)
    return ["search.json: generated search index is missing"];
  if (Buffer.byteLength(source, "utf8") > 64 * 1024 * 1024)
    return [
      "search.json: generated search index exceeds the 64 MiB validation limit",
    ];
  let entries;
  try {
    entries = JSON.parse(source);
  } catch {
    return [
      "search.json: generated search index is not valid JSON (Liquid must be rendered)",
    ];
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 5000)
    return ["search.json: generated index must be a nonempty bounded array"];
  const errors = [];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const context = `search.json: entry ${index + 1}`;
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 4 ||
      !["title", "url", "description", "content"].every(
        (field) => typeof entry[field] === "string",
      )
    ) {
      errors.push(
        `${context}: expected exactly title, url, description and content strings`,
      );
      continue;
    }
    if (
      !entry.title.trim() ||
      !entry.content.trim() ||
      !/[\p{Letter}\p{Number}]/u.test(entry.content)
    )
      errors.push(
        `${context}: title and useful searchable content must not be empty`,
      );
    const route = indexedRoute(entry.url, baseUrl);
    if (!route) {
      errors.push(`${context}: unsafe URL or URL outside configured baseurl`);
      continue;
    }
    if (seen.has(route))
      errors.push(`${context}: duplicate indexed page ${route}`);
    seen.add(route);
    if (!generatedRoutes.has(route))
      errors.push(
        `${context}: indexed URL has no generated HTML page: ${route}`,
      );
    if (!expectedRoutes.has(route))
      errors.push(
        `${context}: indexed page is excluded or not a searchable source document: ${route}`,
      );
  }
  for (const route of expectedRoutes)
    if (!seen.has(route))
      errors.push(
        `search.json: searchable source page is missing from index: ${route}`,
      );
  return errors;
}
