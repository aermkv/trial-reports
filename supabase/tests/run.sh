#!/bin/sh
# Local test: needs a Postgres 16 on /tmp:5499. Rebuilds the test DBs each run.
set -e
cd "$(dirname "$0")/.."
P="-h /tmp -p 5499 -U postgres"
run_migrations() { for f in migrations/0001_trial_reports.sql migrations/0003_fix_insert_rls.sql migrations/0004_add_member_rpc.sql $1; do psql -q $P -d $2 -v ON_ERROR_STOP=1 -f $f 2>&1 | grep -v NOTICE || true; done; }
# 0001 rules (before the route change)
dropdb $P --if-exists trtest; createdb $P trtest
psql -q $P -d trtest -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql
run_migrations "" trtest
psql $P -d trtest -f tests/test_0001.sql 2>&1 | grep -E "PASSED|ERROR" || true
# the 8-step route; 0005 run twice to check it re-runs cleanly
dropdb $P --if-exists trtest5; createdb $P trtest5
psql -q $P -d trtest5 -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql
run_migrations migrations/0005_routing_roadmap.sql trtest5
psql -q $P -d trtest5 -v ON_ERROR_STOP=1 -f migrations/0005_routing_roadmap.sql 2>&1 | grep -v NOTICE || true
psql $P -d trtest5 -f tests/test_0005.sql 2>&1
