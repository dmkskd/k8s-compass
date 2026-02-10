/**
 * DuckDB WASM hook for querying Parquet files
 * 
 * Fetches parquet files and registers them with DuckDB for querying.
 */
import { useState, useEffect, useRef } from 'react'
import * as duckdb from '@duckdb/duckdb-wasm'

// Singleton for the DuckDB instance
let dbInstance: duckdb.AsyncDuckDB | null = null
let dbInitPromise: Promise<duckdb.AsyncDuckDB> | null = null
let tablesRegistered = false

// Schema metadata singleton
let schemaMetadata: SchemaMetadata | null = null
let schemaMetadataPromise: Promise<SchemaMetadata> | null = null

// Schema metadata types
export interface ColumnMetadata {
  name: string
  type: string
  description?: string
  pk?: boolean
  fk?: string  // e.g., "versions.version"
}

export interface TableMetadata {
  description: string
  columns: ColumnMetadata[]
}

export interface TableRelationship {
  from: string
  fromColumn: string
  to: string
  toColumn: string
}

export interface SchemaMetadata {
  tables: Record<string, TableMetadata>
  relationships: TableRelationship[]
}

import type { TableName } from '../types/db-types'

// Get base URL for parquet files (works in dev and prod)
function getParquetBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/data/parquet`
  }
  return '/data/parquet'
}

// Table names that map to parquet files
// This should match the TableName type from db-types.ts
export const TABLES: Record<TableName, TableName> = {
  action_required: 'action_required',
  api_diffs: 'api_diffs',
  api_groups: 'api_groups',
  component_flags: 'component_flags',
  components: 'components',
  content_links: 'content_links',
  deprecations: 'deprecations',
  feature_gates: 'feature_gates',
  features: 'features',
  field_kep_links: 'field_kep_links',
  keps: 'keps',
  kinds: 'kinds',
  kinds_relationships: 'kinds_relationships',
  kubectl_commands: 'kubectl_commands',
  kubectl_examples: 'kubectl_examples',
  kubectl_options: 'kubectl_options',
  patch_release_changes: 'patch_release_changes',
  patch_releases: 'patch_releases',
  patch_security_fixes: 'patch_security_fixes',
  provider_versions: 'provider_versions',
  providers: 'providers',
  release_changes: 'release_changes',
  releases: 'releases',
  security_cves: 'security_cves',
} as const

async function initDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbInstance) return dbInstance
  if (dbInitPromise) return dbInitPromise

  dbInitPromise = (async () => {
    console.log('[DuckDB] Initializing...')
    
    // Use CDN bundles for WASM files
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()
    
    // Select best bundle for this browser
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)
    console.log('[DuckDB] Using bundle:', bundle.mainModule)
    
    const worker_url = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    )
    
    const worker = new Worker(worker_url)
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    URL.revokeObjectURL(worker_url)
    
    console.log('[DuckDB] Instantiated')
    dbInstance = db
    return db
  })()

  return dbInitPromise
}

// Register all parquet files as tables
async function registerTables(db: duckdb.AsyncDuckDB): Promise<void> {
  if (tablesRegistered) return
  
  const baseUrl = getParquetBaseUrl()
  console.log('[DuckDB] Registering tables from:', baseUrl)
  
  // Fetch and register each parquet file
  for (const [tableName, _] of Object.entries(TABLES)) {
    const url = `${baseUrl}/${tableName}.parquet`
    console.log(`[DuckDB] Fetching ${tableName}...`)
    
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`[DuckDB] Failed to fetch ${url}: ${response.status}`)
        continue
      }
      
      const buffer = await response.arrayBuffer()
      await db.registerFileBuffer(`${tableName}.parquet`, new Uint8Array(buffer))
      console.log(`[DuckDB] Registered ${tableName} (${buffer.byteLength} bytes)`)
    } catch (err) {
      console.warn(`[DuckDB] Error registering ${tableName}:`, err)
    }
  }
  
  tablesRegistered = true
  console.log('[DuckDB] All tables registered')
}

// Convert Arrow/DuckDB values to plain JavaScript values
function convertValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }
  
  // Handle Arrow Vector/List types - they have a toArray method
  if (typeof value === 'object' && value !== null && 'toArray' in value && typeof (value as { toArray: () => unknown[] }).toArray === 'function') {
    return (value as { toArray: () => unknown[] }).toArray().map(convertValue)
  }
  
  // Handle BigInt (DuckDB uses BigInt for some integer types)
  if (typeof value === 'bigint') {
    return Number(value)
  }
  
  // Handle objects - check if it's a DuckDB aggregate/struct with numeric keys
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value)
    
    // If all keys are numeric indices (like "0", "1", "2"), it's likely a DuckDB aggregate
    // Just return the first value (the actual result)
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      const firstVal = (value as Record<string, unknown>)[keys[0]]
      return convertValue(firstVal)
    }
    
    // Regular object - convert recursively
    const obj: Record<string, unknown> = {}
    for (const key of keys) {
      obj[key] = convertValue((value as Record<string, unknown>)[key])
    }
    return obj
  }
  
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(convertValue)
  }
  
  return value
}

// Convert a row from DuckDB to plain JS object
function convertRow<T>(row: Record<string, unknown>): T {
  const obj: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    obj[key] = convertValue(row[key])
  }
  return obj as T
}

export function useDB() {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const database = await initDB()
        await registerTables(database)
        setDb(database)
      } catch (err) {
        setError(err as Error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return { db, loading, error }
}

// Helper to run a query and return typed results
export function useQuery<T>(
  sql: string | null,
  _params?: unknown[]
): { data: T[] | null; loading: boolean; error: Error | null } {
  const { db, loading: dbLoading, error: dbError } = useDB()
  const [data, setData] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  
  // Track the current query to avoid stale results
  const queryRef = useRef<string | null>(null)

  useEffect(() => {
    if (!db || !sql) {
      setLoading(false)
      return
    }

    queryRef.current = sql
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const conn = await db.connect()
        const result = await conn.query(sql)
        await conn.close()
        
        // Only update if this is still the current query
        if (queryRef.current === sql) {
          // Convert Arrow table to JS objects with proper type conversion
          const rows = result.toArray().map((row: Record<string, unknown>) => convertRow<T>(row))
          setData(rows)
          setLoading(false)
        }
      } catch (err) {
        if (queryRef.current === sql) {
          setError(err as Error)
          setLoading(false)
        }
      }
    })()
  }, [db, sql])

  return {
    data,
    loading: dbLoading || loading,
    error: dbError || error,
  }
}

// Execute a single query and return results
export async function executeQuery<T>(sql: string): Promise<T[]> {
  const db = await initDB()
  await registerTables(db)
  
  const conn = await db.connect()
  const result = await conn.query(sql)
  await conn.close()
  
  return result.toArray().map((row: Record<string, unknown>) => convertRow<T>(row))
}

// Helper to reference a registered parquet table
export function parquet(table: keyof typeof TABLES): string {
  return `'${table}.parquet'`
}

// Load schema metadata from JSON file
async function loadSchemaMetadata(): Promise<SchemaMetadata> {
  if (schemaMetadata) return schemaMetadata
  if (schemaMetadataPromise) return schemaMetadataPromise
  
  schemaMetadataPromise = (async () => {
    const baseUrl = getParquetBaseUrl()
    const url = `${baseUrl}/schema_metadata.json`
    
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`[Schema] Failed to fetch schema metadata: ${response.status}`)
        return { tables: {}, relationships: [] }
      }
      
      schemaMetadata = await response.json()
      console.log('[Schema] Loaded schema metadata')
      return schemaMetadata!
    } catch (err) {
      console.warn('[Schema] Error loading schema metadata:', err)
      return { tables: {}, relationships: [] }
    }
  })()
  
  return schemaMetadataPromise
}

// Hook to get schema metadata
export function useSchemaMetadata() {
  const [metadata, setMetadata] = useState<SchemaMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  
  useEffect(() => {
    ;(async () => {
      try {
        const data = await loadSchemaMetadata()
        setMetadata(data)
      } catch (err) {
        setError(err as Error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])
  
  return { metadata, loading, error }
}

// Get schema metadata synchronously (returns null if not loaded)
export function getSchemaMetadata(): SchemaMetadata | null {
  return schemaMetadata
}

// Get schema metadata asynchronously
export async function fetchSchemaMetadata(): Promise<SchemaMetadata> {
  return loadSchemaMetadata()
}
