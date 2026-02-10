/**
 * API Data hooks using DuckDB WASM + Parquet
 */
import { useState, useEffect, useMemo } from 'react'
import { useQuery, parquet, executeQuery } from './useDB'
import type { APIGroup, K8sKind, K8sRelationship } from '../types'
import type {
  ReleasesRow,
  ApiGroupsRow,
  KindsRow,
  KindsRelationshipsRow,
  FieldKepLinksRow,
} from '../types/db-types'

// Get all available versions (from releases table)
export function useVersions() {
  const sql = `
    SELECT version, release_date, is_latest
    FROM ${parquet('releases')}
    ORDER BY version DESC
  `
  const { data, loading, error } = useQuery<ReleasesRow>(sql)
  
  const versions = useMemo(() => {
    if (!data) return []
    return data.map(v => ({
      version: v.version!,
      releaseDate: v.release_date!,
      isLatest: v.is_latest!,
    }))
  }, [data])

  return { versions, loading, error }
}

// Get API tree data for constellation/sunburst views
export function useAPITreeDB(version: string) {
  const [data, setData] = useState<{
    version: string
    releaseDate: string
    groups: (APIGroup & { color: string })[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!version) return

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        // Fetch all data in parallel
        const [versionData, groups, kinds, relationships] = await Promise.all([
          executeQuery<ReleasesRow>(`
            SELECT version, release_date, is_latest
            FROM ${parquet('releases')}
            WHERE version = '${version}'
          `),
          executeQuery<ApiGroupsRow>(`
            SELECT name, display_name, description, color
            FROM ${parquet('api_groups')}
            WHERE version = '${version}'
          `),
          executeQuery<KindsRow>(`
            SELECT group_name, api_version, name, singular_name, plural_name,
                   scope, short_names, categories, schema_ref, field_count,
                   description, docs_url
            FROM ${parquet('kinds')}
            WHERE version = '${version}'
          `),
          executeQuery<KindsRelationshipsRow>(`
            SELECT source_kind, source_group, type, target_kind, target_group,
                   description, field_path
            FROM ${parquet('kinds_relationships')}
            WHERE version = '${version}'
          `),
        ])

        // Build relationship lookup
        const relsByKind = new Map<string, K8sRelationship[]>()
        for (const rel of relationships) {
          const key = `${rel.source_group}/${rel.source_kind}`
          if (!relsByKind.has(key)) relsByKind.set(key, [])
          relsByKind.get(key)!.push({
            type: rel.type as K8sRelationship['type'],
            targetKind: rel.target_kind!,
            targetGroup: rel.target_group!,
            description: rel.description!,
            fieldPath: rel.field_path ?? undefined,
          })
        }

        // Build kinds by group and api version
        const kindsByGroupVersion = new Map<string, K8sKind[]>()
        for (const kind of kinds) {
          const key = `${kind.group_name}/${kind.api_version}`
          if (!kindsByGroupVersion.has(key)) kindsByGroupVersion.set(key, [])
          
          const relKey = `${kind.group_name}/${kind.name}`
          kindsByGroupVersion.get(key)!.push({
            name: kind.name!,
            singularName: kind.singular_name!,
            pluralName: kind.plural_name!,
            scope: kind.scope as 'Namespaced' | 'Cluster',
            shortNames: kind.short_names ?? [],
            categories: kind.categories ?? [],
            schemaRef: kind.schema_ref!,
            fieldCount: kind.field_count!,
            description: kind.description,
            docsUrl: kind.docs_url ?? undefined,
            relationships: relsByKind.get(relKey) ?? [],
          })
        }

        // Get unique api versions per group
        const apiVersionsByGroup = new Map<string, Set<string>>()
        for (const kind of kinds) {
          if (!apiVersionsByGroup.has(kind.group_name!)) {
            apiVersionsByGroup.set(kind.group_name!, new Set())
          }
          apiVersionsByGroup.get(kind.group_name!)!.add(kind.api_version!)
        }

        // Build groups with versions
        const groupsWithVersions = groups.map(g => ({
          name: g.name!,
          displayName: g.display_name!,
          description: g.description,
          color: g.color!,
          versions: Array.from(apiVersionsByGroup.get(g.name!) ?? []).map(apiVer => ({
            name: apiVer,
            isPreferred: apiVer === 'v1' || apiVer.endsWith('v1'),
            kinds: kindsByGroupVersion.get(`${g.name}/${apiVer}`) ?? [],
          })),
        }))

        setData({
          version,
          releaseDate: versionData[0]?.release_date ?? '',
          groups: groupsWithVersions,
        })
        setLoading(false)
      } catch (err) {
        setError(err as Error)
        setLoading(false)
      }
    })()
  }, [version])

  return { data, loading, error }
}

