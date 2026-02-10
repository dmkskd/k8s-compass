import { useState, useEffect } from 'react'
import type { APIGroup, K8sKind, K8sRelationship } from '../types'

interface APITreeData {
  version: string
  releaseDate: string
  groups: (APIGroup & { color: string })[]
}

export function useAPITree(version: string) {
  const [data, setData] = useState<APITreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    fetch(`/data/k8s/api-trees/${version}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load API tree for ${version}`)
        return res.json()
      })
      .then((data) => {
        setData(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err)
        setLoading(false)
      })
  }, [version])

  return { data, loading, error }
}

// Extract all kinds with their relationships for the constellation view
export function useConstellationData(version: string) {
  const { data, loading, error } = useAPITree(version)
  
  // Deduplicate kinds - only take from preferred version, or first occurrence
  const nodes = (() => {
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
          
          // Skip if we've already seen this kind
          if (seen.has(id)) continue
          seen.set(id, true)
          
          result.push({
            id,
            kind: kind.name,
            group: group.name,
            groupColor: group.color,
            fieldCount: kind.fieldCount,
            scope: kind.scope as 'Namespaced' | 'Cluster',
            relationships: kind.relationships,
            shortNames: kind.shortNames,
          })
        }
      }
    }
    
    return result
  })()

  const edges = nodes.flatMap((node) =>
    node.relationships.map((rel) => ({
      source: node.id,
      target: `${rel.targetGroup}/${rel.targetKind}`,
      type: rel.type,
      description: rel.description,
    }))
  ).filter((edge) => nodes.some((n) => n.id === edge.target))

  return {
    nodes,
    edges,
    groups: data?.groups ?? [],
    loading,
    error,
  }
}

// Get unique API groups with their metadata
export function useAPIGroups(version: string) {
  const { data, loading, error } = useAPITree(version)
  
  const groups = data?.groups.map((g) => ({
    name: g.name,
    displayName: g.displayName,
    description: g.description,
    color: g.color,
    kindCount: g.versions.reduce((acc, v) => acc + v.kinds.length, 0),
  })) ?? []

  return { groups, loading, error }
}

// Find a specific kind's details
export function useKindDetails(version: string, group: string, kind: string) {
  const { data, loading, error } = useAPITree(version)
  
  let kindData: K8sKind | undefined
  let groupData: APIGroup | undefined

  if (data) {
    groupData = data.groups.find((g) => g.name === group)
    if (groupData) {
      for (const ver of groupData.versions) {
        kindData = ver.kinds.find((k) => k.name === kind)
        if (kindData) break
      }
    }
  }

  return {
    kind: kindData,
    group: groupData,
    loading,
    error,
  }
}
