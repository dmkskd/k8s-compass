/**
 * DeepDiveLayout - Shared layout wrapper for deep dive content
 *
 * Provides consistent structure for all deep dives:
 * - Header with title, subtitle, and metadata
 * - Sticky table of contents sidebar
 * - Main content area
 * - Section intersection observer for TOC highlighting
 *
 * @module features/deep-dives/DeepDiveLayout
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useExplorerStore } from '../../shared/store/explorerStore'
import { executeQuery, parquet } from '../../shared/hooks/useDB'
import type { DeepDiveLayoutProps, DeepDiveSection, DeepDiveStatus } from './index'
import styles from './DeepDiveLayout.module.css'

// =============================================================================
// KEP Path Lookup Hook
// =============================================================================

/**
 * Look up KEP paths from the database for linking to GitHub
 */
function useKepPaths(keps: string[]): Map<string, string> {
  const [kepPaths, setKepPaths] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (keps.length === 0) return

    const fetchKepPaths = async () => {
      try {
        const kepList = keps.map((k) => `'${k}'`).join(', ')
        const result = await executeQuery<{ kep: string; kep_path: string }>(
          `SELECT kep, kep_path FROM ${parquet('keps')} WHERE kep IN (${kepList})`
        )
        const pathMap = new Map<string, string>()
        result.forEach((row) => {
          if (row.kep_path) {
            pathMap.set(row.kep, row.kep_path)
          }
        })
        setKepPaths(pathMap)
      } catch (err) {
        console.error('Failed to fetch KEP paths:', err)
      }
    }

    fetchKepPaths()
  }, [keps])

  return kepPaths
}

/**
 * Generate GitHub URL for a KEP
 */
function getKepGitHubUrl(kep: string, kepPath?: string): string {
  if (kepPath) {
    return `https://github.com/kubernetes/enhancements/tree/master/keps/${kepPath}`
  }
  // Fallback: extract number and search
  const match = kep.match(/KEP-(\d+)/)
  if (match) {
    return `https://github.com/kubernetes/enhancements/issues/${match[1]}`
  }
  return `https://github.com/kubernetes/enhancements`
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a date string for display
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateString
  }
}

/**
 * Get display text and style class for status
 */
function getStatusDisplay(status: DeepDiveStatus): { text: string; className: string } {
  switch (status) {
    case 'draft':
      return { text: 'Draft', className: styles.statusDraft }
    case 'wip':
      return { text: 'Work in Progress', className: styles.statusWip }
    case 'review':
      return { text: 'Under Review', className: styles.statusReview }
    case 'published':
      return { text: 'Published', className: styles.statusPublished }
    default:
      return { text: status, className: '' }
  }
}

/**
 * Get the indentation class for a section based on its level
 */
function getSectionLevelClass(level: 1 | 2 | 3): string {
  switch (level) {
    case 1:
      return styles.tocItemLevel1
    case 2:
      return styles.tocItemLevel2
    case 3:
      return styles.tocItemLevel3
    default:
      return styles.tocItemLevel1
  }
}

// =============================================================================
// Component
// =============================================================================

