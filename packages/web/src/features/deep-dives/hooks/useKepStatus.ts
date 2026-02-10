/**
 * useKepStatus Hook
 *
 * Query KEP data from keps.parquet for displaying live KEP status
 * in deep dive content.
 *
 * @module features/deep-dives/hooks/useKepStatus
 */

import { useMemo } from 'react'
import { useQuery, parquet } from '../../../shared/hooks/useDB'

// =============================================================================
// Types
// =============================================================================

export interface KepStatusData {
  kep: string
  kepPath: string | null
  title: string
  sig: string
  featureGate: string | null
  description: string | null
  historyAlpha: string | null
  historyBeta: string | null
  historyStable: string | null
}

export interface UseKepStatusResult {
  data: Map<string, KepStatusData>
  loading: boolean
  error: Error | null
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Query KEP status data for a list of KEP IDs
 *
 * @param kepIds - Array of KEP IDs (e.g., ['KEP-1287', 'KEP-3570'])
 * @returns Map of KEP ID to status data, loading state, and error
 */
export function useKepStatus(kepIds: string[]): UseKepStatusResult {
  // Build SQL query for the requested KEP IDs
  const sql = useMemo(() => {
    if (kepIds.length === 0) return null

    // Normalize KEP IDs (ensure they have KEP- prefix)
    const normalizedIds = kepIds.map((id) => {
      const normalized = id.toUpperCase()
      return normalized.startsWith('KEP-') ? normalized : `KEP-${normalized}`
    })

    // Build IN clause with escaped values
    const inClause = normalizedIds.map((id) => `'${id}'`).join(', ')

    return `
      SELECT 
        kep,
        kep_path as kepPath,
        title,
        sig,
        feature_gate as featureGate,
        description,
        history_alpha as historyAlpha,
        history_beta as historyBeta,
        history_stable as historyStable
      FROM ${parquet('keps')}
      WHERE UPPER(kep) IN (${inClause})
    `
  }, [kepIds])

  // Execute query
  const { data: rows, loading, error } = useQuery<KepStatusData>(sql)

  // Convert to Map for easy lookup
  const data = useMemo(() => {
    const map = new Map<string, KepStatusData>()
    if (rows) {
      for (const row of rows) {
        map.set(row.kep.toUpperCase(), row)
      }
    }
    return map
  }, [rows])

  return { data, loading, error }
}

/**
 * Get the current stage of a KEP based on its history
 */
export function getKepStage(kep: KepStatusData): 'alpha' | 'beta' | 'stable' | 'unknown' {
  if (kep.historyStable) return 'stable'
  if (kep.historyBeta) return 'beta'
  if (kep.historyAlpha) return 'alpha'
  return 'unknown'
}

/**
 * Get the GitHub URL for a KEP
 */
export function getKepGitHubUrl(kep: KepStatusData): string {
  if (kep.kepPath) {
    return `https://github.com/kubernetes/enhancements/tree/master/keps/${kep.kepPath}`
  }
  // Fallback to search
  return `https://github.com/kubernetes/enhancements/search?q=${encodeURIComponent(kep.kep)}`
}

export default useKepStatus
