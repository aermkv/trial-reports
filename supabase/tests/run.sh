#!/bin/sh
# Local test: needs a Postgres 16 on /tmp:5499 (see README). Rebuilds the test DB each run.
set -e
P="-h /tmp -p 5499 -U postgres"
dropdb $P --if-exists trtest; createdb $P trtest
psql -q $P -d trtest -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql -f migrations/0001_trial_reports.sql 2>&1 | grep -v NOTICE || true
psql -q $P -d trtest -v ON_ERROR_STOP=1 -f migrations/0001_trial_reports.sql 2>&1 | grep -v NOTICE || true
psql $P -d trtest -f tests/test_0001.sql 2>&1
