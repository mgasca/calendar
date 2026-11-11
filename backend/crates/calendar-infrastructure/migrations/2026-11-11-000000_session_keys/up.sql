-- The first migration written for the Rust backend. The session cookie is sealed with one symmetric key that
-- every replica shares. The table holds at most one row (id is always 1), so the first replica to start inserts
-- the key with INSERT ... ON CONFLICT (id) DO NOTHING and every replica, the winner included, then reads the
-- row that exists: concurrent first starts agree on one key without a lock.
CREATE TABLE session_keys (
    id smallint NOT NULL DEFAULT 1,
    key_material bytea NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pk_session_keys PRIMARY KEY (id),
    CONSTRAINT ck_session_keys_single_row CHECK (id = 1),
    CONSTRAINT ck_session_keys_key_material_length CHECK (octet_length(key_material) = 32)
);

-- The app reads the key and inserts it once; it never changes or removes it. Replacing the key (which ends
-- every session) is an operator action as calendar_migrator. The schema-wide defaults also grant UPDATE and
-- DELETE, so narrow this table.
REVOKE UPDATE, DELETE ON TABLE session_keys FROM calendar_app;

-- Diesel's history table is created by the migrator, so the schema-wide defaults gave the app role DML on it.
-- Only the migrator records migrations (ADR-0015); the app may read which ones are applied.
REVOKE INSERT, UPDATE, DELETE ON TABLE __diesel_schema_migrations FROM calendar_app;

-- The ASP.NET Core data-protection key ring protected the .NET session cookie; nothing reads it any more.
DROP TABLE data_protection_keys;
