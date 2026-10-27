#!/bin/sh
# Creates the application roles (ADR-0014). Runs once on an empty data directory, as the bootstrap
# superuser, from the postgres image's /docker-entrypoint-initdb.d. Also used by the Testcontainers fixture.
#   calendar_migrator  owns the schema and runs migrations
#   calendar_app       DML only on the tables the migrator creates; never DDL
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v dbname="$POSTGRES_DB" -v migrator_password="$CALENDAR_MIGRATOR_PASSWORD" -v app_password="$CALENDAR_APP_PASSWORD" <<'SQL'
CREATE ROLE calendar_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE calendar_app LOGIN PASSWORD :'app_password';

-- The migrator owns the database and, as its owner, can create objects in schema public (PostgreSQL 15+).
ALTER DATABASE :"dbname" OWNER TO calendar_migrator;
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO calendar_app;
GRANT USAGE ON SCHEMA public TO calendar_app;

-- Tables and sequences the migrator creates later automatically give the app role DML only.
ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO calendar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO calendar_app;
SQL
