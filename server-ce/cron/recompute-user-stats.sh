#!/usr/bin/env bash

set -eu

echo "----------------------------"
echo "Recompute admin user-stats"
echo "----------------------------"
date

ENABLE_CRON_USER_STATS=$(cat /etc/container_environment/ENABLE_CRON_USER_STATS 2>/dev/null || echo "null")

if [[ "${ENABLE_CRON_USER_STATS:-null}" != "true" ]]; then
  echo "Skipping user-stats recompute due to ENABLE_CRON_USER_STATS not set to true"
  exit 0
fi

# A "full" recompute is requested via the first argument (weekly), otherwise the
# script runs incrementally. --full is needed periodically because a pure project
# deletion may not bump any remaining project's lastUpdated, so incremental runs
# can miss shrinking counts (see scripts/recompute_user_stats.mjs).
EXTRA_ARGS=""
if [[ "${1:-}" == "--full" ]]; then
  EXTRA_ARGS="--full"
fi

source /etc/container_environment.sh
source /etc/overleaf/env.sh
cd /overleaf/services/web && /sbin/setuser www-data node scripts/recompute_user_stats.mjs --commit ${EXTRA_ARGS}

echo "Done recomputing user-stats"
