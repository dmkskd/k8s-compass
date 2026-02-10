import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import styles from './HelpModal.module.css'

interface HelpSection {
  id: string
  title: string
  description: string
  videoUrl?: string  // Optional video URL (MP4, YouTube, etc.)
  tips?: string[]
}

const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'constellation',
    title: 'Constellation View',
    description: 'Explore Kubernetes API resources as an interactive 3D star map. Each node represents a Kind, grouped by API group.',
    tips: [
      'Drag to rotate the view, scroll to zoom',
      'Click a node to see its relationships',
      'Use the sidebar to filter by API group',
      'Search by Kind name or short name (e.g., "po" for Pod)',
    ],
  },
  {
    id: 'sunburst',
    title: 'Sunburst View',
    description: 'Hierarchical view of the API structure. Inner rings show API groups, outer rings show Kinds.',
    tips: [
      'Click a segment to zoom in',
      'Click the center to zoom out',
      'Hover to see details',
      'Click a Kind to view its full spec structure',
    ],
  },
  {
    id: 'releases',
    title: 'Releases View',
    description: 'Browse Kubernetes release history, features, and changes across versions.',
    tips: [
      'Click a release to see its features and changes',
      'Filter by stage (Alpha, Beta, Stable)',
      'View security CVEs and urgent upgrade notes',
      'Explore patch releases and their fixes',
    ],
  },
  {
    id: 'learn',
    title: 'Learn',
    description: 'Discover curated learning resources to master Kubernetes - blog posts, documentation, videos, and tutorials.',
    tips: [
      'Filter by content type (blog, video, tutorial)',
      'Toggle between official and community content',
      'Click topic labels to find related resources',
      'Expand cards to see linked KEPs and releases',
    ],
  },
  {
    id: 'analytics',
    title: 'SQL Analytics',
    description: 'Query the Kubernetes API data directly using SQL. Powered by DuckDB WASM.',
    tips: [
      'Use preset queries as starting points',
      'Write custom SQL against parquet tables',
      'Results can be visualized as 3D charts',
      'Export results for further analysis',
    ],
  },
  {
    id: 'keyboard',
    title: 'Keyboard Shortcuts',
    description: 'Quick navigation shortcuts.',
    tips: [
      'ESC - Close panels and modals',
      '? - Open this help modal',
      '/ - Focus search',
      '1-5 - Switch between tabs',
    ],
  },
  {
    id: 'experimental',
    title: 'Experimental Features',
    description: 'Some features are still in development and hidden by default. You can enable them to try them out early.',
    tips: [
      'Control Plane - 3D visualization of K8s architecture, CLI flags, kubectl commands, and feature gates',
    ],
  },
]

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
  initialSection?: string
}

export function HelpModal({ isOpen, onClose, initialSection }: HelpModalProps) {
  const [activeSection, setActiveSection] = useState(HELP_SECTIONS[0].id)

  // Update active section when modal opens with a specific initial section
  useEffect(() => {
    if (isOpen && initialSection) {
      const section = HELP_SECTIONS.find(s => s.id === initialSection)
      if (section) {
        setActiveSection(section.id)
      }
    }
  }, [isOpen, initialSection])

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  if (!isOpen) return null

  const currentSection = HELP_SECTIONS.find(s => s.id === activeSection) || HELP_SECTIONS[0]

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick} data-modal="help">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            <span className={styles.icon}>?</span>
            Help & Guide
          </h2>
          <button className={styles.closeButton} onClick={onClose} title="Close (ESC)">
            ✕
          </button>
        </div>

        <div className={styles.content}>
          {/* Sidebar navigation */}
          <nav className={styles.nav}>
            {HELP_SECTIONS.map(section => (
              <button
                key={section.id}
                className={`${styles.navItem} ${activeSection === section.id ? styles.navItemActive : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.title}
              </button>
            ))}
          </nav>

          {/* Main content */}
          <div className={styles.main}>
            <h3 className={styles.sectionTitle}>{currentSection.title}</h3>
            <p className={styles.description}>{currentSection.description}</p>

            {/* Video player */}
            {currentSection.videoUrl && (
              <div className={styles.videoContainer}>
                <video
                  src={currentSection.videoUrl}
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                  className={styles.video}
                />
              </div>
            )}

            {/* Special content for experimental features */}
            {currentSection.id === 'experimental' && (
              <div className={styles.experimentalSection}>
                <h4 className={styles.tipsTitle}>How to Enable</h4>
                <p className={styles.experimentalInstructions}>
                  Add <code>?features=control-plane</code> to the URL, or enable all experimental features with <code>?features=all</code>
                </p>
                <div className={styles.experimentalExample}>
                  <code>{window.location.origin}/?features=control-plane</code>
                </div>
              </div>
            )}

            {/* Tips list */}
            {currentSection.tips && currentSection.tips.length > 0 && (
              <div className={styles.tips}>
                <h4 className={styles.tipsTitle}>{currentSection.id === 'experimental' ? 'Available Experimental Features' : 'Tips'}</h4>
                <ul className={styles.tipsList}>
                  {currentSection.tips.map((tip, i) => (
                    <li key={i} className={styles.tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <a 
            href="https://github.com/dmkskd/k8s-compass/discussions" 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.feedbackLink}
          >
            Leave feedback or suggestions
          </a>
          <span className={styles.footerText}>Press ESC or click outside to close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Hook to manage help modal state
export function useHelpModal(getCurrentSection?: () => string) {
  const [isOpen, setIsOpen] = useState(false)
  const [initialSection, setInitialSection] = useState<string | undefined>()

  const open = useCallback((section?: string) => {
    setInitialSection(section)
    setIsOpen(true)
  }, [])
  
  const close = useCallback(() => setIsOpen(false), [])
  
  const toggle = useCallback((section?: string) => {
    setIsOpen(prev => {
      if (!prev) {
        // Opening - set the section
        const sectionToUse = section || getCurrentSection?.()
        if (sectionToUse) {
          setInitialSection(sectionToUse)
        }
      }
      return !prev
    })
  }, [getCurrentSection])

  // Global keyboard shortcut to open help
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ? key opens help (shift + /)
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        // Don't trigger if typing in an input
        if (document.activeElement?.tagName === 'INPUT' || 
            document.activeElement?.tagName === 'TEXTAREA') {
          return
        }
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggle])

  return { isOpen, initialSection, open, close, toggle }
}
