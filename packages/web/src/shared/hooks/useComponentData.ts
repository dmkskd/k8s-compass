/**
 * Hook for loading Kubernetes component data from DuckDB
 */
import { useMemo } from 'react'
import { useQuery, parquet } from './useDB'

export interface Component {
  id: string
  type: string
  display_name: string
  description: string
  docs_url: string | null
  related_keps: string[]
  controllers: string[]
}

export interface ComponentFlag {
  component_id: string
  name: string
  type: string
  default_value: string | null
  description: string | null
  introduced_in: string | null
  deprecated_in: string | null
  removed_in: string | null
  values: string[]
  related_keps: string[]
  related_feature_gates: string[]
}

export interface ComponentWithFlags extends Component {
  flags: ComponentFlag[]
}

/**
 * Load all components
 */
export function useComponents() {
  const sql = `
    SELECT 
      id,
      type,
      display_name,
      description,
      docs_url,
      related_keps,
      controllers
    FROM ${parquet('components')}
    ORDER BY 
      CASE type 
        WHEN 'control-plane' THEN 1 
        WHEN 'node' THEN 2 
        WHEN 'addon' THEN 3 
        WHEN 'runtime' THEN 4 
        ELSE 5 
      END,
      display_name
  `
  
  return useQuery<Component>(sql)
}

/**
 * Load flags for a specific component
 */
export function useComponentFlags(componentId: string | null) {
  const sql = componentId ? `
    SELECT 
      component_id,
      name,
      type,
      default_value,
      description,
      introduced_in,
      deprecated_in,
      removed_in,
      values,
      related_keps,
      related_feature_gates
    FROM ${parquet('component_flags')}
    WHERE component_id = '${componentId}'
    ORDER BY name
  ` : null
  
  return useQuery<ComponentFlag>(sql)
}

/**
 * Load a single component by ID
 */
export function useComponent(componentId: string | null) {
  const sql = componentId ? `
    SELECT 
      id,
      type,
      display_name,
      description,
      docs_url,
      related_keps,
      controllers
    FROM ${parquet('components')}
    WHERE id = '${componentId}'
    LIMIT 1
  ` : null
  
  const { data, loading, error } = useQuery<Component>(sql)
  
  return {
    data: data?.[0] || null,
    loading,
    error,
  }
}

/**
 * Load a single component with its flags (optimized - loads only the specific component)
 */
export function useComponentWithFlags(componentId: string | null) {
  const { data: component, loading: compLoading, error: compError } = useComponent(componentId)
  const { data: flags, loading: flagsLoading, error: flagsError } = useComponentFlags(componentId)
  
  const componentWithFlags: ComponentWithFlags | null = useMemo(() => {
    if (!component) return null
    return {
      ...component,
      flags: flags || [],
    }
  }, [component, flags])
  
  return {
    data: componentWithFlags,
    loading: compLoading || flagsLoading,
    error: compError || flagsError,
  }
}

/**
 * Load content links related to a component
 */
export function useComponentContentLinks(componentId: string | null) {
  const sql = componentId ? `
    SELECT DISTINCT
      url,
      title,
      content_type,
      source,
      is_official,
      published_date,
      author,
      summary,
      description,
      labels
    FROM ${parquet('content_links')}
    WHERE target_type = 'component' AND target_id = '${componentId}'
    ORDER BY published_date DESC NULLS LAST
  ` : null
  
  return useQuery<{
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
  }>(sql)
}

/**
 * Load KEP details for related KEPs
 */
export function useRelatedKeps(kepIds: string[]) {
  const sql = kepIds.length > 0 ? `
    SELECT 
      kep,
      kep_path,
      title,
      sig,
      description,
      history_alpha,
      history_beta,
      history_stable
    FROM ${parquet('keps')}
    WHERE kep IN (${kepIds.map(k => `'${k}'`).join(', ')})
  ` : null
  
  return useQuery<{
    kep: string
    kep_path: string | null
    title: string
    sig: string
    description: string | null
    history_alpha: string | null
    history_beta: string | null
    history_stable: string | null
  }>(sql)
}


// =============================================================================
// kubectl Data Types and Hooks
// =============================================================================

export interface KubectlCommand {
  version: string
  name: string
  synopsis: string | null
  usage: string | null
  subcommands: string[]
}

export interface KubectlOption {
  version: string
  command: string
  name: string
  short: string | null
  type: string | null
  default_value: string | null
  description: string | null
}

export interface KubectlExample {
  version: string
  command: string
  description: string
  example: string
}

export interface KubectlCommandWithDetails extends KubectlCommand {
  options: KubectlOption[]
  examples: KubectlExample[]
}

/**
 * Load all kubectl commands for a specific version
 */
export function useKubectlCommands(version: string | null) {
  const sql = version ? `
    SELECT 
      version,
      name,
      synopsis,
      usage,
      subcommands
    FROM ${parquet('kubectl_commands')}
    WHERE version = '${version}'
    ORDER BY name
  ` : null
  
  return useQuery<KubectlCommand>(sql)
}

/**
 * Load kubectl options for a specific command and version
 */
