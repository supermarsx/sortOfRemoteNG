# Local braces depth guard

This is the npm `braces@3.0.3` distribution, retaining its MIT license and public
API, with a local fix for CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm. Upstream has no
patched published release as of 2026-10-20. The root override explicitly selects
this private local package; it is not an audit exception or an upstream release.

Source: https://registry.npmjs.org/braces/-/braces-3.0.3.tgz
Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
Upstream report and recommended depth bound:
https://github.com/micromatch/braces/issues/70

Changes: parser checks its actual nesting stack before opening either a brace
or parenthesis. Compile, expand and stringify check AST depth iteratively before
their recursive walkers run, including AST objects supplied directly by callers.
The hard ceiling is 100 levels and 50,000 AST nodes; options cannot disable it.
Oversized or cyclic ASTs fail predictably with `SyntaxError`, never stack overflow.
Normal escaping, quoting, ranges, expansions and matching semantics are unchanged.
Package identity/version identify this reviewed local patch and preserve the
original version separately. No installation hooks or new dependencies are added.

Regression: `node --test tests/tooling/bracesDepthGuard.node-test.mjs`.
Replace this override with a genuine fixed upstream release when available.
