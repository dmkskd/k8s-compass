/**
 * FeatureGateCard Component
 *
 * Displays feature gate information with stage and default value.
 *
 * @module features/deep-dives/components/FeatureGateCard
 */

import {
  useFeatureGate,
  getFeatureGateStageColor,
  formatDefaultValue,
} from '../hooks/useFeatureGate'
import styles from './FeatureGateCard.module.css'

// =============================================================================
// Types
// =============================================================================

interface FeatureGateCardProps {
  /** Feature gate name (e.g., 'CPUManager') */
  gateName: string
  /** K8s version to query (e.g., '1.35') */
  version: string
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

export function FeatureGateCard({
  gateName,
  version,
  showDescription = true,
  compact = false,
  className = '',
}: FeatureGateCardProps) {
  const { data, loading, error } = useFeatureGate(gateName, version)

  // Loading state
  if (loading) {
    return (
      <div className={`${styles.card} ${compact ? styles.compact : ''} ${styles.loading} ${className}`}>
        <div className={styles.header}>
          <span className={styles.name}>{gateName}</span>
          <span className={styles.loadingIndicator}>Loading...</span>
        </div>
      </div>
    )
  }

  // Error or not found state
  if (error || !data) {
    return (
      <div className={`${styles.card} ${compact ? styles.compact : ''} ${styles.error} ${className}`}>
        <div className={styles.header}>
          <span className={styles.name}>{gateName}</span>
          <span className={styles.errorBadge}>Not Found</span>
        </div>
        <p className={styles.errorMessage}>
          Feature gate data unavailable for version {version}
        </p>
      </div>
    )
  }

  const stageColor = getFeatureGateStageColor(data.stage)

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''} ${className}`}>
      <div className={styles.header}>
        <span className={styles.name}>{data.name}</span>
        <span className={styles.stage} style={{ backgroundColor: stageColor }}>
          {data.stage}
        </span>
      </div>

      <div className={styles.meta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Default:</span>
          <span className={`${styles.metaValue} ${data.defaultValue ? styles.enabled : styles.disabled}`}>
            {formatDefaultValue(data.defaultValue)}
          </span>
        </div>

        {data.lockToDefault && (
          <div className={styles.metaItem}>
            <span className={styles.lockBadge}>Locked</span>
          </div>
        )}

        {data.kep && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>KEP:</span>
            <span className={styles.kepLink}>{data.kep}</span>
          </div>
        )}
      </div>

      {showDescription && data.description && (
        <p className={styles.description}>{data.description}</p>
      )}

      {data.components && data.components.length > 0 && (
        <div className={styles.components}>
          <span className={styles.componentsLabel}>Components:</span>
          <div className={styles.componentsList}>
            {data.components.map((comp) => (
              <span key={comp} className={styles.componentTag}>
                {comp}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Inline Badge Version
// =============================================================================

interface FeatureGateBadgeProps {
  gateName: string
  version: string
  className?: string
}

export function FeatureGateBadge({
  gateName,
  version,
  className = '',
}: FeatureGateBadgeProps) {
  const { data, loading, error } = useFeatureGate(gateName, version)

  if (loading) {
    return (
      <span className={`${styles.badge} ${styles.loading} ${className}`}>
        {gateName}
      </span>
    )
  }

  if (error || !data) {
    return (
      <span className={`${styles.badge} ${styles.error} ${className}`}>
        {gateName}
      </span>
    )
  }

  const stageColor = getFeatureGateStageColor(data.stage)

  return (
    <span
      className={`${styles.badge} ${className}`}
      title={`${data.name}: ${data.stage}, default ${formatDefaultValue(data.defaultValue)}`}
    >
      <span className={styles.badgeName}>{data.name}</span>
      <span className={styles.badgeStage} style={{ backgroundColor: stageColor }}>
        {data.stage}
      </span>
    </span>
  )
}

export default FeatureGateCard
