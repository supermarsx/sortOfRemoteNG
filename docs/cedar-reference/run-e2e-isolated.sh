#!/bin/bash
# SE-7 e2e helper: brings up the SoftEther test server and provisions
# the testuser on test_hub. Idempotent — safe to re-run between tests.
#
# Intended to be run from inside WSL/Linux, e.g.:
#   wsl -d Ubuntu -u root -- bash /mnt/f/.../docs/cedar-reference/run-e2e-isolated.sh
#
# Why: the siomiz/softethervpn image's entrypoint provisions the
# `USERS` env var onto the DEFAULT hub only. Our tests use test_hub
# (created by VPNCMD_SERVER=HubCreate), and need testuser mirrored
# onto it. This script does that after `docker compose up -d`.
#
# Exit 0 = server up and test_hub has testuser. Exit non-zero = fail.
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$COMPOSE_DIR"

COMPOSE_FILE="docker-compose.softether-test.yml"
CONTAINER="sorng-softether-test"
SPW="test-admin-pwd-CHANGE-ME"
HPW_TEST_HUB="test-admin-pwd-CHANGE-ME"

# Bring up (idempotent — no-op if already running).
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker compose -f "$COMPOSE_FILE" up -d >/dev/null
fi

# Wait for healthy.
for _ in $(seq 1 30); do
  STATUS=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  if [ "$STATUS" = "healthy" ]; then break; fi
  sleep 2
done

if [ "$STATUS" != "healthy" ]; then
  echo "FAIL: container not healthy (status=$STATUS)" >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

# Wait for test_hub to exist — VPNCMD_SERVER=HubCreate fires during
# entrypoint AFTER the port starts listening, so there's a brief race
# window where port 5555 is healthy but the hub isn't yet created.
for _ in $(seq 1 20); do
  if docker exec "$CONTAINER" /usr/vpnserver/vpncmd localhost /server \
        /password:"$SPW" /cmd:HubList 2>/dev/null \
      | grep -q 'test_hub'; then
    break
  fi
  sleep 1
done

# Idempotent UserCreate — succeeds on first, 'already exists' on repeat.
docker exec "$CONTAINER" /usr/vpnserver/vpncmd localhost /server \
  /password:"$SPW" /hub:test_hub /adminhub:"$HPW_TEST_HUB" \
  /cmd:"UserCreate testuser /group:none /realname:none /note:none" \
  >/dev/null 2>&1 || true

# UserPasswordSet is always-idempotent.
docker exec "$CONTAINER" /usr/vpnserver/vpncmd localhost /server \
  /password:"$SPW" /hub:test_hub /adminhub:"$HPW_TEST_HUB" \
  /cmd:"UserPasswordSet testuser /password:testpass123" \
  >/dev/null 2>&1

# Verify user actually exists — fail loudly if not.
if ! docker exec "$CONTAINER" /usr/vpnserver/vpncmd localhost /server \
      /password:"$SPW" /hub:test_hub /adminhub:"$HPW_TEST_HUB" \
      /cmd:UserList 2>/dev/null | grep -q 'testuser'; then
  echo "FAIL: testuser not created on test_hub" >&2
  exit 1
fi

echo ready
