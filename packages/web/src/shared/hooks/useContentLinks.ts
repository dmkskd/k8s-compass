/**
 * Hook for fetching content links from DuckDB
 */
import { useQuery, parquet } from './useDB'

export interface ContentLink {
  url: string
  title: string
  content_type: string
  source: string
  is_official: boolean
  published_date: string | null
  author: string | null
  summary: string | null
  description: string | null
  labels: string[]
  target_type: string
  target_id: string
  target_group: string | null
  target_version: string | null
}

/**
 * Content types that should be excluded from user-facing content lists
 * These are special content types used for specific purposes elsewhere:
 * - 'artwork': Release artwork images, displayed in release headers only
 * 
 * Add new hidden types here to exclude them from Learn tab and content queries
 */
export const HIDDEN_CONTENT_TYPES = ['artwork'] as const
export type HiddenContentType = typeof HIDDEN_CONTENT_TYPES[number]

/**
 * Generate SQL clause to exclude hidden content types
 * @param columnName - The column name to filter (default: 'content_type')
 * @returns SQL clause like "content_type NOT IN ('artwork')"
 */
export function getHiddenContentExclusion(columnName = 'content_type'): string {
  const types = HIDDEN_CONTENT_TYPES.map(t => `'${t}'`).join(', ')
  return `${columnName} NOT IN (${types})`
}

/**
 * Get all content links for a specific release version
 */
export function useContentLinksForRelease(version: string | null) {
  const sql = version
    ? `SELECT DISTINCT url, title, content_type, source, is_official, published_date, author, summary, description, labels
       FROM ${parquet('content_links')}
       WHERE target_type = 'release' AND target_id = '${version}' AND ${getHiddenContentExclusion()}
       ORDER BY is_official DESC, published_date DESC`
    : null

  const { data, loading, error } = useQuery<ContentLink>(sql)
  return { content: data, loading, error }
}

/**
 * Get release artwork URL for a specific version
 * Returns the artwork image URL if available, null otherwise
 */
export function useReleaseArtwork(version: string | null) {
  const sql = version
    ? `SELECT url
       FROM ${parquet('content_links')}
       WHERE target_type = 'release' AND target_id = '${version}' AND content_type = 'artwork'
       LIMIT 1`
    : null

  const { data, loading, error } = useQuery<{ url: string }>(sql)
  return { 
    artworkUrl: data && data.length > 0 ? data[0].url : null, 
    loading, 
    error 
  }
}

/**
 * Get all content links for a specific KEP, optionally filtered by version context
 * When version is provided, only shows content published on or before that release date
 */
export function useContentLinksForKep(kep: string | null, version?: string) {
  // Build SQL with optional version filtering
  // Content is filtered to only show items published before or during the release
  const sql = kep
    ? version
      ? `SELECT DISTINCT c.url, c.title, c.content_type, c.source, c.is_official, 
                c.published_date, c.author, c.summary, c.description, c.labels
         FROM ${parquet('content_links')} c
         LEFT JOIN ${parquet('releases')} r ON r.version = '${version}'
         WHERE c.target_type = 'kep' AND c.target_id = '${kep}'
           AND (c.published_date IS NULL OR c.published_date <= r.release_date OR r.release_date IS NULL)
         ORDER BY c.is_official DESC, c.published_date DESC`
      : `SELECT DISTINCT url, title, content_type, source, is_official, published_date, author, summary, description, labels
         FROM ${parquet('content_links')}
         WHERE target_type = 'kep' AND target_id = '${kep}'
         ORDER BY is_official DESC, published_date DESC`
    : null

  const { data, loading, error } = useQuery<ContentLink>(sql)
  return { content: data, loading, error }
}

/**
 * Get all content links (generic query)
 */
export function useContentLinks(targetType?: string, targetId?: string) {
  let sql = `SELECT * FROM ${parquet('content_links')}`
  
  const conditions: string[] = []
  if (targetType) conditions.push(`target_type = '${targetType}'`)
  if (targetId) conditions.push(`target_id = '${targetId}'`)
  
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  
  sql += ' ORDER BY is_official DESC, published_date DESC'

  const { data, loading, error } = useQuery<ContentLink>(sql)
  return { content: data, loading, error }
}
