/**
 * KepStatusBadge Component
 *
 * Displays a KEP ID with live status badge (alpha/beta/stable)
 * and links to the GitHub KEP page.
 *
 * @module features/deep-dives/components/KepStatusBadge
 */

import { useMemo } from 'react'
import { useKepStatus, getKepStage, getKepGitHubUrl } from '../hooks/useKepStatus'
import styles from './KepStatusBadge.module.css'

// =============================================================================
// Types
// =============================================================================

interface KepStatusBadgeProps {
  /** KEP ID (e.g., 'KEP-1287' or '1287') */
  kepId: string
  /** Show full title on hover (default: true) */
  showTooltip?: boolean
  /** Show the stage badge (default: true) */
  showStage?: boolean
  /** Compact mode - smaller size (default: false) */
  compact?: boolean
  /** Custom class name */
  className?: string
}

// =============================================================================
// Helper Functions
// =============================================================================

function getStageColor(stage: string): string {
  switch (stage) {
    case 'stable':
      return '#10b981' // Green
    case 'beta':
      return '#f59e0b' // Amber
    case 'alpha':
      return '#8b5cf6' // Purple
    default:
      return '#6b7280' // Gray
  }
}

function getStageLabel(stage: string): string {
  switch (stage) {
    case 'stable':
      return 'Stable'
    case 'beta':
      return 'Beta'
    case 'alpha':
      return 'Alpha'
    default:
      return 'Unknown'
  }
}

// =============================================================================
// Component
// =============================================================================

export function KepStatusBadge({
  kepId,
  showTooltip = true,
  showStage = true,
  compact = false,
  className = '',
}: KepStatusBadgeProps) {
  // Normalize KEP ID
  const normalizedId = useMemo(() => {
    const id = kepId.toUpperCase()
    return id.startsWith('KEP-') ? id : `KEP-${id}`
  }, [kepId])

  // Fetch KEP data
  const { data, loading, error } = useKepStatus([normalizedId])
  const kepData = data.get(normalizedId)

  // Determine stage
  const stage = kepData ? getKepStage(kepData) : 'unknown'
  const stageColor = getStageColor(stage)
  const stageLabel = getStageLabel(stage)

  // Build tooltip content
  const tooltipContent = useMemo(() => {
    if (!kepData) return normalizedId
    return `${kepData.title}\n\nSIG: ${kepData.sig}\nStage: ${stageLabel}`
  }, [kepData, normalizedId, stageLabel])

  // Build GitHub URL
  const githubUrl = kepData ? getKepGitHubUrl(kepData) : null

  // Loading state
  if (loading) {
    return (
      <span
        className={`${styles.badge} ${compact ? styles.compact : ''} ${styles.loading} ${className}`}
      >
        <span className={styles.kepId}>{normalizedId}</span>
        <span className={styles.loadingDot}>•</span>
      </span>
    )
  }

  // Error state - show badge without live data
  if (error || !kepData) {
    return (
      <span
        className={`${styles.badge} ${compact ? styles.compact : ''} ${styles.error} ${className}`}
        title={showTooltip ? `${normalizedId} (status unavailable)` : undefined}
      >
        <span className={styles.kepId}>{normalizedId}</span>
      </span>
    )
  }

  // Success state
  const content = (
    <>
      <span className={styles.kepId}>{normalizedId}</span>
      {showStage && (
        <span
          className={styles.stage}
          style={{ backgroundColor: stageColor }}
        >
          {stageLabel}
        </span>
      )}
    </>
  )

  // Wrap in link if we have a GitHub URL
  if (githubUrl) {
    return (
      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${styles.badge} ${styles.link} ${compact ? styles.compact : ''} ${className}`}
        title={showTooltip ? tooltipContent : undefined}
      >
        {content}
      </a>
    )
  }

  return (
    <span
      className={`${styles.badge} ${compact ? styles.compact : ''} ${className}`}
      title={showTooltip ? tooltipContent : undefined}
    >
      {content}
    </span>
  )
}

// =============================================================================
// Multi-KEP Component
// =============================================================================

interface KepStatusBadgeListProps {
  /** Array of KEP IDs */
  kepIds: string[]
  /** Maximum number to show before "+N more" */
  maxVisible?: number
  /** Compact mode */
  compact?: boolean
  /** Custom class name */
  className?: string
}

export function KepStatusBadgeList({
  kepIds,
  maxVisible = 5,
  compact = true,
  className = '',
}: KepStatusBadgeListProps) {
  const visibleKeps = kepIds.slice(0, maxVisible)
  const hiddenCount = kepIds.length - maxVisible

  return (
    <div className={`${styles.badgeList} ${className}`}>
      {visibleKeps.map((kepId) => (
        <KepStatusBadge
          key={kepId}
          kepId={kepId}
          compact={compact}
          showTooltip
        />
      ))}
      {hiddenCount > 0 && (
        <span className={styles.moreCount}>+{hiddenCount} more</span>
      )}
    </div>
  )
}

export default KepStatusBadge
