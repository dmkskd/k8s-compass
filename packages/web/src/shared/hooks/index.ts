/**
 * Data hooks - exports both JSON and DuckDB versions
 * 
 * Set USE_DUCKDB to true to use DuckDB WASM + Parquet
 */

// Feature flag - set to true to use DuckDB
export const USE_DUCKDB = true

// Re-export based on feature flag - using DuckDB versions
export { 
  useAPITreeDB as useAPITree, 
  useConstellationDataDB as useConstellationData, 
  useAPIGroupsDB as useAPIGroups, 
  useKindDetailsDB as useKindDetails,
  useVersions,
  useKindKepLinks
} from './useAPIDataDB'

export { 
  useReleaseIndexDB as useReleaseIndex, 
  useReleaseNotesDB as useReleaseNotes, 
  useAllReleasesDB as useAllReleases 
} from './useReleaseDataDB'

// Also export JSON versions for fallback
export { 
  useAPITree as useAPITreeJSON, 
  useConstellationData as useConstellationDataJSON, 
  useAPIGroups as useAPIGroupsJSON, 
  useKindDetails as useKindDetailsJSON 
} from './useAPIData'

export { 
  useReleaseIndex as useReleaseIndexJSON, 
  useReleaseNotes as useReleaseNotesJSON, 
  useAllReleases as useAllReleasesJSON 
} from './useReleaseData'

// DuckDB utilities
export { useDB, useQuery, executeQuery, parquet, TABLES } from './useDB'

// Content links hook
export { useContentLinks, useContentLinksForRelease, useContentLinksForKep, useReleaseArtwork } from './useContentLinks'

// Component data hooks
export { 
  useComponents,
  useComponent,
  useComponentFlags, 
  useComponentWithFlags, 
  useComponentContentLinks,
  useRelatedKeps 
} from './useComponentData'

// Theme hook
export { useTheme } from './useTheme'
export type { Theme } from './useTheme'