export function DeepDiveLayout({
  metadata,
  sections,
  children,
  activeSection,
  onSectionChange,
}: DeepDiveLayoutProps) {
  const setLearnUrlState = useExplorerStore((state) => state.setLearnUrlState)
  const setActiveSection = useExplorerStore((state) => state.setActiveSection)
  const setControlPlaneComponent = useExplorerStore((state) => state.setControlPlaneComponent)
  const setControlPlaneSearch = useExplorerStore((state) => state.setControlPlaneSearch)
  
  // Track the currently active section (internal state if not controlled)
  const [internalActiveSection, setInternalActiveSection] = useState<string>(
    activeSection || sections[0]?.id || ''
  )
  
  // Mobile TOC toggle state
  const [isTocOpen, setIsTocOpen] = useState(false)
  
  // Expanded state for "more" tags
  const [kepsExpanded, setKepsExpanded] = useState(false)
  const [gatesExpanded, setGatesExpanded] = useState(false)
  
  // Look up KEP paths for GitHub links
  const kepPaths = useKepPaths(metadata.relatedKeps)
  
  // Use controlled or internal state
  const currentActiveSection = activeSection ?? internalActiveSection
  
  // Ref for the content container to set up intersection observer
  const contentRef = useRef<HTMLDivElement>(null)
  
  // Track if user is manually scrolling (to avoid fighting with intersection observer)
  const isManualScrolling = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Handle back navigation to Learn view
  const handleBackToLearn = useCallback(() => {
    setLearnUrlState({
      deepDive: undefined,
      deepDiveSection: undefined,
    })
  }, [setLearnUrlState])

  // Toggle mobile TOC
  const handleToggleToc = useCallback(() => {
    setIsTocOpen((prev) => !prev)
  }, [])
  
  // Handle feature gate click - navigate to Control Plane view with feature gates open and search pre-filled
  const handleFeatureGateClick = useCallback((gateName: string) => {
    setControlPlaneComponent('feature-gates')
    setControlPlaneSearch(gateName)
    setActiveSection('control-plane')
  }, [setActiveSection, setControlPlaneComponent, setControlPlaneSearch])

  // Handle TOC item click - smooth scroll to section
  const handleTocClick = useCallback(
    (sectionId: string) => {
      const element = document.getElementById(sectionId)
      if (element) {
        // Mark as manual scrolling to prevent intersection observer from fighting
        isManualScrolling.current = true
        
        // Clear any existing timeout
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current)
        }
        
        // Update active section immediately for responsive UI
        if (onSectionChange) {
          onSectionChange(sectionId)
        } else {
          setInternalActiveSection(sectionId)
        }
        
        // Close mobile TOC
        setIsTocOpen(false)
        
        // Smooth scroll to the section
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        
        // Reset manual scrolling flag after animation completes
        scrollTimeoutRef.current = setTimeout(() => {
          isManualScrolling.current = false
        }, 1000)
      }
    },
    [onSectionChange]
  )

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

  // Set up intersection observer for section tracking
  useEffect(() => {
    const contentElement = contentRef.current
    if (!contentElement) return

    // Create intersection observer to track which section is visible
    const observer = new IntersectionObserver(
      (entries) => {
        // Skip if user is manually scrolling
        if (isManualScrolling.current) return

        // Find the most visible section
        const visibleEntries = entries.filter((entry) => entry.isIntersecting)
        
        if (visibleEntries.length > 0) {
          // Sort by intersection ratio and pick the most visible
          const mostVisible = visibleEntries.reduce((prev, current) =>
            current.intersectionRatio > prev.intersectionRatio ? current : prev
          )
          
          const sectionId = mostVisible.target.id
          if (sectionId && sectionId !== currentActiveSection) {
            if (onSectionChange) {
              onSectionChange(sectionId)
            } else {
              setInternalActiveSection(sectionId)
            }
          }
        }
      },
      {
        root: contentElement,
        rootMargin: '-20% 0px -60% 0px', // Trigger when section is in upper portion of viewport
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    )

    // Observe all section elements
    sections.forEach((section) => {
      const element = document.getElementById(section.id)
      if (element) {
        observer.observe(element)
      }
    })

    return () => {
      observer.disconnect()
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [sections, currentActiveSection, onSectionChange])

  // Sync with external activeSection prop
  useEffect(() => {
    if (activeSection && activeSection !== internalActiveSection) {
      setInternalActiveSection(activeSection)
    }
  }, [activeSection, internalActiveSection])

  return (
    <div className={styles.layout}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          {/* Back button */}
          <button
            className={styles.backButton}
            onClick={handleBackToLearn}
            title="Back to Learn (Esc)"
          >
            <span className={styles.backIcon}>←</span>
            <span>Back to Learn</span>
          </button>

          {/* Title and metadata */}
          <div className={styles.titleSection}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{metadata.title}</h1>
              {metadata.status !== 'published' && (
                <span className={`${styles.statusBadge} ${getStatusDisplay(metadata.status).className}`}>
                  {getStatusDisplay(metadata.status).text}
                </span>
              )}
            </div>
            {metadata.subtitle && (
              <p className={styles.subtitle}>{metadata.subtitle}</p>
            )}
            
            <div className={styles.metadata}>
              <span className={styles.metaItem}>
                {metadata.estimatedReadTime} min read
              </span>
              
              {metadata.author && (
                <>
                  <span className={styles.metaDot}>•</span>
                  <span className={styles.metaItem}>
                    {metadata.author}
                  </span>
                </>
              )}
              
              <span className={styles.metaDot}>•</span>
              <span className={styles.metaItem}>
                {formatDate(metadata.publishedDate)}
              </span>
              
              {metadata.updatedDate && metadata.updatedDate !== metadata.publishedDate && (
                <>
                  <span className={styles.metaDot}>•</span>
                  <span className={styles.metaItem}>
                    Updated {formatDate(metadata.updatedDate)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content area with sidebar */}
      <div className={styles.main}>
        {/* Mobile TOC Toggle Button */}
        <button
          className={styles.tocToggle}
          onClick={handleToggleToc}
          aria-expanded={isTocOpen}
          aria-label="Toggle table of contents"
        >
          <span className={styles.tocToggleIcon}>{isTocOpen ? '✕' : '☰'}</span>
          <span className={styles.tocToggleText}>Contents</span>
        </button>

        {/* Table of Contents Sidebar */}
        <aside className={`${styles.sidebar} ${isTocOpen ? styles.sidebarOpen : ''}`}>
          <nav className={styles.toc}>
            <h2 className={styles.tocTitle}>Contents</h2>
            <ul className={styles.tocList}>
              {sections.map((section) => (
                <TocItem
                  key={section.id}
                  section={section}
                  isActive={currentActiveSection === section.id}
                  onClick={handleTocClick}
                />
              ))}
            </ul>
          </nav>
          
          {/* Related info */}
          {(metadata.relatedKeps.length > 0 || metadata.relatedFeatureGates.length > 0) && (
            <div className={styles.relatedInfo}>
              {metadata.relatedKeps.length > 0 && (
                <div className={styles.relatedSection}>
                  <h3 className={styles.relatedTitle}>Related KEPs</h3>
                  <div className={styles.relatedTags}>
                    {(kepsExpanded ? metadata.relatedKeps : metadata.relatedKeps.slice(0, 5)).map((kep) => (
                      <a
                        key={kep}
                        href={getKepGitHubUrl(kep, kepPaths.get(kep))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.kepTag}
                        title={`View ${kep} on GitHub`}
                      >
                        {kep}
                      </a>
                    ))}
                    {metadata.relatedKeps.length > 5 && (
                      <button
                        className={styles.moreTag}
                        onClick={() => setKepsExpanded(!kepsExpanded)}
                        title={kepsExpanded ? 'Show less' : `Show ${metadata.relatedKeps.length - 5} more`}
                      >
                        {kepsExpanded ? 'Show less' : `+${metadata.relatedKeps.length - 5} more`}
                      </button>
                    )}
                  </div>
                </div>
              )}
              
              {metadata.relatedFeatureGates.length > 0 && (
                <div className={styles.relatedSection}>
                  <h3 className={styles.relatedTitle}>Feature Gates</h3>
                  <div className={styles.relatedTags}>
                    {(gatesExpanded ? metadata.relatedFeatureGates : metadata.relatedFeatureGates.slice(0, 3)).map((gate) => (
                      <button
                        key={gate}
                        className={styles.gateTag}
                        onClick={() => handleFeatureGateClick(gate)}
                        title={`View ${gate} in Control Plane`}
                      >
                        {gate}
                      </button>
                    ))}
                    {metadata.relatedFeatureGates.length > 3 && (
                      <button
                        className={styles.moreTag}
                        onClick={() => setGatesExpanded(!gatesExpanded)}
                        title={gatesExpanded ? 'Show less' : `Show ${metadata.relatedFeatureGates.length - 3} more`}
                      >
                        {gatesExpanded ? 'Show less' : `+${metadata.relatedFeatureGates.length - 3} more`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Content area */}
        <div className={styles.content} ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

interface TocItemProps {
  section: DeepDiveSection
  isActive: boolean
  onClick: (sectionId: string) => void
}

function TocItem({ section, isActive, onClick }: TocItemProps) {
  const handleClick = useCallback(() => {
    onClick(section.id)
  }, [onClick, section.id])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onClick(section.id)
      }
    },
    [onClick, section.id]
  )

  return (
    <li className={styles.tocItem}>
      <button
        className={`${styles.tocLink} ${getSectionLevelClass(section.level)} ${
          isActive ? styles.tocLinkActive : ''
        }`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-current={isActive ? 'location' : undefined}
      >
        <span className={styles.tocIndicator} />
        <span className={styles.tocText}>{section.title}</span>
      </button>
    </li>
  )
}

export default DeepDiveLayout
