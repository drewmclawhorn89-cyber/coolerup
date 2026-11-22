#!/bin/bash
# Rebuild the throwaway database and run migration 0030 against it.
set -e
cd /workspace/repo2
su postgres -c "dropdb --if-exists t30" >/dev/null 2>&1 || true
su postgres -c "createdb t30"
su postgres -c "psql -q -d t30 -c 'create role anon; create role authenticated; create role service_role;'" >/dev/null 2>&1 || true
su postgres -c "psql -q -d t30 -v ON_ERROR_STOP=1 -f $PWD/supabase/test-harness-0030.sql" >/dev/null
su postgres -c "psql -q -d t30 -v ON_ERROR_STOP=1 -f $PWD/drizzle/migrations/0030_instant_takedown.sql" 2>&1 | grep -i "error" || true
su postgres -c "psql -q -d t30 -v ON_ERROR_STOP=1 -f $PWD/supabase/test-0030.sql"
