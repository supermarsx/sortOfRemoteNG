#!/bin/sh
set -eu
# Package-manager entry only. This is never a portable/AppImage launcher.
case "${1:-}" in
  configure) ;;
  abort-upgrade|abort-remove|abort-deconfigure) exit 0 ;;
  *) exit 1 ;;
esac
exec /usr/bin/python3 -I -B - <<'SORNG_FIXED_SANDBOX_PY'
@@PYTHON_BODY@@
SORNG_FIXED_SANDBOX_PY