export function useKubectlOptions(version: string | null, command: string | null) {
  const sql = version && command ? `
    SELECT 
      version,
      command,
      name,
      short,
      type,
      default_value,
      description
    FROM ${parquet('kubectl_options')}
    WHERE version = '${version}' AND command = '${command}'
    ORDER BY name
  ` : null
  
  return useQuery<KubectlOption>(sql)
}

/**
 * Load kubectl examples for a specific command and version
 */
export function useKubectlExamples(version: string | null, command: string | null) {
  const sql = version && command ? `
    SELECT 
      version,
      command,
      description,
      example
    FROM ${parquet('kubectl_examples')}
    WHERE version = '${version}' AND command = '${command}'
  ` : null
  
  return useQuery<KubectlExample>(sql)
}

/**
 * Load a single kubectl command with its options and examples
 */
export function useKubectlCommandWithDetails(version: string | null, command: string | null) {
  const { data: commands, loading: cmdLoading, error: cmdError } = useKubectlCommands(version)
  const { data: options, loading: optLoading, error: optError } = useKubectlOptions(version, command)
  const { data: examples, loading: exLoading, error: exError } = useKubectlExamples(version, command)
  
  const commandWithDetails: KubectlCommandWithDetails | null = useMemo(() => {
    const cmd = commands?.find(c => c.name === command)
    if (!cmd) return null
    return {
      ...cmd,
      options: options || [],
      examples: examples || [],
    }
  }, [commands, command, options, examples])
  
  return {
    data: commandWithDetails,
    loading: cmdLoading || optLoading || exLoading,
    error: cmdError || optError || exError,
  }
}

/**
 * Get available kubectl versions
 */
export function useKubectlVersions() {
  const sql = `
    SELECT DISTINCT version
    FROM ${parquet('kubectl_commands')}
    ORDER BY version DESC
  `
  
  return useQuery<{ version: string }>(sql)
}


// =============================================================================
// Feature Gate Data Types and Hooks
// =============================================================================

export interface FeatureGate {
  version: string
  name: string
  stage: string  // alpha, beta, stable, deprecated
  default_value: boolean
  lock_to_default: boolean
  description: string | null
  kep: string | null
  kep_title: string | null
  kep_path: string | null
  version_history_json: string | null
}

export interface FeatureGateVersionHistory {
  version: string
  default: boolean
  stage: string
  lock_to_default: boolean
  to_version?: string
}

/**
 * Load all feature gates for a specific K8s version
 */
export function useFeatureGates(version: string | null) {
  const sql = version ? `
    SELECT 
      version,
      name,
      stage,
      default_value,
      lock_to_default,
      description,
      kep,
      kep_title,
      kep_path,
      version_history_json
    FROM ${parquet('feature_gates')}
    WHERE version = '${version}'
    ORDER BY name
  ` : null
  
  return useQuery<FeatureGate>(sql)
}

/**
 * Get feature gate counts by stage for a version
 */
export function useFeatureGateSummary(version: string | null) {
  const sql = version ? `
    SELECT 
      stage,
      COUNT(*) as count
    FROM ${parquet('feature_gates')}
    WHERE version = '${version}'
    GROUP BY stage
    ORDER BY 
      CASE stage 
        WHEN 'stable' THEN 1 
        WHEN 'beta' THEN 2 
        WHEN 'alpha' THEN 3 
        WHEN 'deprecated' THEN 4 
        ELSE 5 
      END
  ` : null
  
  return useQuery<{ stage: string; count: number }>(sql)
}

/**
 * Get available feature gate versions
 */
export function useFeatureGateVersions() {
  const sql = `
    SELECT DISTINCT version
    FROM ${parquet('feature_gates')}
    ORDER BY version DESC
  `
  
  return useQuery<{ version: string }>(sql)
}

/**
 * Parse version history JSON from a feature gate
 */
export function parseVersionHistory(json: string | null): FeatureGateVersionHistory[] {
  if (!json) return []
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

/**
 * Look up feature gate details by name for a specific version
 */
export function useFeatureGateByName(version: string | null, gateName: string | null) {
  const sql = version && gateName ? `
    SELECT 
      name,
      stage,
      default_value,
      lock_to_default,
      description,
      components,
      kep,
      kep_title
    FROM ${parquet('feature_gates')}
    WHERE version = '${version}' AND name = '${gateName}'
    LIMIT 1
  ` : null
  
  const { data, loading, error } = useQuery<FeatureGate>(sql)
  return { gate: data?.[0] ?? null, loading, error }
}

/**
 * Look up multiple feature gates by name for a specific version
 * Returns a map of gate name -> gate details
 */
export function useFeatureGatesByNames(version: string | null, gateNames: string[]) {
  const uniqueNames = [...new Set(gateNames.filter(Boolean))]
  const sql = version && uniqueNames.length > 0 ? `
    SELECT 
      name,
      stage,
      default_value,
      lock_to_default,
      description,
      components
    FROM ${parquet('feature_gates')}
    WHERE version = '${version}' 
      AND name IN (${uniqueNames.map(n => `'${n}'`).join(', ')})
  ` : null
  
  const { data, loading, error } = useQuery<FeatureGate>(sql)
  
  const gateMap = new Map<string, FeatureGate>()
  if (data) {
    for (const gate of data) {
      gateMap.set(gate.name, gate)
    }
  }
  
  return { gates: gateMap, loading, error }
}
