/**
 * A stand-in for the hosted backend, used only when the site runs against the
 * local development API (`npm run local`).
 *
 * It covers the slice of the hosted client the site actually uses — a small
 * query builder over the application tables, and the database functions the panel
 * calls by name — and returns the same `{ data, error }` envelopes, so no page
 * has to know which backend it is talking to. `src/lib/cloud.ts` picks between
 * the two.
 *
 * There is no account here, and no session: the site's one credential is the
 * site key, which is passed as an argument to those functions like any other
 * value. The development API still answers the platform's `/api/auth/*`
 * endpoints, because the platform has an account module whether or not this site
 * uses it, but nothing in the site reaches them.
 *
 * This module is never part of a production build: the condition that selects
 * it is a build-time constant, so the bundler drops it entirely.
 */

const API = '/api'

interface Envelope<T> {
  data: T
  error: unknown
}

interface LocalError {
  message: string
  code?: string
}

const OFFLINE: LocalError = {
  message:
    'The local development API is not answering. Start it with `npm run local`, or run against the hosted backend with `npm run dev`.',
  code: 'LOCAL_API_OFFLINE',
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    return (await response.json()) as Record<string, unknown>
  } catch {
    return { data: null, error: OFFLINE }
  }
}

const asError = (payload: Record<string, unknown>): unknown => payload.error ?? null

/* -------------------------------------------------------------------------- */
/* Query builder                                                              */
/* -------------------------------------------------------------------------- */

type Action = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

interface QueryState {
  action: Action
  columns: string
  filters: { op: string; column: string; value: unknown }[]
  order: { column: string; ascending: boolean }[]
  limit?: number
  mode: 'many' | 'maybeSingle' | 'single'
  payload?: unknown
  onConflict?: string
  returning: boolean
}

function createQuery(table: string) {
  const state: QueryState = {
    action: 'select',
    columns: '*',
    filters: [],
    order: [],
    mode: 'many',
    returning: false,
  }

  async function execute(): Promise<Envelope<unknown>> {
    const payload = await call('/db', { table, ...state })
    return { data: payload.data ?? null, error: asError(payload) }
  }

  const builder = {
    select(columns = '*') {
      if (state.action === 'select') state.columns = columns
      else {
        state.returning = true
        state.columns = columns
      }
      return builder
    },
    insert(values: unknown) {
      state.action = 'insert'
      state.payload = values
      return builder
    },
    update(values: unknown) {
      state.action = 'update'
      state.payload = values
      return builder
    },
    upsert(values: unknown, options?: { onConflict?: string }) {
      state.action = 'upsert'
      state.payload = values
      state.onConflict = options?.onConflict
      return builder
    },
    delete() {
      state.action = 'delete'
      return builder
    },
    eq(column: string, value: unknown) {
      state.filters.push({ op: 'eq', column, value })
      return builder
    },
    neq(column: string, value: unknown) {
      state.filters.push({ op: 'neq', column, value })
      return builder
    },
    in(column: string, value: unknown[]) {
      state.filters.push({ op: 'in', column, value })
      return builder
    },
    limit(count: number) {
      state.limit = count
      return builder
    },
    order(column: string, options?: { ascending?: boolean }) {
      state.order.push({ column, ascending: options?.ascending ?? true })
      return builder
    },
    maybeSingle() {
      state.mode = 'maybeSingle'
      return builder
    },
    single() {
      state.mode = 'single'
      return builder
    },
    then<TResult1 = Envelope<unknown>, TResult2 = never>(
      onFulfilled?: ((value: Envelope<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return execute().then(onFulfilled, onRejected)
    },
  }

  return builder
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The local stand-in, shaped like the hosted client. The caller casts it to the
 * hosted client's type; the shapes line up because both return `{ data, error }`.
 *
 * Only the database half exists, because that is all this site asks of a
 * backend. The development API still answers `/api/auth/*` for the platform's
 * own account module, but nothing here calls it.
 */
export function createLocalCloud() {
  return {
    database: {
      from: (table: string) => createQuery(table),
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        const payload = await call('/rpc', { fn, args: args ?? {} })
        return { data: payload.data ?? null, error: asError(payload) }
      },
    },
  }
}
