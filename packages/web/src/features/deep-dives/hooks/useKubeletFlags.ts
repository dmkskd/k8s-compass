/**
 * useKubeletFlags Hook
 *
 * Query kubelet CLI flags from component_flags.parquet for displaying
 * configuration options in deep dive content.
 *
 * @module features/deep-dives/hooks/useKubeletFlags
 */

import { useMemo } from 'react'
import { useQuery, parquet } from '../../../shared/hooks/useDB'

// =============================================================================
// Types
// =============================================================================

export interface ComponentFlagData {
  componentId: string
  name: string
  type: string
  defaultValue: string | null
  description: string | null
  deprecated: boolean
  introducedVersion: string | null
  deprecatedVersion: string | null
}

export interface UseKubeletFlagsResult {
  data: Map<string, ComponentFlagData>
  loading: boolean
  error: Error | null
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Query kubelet flags by name
 *
 * @param flagNames - Array of flag names (e.g., ['--cpu-manager-policy', '--topology-manager-policy'])
 * @returns Map of flag name to data, loading state, and error
 */
export function useKubeletFlags(flagNames: string[]): UseKubeletFlagsResult {
  const sql = useMemo(() => {
    if (flagNames.length === 0) return null

    // Normalize flag names (remove leading dashes if present)
    const normalizedNames = flagNames.map((name) => {
      return name.replace(/^--?/, '')
    })

    const inClause = normalizedNames.map((name) => `'${name}'`).join(', ')

    return `
      SELECT 
        component_id as componentId,
        name,
        type,
        default_value as defaultValue,
        description,
        deprecated,
        introduced_version as introducedVersion,
        deprecated_version as deprecatedVersion
      FROM ${parquet('component_flags')}
      WHERE component_id = 'kubelet'
        AND REPLACE(name, '--', '') IN (${inClause})
    `
  }, [flagNames])

  const { data: rows, loading, error } = useQuery<ComponentFlagData>(sql)

  const data = useMemo(() => {
    const map = new Map<string, ComponentFlagData>()
    if (rows) {
      for (const row of rows) {
        // Store with normalized name (without dashes)
        const normalizedName = row.name.replace(/^--?/, '')
        map.set(normalizedName, row)
      }
    }
    return map
  }, [rows])

  return { data, loading, error }
}

/**
 * Query all flags for a specific component
 *
 * @param componentId - Component ID (e.g., 'kubelet', 'kube-apiserver')
 * @returns Map of flag name to data, loading state, and error
 */
export function useComponentFlags(componentId: string): UseKubeletFlagsResult {
  const sql = useMemo(() => {
    if (!componentId) return null

    return `
      SELECT 
        component_id as componentId,
        name,
        type,
        default_value as defaultValue,
        description,
        deprecated,
        introduced_version as introducedVersion,
        deprecated_version as deprecatedVersion
      FROM ${parquet('component_flags')}
      WHERE component_id = '${componentId}'
      ORDER BY name
    `
  }, [componentId])

  const { data: rows, loading, error } = useQuery<ComponentFlagData>(sql)

  const data = useMemo(() => {
    const map = new Map<string, ComponentFlagData>()
    if (rows) {
      for (const row of rows) {
        const normalizedName = row.name.replace(/^--?/, '')
        map.set(normalizedName, row)
      }
    }
    return map
  }, [rows])

  return { data, loading, error }
}

/**
 * Format a flag for display with its default value
 */
export function formatFlagWithDefault(flag: ComponentFlagData): string {
  const name = flag.name.startsWith('--') ? flag.name : `--${flag.name}`
  if (flag.defaultValue) {
    return `${name}=${flag.defaultValue}`
  }
  return name
}

/**
 * Get the type badge color for a flag
 */
export function getFlagTypeColor(type: string): string {
  switch (type.toLowerCase()) {
    case 'string':
      return '#3b82f6' // Blue
    case 'bool':
    case 'boolean':
      return '#10b981' // Green
    case 'int':
    case 'int32':
    case 'int64':
    case 'uint':
    case 'uint32':
    case 'uint64':
      return '#f59e0b' // Amber
    case 'duration':
      return '#8b5cf6' // Purple
    case 'stringslice':
    case 'strings':
      return '#ec4899' // Pink
    default:
      return '#6b7280' // Gray
  }
}

export default useKubeletFlags