// Extract all kinds with relationships for constellation view
export function useConstellationDataDB(version: string) {
  const { data, loading, error } = useAPITreeDB(version)
  
  const nodes = useMemo(() => {
    if (!data) return []
    
    const seen = new Map<string, boolean>()
    const result: {
      id: string
      kind: string
      group: string
      groupColor: string
      fieldCount: number
      scope: 'Namespaced' | 'Cluster'
      relationships: K8sRelationship[]
      shortNames?: string[]
    }[] = []
    
    for (const group of data.groups) {
      // Sort versions so preferred comes first
      const sortedVersions = [...group.versions].sort((a, b) => {
        if (a.isPreferred && !b.isPreferred) return -1
        if (!a.isPreferred && b.isPreferred) return 1
        return 0
      })
      
      for (const ver of sortedVersions) {
        for (const kind of ver.kinds) {
          const id = `${group.name}/${kind.name}`
          if (seen.has(id)) continue
          seen.set(id, true)
          
          result.push({
            id,
            kind: kind.name,
            group: group.name,
            groupColor: group.color,
            fieldCount: kind.fieldCount,
            scope: kind.scope,
            relationships: kind.relationships,
            shortNames: kind.shortNames,
          })
        }
      }
    }
    
    return result
  }, [data])

  const edges = useMemo(() => {
    return nodes.flatMap((node) =>
      node.relationships.map((rel) => ({
        source: node.id,
        target: `${rel.targetGroup}/${rel.targetKind}`,
        type: rel.type,
        description: rel.description,
      }))
    ).filter((edge) => nodes.some((n) => n.id === edge.target))
  }, [nodes])

  return {
    nodes,
    edges,
    groups: data?.groups ?? [],
    loading,
    error,
  }
}

// Get unique API groups with metadata
export function useAPIGroupsDB(version: string) {
  const { data, loading, error } = useAPITreeDB(version)
  
  const groups = useMemo(() => {
    if (!data) return []
    return data.groups.map((g) => ({
      name: g.name,
      displayName: g.displayName,
      description: g.description,
      color: g.color,
      kindCount: g.versions.reduce((acc, v) => acc + v.kinds.length, 0),
    }))
  }, [data])

  return { groups, loading, error }
}

// Find a specific kind's details
export function useKindDetailsDB(version: string, group: string, kind: string) {
  const { data, loading, error } = useAPITreeDB(version)
  
  const result = useMemo(() => {
    if (!data) return { kind: undefined, group: undefined }
    
    const groupData = data.groups.find((g) => g.name === group)
    let kindData: K8sKind | undefined
    
    if (groupData) {
      for (const ver of groupData.versions) {
        kindData = ver.kinds.find((k) => k.name === kind)
        if (kindData) break
      }
    }
    
    return { kind: kindData, group: groupData }
  }, [data, group, kind])

  return { ...result, loading, error }
}

// Field KEP link row from parquet - using generated type
// Get KEP link for a specific field
export function useFieldKepLink(version: string, kind: string, group: string, fieldPath: string) {
  const [data, setData] = useState<{
    kep: string
    kepTitle: string
    confidence: number
    matchReason: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!version || !kind || !group || !fieldPath) {
      setData(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const results = await executeQuery<FieldKepLinksRow>(`
          SELECT kep, kep_title, confidence, match_reason
          FROM ${parquet('field_kep_links')}
          WHERE version = '${version}'
            AND kind = '${kind}'
            AND group_name = '${group}'
            AND field_path = '${fieldPath}'
          LIMIT 1
        `)

        if (results.length > 0) {
          setData({
            kep: results[0].kep!,
            kepTitle: results[0].kep_title!,
            confidence: results[0].confidence!,
            matchReason: results[0].match_reason!,
          })
        } else {
          setData(null)
        }
        setLoading(false)
      } catch (err) {
        setError(err as Error)
        setLoading(false)
      }
    })()
  }, [version, kind, group, fieldPath])

  return { data, loading, error }
}

// Get all KEP links for a kind (for batch loading)
export function useKindKepLinks(version: string, kind: string, group: string) {
  const [data, setData] = useState<Map<string, {
    kep: string
    kepTitle: string
    kepPath: string | null
    confidence: number
    matchReason: string
    isCanonical: boolean
  }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!version || !kind || !group) {
      setData(new Map())
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const results = await executeQuery<FieldKepLinksRow>(`
          SELECT field_path, kep, kep_title, kep_path, confidence, match_reason, is_canonical
          FROM ${parquet('field_kep_links')}
          WHERE version = '${version}'
            AND kind = '${kind}'
            AND group_name = '${group}'
        `)

        const linkMap = new Map<string, {
          kep: string
          kepTitle: string
          kepPath: string | null
          confidence: number
          matchReason: string
          isCanonical: boolean
        }>()

        for (const row of results) {
          linkMap.set(row.field_path!, {
            kep: row.kep!,
            kepTitle: row.kep_title!,
            kepPath: row.kep_path || null,
            confidence: row.confidence!,
            matchReason: row.match_reason!,
            isCanonical: row.is_canonical!,
          })
        }

        setData(linkMap)
        setLoading(false)
      } catch (err) {
        setError(err as Error)
        setLoading(false)
      }
    })()
  }, [version, kind, group])

  return { data, loading, error }
}
