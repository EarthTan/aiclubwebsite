-- ---------------------------------------------------------------------------
-- DKU AI Club — Cloudflare D1 schema
--
-- The same three tables the site has always had, expressed in SQLite:
--
--   events         the club's event library
--   site_settings  editable site copy (home hero, about, contact) as JSON text
--   site_access    the SHA-256 of the key that opens the administrator panel
--
-- Two things differ from the Postgres original, and both are a consequence of
-- the database being SQLite rather than a permission model:
--
--   * There are no roles, no row-level security and no SECURITY DEFINER, so the
--     database itself cannot refuse a write. Every guarantee the old design put
--     in the database now lives in the Worker (`worker.ts`), which is the only
--     thing holding a connection. The browser never reaches this database.
--     That is a change of location, not of strength: it was already true that
--     the write path was one key-checked function, and it still is.
--   * JSON and arrays are text. `gallery` and `tags` hold JSON arrays, `value`
--     holds the settings object, and `featured` is 0 or 1. Dates are `YYYY-MM-DD`
--     text, which sorts correctly as text and is what the site already passes
--     around.
--
-- The schema is idempotent, so it can be replayed against a database that
-- already has data without destroying it.
-- ---------------------------------------------------------------------------

create table if not exists events (
  id            integer primary key autoincrement,
  slug          text    not null unique,
  title         text    not null,
  summary       text    not null default '',
  body          text    not null default '',
  category      text    not null default 'Event',
  event_date    text    not null,
  end_date      text,
  location      text,
  role          text    not null default 'host',
  cover_image   text,
  gallery       text    not null default '[]',
  tags          text    not null default '[]',
  status        text    not null default 'draft',
  featured      integer not null default 0,
  source_url    text,
  source_credit text,
  created_at    text    not null default (datetime('now')),
  updated_at    text    not null default (datetime('now'))
);

create index if not exists events_event_date_idx on events (event_date desc);

create table if not exists site_settings (
  key        text primary key,
  value      text not null default '{}',
  updated_at text not null default (datetime('now'))
);

-- One row, holding the hash of the panel key and nothing else. The row is
-- forced to exist under a single key so a second one cannot be inserted: a
-- mismatch between two rows would mean two keys, and there is exactly one.
create table if not exists site_access (
  only_row   integer primary key default 1 check (only_row = 1),
  key_hash   text    not null,
  updated_at text    not null default (datetime('now'))
);
