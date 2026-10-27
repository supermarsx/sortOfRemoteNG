#!/bin/sh
set -eu
# RPM %post supplies 1 for install and 2 for upgrade; no caller path argument.
case "${1:-}" in
  1|2) ;;
  *) exit 1 ;;
esac
exec /usr/bin/python3 -I -B - <<'SORNG_FIXED_SANDBOX_PY'
@@PYTHON_BODY@@
SORNG_FIXED_SANDBOX_PY
