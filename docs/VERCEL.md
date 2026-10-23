# Vercel web deployment without Redis

For the simpler first-admin flow, use [/setup](https://velatradingbot.vercel.app/setup)
and follow [the browser setup guide](SETUP.md). It applies schema migrations itself
when authorized by your temporary SETUP_TOKEN and a migration-capable connection.
The manual migration/bootstrap instructions below remain available for CLI setups.

The website and login no longer require REDIS_URL or a separate Redis service.
Apply migrations through 004 before using login (`npm run migrate` with your
migration administrator connection in a trusted setup environment). Existing
databases with 001–003 already applied need only 004. Do not put administrator
database credentials in the web runtime.

Required web settings, in addition to the automatically supplied runtime database
connection: APP_ORIGIN (exact HTTPS origin, no trailing slash) and SECRET_KEY_HEX
(32 random bytes as 64 hex characters; keep the same key used to bootstrap MFA).
Initial admin creation and database schema setup are still required.

Login attempt limits are now stored atomically in PostgreSQL: 10 attempts per
normalized username hash per 15-minute fixed window. All web instances share the
same counter. A database error blocks login rather than bypassing the limit.
Periodically delete expired login_attempts rows with a trusted maintenance role;
active attempts reset their expired row automatically. No plaintext username is
stored in this table.

AI and Telegram environment settings are optional integrations and unchanged.
MT5 stays on a separate Windows agent. The existing BullMQ worker is optional
infrastructure and still needs Redis if an operator explicitly starts it; do not
start that worker for this web-only deployment. No trading pipeline is enabled
by this change and live execution remains disabled.

Validation: unit tests cover decision boundaries, key normalization, and
fail-closed errors. The PostgreSQL concurrency test requires an isolated test
database with migrations through 004 and TEST_DATABASE_URL /
TEST_ADMIN_DATABASE_URL. Skipped tests do not count as a database verification.
