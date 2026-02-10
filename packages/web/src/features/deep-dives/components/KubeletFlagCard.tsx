/**
 * KubeletFlagCard Component
 *
 * Displays kubelet CLI flag information with type, default value, and description.
 *
 * @module features/deep-dives/components/KubeletFlagCard
 */

import { useMemo } from 'react'
import {
  useKubeletFlags,
  getFlagTypeColor,
} from '../hooks/useKubeletFlags'
import styles from './KubeletFlagCard.module.css'

// =============================================================================
// Types
// =============================================================================

interface KubeletFlagCardProps {
  /** Flag name (e.g., '--cpu-manager-policy' or 'cpu-manager-policy') */
  flagName: string
  /** Show description (default: true) */
  showDescription?: boolean
  /** Compact mode (default: false) */
  compact?: boolean
  /** Custom class name */
  className?: string
}

// =============================================================================
// Component
// =============================================================================

export function KubeletFlagCard({
  flagName,
  showDescription = true,
  compact = false,
  className = '',
}: KubeletFlagCardProps) {
  // Normalize flag name
  const normalizedName = useMemo(() => {
    return flagName.replace(/^--?/, '')
  }, [flagName])

  const { data, loading, error } = useKubeletFlags([normalizedName])
  const flagData = data.get(normalizedName)

  // Loading state
  if (loading) {
    return (
      <div className={`${styles.card} ${compact ? styles.compact : ''} ${styles.loading} ${className}`}>
        <div className={styles.header}>
          <span className={styles.name}>--{normalizedName}</span>
          <span className={styles.loadingIndicator}>Loading...</span>
        </div>
      </div>
    )
  }

  // Error or not found state
  if (error || !flagData) {
    return (
      <div className={`${styles.card} ${compact ? styles.compact : ''} ${styles.error} ${className}`}>
        <div className={styles.header}>
          <span className={styles.name}>--{normalizedName}</span>
          <span className={styles.errorBadge}>Not Found</span>
        </div>
      </div>
    )
  }

  const typeColor = getFlagTypeColor(flagData.type)

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''} ${flagData.deprecated ? styles.deprecated : ''} ${className}`}>
      <div className={styles.header}>
        <span className={styles.name}>{flagData.name.startsWith('--') ? flagData.name : `--${flagData.name}`}</span>
        <span className={styles.type} style={{ color: typeColor }}>
          {flagData.type}
        </span>
      </div>

      <div className={styles.meta}>
        {flagData.defaultValue && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Default:</span>
            <span className={styles.metaValue}>{flagData.defaultValue}</span>
          </div>
        )}

        {flagData.deprecated && (
          <span className={styles.deprecatedBadge}>Deprecated</span>
        )}

        {flagData.introducedVersion && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Since:</span>
            <span className={styles.versionValue}>{flagData.introducedVersion}</span>
          </div>
        )}

        {flagData.deprecatedVersion && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Deprecated in:</span>
            <span className={styles.versionValue}>{flagData.deprecatedVersion}</span>
          </div>
        )}
      </div>

      {showDescription && flagData.description && (
        <p className={styles.description}>{flagData.description}</p>
      )}
    </div>
  )
}

// =============================================================================
// Inline Badge Version
// =============================================================================

interface KubeletFlagBadgeProps {
  flagName: string
  showDefault?: boolean
  className?: string
}

export function KubeletFlagBadge({
  flagName,
  showDefault = true,
  className = '',
}: KubeletFlagBadgeProps) {
  const normalizedName = useMemo(() => {
    return flagName.replace(/^--?/, '')
  }, [flagName])

  const { data, loading, error } = useKubeletFlags([normalizedName])
  const flagData = data.get(normalizedName)

  if (loading) {
    return (
      <span className={`${styles.badge} ${styles.loading} ${className}`}>
        --{normalizedName}
      </span>
    )
  }

  if (error || !flagData) {
    return (
      <span className={`${styles.badge} ${styles.error} ${className}`}>
        --{normalizedName}
      </span>
    )
  }

  const displayName = flagData.name.startsWith('--') ? flagData.name : `--${flagData.name}`
  const typeColor = getFlagTypeColor(flagData.type)

  return (
    <span
      className={`${styles.badge} ${flagData.deprecated ? styles.deprecated : ''} ${className}`}
      title={flagData.description || undefined}
    >
      <span className={styles.badgeName}>{displayName}</span>
      {showDefault && flagData.defaultValue && (
        <span className={styles.badgeDefault}>={flagData.defaultValue}</span>
      )}
      <span className={styles.badgeType} style={{ color: typeColor }}>
        {flagData.type}
      </span>
    </span>
  )
}

// =============================================================================
// Flag List Component
// =============================================================================

interface KubeletFlagListProps {
  flagNames: string[]
  compact?: boolean
  className?: string
}

export function KubeletFlagList({
  flagNames,
  compact = true,
  className = '',
}: KubeletFlagListProps) {
  return (
    <div className={`${styles.flagList} ${className}`}>
      {flagNames.map((flagName) => (
        <KubeletFlagCard
          key={flagName}
          flagName={flagName}
          compact={compact}
          showDescription={!compact}
        />
      ))}
    </div>
  )
}

export default KubeletFlagCard
