#!/bin/sh
# Creates one database per service (database-per-service pattern).
# Runs once, when the postgres volume is first initialised.
set -e
for db in auth_db property_db accounting_db commerce_db; do
  echo "Creating database $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE DATABASE $db;"
done
