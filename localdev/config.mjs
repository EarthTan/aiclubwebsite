/**
 * Shared settings for the local development backend.
 *
 * Everything here is development-only. The database name and port are
 * deliberately specific so a local run can never collide with another project
 * on the same machine, and so it is obvious from a connection string which
 * environment is in play.
 */

const user = process.env.USER || process.env.LOGNAME || 'postgres'

/** The dedicated development database. Created by `localdev/setup.mjs`. */
export const DATABASE_NAME = process.env.LOCAL_DB_NAME || 'dku_ai_club_local'

/** Administrative connection, used to create the database and the schema. */
export const ADMIN_URL =
  process.env.LOCAL_ADMIN_URL || `postgresql://${user}@127.0.0.1:5432/postgres`

/** Connection the API server uses. It owns the tables, so it bypasses RLS and
 *  must lower itself to `anon` per request. */
export const DATABASE_URL =
  process.env.LOCAL_DB_URL || `postgresql://${user}@127.0.0.1:5432/${DATABASE_NAME}`

/** Where the API listens. Vite proxies `/api` here, so the port is internal. */
export const API_PORT = Number(process.env.LOCAL_API_PORT) || 54321

/** Port the site itself is served on. 5173 is taken by another project here. */
export const SITE_PORT = Number(process.env.PORT) || 5199

/**
 * The key this development database accepts, written in full view because it
 * opens a throwaway database on this machine and nothing else.
 *
 * This is the only definition of it. `schema.sql` deliberately seeds nothing:
 * `setup.mjs` writes the hash every time it runs — including when it is reusing
 * a database — so a local key that was replaced while testing is restored to a
 * known value rather than leaving the panel locked. Production seeds its own
 * hash out of band, so this value appears nowhere in the shipped site.
 */
export const DEV_SITE_KEY = process.env.LOCAL_SITE_KEY || 'dku-ai-club-local-development-key'
