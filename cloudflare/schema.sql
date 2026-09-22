-- ---------------------------------------------------------------------------
-- DKU AI Club — Cloudflare D1 schema
--
-- The same three tables the site has always had, expressed in SQLite:
--
--   events           the club's event library
--   site_settings    editable site copy (home hero, about, contact) as JSON text
--   site_access      the SHA-256 of the key that opens the administrator panel
--
-- and two more, both of them about an event being written from more than one
-- place — a link handed to somebody who is not an administrator, and the
-- administrator's own panel:
--
--   event_tokens     one row per link that opens a single event for a while
--   event_revisions  one row per event: the version it held before its last save
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

-- One row per shared editing link: a credential that opens exactly one event,
-- for a stated number of days, and nothing else. An administrator makes them
-- from the event's own page; the link travels in a chat message to whoever is
-- writing that event up, and expires on its own.
--
-- The token is kept as it was generated rather than as a hash, which is the
-- opposite of the choice made for the panel key one table up. The reason is
-- what each credential is for. The panel key is permanent and opens everything,
-- so a copy of it anywhere is a copy of the whole site, and hashing it means a
-- leaked database does not hold a working key. A share token is worth one
-- event for a few days and can be revoked in one click; storing it as text is
-- what lets an administrator see the link again a week later and send it to the
-- second person who needs it. Nothing is given away by that: anyone able to
-- read this table can already rewrite the panel key row above it.
create table if not exists event_tokens (
  token        text primary key,
  slug         text not null,
  -- Who the link was made for. For the administrator's own memory, never shown
  -- to whoever opens the link.
  label        text not null default '',
  created_at   text not null default (datetime('now')),
  expires_at   text not null,
  last_used_at text
);

create index if not exists event_tokens_slug_idx on event_tokens (slug);

-- One row per event, holding the version that was there immediately before the
-- most recent save — and only that one. A save overwrites the row above; if the
-- save changed nothing worth keeping, the previous version is left where it is
-- rather than being replaced by a copy of what is already current.
--
-- It exists because an event is now written from two places. An administrator
-- hands out a link so somebody else can do the writing, and the person holding
-- it deletes a paragraph the administrator wrote, or replaces a whole write-up
-- with a first draft, and nothing anywhere says so. One version back is enough
-- for that: the answer to "put back what was there before this happened", which
-- is a different thing from keeping a history and does not need one.
--
-- The columns are the event's content and not its publishing state. Restoring
-- gives the words back and leaves whether the event is on the public site where
-- it is, because that decision belongs to the panel and should not ride along
-- with a recovery. `via` records which door did the displacing, so the panel can
-- say whether it was a link or the administrator's own hand.
create table if not exists event_revisions (
  slug          text primary key,
  title         text not null,
  summary       text not null default '',
  body          text not null default '',
  category      text not null default 'Event',
  event_date    text not null,
  end_date      text,
  location      text,
  role          text not null default 'host',
  cover_image   text,
  gallery       text not null default '[]',
  tags          text not null default '[]',
  source_url    text,
  source_credit text,
  saved_at      text not null default (datetime('now')),
  via           text not null default 'panel'
);
