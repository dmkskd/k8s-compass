import React, { useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useReleaseIndex, useReleaseNotes, useContentLinksForRelease, useContentLinksForKep, useReleaseArtwork } from '../../shared/hooks'
import { useFeatureGateByName, useFeatureGatesByNames } from '../../shared/hooks/useComponentData'
import type { ContentLink } from '../../shared/hooks/useContentLinks'
import { useExplorerStore } from '../../shared/store/explorerStore'
import type { ReleaseFeature, ChangeEntry, ActionRequiredNote, SecurityCVE, PatchRelease, ChangesByKind, ReleaseDeprecation, ReleaseNotes } from '../../shared/types'
import { RotatingStatCard } from './components'
import type { StatItem } from './components'
import styles from './ReleasesView.module.css'

// Helper to extract feature gate names from text
// Feature gates are typically PascalCase identifiers
function extractFeatureGates(text: string): string[] {
  if (!text) return []
  // Match backtick-quoted identifiers that look like feature gates (PascalCase)
  const backtickMatches = text.match(/`([A-Z][a-zA-Z0-9]+)`/g) || []
  const gates = backtickMatches
    .map(m => m.replace(/`/g, ''))
    .filter(name => {
      // Filter to likely feature gates: PascalCase, not common words
      const isPascalCase = /^[A-Z][a-z]+([A-Z][a-z0-9]*)+$/.test(name)
      const notCommonWord = !['PodSpec', 'NodeSpec', 'ServiceSpec', 'DeploymentSpec'].includes(name)
      return isPascalCase && notCommonWord && name.length > 5
    })
  return [...new Set(gates)]
}

// Modal wrapper that renders to document.body via portal
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return createPortal(
    <div className={styles.detailModalOverlay} onClick={onClose}>
      <div className={styles.detailModal} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  )
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 < p2) return -1
    if (p1 > p2) return 1
  }
  return 0
}

type SectionId = 'content' | 'features' | 'notices' | 'changes' | 'patches'

export function ReleasesView() {
  const { index, loading: indexLoading } = useReleaseIndex()
  const { selectedRelease, setSelectedRelease, setSelectedKind, searchQuery, releasesUrlState, setReleasesUrlState } = useExplorerStore()
  
  const activeRelease = selectedRelease || index?.latestVersion
  const { release, loading: releaseLoading } = useReleaseNotes(activeRelease)
  const { content: releaseContent } = useContentLinksForRelease(activeRelease || null)
  
  // Fetch release artwork for background
  const { artworkUrl } = useReleaseArtwork(activeRelease || null)
  
  // Initialize from URL state
  const [expandedSection, setExpandedSectionLocal] = useState<SectionId | null>(
    (releasesUrlState.section as SectionId) || null
  )
  const [featureFilter, setFeatureFilterLocal] = useState<'stable' | 'beta' | 'alpha'>(
    (releasesUrlState.filter as 'stable' | 'beta' | 'alpha') || 'stable'
  )
  const [featureLabelFilter, setFeatureLabelFilterLocal] = useState<string | null>(
    releasesUrlState.labelFilter || null
  )
  const [changeFilter, setChangeFilter] = useState<string | null>(null)
  
  // Wrapped setters that update URL state
  const setExpandedSection = useCallback((section: SectionId | null) => {
    setExpandedSectionLocal(section)
    setReleasesUrlState({ section: section || undefined })
  }, [setReleasesUrlState])
  
  const setFeatureFilter = useCallback((filter: 'stable' | 'beta' | 'alpha') => {
    setFeatureFilterLocal(filter)
    setReleasesUrlState({ filter: filter !== 'stable' ? filter : undefined })
  }, [setReleasesUrlState])
  
  const setFeatureLabelFilter = useCallback((label: string | null) => {
    setFeatureLabelFilterLocal(label)
    setReleasesUrlState({ labelFilter: label || undefined })
  }, [setReleasesUrlState])
  
  // Section-specific search
  const [featureSearch, setFeatureSearch] = useState('')
  const [changeSearch, setChangeSearch] = useState('')
  const [noticeSearch, setNoticeSearch] = useState('')
  const [patchSearch, setPatchSearch] = useState('')

  const handleKindClick = useCallback((kind: string) => setSelectedKind(kind), [setSelectedKind])
  const toggleSection = (id: SectionId) => setExpandedSection(expandedSection === id ? null : id)

  // Compute totals
  const totals = useMemo(() => {
    if (!release) return { content: 0, features: 0, notices: 0, changes: 0, patches: 0 }
    const actionRequired = release.actionRequired?.length || 0
    const security = release.securityInformation?.length || 0
    const deprecations = release.deprecations?.length || 0
    const changes = release.changesByKind 
      ? Object.values(release.changesByKind).reduce((sum, arr) => sum + (arr?.length || 0), 0)
      : 0
    return {
      content: releaseContent?.length || 0,
      features: release.summary.total,
      notices: actionRequired + security + deprecations,
      changes,
      patches: release.patchReleases?.length || 0,
    }
  }, [release, releaseContent])

  // Check if release has enriched data
  const isEnriched = useMemo(() => {
    if (!release) return false
    // Check if features have descriptions (from KEP enrichment)
    const hasFeatureDescriptions = release.features.some(f => f.description && f.description.length > 20)
    // Check if changes have enrichment data
    const hasChangeEnrichment = release.changesByKind && Object.values(release.changesByKind).some(
      changes => changes?.some((c: ChangeEntry) => c.enrichment?.problem)
    )
    return hasFeatureDescriptions || hasChangeEnrichment
  }, [release])

  // Extract all unique labels from all features (across all stages)
  const allFeatureLabels = useMemo(() => {
    if (!release) return []
    const labelCounts = new Map<string, number>()
    for (const feature of release.features) {
      if (feature.labels) {
        for (const label of feature.labels) {
          labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
        }
      }
    }
    // Sort by count descending, then alphabetically
    return Array.from(labelCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }))
  }, [release])

  const filteredFeatures = useMemo(() => {
    if (!release) return []
    let features = release.features
    
    // If searching or filtering by label, search across ALL stages
    if (featureSearch.trim()) {
      const q = featureSearch.toLowerCase()
      features = features.filter(f => 
        f.title.toLowerCase().includes(q) || f.kep.toLowerCase().includes(q) ||
        f.sig.toLowerCase().includes(q) || f.description?.toLowerCase().includes(q)
      )
    } else if (featureLabelFilter) {
      // Label filter - show all stages with that label
      features = features.filter(f => f.labels?.includes(featureLabelFilter))
    } else {
      // No search or label filter - apply stage filter
      features = features.filter(f => f.stage === featureFilter)
    }
    
    // Also apply global search if present
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      features = features.filter(f => 
        f.title.toLowerCase().includes(q) || f.kep.toLowerCase().includes(q) ||
        f.sig.toLowerCase().includes(q) || f.description?.toLowerCase().includes(q)
      )
    }
    return features
  }, [release, featureFilter, featureLabelFilter, featureSearch, searchQuery])

  // Compute year markers based on release positions (evenly spaced releases)
  const yearMarkers = useMemo(() => {
    if (!index || index.releases.length < 2) return []
    
    // Sort releases by date to find year boundaries
    const releasesWithDates = index.releases
      .map((r, i) => {
        const date = r.releaseDate ? new Date(r.releaseDate) : null
        return { version: r.version, date, index: i }
      })
      .filter((r): r is { version: string; date: Date; index: number } => r.date !== null && !isNaN(r.date.getTime()))
    
    if (releasesWithDates.length < 2) return []
    
    // Sort by date
    const sortedByDate = [...releasesWithDates].sort((a, b) => a.date.getTime() - b.date.getTime())
    
    // Find the first release of each year
    const markers: { label: string; position: number }[] = []
    const seenYears = new Set<number>()
    
    const totalReleases = index.releases.length
    const spacing = 80 / Math.max(totalReleases - 1, 1)
    
    for (const r of sortedByDate) {
      const year = r.date.getFullYear()
      if (!seenYears.has(year)) {
        seenYears.add(year)
        // Find this release's position in the display order (newest first)
        const displayIndex = index.releases.findIndex(rel => rel.version === r.version)
        // Position just AFTER the release node (offset by half spacing to the right)
        // Since newest is on left, "after" in time means to the right
        const basePosition = 10 + (displayIndex * spacing)
        const position = basePosition + (spacing * 0.5)
        markers.push({ label: String(year), position })
      }
    }
    
    return markers
  }, [index])

  if (indexLoading) return <div className={styles.loading}><div className={styles.spinner} /><p>Loading releases...</p></div>
  if (!index) return <div className={styles.error}><p>Failed to load release data</p></div>

  return (
    <div className={styles.container}>
      {/* Artwork background layer */}
      {artworkUrl && (
        <div 
          className={styles.artworkBackground}
          style={{ backgroundImage: `url(${artworkUrl})` }}
        />
      )}
      {/* Timeline */}
      <div className={styles.timeline}>
        {/* Year markers in background */}
        {yearMarkers.map((marker, i) => (
          <div 
            key={i} 
            className={styles.quarterMarker}
            style={{ left: `${marker.position}%` }}
          >
            <div className={styles.quarterLine} />
            <span className={styles.quarterLabel}>{marker.label}</span>
          </div>
        ))}
        <div className={styles.timelineLine} />
        {index.releases.map((r, i) => (
          <button
            key={r.version}
            className={`${styles.timelineNode} ${activeRelease === r.version ? styles.active : ''}`}
            onClick={() => setSelectedRelease(r.version)}
            style={{ left: `${10 + (i * 80 / Math.max(index.releases.length - 1, 1))}%` }}
          >
            <div className={styles.nodeCircle} />
            <div className={styles.nodeLabel}>
              <span className={styles.version}>{r.version}</span>
              {r.codename && <span className={styles.codename}>{r.codename.split('(')[0].trim()}</span>}
            </div>
          </button>
        ))}
      </div>

      {releaseLoading ? (
        <div className={styles.loading}><div className={styles.spinner} /></div>
      ) : release ? (
        <div className={styles.releaseDetails}>
          {/* Header */}
          <div className={styles.releaseHeader}>
            <div className={styles.releaseTitle}>
              <h2>{release.version}</h2>
              {release.codename && <span className={styles.releaseCodename}>{release.codename}</span>}
              <span className={styles.releaseDate}>
                {new Date(release.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
          </div>

          {/* Release Summary - description, blog link, and stats */}
          <ReleaseSummary release={release} />

          {/* Not enriched banner */}
          {!isEnriched && (
            <div className={styles.notEnrichedBanner}>
              This release has limited data. Feature descriptions and change context are not yet available.
            </div>
          )}

          {/* Section Cards */}
          <h3 className={styles.exploreTitle}>Explore</h3>
          <div className={styles.sectionCards}>
            <SectionCard 
              title="Features" 
              description="KEP enhancements" 
              count={totals.features} 
              isActive={expandedSection === 'features'} 
              onClick={() => toggleSection('features')} 
            />
            <SectionCard 
              title="Upgrade Notes" 
              description="Action required & deprecations" 
              count={totals.notices} 
              theme="warning"
              isActive={expandedSection === 'notices'} 
              onClick={() => toggleSection('notices')} 
            />
            <SectionCard 
              title="Changes" 
              description="All PR changes" 
              count={totals.changes} 
              isActive={expandedSection === 'changes'} 
              onClick={() => toggleSection('changes')} 
            />
            <SectionCard 
              title="Patches" 
              description="Bug fixes & security" 
              count={totals.patches} 
              isActive={expandedSection === 'patches'} 
              onClick={() => toggleSection('patches')} 
            />
            <SectionCard 
              title="Resources" 
              description="Blogs, docs & videos" 
              count={totals.content} 
              isActive={expandedSection === 'content'} 
              onClick={() => toggleSection('content')} 
            />
          </div>

          {/* Expanded Section Content */}
          {expandedSection && (
            <div className={styles.expandedSection}>
              <div className={styles.expandedHeader}>
                <span className={styles.expandedTitle}>
                  {expandedSection === 'content' && 'Resources'}
                  {expandedSection === 'features' && 'Features'}
                  {expandedSection === 'notices' && 'Upgrade Notes'}
                  {expandedSection === 'changes' && 'Changes'}
                  {expandedSection === 'patches' && 'Patch Releases'}
                </span>
                <button className={styles.expandedClose} onClick={() => setExpandedSection(null)}>×</button>
              </div>
              <div className={styles.expandedContent}>
                {expandedSection === 'content' && (
                  releaseContent && releaseContent.length > 0 ? (
                    <ContentList content={releaseContent} />
                  ) : (
                    <p className={styles.emptyMessage}>No related content available</p>
                  )
                )}

                {expandedSection === 'features' && (
                  <>
                    <FeatureSearchWithAutocomplete 
                      labels={allFeatureLabels}
                      searchValue={featureSearch}
                      onSearchChange={setFeatureSearch}
                      selectedLabel={featureLabelFilter}
                      onLabelSelect={setFeatureLabelFilter}
                    />
                    {!featureSearch && !featureLabelFilter && (
                      <div className={styles.filterBar}>
                        {(['stable', 'beta', 'alpha'] as const).map(f => (
                          <button key={f} className={`${styles.filterButton} ${styles[f]} ${featureFilter === f ? styles.active : ''}`} onClick={() => setFeatureFilter(f)}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                            <span className={styles.filterCount}>{release.features.filter(feat => feat.stage === f).length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {(featureLabelFilter || featureSearch) && (
                      <div className={styles.searchResultsInfo}>
                        {featureLabelFilter && !featureSearch && `Showing ${filteredFeatures.length} feature${filteredFeatures.length !== 1 ? 's' : ''} with label "${featureLabelFilter}"`}
                        {featureSearch && `Found ${filteredFeatures.length} feature${filteredFeatures.length !== 1 ? 's' : ''} matching "${featureSearch}"`}
                        {featureLabelFilter && featureSearch && ` (filtered by "${featureLabelFilter}")`}
                      </div>
                    )}
                    <FeaturesContent features={filteredFeatures} version={activeRelease} onKindClick={handleKindClick} />
                  </>
                )}

                {expandedSection === 'notices' && (
                  <NoticesContent release={release} searchQuery={noticeSearch} setSearchQuery={setNoticeSearch} />
                )}

                {expandedSection === 'changes' && (
                  <ChangesContent changesByKind={release.changesByKind} version={activeRelease} filter={changeFilter} setFilter={setChangeFilter} searchQuery={changeSearch} setSearchQuery={setChangeSearch} />
                )}

                {expandedSection === 'patches' && (
                  <PatchesContent patches={release.patchReleases} searchQuery={patchSearch} setSearchQuery={setPatchSearch} />
                )}
              </div>
            </div>
          )}

          <ReleaseHighlights release={release} />
        </div>
      ) : null}
    </div>
  )
}

// Section Card Component
function SectionCard({ title, description, count, theme, isActive, onClick }: {
  title: string; description?: string; count: number; theme?: string; isActive: boolean; onClick: () => void
}) {
  return (
    <button 
      className={`${styles.sectionCard} ${isActive ? styles.active : ''} ${theme ? styles[theme] : ''}`}
      onClick={onClick}
    >
      <div className={styles.sectionCardInfo}>
        <span className={styles.sectionCardTitle}>{title}</span>
        {description && <span className={styles.sectionCardDescription}>{description}</span>}
      </div>
      <span className={styles.sectionCardCount}>{count}</span>
    </button>
  )
}

// Feature Search with Autocomplete
function FeatureSearchWithAutocomplete({ labels, searchValue, onSearchChange, selectedLabel, onLabelSelect }: {
  labels: { label: string; count: number }[]
  searchValue: string
  onSearchChange: (value: string) => void
  selectedLabel: string | null
  onLabelSelect: (label: string | null) => void
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  // Filter labels based on search input
  const filteredLabels = useMemo(() => {
    if (!searchValue.trim()) return labels
    const q = searchValue.toLowerCase()
    return labels.filter(({ label }) => label.toLowerCase().includes(q))
  }, [labels, searchValue])

  // Show dropdown when focused and either no search or matching labels exist
  const showDropdown = isFocused && (filteredLabels.length > 0 || !searchValue.trim())

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.min(prev + 1, filteredLabels.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      const selected = filteredLabels[highlightedIndex]
      if (selected) {
        onLabelSelect(selected.label)
        onSearchChange('')
        setIsFocused(false)
        inputRef.current?.blur()
      }
    } else if (e.key === 'Escape') {
      setIsFocused(false)
      inputRef.current?.blur()
    }
  }

  const handleLabelClick = (label: string) => {
    onLabelSelect(selectedLabel === label ? null : label)
    onSearchChange('')
    setIsFocused(false)
  }

  const handleClear = () => {
    onSearchChange('')
    onLabelSelect(null)
    inputRef.current?.focus()
  }

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset highlight when search changes
  React.useEffect(() => {
    setHighlightedIndex(-1)
  }, [searchValue])

  return (
    <div className={styles.autocompleteContainer}>
      <div className={styles.autocompleteInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          placeholder={selectedLabel ? `Label: ${selectedLabel}` : "Search features or select a label..."}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          className={`${styles.autocompleteInput} ${selectedLabel ? styles.hasLabel : ''}`}
        />
        {(searchValue || selectedLabel) && (
          <button className={styles.autocompleteClear} onClick={handleClear}>×</button>
        )}
      </div>
      
      {showDropdown && (
        <div ref={dropdownRef} className={styles.autocompleteDropdown}>
          {!searchValue.trim() && (
            <div className={styles.dropdownHeader}>Select a label to filter features</div>
          )}
          {searchValue.trim() && filteredLabels.length > 0 && (
            <div className={styles.dropdownHeader}>
              Matching labels ({filteredLabels.length}) — or press Enter to search "{searchValue}"
            </div>
          )}
          {searchValue.trim() && filteredLabels.length === 0 && (
            <div className={styles.dropdownHeader}>
              No matching labels — press Enter to search "{searchValue}"
            </div>
          )}
          <div className={styles.dropdownLabels}>
            {filteredLabels.map(({ label, count }, index) => (
              <button
                key={label}
                className={`${styles.dropdownLabel} ${selectedLabel === label ? styles.selected : ''} ${highlightedIndex === index ? styles.highlighted : ''}`}
                onClick={() => handleLabelClick(label)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className={styles.dropdownLabelName}>{label}</span>
                <span className={styles.dropdownLabelCount}>{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Content List
function ContentList({ content }: { content: ContentLink[] }) {
  return (
    <div className={styles.contentList}>
      {content.map((item, i) => (
        <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className={styles.contentItem}>
          <div className={styles.contentItemHeader}>
            <span className={styles.contentType}>{item.content_type}</span>
            {item.is_official && <span className={styles.officialBadge}>Official</span>}
          </div>
          <span className={styles.contentItemTitle}>{item.title}</span>
          {item.summary && <p className={styles.contentSummary}>{item.summary}</p>}
          <div className={styles.contentMeta}>
            <span className={styles.contentSource}>{item.source}</span>
            {item.published_date && <span className={styles.contentDate}>{new Date(item.published_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
          </div>
        </a>
      ))}
    </div>
  )
}

// Notices Content
function NoticesContent({ release, searchQuery = '', setSearchQuery }: { release: { actionRequired?: ActionRequiredNote[]; securityInformation?: SecurityCVE[]; deprecations?: ReleaseDeprecation[] }; searchQuery?: string; setSearchQuery?: (q: string) => void }) {
  const [subSection, setSubSection] = useState<'actionRequired' | 'security' | 'deprecations'>('actionRequired')
  const [selectedActionRequired, setSelectedActionRequired] = useState<ActionRequiredNote | null>(null)
  const [selectedSecurity, setSelectedSecurity] = useState<SecurityCVE | null>(null)
  const [selectedDeprecation, setSelectedDeprecation] = useState<ReleaseDeprecation | null>(null)
  const query = searchQuery.toLowerCase().trim()
  
  const actionRequiredNotes = release.actionRequired || []
  const security = release.securityInformation || []
  const deprecations = release.deprecations || []
  
  // Close modal on ESC key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedActionRequired(null)
        setSelectedSecurity(null)
        setSelectedDeprecation(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  // Filter by search query
  const filteredActionRequired = query ? actionRequiredNotes.filter(n => 
    n.description?.toLowerCase().includes(query) || n.enrichment?.title?.toLowerCase().includes(query)
  ) : actionRequiredNotes
  const filteredSecurity = query ? security.filter(c => 
    c.cve?.toLowerCase().includes(query) || c.title?.toLowerCase().includes(query) || c.description?.toLowerCase().includes(query)
  ) : security
  const filteredDeprecations = query ? deprecations.filter(d => 
    d.item?.toLowerCase().includes(query) || d.reason?.toLowerCase().includes(query)
  ) : deprecations
  
  const totalFiltered = filteredActionRequired.length + filteredSecurity.length + filteredDeprecations.length

  const ActionRequiredCard = ({ note }: { note: ActionRequiredNote }) => (
    <div 
      className={styles.noticeItem}
      onClick={() => setSelectedActionRequired(note)}
      style={{ cursor: 'pointer' }}
    >
      {note.enrichment?.title && <h4 className={styles.noticeItemTitle}>{note.enrichment.title}</h4>}
      <p className={styles.noticeDescription}>{note.description}</p>
      {note.enrichment?.action && <div className={styles.actionRequired}><strong>Action:</strong> {note.enrichment.action}</div>}
      <div className={styles.noticeMeta}>
        {note.enrichment?.severity && <span className={`${styles.severityBadge} ${styles[note.enrichment.severity]}`}>{note.enrichment.severity}</span>}
        {note.prNumber && <span className={styles.prLink}>#{note.prNumber}</span>}
      </div>
    </div>
  )

  const SecurityCard = ({ cve }: { cve: SecurityCVE }) => (
    <div 
      className={styles.noticeItem}
      onClick={() => setSelectedSecurity(cve)}
      style={{ cursor: 'pointer' }}
    >
      <div className={styles.cveHeader}><span className={styles.cveBadge}>{cve.cve}</span><span>{cve.title}</span></div>
      <p className={styles.noticeDescription}>{cve.description}</p>
      <div className={styles.noticeMeta}>
        {cve.patchVersion && <span className={styles.patchVersion}>Fixed in {cve.patchVersion}</span>}
        {cve.affectedComponents && cve.affectedComponents.length > 0 && <span>{cve.affectedComponents.join(', ')}</span>}
      </div>
    </div>
  )

  const DeprecationCard = ({ dep }: { dep: ReleaseDeprecation }) => (
    <div 
      className={styles.noticeItem}
      onClick={() => setSelectedDeprecation(dep)}
      style={{ cursor: 'pointer' }}
    >
      <div className={styles.deprecationHeader}>
        <span className={styles.deprecationName}>{dep.item}</span>
        {dep.removalTarget && <span className={styles.removalTarget}>Removal: {dep.removalTarget}</span>}
      </div>
      <p className={styles.noticeDescription}>{dep.reason}</p>
      {dep.replacement && <div className={styles.replacement}><strong>Use instead:</strong> <code>{dep.replacement}</code></div>}
    </div>
  )

  return (
    <div>
      {setSearchQuery && (
        <div className={styles.sectionSearchBar}>
          <input
            type="text"
            placeholder="Search notices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.sectionSearchInput}
          />
          {searchQuery && (
            <button className={styles.clearSearch} onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      )}
      {query && (
        <div className={styles.searchResultsInfo}>
          Found {totalFiltered} notice{totalFiltered !== 1 ? 's' : ''} matching "{searchQuery}"
        </div>
      )}
      {!query && (
        <div className={styles.filterBar}>
          <button className={`${styles.filterButton} ${styles.urgent} ${subSection === 'actionRequired' ? styles.active : ''}`} onClick={() => setSubSection('actionRequired')}>
            Action Required <span className={styles.filterCount}>{actionRequiredNotes.length}</span>
          </button>
          <button className={`${styles.filterButton} ${styles.security} ${subSection === 'security' ? styles.active : ''}`} onClick={() => setSubSection('security')}>
            Security <span className={styles.filterCount}>{security.length}</span>
          </button>
          <button className={`${styles.filterButton} ${styles.deprecation} ${subSection === 'deprecations' ? styles.active : ''}`} onClick={() => setSubSection('deprecations')}>
            Deprecations <span className={styles.filterCount}>{deprecations.length}</span>
          </button>
        </div>
      )}
      
      {/* When searching, show all matching results */}
      {query ? (
        <div className={styles.noticesList}>
          {filteredActionRequired.length > 0 && (
            <>
              <div className={styles.noticeGroupHeader}>Action Required ({filteredActionRequired.length})</div>
              {filteredActionRequired.map((note, i) => (
                <ActionRequiredCard key={`action-${i}`} note={note} />
              ))}
            </>
          )}
          {filteredSecurity.length > 0 && (
            <>
              <div className={styles.noticeGroupHeader}>Security ({filteredSecurity.length})</div>
              {filteredSecurity.map((cve, i) => (
                <SecurityCard key={`security-${i}`} cve={cve} />
              ))}
            </>
          )}
          {filteredDeprecations.length > 0 && (
            <>
              <div className={styles.noticeGroupHeader}>Deprecations ({filteredDeprecations.length})</div>
              {filteredDeprecations.map((dep, i) => (
                <DeprecationCard key={`dep-${i}`} dep={dep} />
              ))}
            </>
          )}
          {totalFiltered === 0 && <p className={styles.emptyMessage}>No notices matching "{searchQuery}"</p>}
        </div>
      ) : (
        <>
          {subSection === 'actionRequired' && (
            <div className={styles.noticesList}>
              {actionRequiredNotes.length === 0 ? <p className={styles.emptyMessage}>No action required notes</p> : actionRequiredNotes.map((note, i) => (
                <ActionRequiredCard key={i} note={note} />
              ))}
            </div>
          )}
          
          {subSection === 'security' && (
            <div className={styles.noticesList}>
              {security.length === 0 ? <p className={styles.emptyMessage}>No security CVEs</p> : security.map((cve, i) => (
                <SecurityCard key={i} cve={cve} />
              ))}
            </div>
          )}
          
          {subSection === 'deprecations' && (
            <div className={styles.noticesList}>
              {deprecations.length === 0 ? <p className={styles.emptyMessage}>No deprecations</p> : deprecations.map((dep, i) => (
                <DeprecationCard key={i} dep={dep} />
              ))}
            </div>
          )}
        </>
      )}
      
      {/* Action Required Detail Modal */}
      {selectedActionRequired && (
        <div className={styles.detailModalOverlay} onClick={() => setSelectedActionRequired(null)}>
          <div className={styles.detailModal} onClick={e => e.stopPropagation()}>
            <div className={styles.detailModalHeader}>
              <span className={styles.detailModalTitle}>{selectedActionRequired.enrichment?.title || 'Action Required'}</span>
              <button className={styles.detailModalClose} onClick={() => setSelectedActionRequired(null)}>×</button>
            </div>
            <div className={styles.detailModalBody}>
              <div className={styles.detailModalSection}>
                <div className={styles.detailModalLabel}>Description</div>
                <div className={styles.detailModalText}>{selectedActionRequired.description}</div>
              </div>
              {selectedActionRequired.enrichment?.action && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Action Required</div>
                  <div className={styles.detailModalText}>{selectedActionRequired.enrichment.action}</div>
                </div>
              )}
              {selectedActionRequired.enrichment?.summary && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Summary</div>
                  <div className={styles.detailModalText}>{selectedActionRequired.enrichment.summary}</div>
                </div>
              )}
              {selectedActionRequired.enrichment?.affectedComponents && selectedActionRequired.enrichment.affectedComponents.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Affected Components</div>
                  <div className={styles.detailModalText}>{selectedActionRequired.enrichment.affectedComponents.join(', ')}</div>
                </div>
              )}
              {selectedActionRequired.enrichment?.affectedWorkloads && selectedActionRequired.enrichment.affectedWorkloads.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Affected Workloads</div>
                  <div className={styles.detailModalText}>{selectedActionRequired.enrichment.affectedWorkloads.join(', ')}</div>
                </div>
              )}
              <div className={styles.detailModalMeta}>
                {selectedActionRequired.enrichment?.severity && (
                  <span className={`${styles.severityBadge} ${styles[selectedActionRequired.enrichment.severity]}`}>{selectedActionRequired.enrichment.severity}</span>
                )}
                {selectedActionRequired.enrichment?.breakingChange && (
                  <span className={styles.detailModalBadge} style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>Breaking Change</span>
                )}
                {selectedActionRequired.prNumber && (
                  <a 
                    href={selectedActionRequired.prUrl || `https://github.com/kubernetes/kubernetes/pull/${selectedActionRequired.prNumber}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className={styles.detailModalLink}
                  >
                    PR #{selectedActionRequired.prNumber}
                  </a>
                )}
                {selectedActionRequired.sigs && selectedActionRequired.sigs.length > 0 && (
                  <span className={styles.detailModalBadge}>{selectedActionRequired.sigs.join(', ')}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Security Detail Modal */}
      {selectedSecurity && (
        <div className={styles.detailModalOverlay} onClick={() => setSelectedSecurity(null)}>
          <div className={styles.detailModal} onClick={e => e.stopPropagation()}>
            <div className={styles.detailModalHeader}>
              <span className={styles.detailModalTitle}>{selectedSecurity.cve}: {selectedSecurity.title}</span>
              <button className={styles.detailModalClose} onClick={() => setSelectedSecurity(null)}>×</button>
            </div>
            <div className={styles.detailModalBody}>
              <div className={styles.detailModalSection}>
                <div className={styles.detailModalLabel}>Description</div>
                <div className={styles.detailModalText}>{selectedSecurity.description}</div>
              </div>
              {selectedSecurity.affectedComponents && selectedSecurity.affectedComponents.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Affected Components</div>
                  <div className={styles.detailModalText}>{selectedSecurity.affectedComponents.join(', ')}</div>
                </div>
              )}
              {selectedSecurity.affectedVersions && selectedSecurity.affectedVersions.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Affected Versions</div>
                  <div className={styles.detailModalText}>{selectedSecurity.affectedVersions.join(', ')}</div>
                </div>
              )}
              {selectedSecurity.fixedVersions && selectedSecurity.fixedVersions.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Fixed Versions</div>
                  <div className={styles.detailModalText}>{selectedSecurity.fixedVersions.join(', ')}</div>
                </div>
              )}
              <div className={styles.detailModalMeta}>
                <span className={styles.cveBadge}>{selectedSecurity.cve}</span>
                {selectedSecurity.patchVersion && (
                  <span className={styles.detailModalBadge} style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80' }}>Fixed in {selectedSecurity.patchVersion}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Deprecation Detail Modal */}
      {selectedDeprecation && (
        <div className={styles.detailModalOverlay} onClick={() => setSelectedDeprecation(null)}>
          <div className={styles.detailModal} onClick={e => e.stopPropagation()}>
            <div className={styles.detailModalHeader}>
              <span className={styles.detailModalTitle}>{selectedDeprecation.item}</span>
              <button className={styles.detailModalClose} onClick={() => setSelectedDeprecation(null)}>×</button>
            </div>
            <div className={styles.detailModalBody}>
              <div className={styles.detailModalSection}>
                <div className={styles.detailModalLabel}>Reason</div>
                <div className={styles.detailModalText}>{selectedDeprecation.reason}</div>
              </div>
              {selectedDeprecation.replacement && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Replacement</div>
                  <div className={styles.detailModalText}><code>{selectedDeprecation.replacement}</code></div>
                </div>
              )}
              <div className={styles.detailModalMeta}>
                {selectedDeprecation.removalTarget && (
                  <span className={styles.detailModalBadge}>Removal: {selectedDeprecation.removalTarget}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Changes Content
function ChangesContent({ changesByKind, version, filter, setFilter, searchQuery = '', setSearchQuery }: { 
  changesByKind?: ChangesByKind; version?: string; filter: string | null; setFilter: (f: string | null) => void; searchQuery?: string; setSearchQuery?: (q: string) => void
}) {
  const [selectedChange, setSelectedChange] = useState<ChangeEntry | null>(null)
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  
  // Extract feature gates from selected change description
  const extractedGates = useMemo(() => {
    if (!selectedChange) return []
    return extractFeatureGates(selectedChange.description || '')
  }, [selectedChange])
  
  // Look up feature gate details
  const { gates: featureGatesMap } = useFeatureGatesByNames(version || null, extractedGates)
  
  // Close modal on ESC key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedChange) {
        setSelectedChange(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedChange])
  
  if (!changesByKind) return <p className={styles.emptyMessage}>No change data available</p>

  // Fixed order for change kinds
  const kindOrder = ['feature', 'bugOrRegression', 'apiChange', 'deprecation', 'documentation', 'failingTest', 'other']
  
  const kindConfig: Record<string, { label: string }> = {
    feature: { label: 'Features' },
    bugOrRegression: { label: 'Bug Fixes' },
    apiChange: { label: 'API Changes' },
    deprecation: { label: 'Deprecations' },
    documentation: { label: 'Documentation' },
    failingTest: { label: 'Test Fixes' },
    other: { label: 'Other' },
  }

  const query = searchQuery.toLowerCase().trim()
  
  // Extract all unique labels from all changes
  const allChangeLabels = useMemo(() => {
    const labelCounts = new Map<string, number>()
    for (const entries of Object.values(changesByKind)) {
      if (!entries) continue
      for (const entry of entries) {
        if (entry.enrichment?.labels) {
          for (const label of entry.enrichment.labels) {
            labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
          }
        }
      }
    }
    return Array.from(labelCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }))
  }, [changesByKind])
  
  // Filter function for label matching
  const matchesLabel = (entry: ChangeEntry) => {
    if (!labelFilter) return true
    return entry.enrichment?.labels?.includes(labelFilter)
  }
  
  // When searching or filtering by label, search across ALL change kinds
  const allEntries = (query || labelFilter) ? Object.entries(changesByKind)
    .filter((entry): entry is [string, ChangeEntry[]] => entry[1] != null && entry[1].length > 0)
    .flatMap(([kind, entries]) => entries.filter(e => {
      const matchesQuery = !query || e.description?.toLowerCase().includes(query) || e.author?.toLowerCase().includes(query)
      const matchesLabelFilter = matchesLabel(e)
      return matchesQuery && matchesLabelFilter
    }).map(e => ({ ...e, _kind: kind }))) : []
  
  const kinds = kindOrder
    .filter(kind => changesByKind[kind as keyof ChangesByKind]?.length)
    .map(kind => {
      const entries = changesByKind[kind as keyof ChangesByKind] || []
      const filtered = (query || labelFilter) ? entries.filter(e => {
        const matchesQuery = !query || e.description?.toLowerCase().includes(query) || e.author?.toLowerCase().includes(query)
        const matchesLabelFilter = matchesLabel(e)
        return matchesQuery && matchesLabelFilter
      }) : entries
      return { kind, entries: filtered, config: kindConfig[kind] || { label: kind } }
    })
    .filter(k => k.entries.length > 0)

  // When filtering by label/search, reset to first available kind if current filter is empty
  const activeKind = (filter && kinds.some(k => k.kind === filter)) ? filter : kinds[0]?.kind
  
  const handleLabelSelect = (label: string | null) => {
    setLabelFilter(label)
    setFilter(null) // Reset category filter when selecting a label
    if (setSearchQuery) setSearchQuery('')
  }

  return (
    <div>
      {allChangeLabels.length > 0 && (
        <ChangeSearchWithAutocomplete 
          labels={allChangeLabels}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery || (() => {})}
          selectedLabel={labelFilter}
          onLabelSelect={handleLabelSelect}
        />
      )}
      {!allChangeLabels.length && setSearchQuery && (
        <div className={styles.sectionSearchBar}>
          <input
            type="text"
            placeholder="Search changes across all categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.sectionSearchInput}
          />
          {searchQuery && (
            <button className={styles.clearSearch} onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      )}
      {(query || labelFilter) && (
        <div className={styles.searchResultsInfo}>
          {labelFilter && !query && `Showing ${allEntries.length} change${allEntries.length !== 1 ? 's' : ''} with label "${labelFilter}"`}
          {query && `Found ${allEntries.length} change${allEntries.length !== 1 ? 's' : ''} matching "${searchQuery}"`}
          {labelFilter && query && ` (filtered by "${labelFilter}")`}
        </div>
      )}
      <div className={styles.filterBar}>
        {kinds.map(({ kind, entries, config }) => (
          <button 
            key={kind} 
            className={`${styles.filterButton} ${kind === 'breaking' ? styles.breaking : ''} ${activeKind === kind ? styles.active : ''}`} 
            onClick={() => setFilter(kind)}
          >
            {config.label} <span className={styles.filterCount}>{entries.length}</span>
          </button>
        ))}
      </div>
      <div className={styles.changeEntries}>
        {kinds.find(k => k.kind === activeKind)?.entries.map((entry, i) => (
          <div 
            key={i} 
            className={styles.changeEntry}
            onClick={() => setSelectedChange(entry)}
          >
            <p className={styles.changeDescription}>{entry.description && entry.description.toLowerCase() !== 'none' ? entry.description : `PR #${entry.prNumber}`}</p>
            <div className={styles.changeMeta}>
              {entry.prNumber && <span className={styles.prLink}>#{entry.prNumber}</span>}
              {entry.enrichment?.labels && entry.enrichment.labels.length > 0 && (
                <span className={styles.changeLabels}>
                  {entry.enrichment.labels.slice(0, 3).map(label => (
                    <span key={label} className={styles.changeLabel}>{label}</span>
                  ))}
                  {entry.enrichment.labels.length > 3 && (
                    <span className={styles.changeLabelMore}>+{entry.enrichment.labels.length - 3}</span>
                  )}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Change Detail Modal */}
      {selectedChange && (
        <Modal onClose={() => setSelectedChange(null)}>
            <div className={styles.detailModalHeader}>
              <span className={styles.detailModalTitle}>{selectedChange.description && selectedChange.description.toLowerCase() !== 'none' ? selectedChange.description : `PR #${selectedChange.prNumber}`}</span>
              <button className={styles.detailModalClose} onClick={() => setSelectedChange(null)}>×</button>
            </div>
            <div className={styles.detailModalBody}>
              {selectedChange.enrichment && (
                <>
                  {selectedChange.enrichment.problem && (
                    <div className={styles.detailModalSection}>
                      <div className={styles.detailModalLabel}>Problem</div>
                      <div className={styles.detailModalText}>{selectedChange.enrichment.problem}</div>
                    </div>
                  )}
                  {selectedChange.enrichment.fix && (
                    <div className={styles.detailModalSection}>
                      <div className={styles.detailModalLabel}>Fix</div>
                      <div className={styles.detailModalText}>{selectedChange.enrichment.fix}</div>
                    </div>
                  )}
                  {selectedChange.enrichment.impact && (
                    <div className={styles.detailModalSection}>
                      <div className={styles.detailModalLabel}>Impact</div>
                      <div className={styles.detailModalText}>{selectedChange.enrichment.impact}</div>
                    </div>
                  )}
                  {selectedChange.enrichment.labels && selectedChange.enrichment.labels.length > 0 && (
                    <div className={styles.detailModalSection}>
                      <div className={styles.detailModalLabel}>Labels</div>
                      <div className={styles.detailModalLabels}>
                        {selectedChange.enrichment.labels.map(label => (
                          <span key={label} className={styles.detailModalLabelBadge}>{label}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {/* Feature Gates extracted from description */}
              {extractedGates.length > 0 && featureGatesMap.size > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>
                    Feature Gates
                    <a 
                      href="https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.featureGateDocsLink}
                      title="Learn about Feature Gates"
                    >
                      ?
                    </a>
                  </div>
                  <div className={styles.featureGatesGrid}>
                    {extractedGates.map(gateName => {
                      const gate = featureGatesMap.get(gateName)
                      if (!gate) return null
                      const statusText = gate.lock_to_default ? 'Always enabled' : gate.default_value ? 'Enabled by default' : 'Needs enabling'
                      const statusClass = gate.default_value || gate.lock_to_default ? styles.gateEnabled : styles.gateDisabled
                      return (
                        <div key={gateName} className={styles.featureGateItem}>
                          <code className={styles.featureGate}>{gateName}</code>
                          <span className={statusClass}>{statusText}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className={styles.detailModalMeta}>
                {selectedChange.prNumber && (
                  <a 
                    href={selectedChange.prUrl || `https://github.com/kubernetes/kubernetes/pull/${selectedChange.prNumber}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className={styles.detailModalLink}
                  >
                    PR #{selectedChange.prNumber}
                  </a>
                )}
                {selectedChange.sigs && selectedChange.sigs.length > 0 && (
                  <span className={styles.detailModalBadge}>{selectedChange.sigs.join(', ')}</span>
                )}
              </div>
            </div>
        </Modal>
      )}
    </div>
  )
}

// Change Search with Autocomplete (similar to Feature search)
function ChangeSearchWithAutocomplete({ labels, searchValue, onSearchChange, selectedLabel, onLabelSelect }: {
  labels: { label: string; count: number }[]
  searchValue: string
  onSearchChange: (value: string) => void
  selectedLabel: string | null
  onLabelSelect: (label: string | null) => void
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const filteredLabels = useMemo(() => {
    if (!searchValue.trim()) return labels
    const q = searchValue.toLowerCase()
    return labels.filter(({ label }) => label.toLowerCase().includes(q))
  }, [labels, searchValue])

  const showDropdown = isFocused && (filteredLabels.length > 0 || !searchValue.trim())

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.min(prev + 1, filteredLabels.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      const selected = filteredLabels[highlightedIndex]
      if (selected) {
        onLabelSelect(selected.label)
        onSearchChange('')
        setIsFocused(false)
        inputRef.current?.blur()
      }
    } else if (e.key === 'Escape') {
      setIsFocused(false)
      inputRef.current?.blur()
    }
  }

  const handleLabelClick = (label: string) => {
    onLabelSelect(selectedLabel === label ? null : label)
    onSearchChange('')
    setIsFocused(false)
  }

  const handleClear = () => {
    onSearchChange('')
    onLabelSelect(null)
    inputRef.current?.focus()
  }

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  React.useEffect(() => {
    setHighlightedIndex(-1)
  }, [searchValue])

  return (
    <div className={styles.autocompleteContainer}>
      <div className={styles.autocompleteInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          placeholder={selectedLabel ? `Label: ${selectedLabel}` : "Search changes or select a label..."}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          className={`${styles.autocompleteInput} ${selectedLabel ? styles.hasLabel : ''}`}
        />
        {(searchValue || selectedLabel) && (
          <button className={styles.autocompleteClear} onClick={handleClear}>×</button>
        )}
      </div>
      
      {showDropdown && (
        <div ref={dropdownRef} className={styles.autocompleteDropdown}>
          {!searchValue.trim() && (
            <div className={styles.dropdownHeader}>Select a label to filter changes</div>
          )}
          {searchValue.trim() && filteredLabels.length > 0 && (
            <div className={styles.dropdownHeader}>
              Matching labels ({filteredLabels.length}) — or press Enter to search "{searchValue}"
            </div>
          )}
          {searchValue.trim() && filteredLabels.length === 0 && (
            <div className={styles.dropdownHeader}>
              No matching labels — press Enter to search "{searchValue}"
            </div>
          )}
          <div className={styles.dropdownLabels}>
            {filteredLabels.map(({ label, count }, index) => (
              <button
                key={label}
                className={`${styles.dropdownLabel} ${selectedLabel === label ? styles.selected : ''} ${highlightedIndex === index ? styles.highlighted : ''}`}
                onClick={() => handleLabelClick(label)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className={styles.dropdownLabelName}>{label}</span>
                <span className={styles.dropdownLabelCount}>{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Patches Content
function PatchesContent({ patches, searchQuery = '', setSearchQuery }: { patches?: PatchRelease[]; searchQuery?: string; setSearchQuery?: (q: string) => void }) {
  const [expandedPatch, setExpandedPatch] = useState<string | null>(null)
  
  if (!patches || patches.length === 0) return <p className={styles.emptyMessage}>No patch releases yet</p>

  const query = searchQuery.toLowerCase().trim()
  
  // Filter patches and their contents by search query
  const filteredPatches = query ? patches.map(patch => {
    // Filter security fixes
    const filteredSecurityFixes = patch.securityFixes?.filter(fix => 
      fix.cve?.toLowerCase().includes(query) || fix.title?.toLowerCase().includes(query) || fix.description?.toLowerCase().includes(query)
    ) || []
    
    // Filter changes
    const filteredChangesByKind: typeof patch.changesByKind = {}
    if (patch.changesByKind) {
      for (const [kind, entries] of Object.entries(patch.changesByKind)) {
        if (entries) {
          const filtered = entries.filter((e: ChangeEntry) => 
            e.description?.toLowerCase().includes(query) || e.author?.toLowerCase().includes(query)
          )
          if (filtered.length > 0) {
            filteredChangesByKind[kind as keyof typeof patch.changesByKind] = filtered
          }
        }
      }
    }
    
    const hasMatches = filteredSecurityFixes.length > 0 || Object.keys(filteredChangesByKind).length > 0 || patch.version.toLowerCase().includes(query)
    
    return hasMatches ? {
      ...patch,
      securityFixes: filteredSecurityFixes.length > 0 ? filteredSecurityFixes : patch.securityFixes,
      changesByKind: Object.keys(filteredChangesByKind).length > 0 ? filteredChangesByKind : patch.changesByKind,
      _matchCount: filteredSecurityFixes.length + Object.values(filteredChangesByKind).reduce((sum, arr) => sum + (arr?.length || 0), 0)
    } : null
  }).filter((p): p is NonNullable<typeof p> => p !== null) : patches

  const totalMatches = query ? filteredPatches.reduce((sum, p) => sum + ((p as { _matchCount?: number })._matchCount || 0), 0) : 0

  return (
    <div>
      {setSearchQuery && (
        <div className={styles.sectionSearchBar}>
          <input
            type="text"
            placeholder="Search patch releases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.sectionSearchInput}
          />
          {searchQuery && (
            <button className={styles.clearSearch} onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      )}
      {query && (
        <div className={styles.searchResultsInfo}>
          Found {totalMatches} item{totalMatches !== 1 ? 's' : ''} in {filteredPatches.length} patch release{filteredPatches.length !== 1 ? 's' : ''} matching "{searchQuery}"
        </div>
      )}
      <div className={styles.patchList}>
        {filteredPatches.map(patch => {
          const isExpanded = expandedPatch === patch.version || (query && filteredPatches.length <= 3)
          const totalChanges = patch.changesByKind ? Object.values(patch.changesByKind).reduce((sum, arr) => sum + (arr?.length || 0), 0) : 0
          return (
            <div key={patch.version} className={`${styles.patchItem} ${isExpanded ? styles.expanded : ''}`}>
              <button className={styles.patchHeader} onClick={() => setExpandedPatch(isExpanded ? null : patch.version)}>
                <span className={styles.patchVersion}>{patch.version}</span>
                <div className={styles.patchStats}>
                  {patch.securityFixes && patch.securityFixes.length > 0 && <span className={styles.patchSecurity}>🔒 {patch.securityFixes.length}</span>}
                  <span className={styles.patchChanges}>{totalChanges} changes</span>
                </div>
                <span className={styles.expandIcon}>{isExpanded ? '−' : '+'}</span>
              </button>
              {isExpanded && (
                <div className={styles.patchDetails}>
                  {patch.securityFixes && patch.securityFixes.length > 0 && (
                    <div className={styles.patchSecurityList}>
                      <h4>Security Fixes</h4>
                      {patch.securityFixes.map((fix, i) => (
                        <div key={i} className={styles.patchSecurityItem}><span className={styles.cveBadge}>{fix.cve}</span> {fix.title}</div>
                      ))}
                    </div>
                  )}
                  {patch.changesByKind && Object.entries(patch.changesByKind).map(([kind, entries]) => {
                    if (!entries || entries.length === 0) return null
                    const kindLabels: Record<string, string> = {
                      feature: 'Features', bugOrRegression: 'Bug Fixes', apiChange: 'API Changes',
                      deprecation: 'Deprecations', documentation: 'Documentation', other: 'Other'
                    }
                    return (
                      <div key={kind} className={styles.patchChangeGroup}>
                        <h4>{kindLabels[kind] || kind}</h4>
                        {(entries as ChangeEntry[]).map((entry: ChangeEntry, i: number) => (
                          <div key={i} className={styles.patchChangeItem}>
                            <p>{entry.description}</p>
                            {entry.enrichment && (
                              <div className={styles.enrichment}>
                                {entry.enrichment.problem && <div className={styles.enrichmentRow}><span className={styles.enrichmentLabel}>Problem:</span> {entry.enrichment.problem}</div>}
                                {entry.enrichment.fix && <div className={styles.enrichmentRow}><span className={styles.enrichmentLabel}>Fix:</span> {entry.enrichment.fix}</div>}
                                {entry.enrichment.impact && <div className={styles.enrichmentRow}><span className={styles.enrichmentLabel}>Impact:</span> {entry.enrichment.impact}</div>}
                              </div>
                            )}
                            <div className={styles.changeMeta}>
                              {entry.prNumber && <a href={entry.prUrl || `https://github.com/kubernetes/kubernetes/pull/${entry.prNumber}`} target="_blank" rel="noopener noreferrer" className={styles.prLink}>#{entry.prNumber}</a>}
                              {entry.sigs && entry.sigs.length > 0 && <span className={styles.sigs}>{entry.sigs.slice(0, 3).join(', ')}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {query && filteredPatches.length === 0 && <p className={styles.emptyMessage}>No patch releases matching "{searchQuery}"</p>}
      </div>
    </div>
  )
}

// Features Content with Modal
function FeaturesContent({ features, version, onKindClick }: { 
  features: ReleaseFeature[]; version?: string; onKindClick: (kind: string) => void 
}) {
  const [selectedFeature, setSelectedFeature] = useState<ReleaseFeature | null>(null)
  const { content: kepContent } = useContentLinksForKep(selectedFeature?.kep || null, version)
  
  // Fetch feature gate details when a feature is selected
  const { gate: featureGateDetails } = useFeatureGateByName(
    version || null, 
    selectedFeature?.featureGate || null
  )

  // Close modal on ESC key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedFeature) {
        setSelectedFeature(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedFeature])

  const kepNumber = selectedFeature?.kep.replace('KEP-', '')
  const kepIssueUrl = kepNumber ? `https://github.com/kubernetes/enhancements/issues/${kepNumber}` : null
  const kepDocUrl = selectedFeature?.kepPath ? `https://github.com/kubernetes/enhancements/tree/master/keps/${selectedFeature.kepPath}` : null
  
  // Determine feature gate status text
  const getFeatureGateStatus = () => {
    if (!selectedFeature?.featureGate) return null
    if (!featureGateDetails) {
      // Gate not found in our data - show the gate name only
      return null
    }
    
    const { default_value, lock_to_default } = featureGateDetails
    if (lock_to_default) {
      return { text: 'Always enabled', className: styles.gateEnabled }
    }
    if (default_value) {
      return { text: 'Enabled by default', className: styles.gateEnabled }
    }
    return { text: 'Needs enabling', className: styles.gateDisabled }
  }
  
  const gateStatus = getFeatureGateStatus()

  return (
    <>
      <div className={styles.featuresList}>
        {features.map(feature => (
          <FeatureCard key={feature.kep} feature={feature} onClick={() => setSelectedFeature(feature)} />
        ))}
      </div>
      
      {/* Feature Detail Modal */}
      {selectedFeature && (
        <Modal onClose={() => setSelectedFeature(null)}>
            <div className={styles.detailModalHeader}>
              <span className={styles.detailModalTitle}>{selectedFeature.title}</span>
              <button className={styles.detailModalClose} onClick={() => setSelectedFeature(null)}>×</button>
            </div>
            <div className={styles.detailModalBody}>
              <div className={styles.detailModalMeta} style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: 16 }}>
                <span className={`${styles.detailModalBadge} ${styles[selectedFeature.stage]}`}>{selectedFeature.stage}</span>
                <span className={styles.detailModalBadge}>{selectedFeature.sig}</span>
              </div>
              
              {selectedFeature.description && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Description</div>
                  <div className={styles.detailModalText}>{selectedFeature.description}</div>
                </div>
              )}
              
              {selectedFeature.impact && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Impact</div>
                  <div className={styles.detailModalText}>{selectedFeature.impact}</div>
                </div>
              )}
              
              {selectedFeature.labels && selectedFeature.labels.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Labels</div>
                  <div className={styles.featureLabels}>
                    {selectedFeature.labels.map(label => (
                      <span key={label} className={styles.labelBadge}>{label}</span>
                    ))}
                  </div>
                </div>
              )}
              
              {selectedFeature.affectedKinds && selectedFeature.affectedKinds.length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>Affected Kinds</div>
                  <div className={styles.kindBadges}>
                    {selectedFeature.affectedKinds.map(kind => (
                      <button key={kind} className={styles.kindBadge} onClick={() => { onKindClick(kind); setSelectedFeature(null); }}>{kind}</button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Feature Gate Section - same style as other sections */}
              {selectedFeature.featureGate && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>
                    Feature Gate
                    <a 
                      href="https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.featureGateDocsLink}
                      title="Learn about Feature Gates"
                    >
                      ?
                    </a>
                  </div>
                  <div className={styles.featureGateContent}>
                    <code className={styles.featureGate}>{selectedFeature.featureGate}</code>
                    {gateStatus && <span className={gateStatus.className}>{gateStatus.text}</span>}
                  </div>
                  {featureGateDetails && !featureGateDetails.default_value && (
                    <div className={styles.featureGateHint}>
                      Enable with: --feature-gates={selectedFeature.featureGate}=true
                    </div>
                  )}
                </div>
              )}
              
              {selectedFeature.history && Object.keys(selectedFeature.history).length > 0 && (
                <div className={styles.detailModalSection}>
                  <div className={styles.detailModalLabel}>History</div>
                  <div className={styles.historyTimeline}>
                    {(['alpha', 'beta', 'stable'] as const).map(stage => {
                      const v = selectedFeature.history[stage]
                      if (!v) return null
                      const isCurrent = v === version
                      const isPast = version && compareVersions(v, version) < 0
                      const stateClass = isCurrent ? styles.current : isPast ? styles.past : styles.future
                      return (
                        <span key={stage} className={`${styles.historyItem} ${stateClass}`}>
                          <span className={styles.historyStage}>{stage === 'alpha' ? 'α' : stage === 'beta' ? 'β' : '✓'}</span>
                          <span className={styles.historyVersion}>{v}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
              
              <div className={styles.detailModalLinks}>
                {kepDocUrl && <a href={kepDocUrl} target="_blank" rel="noopener noreferrer" className={styles.detailModalLink}>📄 KEP Document</a>}
                {kepIssueUrl && <a href={kepIssueUrl} target="_blank" rel="noopener noreferrer" className={styles.detailModalLink}>💬 Discussion</a>}
                {kepContent?.map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className={`${styles.detailModalLink} ${item.is_official ? styles.official : ''}`}>
                    {item.content_type === 'blog' ? '📝' : item.content_type === 'video' ? '🎬' : '📚'} {item.title}
                  </a>
                ))}
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}

// Feature Card Component (simplified - no inline expansion)
function FeatureCard({ feature, onClick }: { feature: ReleaseFeature; onClick: () => void }) {
  const kepNumber = feature.kep.replace('KEP-', '')
  const kepIssueUrl = `https://github.com/kubernetes/enhancements/issues/${kepNumber}`
  const kepDocUrl = feature.kepPath ? `https://github.com/kubernetes/enhancements/tree/master/keps/${feature.kepPath}` : null

  return (
    <div className={`${styles.featureCard} ${styles[feature.stage]}`} onClick={onClick}>
      <div className={styles.featureHeader}>
        <div className={styles.featureMain}>
          <span className={styles.featureTitle}>{feature.title}</span>
        </div>
        {feature.description && <p className={styles.featurePreview}>{feature.description}</p>}
        <div className={styles.featureMeta}>
          <a href={kepDocUrl || kepIssueUrl} target="_blank" rel="noopener noreferrer" className={styles.featureKep} onClick={e => e.stopPropagation()}>{feature.kep}</a>
          <span className={styles.featureSig}>{feature.sig}</span>
        </div>
      </div>
    </div>
  )
}


// Release Summary Component - Shows description, blog link, and rotating stats
function ReleaseSummary({ release }: { release: ReleaseNotes }) {
  // Use the curated description directly if available, otherwise fall back to themes
  const descriptionText = release.description 
    ? release.description
    : release.themes && release.themes.length > 0
      ? `This release focuses on ${release.themes.slice(0, 4).join(', ').toLowerCase()}.`
      : null

  // Official release blog URL
  const releaseBlogUrl = `https://kubernetes.io/blog/${release.releaseDate.slice(0, 4)}/${release.releaseDate.slice(5, 7)}/${release.releaseDate.slice(8, 10)}/kubernetes-v${release.version.replace('.', '-')}-release/`

  return (
    <div className={styles.releaseSummary}>
      <div className={styles.summaryRow}>
        <p className={styles.releaseGoals}>
          {descriptionText || 'Release information.'}
        </p>
        <div className={styles.statsAndBlog}>
          <a 
            href={releaseBlogUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className={`${styles.releaseBlogCard} ${styles.noArtwork}`}
          >
            <div className={styles.blogCardOverlay}>
              <span className={styles.blogCardLabel}>Release Blog</span>
              <span className={styles.blogCardIcon}>↗</span>
            </div>
          </a>
          <RotatingStats release={release} />
        </div>
      </div>
    </div>
  )
}

// Release Highlights Component - Shows featured KEPs
function ReleaseHighlights({ release }: { release: ReleaseNotes }) {
  // Get highlighted features - stable features are typically the highlights
  const highlightedFeatures = useMemo(() => {
    // Prioritize stable features, then beta features with high impact
    const stableFeatures = release.features.filter((f: ReleaseFeature) => f.stage === 'stable').slice(0, 3)
    const betaFeatures = release.features.filter((f: ReleaseFeature) => f.stage === 'beta' && f.impact).slice(0, 2)
    const alphaFeatures = release.features.filter((f: ReleaseFeature) => f.stage === 'alpha' && f.impact).slice(0, 1)
    
    // Combine and limit to 5
    return [...stableFeatures, ...betaFeatures, ...alphaFeatures].slice(0, 5)
  }, [release.features])

  if (highlightedFeatures.length === 0) return null

  return (
    <div className={styles.releaseHighlights}>
      <div className={styles.highlightsSection}>
        <h3 className={styles.highlightsTitle}>Highlights</h3>
        <ul className={styles.highlightsList}>
          {highlightedFeatures.map(feature => {
            const kepNumber = feature.kep.replace('KEP-', '')
            const kepUrl = feature.kepPath 
              ? `https://github.com/kubernetes/enhancements/tree/master/keps/${feature.kepPath}`
              : `https://github.com/kubernetes/enhancements/issues/${kepNumber}`
            
            return (
              <li key={feature.kep} className={styles.highlightItem}>
                <span className={`${styles.highlightStage} ${styles[feature.stage]}`}>
                  {feature.stage === 'stable' ? '✓' : feature.stage === 'beta' ? 'β' : 'α'}
                </span>
                <span className={styles.highlightText}>
                  <strong>{feature.title}</strong>
                  {feature.stage === 'stable' && ' graduates to stable'}
                  {feature.stage === 'beta' && ' moves to beta'}
                  {feature.stage === 'alpha' && ' arrives in alpha'}
                </span>
                <a 
                  href={kepUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className={styles.highlightKepLink}
                >
                  {feature.kep}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// Rotating Stats Component
function RotatingStats({ release }: { release: { summary: { total: number; stable: number; beta: number; alpha: number }; changesByKind?: ChangesByKind; actionRequired?: ActionRequiredNote[]; securityInformation?: SecurityCVE[]; deprecations?: ReleaseDeprecation[] } }) {
  const changeTotals = useMemo(() => {
    if (!release.changesByKind) return { total: 0, bugs: 0, api: 0, other: 0 }
    const bugs = release.changesByKind.bugOrRegression?.length || 0
    const api = release.changesByKind.apiChange?.length || 0
    const features = release.changesByKind.feature?.length || 0
    const docs = release.changesByKind.documentation?.length || 0
    const other = (release.changesByKind.other?.length || 0) + (release.changesByKind.failingTest?.length || 0)
    const total = bugs + api + features + docs + other + (release.changesByKind.deprecation?.length || 0)
    return { total, bugs, api, other: other + docs, features }
  }, [release.changesByKind])

  const featureItems: StatItem[] = [
    { value: release.summary.total, label: 'Total Features', sublabel: 'KEPs in this release', theme: 'features' },
    { value: release.summary.stable, label: 'Stable', sublabel: 'Graduating to GA', theme: 'stable' },
    { value: release.summary.beta, label: 'Beta', sublabel: 'Moving to beta', theme: 'beta' },
    { value: release.summary.alpha, label: 'Alpha', sublabel: 'New in alpha', theme: 'alpha' },
  ]

  const changeItems: StatItem[] = [
    { value: changeTotals.total, label: 'Total Changes', sublabel: 'PRs in release', theme: 'changes' },
    { value: changeTotals.bugs, label: 'Bug Fixes', sublabel: 'Bugs & regressions', theme: 'bugs' },
    { value: changeTotals.api, label: 'API Changes', sublabel: 'API modifications', theme: 'api' },
  ]

  const criticalItems: StatItem[] = [
    { value: release.actionRequired?.length || 0, label: 'Action Required', sublabel: 'Must address', theme: 'urgent' },
    { value: release.securityInformation?.length || 0, label: 'Security CVEs', sublabel: 'Vulnerabilities', theme: 'security' },
    { value: release.deprecations?.length || 0, label: 'Deprecations', sublabel: 'Being removed', theme: 'deprecations' },
  ]

  return (
    <div className={styles.rotatingStats}>
      <RotatingStatCard items={featureItems} />
      <RotatingStatCard items={changeItems} />
      <RotatingStatCard items={criticalItems} />
    </div>
  )
}
