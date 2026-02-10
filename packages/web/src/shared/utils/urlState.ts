/**
 * URL State Management
 * 
 * Encodes/decodes application state to/from URL hash for shareable links.
 * 
 * URL Format: #section/view?param1=value1&param2=value2
 * 
 * Examples:
 * - #api-explorer/constellation
 * - #releases/1.35
 * - #learn?type=video&labels=dra,scheduling&sort=newest
 * - #analytics?preset=0&view=chart
 * - #analytics?sql=SELECT...&chart=bar&labels=name&values=count
 */

import type { AppSection, APIExplorerViewMode } from '../types'

// ============ Types ============

export interface LearnUrlState {
  contentType?: string
  sourceFilter?: string
  labels?: string[]
  sort?: string
  search?: string
  expanded?: string  // URL of expanded item
  deepDive?: string  // Deep dive ID (e.g., 'cpu-numa-low-latency')
  deepDiveSection?: string  // Section anchor within deep dive
}

export interface AnalyticsUrlState {
  preset?: number      // Index of preset query
  sql?: string         // Custom SQL (base64 encoded if complex)
  view?: 'table' | 'chart' | 'schema' | 'queries'
  chartType?: string
  chartLabels?: string
  chartValues?: string
  chartGroup?: string
  chartStyle?: '2d' | '3d'
  fullscreen?: boolean // Whether chart is in fullscreen mode
}

export interface ReleasesUrlState {
  version?: string
  section?: string     // expanded section: features, notices, changes, patches
  filter?: string      // feature filter: stable, beta, alpha
  labelFilter?: string // feature label filter
}

export interface ApiExplorerUrlState {
  view?: APIExplorerViewMode
  version?: string
  kind?: string
  group?: string
  panel?: 'spec'  // Whether spec structure panel is open
}

export interface UrlState {
  section: AppSection
  apiExplorer?: ApiExplorerUrlState
  releases?: ReleasesUrlState
  learn?: LearnUrlState
  analytics?: AnalyticsUrlState
}

// ============ Encoding/Decoding Helpers ============

/**
 * Encode a string for URL (handles special chars)
 */
function encodeValue(value: string): string {
  return encodeURIComponent(value)
}

/**
 * Decode a URL-encoded string
 */
function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Encode SQL for URL - use base64 for complex queries
 */
export function encodeSql(sql: string): string {
  // If SQL is simple (no special chars), just encode it
  if (/^[a-zA-Z0-9\s_.*,'()=<>]+$/.test(sql) && sql.length < 200) {
    return encodeValue(sql)
  }
  // Otherwise use base64
  return 'b64:' + btoa(unescape(encodeURIComponent(sql)))
}

/**
 * Decode SQL from URL
 */
export function decodeSql(encoded: string): string {
  if (encoded.startsWith('b64:')) {
    try {
      return decodeURIComponent(escape(atob(encoded.slice(4))))
    } catch {
      return ''
    }
  }
  return decodeValue(encoded)
}

/**
 * Parse query string into object
 */
function parseQueryString(query: string): Record<string, string> {
  if (!query) return {}
  
  const params: Record<string, string> = {}
  const pairs = query.split('&')
  
  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) {
      params[decodeValue(key)] = decodeValue(value)
    }
  }
  
  return params
}

/**
 * Build query string from object
 */
function buildQueryString(params: Record<string, string | undefined>): string {
  const pairs: string[] = []
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      pairs.push(`${encodeValue(key)}=${encodeValue(value)}`)
    }
  }
  
  return pairs.length > 0 ? '?' + pairs.join('&') : ''
}

// ============ URL Parsing ============

/**
 * Parse URL hash into state object
 */
