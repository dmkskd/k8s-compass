import { useEffect, useMemo } from 'react'
import { useExplorerStore } from '../store/explorerStore'
import { useVersions } from '../hooks'
import { useTheme } from '../hooks/useTheme'
import type { AppSection, APIExplorerViewMode } from '../types'
import { AudioControls } from './AudioControls'
import { getEnabledFeatures, isExperimental } from '../utils/featureFlags'
import styles from './Header.module.css'

const ALL_SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'api-explorer', label: 'API Explorer' },
  { id: 'control-plane', label: 'Control Plane' },
  { id: 'releases', label: 'Releases' },
  { id: 'learn', label: 'Learn' },
  { id: 'analytics', label: 'Analytics' },
]

const VIEW_MODES = [
  { id: 'constellation', label: 'Constellation', icon: '✦' },
  { id: 'sunburst', label: 'Sunburst', icon: '◉' },
] as const

interface HeaderProps {
  onHelpClick?: () => void
}

export function Header({ onHelpClick }: HeaderProps) {
  const { versions } = useVersions()
  const { theme, toggleTheme } = useTheme()
  
  const { 
    activeSection,
    setActiveSection,
    viewMode, 
    setViewMode, 
    selectedVersion, 
    setSelectedVersion,
    searchQuery,
    setSearchQuery,
  } = useExplorerStore()

  // Get enabled features (memoized to avoid recalculating on every render)
  const enabledFeatures = useMemo(() => getEnabledFeatures(), [])
  const visibleSections = useMemo(() => 
    ALL_SECTIONS.filter(s => enabledFeatures.has(s.id)),
    [enabledFeatures]
  )

  // Set initial version when versions load
  useEffect(() => {
    if (versions.length > 0 && !versions.some(v => v.version === selectedVersion)) {
      const latest = versions.find(v => v.isLatest) || versions[0]
      setSelectedVersion(latest.version)
    }
  }, [versions, selectedVersion, setSelectedVersion])

  // If current section is not enabled, switch to first enabled section
  useEffect(() => {
    if (!enabledFeatures.has(activeSection) && visibleSections.length > 0) {
      setActiveSection(visibleSections[0].id)
    }
  }, [activeSection, enabledFeatures, visibleSections, setActiveSection])

  const versionOptions = versions.map(v => v.version)

  return (
    <div className={styles.headerWrapper}>
      {/* Main header bar - brand and main tabs only */}
      <header className={styles.header}>
        {/* Main tabs - includes brand as home button */}
        <nav className={styles.mainTabs}>
          {/* Brand: helm + title - clickable for home */}
          <button 
            className={`${styles.mainTab} ${styles.brandTab} ${activeSection === 'home' ? styles.active : ''}`}
            onClick={() => setActiveSection('home')}
            title="Home"
          >
            <span className={styles.brandContent}>
              <span className={styles.logo}>⎈</span>
              <span className={styles.title}>K8s Compass</span>
            </span>
          </button>
          
          {visibleSections.map((section) => (
            <button
              key={section.id}
              className={`${styles.mainTab} ${activeSection === section.id ? styles.active : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
              {isExperimental(section.id) && (
                <span className={styles.experimentalBadge}>experimental</span>
              )}
            </button>
          ))}
        </nav>

        <div className={styles.spacer} />

        <span className={styles.alphaBanner}>
          Early Alpha: features and data under active development. Data may not be accurate.
        </span>
        
        <button 
          className={styles.helpButton} 
          onClick={onHelpClick}
          title="Help & Guide (?)"
        >
          ?
        </button>
        
        <button 
          className={styles.themeToggle} 
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        
        <a 
          href="https://github.com/dmkskd/k8s-compass"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.githubLink}
          title="View on GitHub"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
        </a>
        
        <AudioControls />
      </header>

      {/* Sub-navigation bar - content depends on active section, hidden for home */}
      {activeSection !== 'home' && (
      <div className={styles.subNav}>
        {activeSection === 'api-explorer' ? (
          <>
            <nav className={styles.viewModes}>
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`${styles.viewMode} ${viewMode === mode.id ? styles.active : ''}`}
                  onClick={() => setViewMode(mode.id as APIExplorerViewMode)}
                  title={mode.label}
                >
                  <span className={styles.viewIcon}>{mode.icon}</span>
                  <span className={styles.viewLabel}>{mode.label}</span>
                </button>
              ))}
            </nav>

            <div className={styles.subNavRight}>
              <div className={styles.search}>
                <span className={styles.searchIcon}>⌕</span>
                <input
                  type="text"
                  placeholder="Search APIs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                />
                {searchQuery && (
                  <button 
                    className={styles.clearSearch}
                    onClick={() => setSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>

              <div className={styles.versionSelector}>
                <label className={styles.versionLabel}>Version</label>
                <select
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  className={styles.versionSelect}
                >
                  {versionOptions.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        ) : activeSection === 'releases' ? (
          <>
            <div className={styles.subNavLabel}>Release Timeline</div>
            <div className={styles.subNavRight}>
              <div className={styles.search}>
                <span className={styles.searchIcon}>⌕</span>
                <input
                  type="text"
                  placeholder="Search features..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                />
                {searchQuery && (
                  <button 
                    className={styles.clearSearch}
                    onClick={() => setSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          </>
        ) : activeSection === 'analytics' ? (
          <>
            <div className={styles.subNavLabel}>
              <span className={styles.duckdbLogoWrapper}>
                <svg className={styles.duckdbLogo} viewBox="0 0 500 500" width="18" height="18">
                  <path fill="#fff100" d="M249.9996737,500C111.9320267,500,0,388.068425,0,250.0000251,0,111.9318259,111.3637372,0,249.9996737,0,388.6367145,0,500,111.9318259,500,250.0000251c0,138.0683999-111.9317506,249.9999749-250.0003263,249.9999749Z"/>
                  <path fill="#1d1d1b" d="M190.0545045,146.5907724c-56.8184727,0-103.4089829,46.5908427-103.4089829,103.4092276,0,57.3868501,46.5905102,103.4092401,103.4089829,103.4092401,56.8183974,0,103.4091523-46.5908552,103.4091523-103.4092401s-46.5907549-103.4092401-103.4091523-103.4092276Z"/>
                  <path fill="#1d1d1b" d="M376.1380597,212.7835876h-49.1467777v74.432875h49.1467777c20.5540155,0,37.2164375-16.6623467,37.2164375-37.2164375v-.0000753c0-20.5540155-16.662422-37.2163622-37.2164375-37.2163622Z"/>
                </svg>
                <span className={styles.duckdbTooltip}>Powered by DuckDB WASM</span>
              </span>
              SQL Analytics
            </div>
            <div className={styles.subNavRight}>
            </div>
          </>
        ) : activeSection === 'learn' ? (
          // Don't show sub-nav when viewing a deep dive - the DeepDiveLayout has its own header
          null
        ) : activeSection === 'control-plane' ? (
          <>
            <div className={styles.subNavLabel}>Control Plane Components</div>
            <div className={styles.subNavRight}>
              <div className={styles.versionSelector}>
                <label className={styles.versionLabel}>Version</label>
                <select
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  className={styles.versionSelect}
                >
                  {versionOptions.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        ) : null}
      </div>
      )}
    </div>
  )
}
