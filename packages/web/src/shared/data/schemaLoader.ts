/**
 * Schema loader that can use either JSON files or DuckDB
 */
import { executeQuery, parquet } from '../hooks/useDB'
import type { SchemaProperty } from '../types'

// Cache for loaded schemas - keyed by kind name, but also stores group
const schemaCache: Map<string, Record<string, { properties: SchemaProperty[], description: string, group: string }>> = new Map()

interface SchemaRow {
  group_name: string
  name: string
  schema_json: string
}

/**
 * Load schemas from DuckDB parquet (now from kinds table)
 */
export async function loadSchemasFromDB(version: string): Promise<Record<string, { properties: SchemaProperty[], description: string, group: string }>> {
  if (schemaCache.has(version)) {
    return schemaCache.get(version)!
  }

  try {
    const rows = await executeQuery<SchemaRow>(`
      SELECT group_name, name, schema_json
      FROM ${parquet('kinds')}
      WHERE version = '${version}' AND schema_json IS NOT NULL
    `)

    const schemas: Record<string, { properties: SchemaProperty[], description: string, group: string }> = {}

    for (const row of rows) {
      const kind = row.name
      const group = row.group_name || 'core'
      
      // Parse the JSON schema
      let schemaData: { properties?: SchemaProperty[], description?: string }
      try {
        schemaData = typeof row.schema_json === 'string' 
          ? JSON.parse(row.schema_json) 
          : row.schema_json
      } catch {
        console.warn(`Failed to parse schema for ${group}/${kind}`)
        continue
      }

      schemas[kind] = {
        properties: schemaData.properties || [],
        description: schemaData.description || '',
        group,
      }
    }

    schemaCache.set(version, schemas)
    return schemas
  } catch (err) {
    console.error('Error loading schemas from DuckDB:', err)
    return {}
  }
}

/**
 * Get schema for a specific kind (sync, returns empty if not loaded)
 */
export function getSchemaFromCache(kind: string, version: string): SchemaProperty[] {
  const schemas = schemaCache.get(version)
  return schemas?.[kind]?.properties || []
}

/**
 * Get description for a specific kind (sync, returns empty if not loaded)
 */
export function getDescriptionFromCache(kind: string, version: string): string {
  const schemas = schemaCache.get(version)
  return schemas?.[kind]?.description || ''
}
