import {digest} from './security';

type Database = {
  query(sql:string, values:string[]):Promise<{rows:{attempts:number;retry_after:number}[]}>;
};

// One atomic UPSERT serializes concurrent attempts across all web instances.
// Database failure propagates: never disable login protection as a fallback.
export async function consumeLoginAttempt(db:Database, username:string) {
  const result = await db.query(`
    INSERT INTO login_attempts AS bucket (key_hash, attempts, resets_at)
    VALUES ($1, 1, statement_timestamp() + interval '15 minutes')
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE WHEN bucket.resets_at <= statement_timestamp()
        THEN 1 ELSE LEAST(bucket.attempts + 1, 11) END,
      resets_at = CASE WHEN bucket.resets_at <= statement_timestamp()
        THEN statement_timestamp() + interval '15 minutes' ELSE bucket.resets_at END
    RETURNING attempts,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (resets_at - statement_timestamp()))))::int AS retry_after
  `, [digest(username.toLowerCase())]);
  const row = result.rows[0];
  if (!row) throw Error('LOGIN_LIMIT_UNAVAILABLE');
  return {allowed:row.attempts <= 10, retryAfter:row.retry_after};
}

