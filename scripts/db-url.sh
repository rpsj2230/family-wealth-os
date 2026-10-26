#!/usr/bin/env bash
# Prints a working Postgres connection URL for the Supabase project through its connection pooler (session mode).
# GitHub runners have no IPv6, so the direct database host cannot be used. Needs SUPABASE_DB_PASSWORD; the project
# reference is public. The project's region is tried first, then the others, so a region mix-up cannot break jobs.
set -uo pipefail
ref="${SUPABASE_PROJECT_REF:-imrrsvpqdazjojeescwl}"
pw=$(python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"],safe=""))')
regions="ap-southeast-2 ap-south-1 ap-southeast-1 ap-northeast-1 ap-northeast-2 us-east-1 us-east-2 us-west-1 us-west-2 eu-west-1 eu-west-2 eu-west-3 eu-central-1 eu-north-1 ca-central-1 sa-east-1"
for region in $regions; do
  for n in 0 1; do
    host="aws-$n-$region.pooler.supabase.com"
    url="postgresql://postgres.${ref}:${pw}@${host}:5432/postgres"
    if psql "$url" -Atc 'select 1' >/dev/null 2>&1; then
      echo "Connected through $host" >&2
      echo "$url"
      exit 0
    fi
  done
done
echo "Could not reach the database through any pooler host. Check the SUPABASE_DB_PASSWORD secret." >&2
exit 1
