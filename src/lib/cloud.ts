import { createWorkBuddyCloud, type WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk'
import { createLocalCloud } from './localClient'

/**
 * Values returned by the WorkBuddy cloud-service activation for this app.
 * `publishableKey` identifies which app is calling and carries no permissions of
 * its own — the server additionally enforces an exact Origin match — so it is safe
 * to ship in the front-end bundle. The underlying environment id and provider keys
 * are server-side only and never appear here.
 */
export const cloudConfig = {
  endpoint: 'https://dku-ai-club.app.workbuddy.host',
  publishableKey: 'wbpk_FSdVvw7EfcuaomD8qeHlX4_iM9Stlu7dcq1u4h9xbCsWhYTrXfX7WQ8',
} as const

/**
 * Hand-written description of the app's Postgres schema, in the shape the SDK's
 * `cloud.database` expects (mirrors supabase's `Database` type). Tables were created
 * through the cloud-service migration tools; this file only describes them.
 */
type EventRow = {
  id: number
  slug: string
  title: string
  summary: string
  body: string
  category: string
  event_date: string
  end_date: string | null
  location: string | null
  role: string
  cover_image: string | null
  gallery: unknown
  tags: unknown
  status: string
  featured: boolean
  source_url: string | null
  source_credit: string | null
  owner_id: string | null
  owner_name: string | null
  created_at: string
  updated_at: string
}

type SettingsRow = {
  key: string
  value: unknown
  owner_id: string | null
  updated_at: string
}

/**
 * One row per site, holding the SHA-256 of the key that opens the panel. The
 * key itself is nowhere in this database, and this table is granted to no role.
 */
type SiteAccessRow = {
  only_row: boolean
  key_hash: string
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      events: {
        Row: EventRow
        Insert: Partial<EventRow> & { slug: string; title: string; event_date: string }
        Update: Partial<EventRow>
      }
      site_settings: {
        Row: SettingsRow
        Insert: { key: string; value?: unknown; updated_at?: string }
        Update: { key?: string; value?: unknown; updated_at?: string }
      }
      site_access: {
        Row: SiteAccessRow
        Insert: { key_hash: string; updated_at?: string }
        Update: { key_hash?: string; updated_at?: string }
      }
    }
    Views: Record<string, never>
    /**
     * The functions the panel calls. Every write the site performs is one of
     * these, because no role it can act as has been granted a write on a table —
     * see `localdev/schema.sql` for the checks each one makes.
     */
    Functions: {
      /** Whether the supplied key is the site's key. */
      site_key_ok: { Args: { candidate: string }; Returns: boolean }
      /** Every event, drafts and archived records included. */
      admin_list_events: { Args: { p_key: string }; Returns: Record<string, unknown>[] }
      /** Creates or overwrites one event; returns the stored row. */
      admin_save_event: {
        Args: { p_key: string; p_event: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      /** Publishes, drafts or archives one event. */
      admin_set_event_status: {
        Args: { p_key: string; p_slug: string; p_status: string }
        Returns: boolean
      }
      /** Removes one event; false when there was nothing to remove. */
      admin_delete_event: { Args: { p_key: string; p_slug: string }; Returns: boolean }
      /** Replaces the site copy as a whole. */
      admin_save_settings: {
        Args: { p_key: string; p_value: Record<string, unknown> }
        Returns: boolean
      }
      /** Replaces the site key; the current key has to be supplied. */
      admin_replace_site_key: {
        Args: { p_current: string; p_next: string }
        Returns: boolean
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

/** The client the whole app talks to. Both backends are shaped alike, so pages
 *  never learn which one is in play. */
type CloudClient = WorkBuddyCloudClient<Database>

/**
 * Local development mode: `npm run local` sets this flag, and every call goes to
 * the API in `localdev/` instead of the hosted service. The flag is read at
 * build time, so the production build contains only the hosted client.
 */
const useLocalBackend = import.meta.env.VITE_LOCAL_BACKEND === '1'

/** Initialised once; the site talks to it for every read and every write. */
export const cloud: CloudClient = useLocalBackend
  ? (createLocalCloud() as unknown as CloudClient)
  : createWorkBuddyCloud<Database>({
      endpoint: cloudConfig.endpoint,
      publishableKey: cloudConfig.publishableKey,
    })
