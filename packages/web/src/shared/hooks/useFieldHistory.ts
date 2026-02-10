import { useState, useEffect } from 'react'
import type { SchemaProperty } from '../types'

interface FieldHistoryEntry {
  path: string
  introducedIn: string
  deprecatedIn?: string
  removedIn?: string
}

type FieldHistoryData = Record<string, FieldHistoryEntry[]>

let cachedHistory: FieldHistoryData | null = null
let loadingPromise: Promise<FieldHistoryData> | null = null

async function loadFieldHistory(): Promise<FieldHistoryData> {
  if (cachedHistory) return cachedHistory
  
  if (loadingPromise) return loadingPromise
  
  loadingPromise = fetch('/data/k8s/field-history.json')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to load field history')
      return res.json()
    })
    .then((data) => {
      cachedHistory = data
      return data
    })
  
  return loadingPromise
}

export function useFieldHistory() {
  const [history, setHistory] = useState<FieldHistoryData | null>(cachedHistory)
  const [loading, setLoading] = useState(!cachedHistory)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (cachedHistory) {
      setHistory(cachedHistory)
      setLoading(false)
      return
    }

    loadFieldHistory()
      .then((data) => {
        setHistory(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err)
        setLoading(false)
      })
  }, [])

  return { history, loading, error }
}

// Get history for a specific kind
export function useKindFieldHistory(group: string, kind: string) {
  const { history, loading, error } = useFieldHistory()
  
  const kindKey = `${group}/${kind}`
  const fields = history?.[kindKey] ?? []
  
  // Convert to a map for easy lookup
  const fieldMap = new Map<string, FieldHistoryEntry>()
  for (const field of fields) {
    fieldMap.set(field.path, field)
  }
  
  return { fieldMap, loading, error }
}

// Enrich schema properties with version history
export function enrichSchemaWithHistory(
  properties: SchemaProperty[],
  fieldMap: Map<string, FieldHistoryEntry>
): SchemaProperty[] {
  return properties.map((prop) => {
    const history = fieldMap.get(prop.path)
    
    const enriched: SchemaProperty = {
      ...prop,
      introducedIn: history?.introducedIn,
      deprecatedIn: history?.deprecatedIn,
      removedIn: history?.removedIn,
    }
    
    // Recurse into nested properties
    if (prop.properties) {
      enriched.properties = enrichSchemaWithHistory(prop.properties, fieldMap)
    }
    
    if (prop.items) {
      enriched.items = enrichSchemaWithHistory([prop.items], fieldMap)[0]
    }
    
    return enriched
  })
}
