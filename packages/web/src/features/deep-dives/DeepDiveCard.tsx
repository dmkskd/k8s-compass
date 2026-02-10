/**
 * DeepDiveCard Component
 *
 * Card component for displaying deep dives in the Learn view.
 * Styled consistently with regular content cards, with a "Deep Dive" badge.
 *
 * @module features/deep-dives/DeepDiveCard
 */

import { useCallback } from 'react'
import type { DeepDiveMetadata, DeepDiveStatus } from './index'
import styles from './DeepDiveCard.module.css'

// =============================================================================
// Types
// =============================================================================

interface DeepDiveCardProps {
  /** Deep dive metadata */
  metadata: DeepDiveMetadata
  /** Click handler for opening the deep dive */
  onClick: (id: string) => void
  /** Click handler for label filtering */
  onLabelClick?: (label: string, event: React.MouseEvent) => void
  /** Set of currently selected labels (for highlighting) */
  selectedLabels?: Set<string>
  /** Whether the card is expanded */
  expanded?: boolean
  /** Custom class name */
  className?: string
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateString
  }
}

function getStatusDisplay(status: DeepDiveStatus): { text: string; className: string } {
  switch (status) {
    case 'draft':
      return { text: 'Draft', className: styles.statusDraft }
    case 'wip':
      return { text: 'WIP', className: styles.statusWip }
    case 'review':
      return { text: 'Review', className: styles.statusReview }
    case 'published':
      return { text: '', className: '' }
    default:
      return { text: status, className: '' }
  }
}

// =============================================================================
// Component
// =============================================================================

export function DeepDiveCard({
  metadata,
  onClick,
  onLabelClick,
  selectedLabels = new Set(),
  expanded = false,
  className = '',
}: DeepDiveCardProps) {
  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // Don't navigate if clicking on a label button
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    onClick(metadata.id)
  }, [onClick, metadata.id])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onClick(metadata.id)
      }
    },
    [onClick, metadata.id]
  )

  const handleLabelClick = useCallback((label: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onLabelClick?.(label, e)
  }, [onLabelClick])

  return (
    <article
      className={`${styles.card} ${expanded ? styles.expanded : ''} ${className}`}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-expanded={expanded}
    >
      {/* Header with badge */}
      <div className={styles.cardHeader}>
        <span className={styles.contentType}>deep dive</span>
        {metadata.status !== 'published' && (
          <span className={`${styles.statusBadge} ${getStatusDisplay(metadata.status).className}`}>
            {getStatusDisplay(metadata.status).text}
          </span>
        )}
      </div>

      {/* Title */}
      <span className={styles.cardTitle}>{metadata.title}</span>

      {/* Summary/Subtitle */}
      {metadata.subtitle && (
        <p className={styles.cardSummary}>{metadata.subtitle}</p>
      )}

      {/* Description */}
      <p className={styles.cardDescription}>{metadata.description}</p>

      {/* Labels */}
      {metadata.labels.length > 0 && (
        <div className={styles.cardLabels}>
          {metadata.labels.slice(0, expanded ? undefined : 4).map((label) => (
            <button
              key={label}
              className={`${styles.cardLabel} ${selectedLabels.has(label) ? styles.active : ''}`}
              onClick={(e) => handleLabelClick(label, e)}
              title={selectedLabels.size > 0 ? 'Shift+click to add/remove' : 'Click to filter'}
            >
              {label}
            </button>
          ))}
          {!expanded && metadata.labels.length > 4 && (
            <span className={styles.moreLabels}>+{metadata.labels.length - 4}</span>
          )}
        </div>
      )}

      {/* Expanded Content */}
      {expanded && (
        <>
          {/* Related KEPs */}
          {metadata.relatedKeps.length > 0 && (
            <div className={styles.linkedItems}>
              <span className={styles.linkedLabel}>Related KEPs:</span>
              {metadata.relatedKeps.map((kep) => (
                <span key={kep} className={styles.kepBadge}>
                  {kep}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className={styles.cardFooter}>
        <div className={styles.cardMeta}>
          <span className={styles.cardSource}>K8s Compass</span>
          <span className={styles.metaDot}>•</span>
          <span className={styles.cardDate}>{formatDate(metadata.publishedDate)}</span>
          <span className={styles.metaDot}>•</span>
          <span className={styles.cardDate}>{metadata.estimatedReadTime} min read</span>
        </div>
        <span className={styles.expandHint}>
          {expanded ? '▲ Less' : '▼ More'}
        </span>
      </div>
    </article>
  )
}

export default DeepDiveCard
