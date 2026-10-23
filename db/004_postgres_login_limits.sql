-- Login security now uses the existing database; web does not require Redis.
CREATE TABLE login_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 11),
  resets_at timestamptz NOT NULL
);
CREATE INDEX login_attempts_expiry ON login_attempts(resets_at);
GRANT SELECT, INSERT, UPDATE ON login_attempts TO forex_app;