export function parseUrlHash(): UrlState | null {
  const hash = window.location.hash.slice(1) // Remove #
  if (!hash) return null
  
  // Split path and query
  const [pathPart, queryPart] = hash.split('?')
  const parts = pathPart.split('/')
  const section = parts[0] as AppSection
  
  // Validate section
  if (!['home', 'api-explorer', 'control-plane', 'releases', 'learn', 'analytics'].includes(section)) {
    return null
  }
  
  const params = parseQueryString(queryPart || '')
  const state: UrlState = { section }
  
  switch (section) {
    case 'api-explorer': {
      const view = parts[1] as APIExplorerViewMode
      state.apiExplorer = {
        view: ['constellation', 'sunburst'].includes(view) ? view : undefined,
        version: params.v || params.version,
        kind: params.kind,
        group: params.group,
        panel: params.panel === 'spec' ? 'spec' : undefined,
      }
      break
    }
    
    case 'releases': {
      state.releases = {
        version: parts[1] || params.v || params.version,
        section: params.section,
        filter: params.filter,
        labelFilter: params.label,
      }
      break
    }
    
    case 'learn': {
      state.learn = {
        contentType: params.type,
        sourceFilter: params.source,
        labels: params.labels ? params.labels.split(',') : undefined,
        sort: params.sort,
        search: params.q || params.search,
        expanded: params.expanded,
        deepDive: params.deepDive,
        deepDiveSection: params.deepDiveSection,
      }
      break
    }
    
    case 'analytics': {
      state.analytics = {
        preset: params.preset !== undefined ? parseInt(params.preset, 10) : undefined,
        sql: params.sql ? decodeSql(params.sql) : undefined,
        view: params.view as AnalyticsUrlState['view'],
        chartType: params.chart,
        chartLabels: params.labels,
        chartValues: params.values,
        chartGroup: params.group,
        chartStyle: params.style as '2d' | '3d',
        fullscreen: params.fs === '1',
      }
      break
    }
  }
  
  return state
}

// ============ URL Building ============

/**
 * Build URL hash from state
 */
export function buildUrlHash(state: UrlState): string {
  let path = state.section
  let params: Record<string, string | undefined> = {}
  
  switch (state.section) {
    case 'api-explorer': {
      const api = state.apiExplorer
      if (api?.view) path += `/${api.view}`
      params = {
        v: api?.version,
        kind: api?.kind,
        group: api?.group,
        panel: api?.panel,
      }
      break
    }
    
    case 'releases': {
      const rel = state.releases
      if (rel?.version) path += `/${rel.version}`
      params = {
        section: rel?.section,
        filter: rel?.filter,
        label: rel?.labelFilter,
      }
      break
    }
    
    case 'learn': {
      const learn = state.learn
      params = {
        type: learn?.contentType !== 'all' ? learn?.contentType : undefined,
        source: learn?.sourceFilter !== 'all' ? learn?.sourceFilter : undefined,
        labels: learn?.labels?.length ? learn.labels.join(',') : undefined,
        sort: learn?.sort !== 'newest' ? learn?.sort : undefined,
        q: learn?.search,
        expanded: learn?.expanded,
        deepDive: learn?.deepDive,
        deepDiveSection: learn?.deepDiveSection,
      }
      break
    }
    
    case 'analytics': {
      const analytics = state.analytics
      // Prefer preset index over raw SQL for shorter URLs
      if (analytics?.preset !== undefined) {
        params.preset = String(analytics.preset)
      } else if (analytics?.sql) {
        params.sql = encodeSql(analytics.sql)
      }
      params.view = analytics?.view !== 'table' ? analytics?.view : undefined
      params.chart = analytics?.chartType
      params.labels = analytics?.chartLabels
      params.values = analytics?.chartValues
      params.group = analytics?.chartGroup
      params.style = analytics?.chartStyle !== '2d' ? analytics?.chartStyle : undefined
      params.fs = analytics?.fullscreen ? '1' : undefined
      break
    }
  }
  
  return '#' + path + buildQueryString(params)
}

// ============ URL Update ============

/**
 * Update URL hash without triggering navigation
 */
export function updateUrlHash(state: UrlState): void {
  const newHash = buildUrlHash(state)
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, '', newHash)
  }
}

/**
 * Push new URL hash (creates history entry)
 */
export function pushUrlHash(state: UrlState): void {
  const newHash = buildUrlHash(state)
  if (window.location.hash !== newHash) {
    window.history.pushState(null, '', newHash)
  }
}

// ============ Shareable Link Generation ============

/**
 * Generate a shareable link for the current state
 */
export function generateShareableLink(state: UrlState): string {
  const hash = buildUrlHash(state)
  return window.location.origin + window.location.pathname + hash
}

/**
 * Copy shareable link to clipboard
 */
export async function copyShareableLink(state: UrlState): Promise<boolean> {
  const link = generateShareableLink(state)
  try {
    await navigator.clipboard.writeText(link)
    return true
  } catch {
    return false
  }
}
