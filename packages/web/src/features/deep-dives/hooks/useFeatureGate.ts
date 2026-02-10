/**
 * useFeatureGate Hook
 *
 * Query feature gate data from feature_gates.parquet for displaying
 * live feature gate status in deep dive content.
 *
 * @module features/deep-dives/hooks/useFeatureGate
 */

import { useMemo } from 'react'
import { useQuery, parquet } from '../../../shared/hooks/useDB'

// =============================================================================
// Types
// =============================================================================

export interface FeatureGateData {
  name: string
  version: string
  stage: string
  defaultValue: boolean
  lockToDefault: boolean
  description: string | null
  kep: string | null
  components: string[] | null
}

export interface UseFeatureGateResult {
  data: FeatureGateData | null
  loading: boolean
  error: Error | null
}

export interface UseFeatureGatesResult {
  data: Map<string, FeatureGateData>
  loading: boolean
  error: Error | null
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Query a single feature gate by name and version
 *
 * @param gateName - Feature gate name (e.g., 'CPUManager')
 * @param version - K8s version (e.g., '1.35')
 * @returns Feature gate data, loading state, and error
 */
export function useFeatureGate(
  gateName: string | null,
  version: string
): UseFeatureGateResult {
  const sql = useMemo(() => {
    if (!gateName) return null

    return `
      SELECT 
        name,
        version,
        stage,
        default_value as defaultValue,
        lock_to_default as lockToDefault,
        description,
        kep,
        components
      FROM ${parquet('feature_gates')}
      WHERE LOWER(name) = LOWER('${gateName}')
        AND version = '${version}'
      LIMIT 1
    `
  }, [gateName, version])

  const { data: rows, loading, error } = useQuery<FeatureGateData>(sql)

  const data = useMemo(() => {
    return rows && rows.length > 0 ? rows[0] : null
  }, [rows])

  return { data, loading, error }
}

/**
 * Query multiple feature gates by name for a specific version
 *
 * @param gateNames - Array of feature gate names
 * @param version - K8s version (e.g., '1.35')
 * @returns Map of gate name to data, loading state, and error
 */
export function useFeatureGates(
  gateNames: string[],
  version: string
): UseFeatureGatesResult {
  const sql = useMemo(() => {
    if (gateNames.length === 0) return null

    const inClause = gateNames.map((name) => `'${name.toLowerCase()}'`).join(', ')

    return `
      SELECT 
        name,
        version,
        stage,
        default_value as defaultValue,
        lock_to_default as lockToDefault,
        description,
        kep,
        components
      FROM ${parquet('feature_gates')}
      WHERE LOWER(name) IN (${inClause})
        AND version = '${version}'
    `
  }, [gateNames, version])

  const { data: rows, loading, error } = useQuery<FeatureGateData>(sql)

  const data = useMemo(() => {
    const map = new Map<string, FeatureGateData>()
    if (rows) {
      for (const row of rows) {
        map.set(row.name.toLowerCase(), row)
      }
    }
    return map
  }, [rows])

  return { data, loading, error }
}

/**
 * Get the stage color for a feature gate
 */
export function getFeatureGateStageColor(stage: string): string {
  switch (stage.toLowerCase()) {
    case 'stable':
    case 'ga':
      return '#10b981' // Green
    case 'beta':
      return '#f59e0b' // Amber
    case 'alpha':
      return '#8b5cf6' // Purple
    case 'deprecated':
      return '#ef4444' // Red
    default:
      return '#6b7280' // Gray
  }
}

/**
 * Format the default value for display
 */
export function formatDefaultValue(value: boolean): string {
  return value ? 'Enabled' : 'Disabled'
}

export default useFeatureGate
