// Trusted palette only: keep the document canvas dark while dynamic styles
// settle. No filters, layout changes, hidden content or additional network work.
function nativeAppearanceCanvasCss(theme) {
  if (!theme || !["dynamic", "dynamicFilter"].includes(theme.mode)) return "";
  for (const color of [theme.backgroundColor, theme.textColor]) {
    if (typeof color !== "string" || !/^#[a-f0-9]{6}$/i.test(color)) throw Error();
  }
  return `html:root,body{color-scheme:dark!important;background-color:${theme.backgroundColor}!important;color:${theme.textColor}!important;}`;
}
