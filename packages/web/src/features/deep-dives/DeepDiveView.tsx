/**
 * DeepDiveView - Router component for deep dive content
 *
 * Loads deep dive metadata from the database (content_links.parquet)
 * and renders the appropriate component from the registry.
 *
 * URL patterns:
 * - #learn?deepDive=cpu-numa-low-latency
 * - #learn?deepDive=cpu-numa-low-latency&deepDiveSection=topology-manager
 *
 * @module features/deep-dives/DeepDiveView
 */

import { Suspense, useCallback, useEffect, useMemo, lazy, type ComponentType } from 'react'
import { useExplorerStore } from '../../shared/store/explorerStore'
import { useQuery, parquet } from '../../shared/hooks/useDB'
import type { DeepDiveMetadata } from './index'
import styles from './DeepDiveView.module.css'

// =============================================================================
// Component Registry - maps deep dive IDs to lazy-loaded components
// Add new deep dives here when creating content.
// =============================================================================

const DEEP_DIVE_COMPONENTS: Record<string, ComponentType<{ sectionId?: string }>> = {
  'cpu-numa-low-latency': lazy(() =>
    import('./content/cpu-numa-low-latency').then((m) => ({
      default: m.CPUNUMADeepDive,
    }))
  ),
}

// =============================================================================
// Types
// =============================================================================

interface DeepDiveViewProps {
  /** Deep dive ID from URL */
  deepDiveId: string
  /** Optional section anchor from URL */
  sectionId?: string
}

interface DeepDiveDbRow {
  url: string
  title: string
  summary: string
  description: string
  author: string
  published_date: string
  labels: string[]
  attrs: string
  linked_keps: string[]
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert database row to DeepDiveMetadata
 */
function dbRowToMetadata(row: DeepDiveDbRow, deepDiveId: string): DeepDiveMetadata {
  let attrs: Record<string, unknown> = {}
  try {
    attrs = row.attrs ? JSON.parse(row.attrs) : {}
  } catch {
    // Ignore parse errors
  }

  return {
    id: deepDiveId,
    title: row.title || deepDiveId,
    subtitle: row.summary,
    description: row.description || '',
    status: (attrs.status as DeepDiveMetadata['status']) || 'draft',
    author: row.author,
    publishedDate: row.published_date || '',
    estimatedReadTime: (attrs.estimatedReadTime as number) || 30,
    labels: (row.labels || []).filter(l => l !== 'deep-dive'), // Remove the type label
    relatedKeps: row.linked_keps || [],
    relatedFeatureGates: (attrs.relatedFeatureGates as string[]) || [],
  }
}

// =============================================================================
// Component
// =============================================================================

export function DeepDiveView({ deepDiveId, sectionId }: DeepDiveViewProps) {
  const setLearnUrlState = useExplorerStore((state) => state.setLearnUrlState)

  // Load deep dive metadata from database
  const deepDiveUrl = `app://deep-dive/${deepDiveId}`
  const sql = `
    WITH kep_links AS (
      SELECT url, LIST(DISTINCT target_id) as keps
      FROM ${parquet('content_links')}
      WHERE target_type = 'kep'
      GROUP BY url
    )
    SELECT 
      c.url, c.title, c.summary, c.description, c.author, 
      c.published_date, c.labels, c.attrs,
      COALESCE(k.keps, []) as linked_keps
    FROM ${parquet('content_links')} c
    LEFT JOIN kep_links k ON c.url = k.url
    WHERE c.url = '${deepDiveUrl}'
    LIMIT 1
  `
  const { data: rows, loading } = useQuery<DeepDiveDbRow>(sql)

  // Convert to metadata
  const deepDive = useMemo(() => {
    if (!rows || rows.length === 0) return null
    return dbRowToMetadata(rows[0], deepDiveId)
  }, [rows, deepDiveId])

  // Check if component exists
  const DeepDiveComponent = DEEP_DIVE_COMPONENTS[deepDiveId]

  // Handle back navigation to Learn view
  const handleBackToLearn = useCallback(() => {
    setLearnUrlState({
      deepDive: undefined,
      deepDiveSection: undefined,
    })
  }, [setLearnUrlState])

  // Handle keyboard navigation (Escape to go back)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBackToLearn()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBackToLearn])

  // Scroll to section if specified
  useEffect(() => {
    if (sectionId) {
      const timeoutId = setTimeout(() => {
        const element = document.getElementById(sectionId)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [sectionId])

  // Loading state
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading deep dive...</p>
        </div>
      </div>
    )
  }

  // 404 state - deep dive not found in database
  if (!deepDive) {
    return (
      <div className={styles.container}>
        <div className={styles.notFound}>
          <button
            className={styles.backButton}
            onClick={handleBackToLearn}
            title="Back to Learn (Esc)"
          >
            <span className={styles.backIcon}>←</span>
            <span>Back to Learn</span>
          </button>

          <div className={styles.notFoundContent}>
            <h2 className={styles.notFoundTitle}>Deep Dive Not Found</h2>
            <p className={styles.notFoundMessage}>
              The deep dive "<code>{deepDiveId}</code>" could not be found.
            </p>
            <p className={styles.notFoundHint}>
              It may have been moved, renamed, or is not yet available.
            </p>
            <button
              className={styles.notFoundAction}
              onClick={handleBackToLearn}
            >
              Browse Available Content
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Deep dive found but component not yet implemented
  if (!DeepDiveComponent) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button
            className={styles.backButton}
            onClick={handleBackToLearn}
            title="Back to Learn (Esc)"
          >
            <span className={styles.backIcon}>←</span>
            <span>Back to Learn</span>
          </button>
        </div>

        <div className={styles.comingSoon}>
          <div className={styles.comingSoonContent}>
            <h2 className={styles.comingSoonTitle}>{deepDive.title}</h2>
            {deepDive.subtitle && (
              <p className={styles.comingSoonSubtitle}>{deepDive.subtitle}</p>
            )}
            <p className={styles.comingSoonMessage}>
              This deep dive is coming soon!
            </p>
            <div className={styles.comingSoonMeta}>
              <span className={styles.metaItem}>
                {deepDive.estimatedReadTime} min read
              </span>
              <span className={styles.metaDot}>•</span>
              <span className={styles.metaItem}>
                {deepDive.labels.length} topics
              </span>
              <span className={styles.metaDot}>•</span>
              <span className={styles.metaItem}>
                {deepDive.relatedKeps.length} KEPs
              </span>
            </div>
            <button
              className={styles.notFoundAction}
              onClick={handleBackToLearn}
            >
              Browse Available Content
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render the deep dive component with Suspense for lazy loading
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <Suspense
          fallback={
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <p>Loading content...</p>
            </div>
          }
        >
          <DeepDiveComponent sectionId={sectionId} />
        </Suspense>
      </div>
    </div>
  )
}

// =============================================================================
// URL State Helpers
// =============================================================================

/**
 * Parse deep dive ID and section from URL state
 */
export function parseDeepDiveUrl(learnUrlState: {
  deepDive?: string
  deepDiveSection?: string
}): { deepDiveId: string; sectionId?: string } | null {
  if (!learnUrlState.deepDive) {
    return null
  }

  return {
    deepDiveId: learnUrlState.deepDive,
    sectionId: learnUrlState.deepDiveSection,
  }
}

/**
 * Build URL state for navigating to a deep dive
 */
export function buildDeepDiveUrlState(
  deepDiveId: string,
  sectionId?: string
): { deepDive: string; deepDiveSection?: string } {
  return {
    deepDive: deepDiveId,
    deepDiveSection: sectionId,
  }
}

export default DeepDiveView
