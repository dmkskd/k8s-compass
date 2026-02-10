/**
 * Load field and kind history from DuckDB
 */
import { executeQuery, parquet } from '../hooks/useDB'

interface FieldHistoryEntry {
  path: string
  introducedIn: string
  deprecatedIn?: string
  removedIn?: string
}

interface KindHistoryEntry {
  introducedIn?: string
  removedIn?: string
}

// Cache
let fieldHistoryCache: Record<string, FieldHistoryEntry[]> | null = null
let kindHistoryCache: Record<string, KindHistoryEntry> | null = null

/**
 * Load field history from DuckDB diffs table
 * Derives when fields were introduced by finding MIN(to_version) for field_added
 */
export async function loadFieldHistoryFromDB(): Promise<Record<string, FieldHistoryEntry[]>> {
  if (fieldHistoryCache) return fieldHistoryCache

  try {
    interface FieldRow {
      kind_key: string
      field_path: string
      introduced_in: string
    }

    const rows = await executeQuery<FieldRow>(`
      SELECT 
        group_name || '/' || kind as kind_key,
        field_path,
        MIN(to_version) as introduced_in
      FROM ${parquet('api_diffs')}
      WHERE change_type = 'field_added' AND field_path IS NOT NULL
      GROUP BY group_name, kind, field_path
    `)

    const history: Record<string, FieldHistoryEntry[]> = {}
    
    for (const row of rows) {
      if (!history[row.kind_key]) {
        history[row.kind_key] = []
      }
      history[row.kind_key].push({
        path: row.field_path,
        introducedIn: row.introduced_in,
      })
    }

    fieldHistoryCache = history
    return history
  } catch (err) {
    console.warn('Failed to load field history from DuckDB:', err)
    return {}
  }
}

/**
 * Load kind history from DuckDB kinds table
 * Derives when kinds were introduced by finding MIN(version)
 */
export async function loadKindHistoryFromDB(): Promise<Record<string, KindHistoryEntry>> {
  if (kindHistoryCache) return kindHistoryCache

  try {
    interface KindRow {
      kind_key: string
      introduced_in: string
    }

    const rows = await executeQuery<KindRow>(`
      SELECT 
        group_name || '/' || name as kind_key,
        MIN(version) as introduced_in
      FROM ${parquet('kinds')}
      GROUP BY group_name, name
    `)

    const history: Record<string, KindHistoryEntry> = {}
    
    for (const row of rows) {
      history[row.kind_key] = {
        introducedIn: row.introduced_in,
      }
    }

    kindHistoryCache = history
    return history
  } catch (err) {
    console.warn('Failed to load kind history from DuckDB:', err)
    return {}
  }
}

/**
 * Get kind history (sync, returns null if not loaded)
 */
export function getKindHistoryFromCache(group: string, kind: string): KindHistoryEntry | null {
  if (!kindHistoryCache) return null
  return kindHistoryCache[`${group}/${kind}`] || null
}

/**
 * Ensure kind history is loaded
 */
export async function ensureKindHistoryLoaded(): Promise<void> {
  await loadKindHistoryFromDB()
}
