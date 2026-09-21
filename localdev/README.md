# Local development backend

Running the site normally (`npm run dev`) talks to the hosted service, which only
accepts requests from the published domain — so editing events or site copy
cannot be tested locally. This folder removes that obstacle: it stands a copy of
the backend up on this machine, backed by the PostgreSQL already installed here.

```bash
npm run local          # start the database check, the API and the site together
npm run local:check    # verify the whole backend against a throwaway database
npm run local:reset    # rebuild the database, discarding events and site copy
```

The site is then at <http://localhost:5199>. Everything the site does — reading,
opening the panel, editing events and site copy, replacing the site key — goes to
this machine's database, not the hosted one.

## The key

The panel asks for one thing, the site key, and holds no account of any kind.
The development database accepts a fixed key, printed every time the database
step runs:

```
key      this database accepts: dku-ai-club-local-development-key
```

It is defined once, in `DEV_SITE_KEY` in `config.mjs`. `schema.sql` deliberately
seeds nothing, and `setup.mjs` writes the hash on every run — including when it
reuses an existing database. A local key that was replaced from the panel is
therefore restored the next time you start the site, which is what keeps "I
changed it and forgot it" from turning into "reset the database".

The key is stored the way production stores its own: as a SHA-256 in
`public.site_access`, a table granted to no role and readable only by the
key-checked functions.

## Seeding the event library

The site reads its events from the database, so an empty database means an empty
library. The club's history ships inside the site bundle as
`public/content/events.json`, and the **Event library** tab notices when records
from that file are missing and offers to copy them in. The import is safe to run
more than once: a slug that already exists is left alone, so an edited write-up is
never overwritten. Until the import runs, the public pages show the bundled
history instead, so a fresh environment is never blank.

`npm run local:reset` discards the imported records along with everything else.

## What is here

| File | Purpose |
|---|---|
| `config.mjs` | Ports, database name, the development key — the settings the rest share |
| `schema.sql` | Tables, roles, the key-checked functions and row-level security policies |
| `setup.mjs` | Creates the database, applies the schema, writes the development key |
| `server.mjs` | The API: table reads and function calls |
| `run.mjs` | Starts the database step, the API and Vite together |
| `check.mjs` | End-to-end test against a temporary database |

## How faithful is it?

There is no account system in either database, so every request runs as `anon` —
in production too, where the hosted data plane is called without a token. The
server lowers each request to that role before running it, so PostgreSQL's
policies and grants decide what may be read or written; the API's own role owns
the tables and would otherwise bypass both. A request that would be refused in
production is refused here for the same reason, and `check.mjs` asserts several
of those refusals by talking to the database directly rather than through the
API, so that the privilege model is tested rather than the API's willingness to
pass a request along.

Column types match the hosted tables too, which is less cosmetic than it sounds.
`events.event_date` is a real `date`, so it is read back as a calendar day rather
than as a midnight timestamp that shifts across time zones. `events.tags` is a
Postgres `text[]` rather than JSON, which changes how a value has to be bound.

Differences from production, all deliberate:

- **Error codes.** The hosted gateway prefixes a SQLSTATE with the module that
  raised it, so a refused key arrives as `DATABASE_42501`; this API sends the bare
  `42501`. The client matches on the end of the code, and either form reads the
  same.
- **The owner of a new row.** Both databases fill `owner_id` from the caller's
  identity, which a caller cannot supply. The hosted one stamps the anonymous
  role's name (`anon`); this one leaves it null. Nothing reads the column — the
  panel cannot see it and cannot set it — so the test asserts only that a value
  supplied by the caller was ignored.
- **Library versions.** The two run whatever PostgreSQL each has, so the shared
  functions are written against the older of the two.

## Reset points

- **Database contents** live in the `dku_ai_club_local` database. `npm run
  local:reset` rebuilds it from `schema.sql` and re-runs the seeding step.
- **The key the browser holds** lives in localStorage under
  `dku-ai-club.site-key`. Clearing site data, or the **Forget this key** button in
  the panel, takes it back to the prompt. There is no session to expire.
- Nothing here is referenced by a production build: the site selects this backend
  through a build-time flag, so the flag being absent removes the code entirely.
