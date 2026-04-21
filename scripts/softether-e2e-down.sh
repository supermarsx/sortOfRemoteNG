#!/usr/bin/env bash
# SE-7: tear down the local SoftEther test server after e2e runs.
#
# By design the e2e test suite does NOT tear down the server (leaves
# it up for dev iteration). Run this when you're done iterating and
# want to free the ports + Docker resources.
#
# Usage: ./scripts/softether-e2e-down.sh  [--volumes]
#   --volumes: also remove the named volume (wipes server state).

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docs/cedar-reference/docker-compose.softether-test.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "error: $COMPOSE_FILE not found" >&2
    exit 1
fi

if [[ "${1:-}" == "--volumes" ]]; then
    echo "tearing down SoftEther test server + volumes"
    docker compose -f "$COMPOSE_FILE" down -v
else
    echo "tearing down SoftEther test server (preserving volume)"
    docker compose -f "$COMPOSE_FILE" down
fi
