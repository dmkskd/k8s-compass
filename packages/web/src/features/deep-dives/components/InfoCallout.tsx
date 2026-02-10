/**
 * InfoCallout Component
 *
 * Callout boxes for tips, warnings, notes, and other informational content.
 *
 * @module features/deep-dives/components/InfoCallout
 */

import styles from './InfoCallout.module.css'

// =============================================================================
// Types
// =============================================================================

type CalloutType = 'tip' | 'warning' | 'note' | 'info' | 'danger'

interface InfoCalloutProps {
  /** Type of callout */
  type: CalloutType
  /** Optional title (defaults based on type) */
  title?: string
  /** Content */
  children: React.ReactNode
  /** Custom class name */
  className?: string
}

// =============================================================================
// Helper Functions
// =============================================================================

function getDefaultTitle(type: CalloutType): string {
  switch (type) {
    case 'tip':
      return 'Tip'
    case 'warning':
      return 'Warning'
    case 'note':
      return 'Note'
    case 'info':
      return 'Info'
    case 'danger':
      return 'Danger'
    default:
      return 'Note'
  }
}

// =============================================================================
// Component
// =============================================================================

export function InfoCallout({
  type,
  title,
  children,
  className = '',
}: InfoCalloutProps) {
  const displayTitle = title ?? getDefaultTitle(type)

  return (
    <div className={`${styles.callout} ${styles[type]} ${className}`}>
      <div className={styles.header}>
        <span className={styles.title}>{displayTitle}</span>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  )
}

// =============================================================================
// Convenience Components
// =============================================================================

interface SimpleCalloutProps {
  title?: string
  children: React.ReactNode
  className?: string
}

export function Tip({ title, children, className }: SimpleCalloutProps) {
  return (
    <InfoCallout type="tip" title={title} className={className}>
      {children}
    </InfoCallout>
  )
}

export function Warning({ title, children, className }: SimpleCalloutProps) {
  return (
    <InfoCallout type="warning" title={title} className={className}>
      {children}
    </InfoCallout>
  )
}

export function Note({ title, children, className }: SimpleCalloutProps) {
  return (
    <InfoCallout type="note" title={title} className={className}>
      {children}
    </InfoCallout>
  )
}

export function Info({ title, children, className }: SimpleCalloutProps) {
  return (
    <InfoCallout type="info" title={title} className={className}>
      {children}
    </InfoCallout>
  )
}

export function Danger({ title, children, className }: SimpleCalloutProps) {
  return (
    <InfoCallout type="danger" title={title} className={className}>
      {children}
    </InfoCallout>
  )
}

export default InfoCallout
