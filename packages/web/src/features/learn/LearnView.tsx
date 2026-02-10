import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, parquet } from '../../shared/hooks/useDB'
import { useExplorerStore } from '../../shared/store/explorerStore'
import type { ContentLink } from '../../shared/hooks/useContentLinks'
import { getHiddenContentExclusion } from '../../shared/hooks/useContentLinks'
import { DeepDiveCard, DeepDiveView, parseDeepDiveUrl } from '../deep-dives'
import type { DeepDiveMetadata } from '../deep-dives'
import styles from './LearnView.module.css'

type ContentType = 'all' | 'blog' | 'documentation' | 'video' | 'tutorial' | 'reference' | 'announcement' | 'deep-dive'
type SourceFilter = 'all' | 'official' | 'community'
type SortOption = 'newest' | 'oldest' | 'upcoming'

// Color map for content types
const CONTENT_TYPE_COLORS: Record<string, string> = {
  blog: '#3b82f6',        // blue
  video: '#fca5a5',       // soft pink/rose
  documentation: '#10b981', // green
  tutorial: '#8b5cf6',    // purple
  reference: '#fbbf24',   // yellow/gold (sessions)
  announcement: '#06b6d4', // cyan
  'deep-dive': '#f472b6', // pink for deep dives
}

interface ContentWithMeta extends ContentLink {
  linked_releases: string[]
  linked_keps: string[]
  attrs?: string | Record<string, unknown>
}

// Deep dive URL scheme prefix
const DEEP_DIVE_URL_PREFIX = 'app://deep-dive/'

/**
 * Check if a URL is a deep dive internal URL
 */
function isDeepDiveUrl(url: string): boolean {
  return url.startsWith(DEEP_DIVE_URL_PREFIX)
}

/**
 * Extract deep dive ID from an app://deep-dive/{id} URL
 */
function extractDeepDiveId(url: string): string | null {
  if (!isDeepDiveUrl(url)) return null
  return url.slice(DEEP_DIVE_URL_PREFIX.length)
}

/**
 * Convert a content_links entry to DeepDiveMetadata for rendering
 */

function contentToDeepDiveMetadata(item: ContentWithMeta): DeepDiveMetadata | null {
  const deepDiveId = extractDeepDiveId(item.url)
  if (!deepDiveId) return null
  
  // Parse attrs if present
  let attrs: Record<string, unknown> = {}
  if (item.attrs) {
    try {
      attrs = typeof item.attrs === 'string' ? JSON.parse(item.attrs) : item.attrs
    } catch {
      // Ignore parse errors
    }
  }
  
  return {
    id: deepDiveId,
    title: item.title || deepDiveId,
    subtitle: item.summary || undefined,
    description: item.description || '',
    status: (attrs.status as DeepDiveMetadata['status']) || 'draft',
    author: item.author || undefined,
    publishedDate: item.published_date || '',
    estimatedReadTime: (attrs.estimatedReadTime as number) || 30,
    labels: (item.labels || []).filter(l => l !== 'deep-dive'),
    relatedKeps: item.linked_keps || [],
    relatedFeatureGates: (attrs.relatedFeatureGates as string[]) || [],
  }
}

export function LearnView() {
  const { searchQuery, learnUrlState, setLearnUrlState } = useExplorerStore()
  
  // Check if we should render a deep dive view instead
  const deepDiveUrl = parseDeepDiveUrl(learnUrlState)
  
  // Handle deep dive card click - navigate to deep dive view
  const handleDeepDiveClick = useCallback((id: string) => {
    setLearnUrlState({ deepDive: id })
  }, [setLearnUrlState])
  
  // If a deep dive is selected, render the DeepDiveView
  if (deepDiveUrl) {
    return <DeepDiveView deepDiveId={deepDiveUrl.deepDiveId} sectionId={deepDiveUrl.sectionId} />
  }
  
  // Initialize state from URL
  const [contentType, setContentTypeLocal] = useState<ContentType>(
    (learnUrlState.contentType as ContentType) || 'all'
  )
  const [sourceFilter, setSourceFilterLocal] = useState<SourceFilter>(
    (learnUrlState.sourceFilter as SourceFilter) || 'all'
  )
  const [sortOption, setSortOptionLocal] = useState<SortOption>(
    (learnUrlState.sort as SortOption) || 'newest'
  )
  const [selectedLabels, setSelectedLabelsLocal] = useState<Set<string>>(
    new Set(learnUrlState.labels || [])
  )
  const [expandedItem, setExpandedItemLocal] = useState<string | null>(
    learnUrlState.expanded || null
  )
  const [labelSearch, setLabelSearch] = useState('')
  const [showAllLabels, setShowAllLabels] = useState(false)
  const [showLabelDropdown, setShowLabelDropdown] = useState(false)
  const labelSearchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  // Wrapped setters that update URL state
  const setContentType = useCallback((type: ContentType) => {
    setContentTypeLocal(type)
    setLearnUrlState({ contentType: type !== 'all' ? type : undefined })
  }, [setLearnUrlState])
  
  const setSourceFilter = useCallback((filter: SourceFilter) => {
    setSourceFilterLocal(filter)
    setLearnUrlState({ sourceFilter: filter !== 'all' ? filter : undefined })
  }, [setLearnUrlState])
  
  const setSortOption = useCallback((sort: SortOption) => {
    setSortOptionLocal(sort)
    setLearnUrlState({ sort: sort !== 'newest' ? sort : undefined })
  }, [setLearnUrlState])
  
  const setSelectedLabels = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setSelectedLabelsLocal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      setLearnUrlState({ labels: next.size > 0 ? Array.from(next) : undefined })
      return next
    })
  }, [setLearnUrlState])
  
  const setExpandedItem = useCallback((url: string | null) => {
    setExpandedItemLocal(url)
    setLearnUrlState({ expanded: url || undefined })
  }, [setLearnUrlState])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLabelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle label click with shift support for multi-select
  const handleLabelClick = (label: string, event: React.MouseEvent) => {
    setSelectedLabels(prev => {
      const next = new Set(prev)
      if (event.shiftKey) {
        // Shift+click: toggle this label (add/remove from selection)
        if (next.has(label)) {
          next.delete(label)
        } else {
          next.add(label)
        }
      } else {
        // Regular click: if already selected alone, clear; otherwise select only this
        if (next.size === 1 && next.has(label)) {
          next.clear()
        } else {
          next.clear()
          next.add(label)
        }
      }
      return next
    })
  }

  // Fetch all content with aggregated links
  // Sort is handled client-side for flexibility
  // Note: Hidden content types (artwork, etc.) are excluded - see HIDDEN_CONTENT_TYPES in useContentLinks.ts
  const sql = `
    WITH content_releases AS (
      SELECT url, LIST(DISTINCT target_id) as releases
      FROM ${parquet('content_links')}
      WHERE target_type = 'release'
      GROUP BY url
    ),
    content_keps AS (
      SELECT url, LIST(DISTINCT target_id) as keps
      FROM ${parquet('content_links')}
      WHERE target_type = 'kep'
      GROUP BY url
    )
    SELECT DISTINCT
      c.url,
      c.title,
      c.content_type,
      c.source,
      c.is_official,
      c.published_date,
      c.author,
      c.summary,
      c.description,
      c.labels,
      c.attrs,
      COALESCE(cr.releases, []) as linked_releases,
      COALESCE(ck.keps, []) as linked_keps
    FROM ${parquet('content_links')} c
    LEFT JOIN content_releases cr ON c.url = cr.url
    LEFT JOIN content_keps ck ON c.url = ck.url
    WHERE ${getHiddenContentExclusion('c.content_type')}
  `

  const { data: content, loading, error } = useQuery<ContentWithMeta>(sql)

  // Fetch KEP paths for linking to GitHub
  const kepPathsSql = `
    SELECT kep, kep_path
    FROM ${parquet('keps')}
    WHERE kep_path IS NOT NULL
  `
  const { data: kepPaths } = useQuery<{ kep: string; kep_path: string }>(kepPathsSql)

  // Build a map of KEP ID to GitHub URL
  const kepUrlMap = useMemo(() => {
    const map = new Map<string, string>()
    kepPaths?.forEach(({ kep, kep_path }) => {
      if (kep_path) {
        map.set(kep, `https://github.com/kubernetes/enhancements/tree/master/keps/${kep_path}`)
      }
    })
    return map
  }, [kepPaths])

  // Filter deep dives based on search query and selected labels

  // Filter deep dives from database content
  const filteredDeepDives = useMemo(() => {
    if (!content) return []
    if (contentType !== 'all' && contentType !== 'deep-dive') return []
    
    const today = new Date().toISOString().split('T')[0]
    
    // Extract deep dives from content and convert to metadata
    const deepDiveItems = content
      .filter(item => {
        const isDeepDive = (item.content_type || '').toLowerCase() === 'deep-dive'
        const hasDeepDiveUrl = isDeepDiveUrl(item.url)
        return isDeepDive && hasDeepDiveUrl
      })
      .map(item => contentToDeepDiveMetadata(item))
      .filter((dd): dd is DeepDiveMetadata => dd !== null)
    
    let dives = deepDiveItems
    
    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      dives = dives.filter(dd => 
        dd.title.toLowerCase().includes(q) ||
        dd.subtitle?.toLowerCase().includes(q) ||
        dd.description.toLowerCase().includes(q) ||
        dd.labels.some(l => l.toLowerCase().includes(q)) ||
        dd.relatedKeps.some(k => k.toLowerCase().includes(q)) ||
        dd.relatedFeatureGates.some(g => g.toLowerCase().includes(q))
      )
    }
    
    // Apply label filter
    if (selectedLabels.size > 0) {
      dives = dives.filter(dd => 
        Array.from(selectedLabels).every(label => dd.labels.includes(label))
      )
    }
    
    // Sort deep dives based on selected option
    dives = dives.sort((a, b) => {
      const dateA = a.publishedDate || ''
      const dateB = b.publishedDate || ''
      const isFutureA = dateA > today
      const isFutureB = dateB > today
      
      if (sortOption === 'newest') {
        if (isFutureA !== isFutureB) return isFutureA ? 1 : -1
        if (isFutureA) return dateA.localeCompare(dateB)
        return dateB.localeCompare(dateA)
      } else if (sortOption === 'oldest') {
        if (isFutureA !== isFutureB) return isFutureA ? 1 : -1
        if (isFutureA) return dateA.localeCompare(dateB)
        return dateA.localeCompare(dateB)
      } else if (sortOption === 'upcoming') {
        if (isFutureA !== isFutureB) return isFutureA ? -1 : 1
        if (isFutureA) return dateA.localeCompare(dateB)
        return dateB.localeCompare(dateA)
      }
      return 0
    })
    
    return dives
  }, [content, searchQuery, selectedLabels, contentType, sortOption])

  // Extract unique labels for filtering (including deep dive labels)
  const allLabels = useMemo(() => {
    const labelCounts = new Map<string, number>()
    
    // Count labels from regular content
    content?.forEach(item => {
      item.labels?.forEach(label => {
        labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
      })
    })
    
    return Array.from(labelCounts.entries()).sort((a, b) => b[1] - a[1])
  }, [content])

  // Labels filtered by search
  const filteredLabels = useMemo(() => {
    if (!labelSearch) return allLabels
    const q = labelSearch.toLowerCase()
    return allLabels.filter(([label]) => label.toLowerCase().includes(q))
  }, [allLabels, labelSearch])

  // Labels to display (limited unless showAllLabels)
  const displayedLabels = useMemo(() => {
    const labels = labelSearch ? filteredLabels : allLabels
    return showAllLabels ? labels : labels.slice(0, 30)
  }, [allLabels, filteredLabels, labelSearch, showAllLabels])

  // Filter and sort content
  const filteredContent = useMemo(() => {
    if (!content) return []
    
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    
    const filtered = content.filter(item => {
      // ALWAYS exclude deep-dives from regular content cards - they render via DeepDiveCard
      if (item.content_type === 'deep-dive') return false

      // Content type filter
      if (contentType !== 'all' && item.content_type !== contentType) return false
      
      // Source filter
      if (sourceFilter === 'official' && !item.is_official) return false
      if (sourceFilter === 'community' && item.is_official) return false
      
      // Label filter - must have ALL selected labels
      if (selectedLabels.size > 0) {
        const hasAllLabels = Array.from(selectedLabels).every(label => 
          item.labels?.includes(label)
        )
        if (!hasAllLabels) return false
      }
      
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matches = 
          item.title?.toLowerCase().includes(q) ||
          item.summary?.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.labels?.some(l => l.toLowerCase().includes(q)) ||
          item.linked_keps?.some(k => k.toLowerCase().includes(q))
        if (!matches) return false
      }
      
      return true
    })
    
    // Sort based on selected option
    return filtered.sort((a, b) => {
      const dateA = a.published_date || ''
      const dateB = b.published_date || ''
      const isFutureA = dateA > today
      const isFutureB = dateB > today
      
      if (sortOption === 'newest') {
        // Past content first (newest), then future content (soonest)
        if (isFutureA !== isFutureB) return isFutureA ? 1 : -1
        if (isFutureA) return dateA.localeCompare(dateB) // Future: soonest first
        return dateB.localeCompare(dateA) // Past: newest first
      } else if (sortOption === 'oldest') {
        // Past content first (oldest), then future content (soonest)
        if (isFutureA !== isFutureB) return isFutureA ? 1 : -1
        if (isFutureA) return dateA.localeCompare(dateB) // Future: soonest first
        return dateA.localeCompare(dateB) // Past: oldest first
      } else if (sortOption === 'upcoming') {
        // Future content first (soonest), then past content (newest)
        if (isFutureA !== isFutureB) return isFutureA ? -1 : 1
        if (isFutureA) return dateA.localeCompare(dateB) // Future: soonest first
        return dateB.localeCompare(dateA) // Past: newest first
      }
      return 0
    })
  }, [content, contentType, sourceFilter, selectedLabels, searchQuery, sortOption])

  // Group content by type for stats (including deep dives)
  const stats = useMemo(() => {
    if (!content) return { total: 0, blog: 0, documentation: 0, video: 0, tutorial: 0, reference: 0, official: 0, 'deep-dive': 0 }
    return {
      total: content.length,
      blog: content.filter(c => c.content_type === 'blog').length,
      documentation: content.filter(c => c.content_type === 'documentation').length,
      video: content.filter(c => c.content_type === 'video').length,
      tutorial: content.filter(c => c.content_type === 'tutorial').length,
      reference: content.filter(c => c.content_type === 'reference').length,
      official: content.filter(c => c.is_official).length,
      'deep-dive': content.filter(c => (c.content_type || '').toLowerCase() === 'deep-dive').length,
    }
  }, [content])

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading learning resources...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>Failed to load content: {error.message}</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Hero Section */}
      <div className={styles.hero}>
        <p className={styles.heroSubtitle}>
          Curated blog posts, documentation, videos, and tutorials
        </p>
        <div className={styles.heroStats}>
          <span className={styles.heroStat}>{stats.total} resources</span>
          <span className={styles.heroDot}>•</span>
          <span className={styles.heroStat}>{stats.official} official</span>
          <span className={styles.heroDot}>•</span>
          <span className={styles.heroStat}>{stats.video} videos</span>
        </div>
      </div>

      <div className={styles.mainContent}>
        {/* Sidebar Filters */}
        <aside className={styles.sidebar}>
          {/* Content Type Filter */}
          <div className={styles.filterSection}>
            <h3 className={styles.filterTitle}>Content Type</h3>
            <div className={styles.filterOptions}>
              {[
                { id: 'all', label: 'All' },
                { id: 'deep-dive', label: 'Deep Dives' },
                { id: 'blog', label: 'Blog Posts' },
                { id: 'documentation', label: 'Documentation' },
                { id: 'video', label: 'Videos' },
                { id: 'reference', label: 'Sessions' },
                { id: 'tutorial', label: 'Tutorials' },
              ].map(opt => (
                <button
                  key={opt.id}
                  className={`${styles.filterOption} ${contentType === opt.id ? styles.active : ''}`}
                  onClick={() => setContentType(opt.id as ContentType)}
                >
                  {opt.id !== 'all' && (
                    <span 
                      className={styles.contentTypeDot} 
                      style={{ backgroundColor: CONTENT_TYPE_COLORS[opt.id] }}
                    />
                  )}
                  <span>{opt.label}</span>
                  {opt.id !== 'all' && (
                    <span className={styles.filterCount}>
                      {stats[opt.id as keyof typeof stats] || 0}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Source Filter */}
          <div className={styles.filterSection}>
            <h3 className={styles.filterTitle}>Source</h3>
            <div className={styles.filterOptions}>
              {[
                { id: 'all', label: 'All Sources' },
                { id: 'official', label: 'Official K8s' },
                { id: 'community', label: 'Community' },
              ].map(opt => (
                <button
                  key={opt.id}
                  className={`${styles.filterOption} ${sourceFilter === opt.id ? styles.active : ''}`}
                  onClick={() => setSourceFilter(opt.id as SourceFilter)}
                >
                  {opt.id === 'official' && <span className={styles.officialDot} />}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Topic Labels */}
          <div className={styles.filterSection}>
            <h3 className={styles.filterTitle}>
              Topics
              {selectedLabels.size > 0 && (
                <span className={styles.filterHint}> (shift+click to add)</span>
              )}
            </h3>
            
            {/* Label Search */}
            <div className={styles.labelSearchContainer} ref={dropdownRef}>
              <input
                ref={labelSearchRef}
                type="text"
                className={styles.labelSearchInput}
                placeholder="Search topics..."
                value={labelSearch}
                onChange={(e) => {
                  setLabelSearch(e.target.value)
                  setShowLabelDropdown(true)
                }}
                onFocus={() => setShowLabelDropdown(true)}
              />
              {labelSearch && (
                <button 
                  className={styles.labelSearchClear}
                  onClick={() => {
                    setLabelSearch('')
                    setShowLabelDropdown(false)
                  }}
                >
                  ✕
                </button>
              )}
              
              {/* Autocomplete dropdown */}
              {showLabelDropdown && labelSearch && filteredLabels.length > 0 && (
                <div className={styles.labelDropdown}>
                  {filteredLabels.slice(0, 10).map(([label, count]) => (
                    <button
                      key={label}
                      className={`${styles.labelDropdownItem} ${selectedLabels.has(label) ? styles.active : ''}`}
                      onClick={() => {
                        setSelectedLabels(prev => {
                          const next = new Set(prev)
                          if (next.has(label)) {
                            next.delete(label)
                          } else {
                            next.add(label)
                          }
                          return next
                        })
                        setLabelSearch('')
                        setShowLabelDropdown(false)
                      }}
                    >
                      <span>{label}</span>
                      <span className={styles.labelCount}>{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.labelCloud}>
              {selectedLabels.size > 0 && (
                <button
                  className={`${styles.labelTag} ${styles.clearLabel}`}
                  onClick={() => setSelectedLabels(new Set())}
                >
                  ✕ Clear {selectedLabels.size > 1 ? `${selectedLabels.size} filters` : 'filter'}
                </button>
              )}
              {displayedLabels.map(([label, count]) => (
                <button
                  key={label}
                  className={`${styles.labelTag} ${selectedLabels.has(label) ? styles.active : ''}`}
                  onClick={(e) => handleLabelClick(label, e)}
                  title={selectedLabels.size > 0 ? 'Shift+click to add/remove' : 'Click to filter'}
                >
                  {label}
                  <span className={styles.labelCount}>{count}</span>
                </button>
              ))}
            </div>
            
            {/* Show more/less toggle */}
            {!labelSearch && allLabels.length > 30 && (
              <button
                className={styles.showMoreLabels}
                onClick={() => setShowAllLabels(!showAllLabels)}
              >
                {showAllLabels 
                  ? `Show less` 
                  : `Show all ${allLabels.length} topics`}
              </button>
            )}
          </div>
        </aside>

        {/* Content Grid */}
        <main className={styles.contentArea}>
          <div className={styles.resultsHeader}>
            <span className={styles.resultsCount}>
              {filteredContent.length + filteredDeepDives.length} {(filteredContent.length + filteredDeepDives.length) === 1 ? 'resource' : 'resources'}
              {selectedLabels.size > 0 && (
                <span className={styles.activeFilter}>
                  {' '}tagged {Array.from(selectedLabels).map((l, i) => (
                    <span key={l}>
                      {i > 0 && ' + '}"{l}"
                    </span>
                  ))}
                </span>
              )}
              {searchQuery && <span className={styles.activeFilter}> matching "{searchQuery}"</span>}
            </span>
            
            <div className={styles.sortControl}>
              {(['newest', 'oldest', 'upcoming'] as const).map(opt => (
                <button
                  key={opt}
                  className={`${styles.sortButton} ${sortOption === opt ? styles.active : ''}`}
                  onClick={() => setSortOption(opt)}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.contentGrid}>
            {/* Deep Dive Cards - shown at top for newest/oldest, at end for upcoming */}
            {sortOption !== 'upcoming' && filteredDeepDives.map((deepDive) => (
              <DeepDiveCard
                key={deepDive.id}
                metadata={deepDive}
                onClick={handleDeepDiveClick}
                onLabelClick={handleLabelClick}
                selectedLabels={selectedLabels}
                expanded={expandedItem === `deep-dive:${deepDive.id}`}
                className={styles.deepDiveCard}
              />
            ))}
            
            {/* Regular Content Cards */}
            {filteredContent.map((item) => (
              <article 
                key={item.url} 
                className={`${styles.contentCard} ${expandedItem === item.url ? styles.expanded : ''}`}
                onClick={(e) => {
                  // Don't toggle if clicking on interactive elements
                  const target = e.target as HTMLElement
                  if (target.closest('a') || target.closest('button')) return
                  // Don't toggle if user is selecting text
                  const selection = window.getSelection()
                  if (selection && selection.toString().length > 0) return
                  setExpandedItem(expandedItem === item.url ? null : item.url)
                }}
              >
                <div className={styles.cardHeader}>
                  <span 
                    className={styles.contentType}
                    style={{ color: CONTENT_TYPE_COLORS[item.content_type] || undefined }}
                  >
                    {item.content_type}
                  </span>
                  {item.is_official && (
                    <span className={styles.officialBadge}>Official</span>
                  )}
                </div>

                <a 
                  href={item.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className={styles.cardTitle}
                >
                  {item.title}
                </a>

                {item.summary && (
                  <p className={styles.cardSummary}>{item.summary}</p>
                )}

                {expandedItem === item.url && item.description && (
                  <p className={styles.cardDescription}>{item.description}</p>
                )}

                {/* Labels */}
                {item.labels && item.labels.length > 0 && (
                  <div className={styles.cardLabels}>
                    {item.labels.slice(0, expandedItem === item.url ? undefined : 4).map(label => (
                      <button
                        key={label}
                        className={`${styles.cardLabel} ${selectedLabels.has(label) ? styles.active : ''}`}
                        onClick={(e) => {
                          e.preventDefault()
                          handleLabelClick(label, e)
                        }}
                        title={selectedLabels.size > 0 ? 'Shift+click to add/remove' : 'Click to filter'}
                      >
                        {label}
                      </button>
                    ))}
                    {expandedItem !== item.url && item.labels.length > 4 && (
                      <span className={styles.moreLabels}>+{item.labels.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Linked KEPs */}
                {expandedItem === item.url && item.linked_keps && item.linked_keps.length > 0 && (
                  <div className={styles.linkedItems}>
                    <span className={styles.linkedLabel}>Related KEPs:</span>
                    {item.linked_keps.map(kep => {
                      const kepUrl = kepUrlMap.get(kep)
                      return kepUrl ? (
                        <a 
                          key={kep} 
                          href={kepUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.kepBadge}
                          title={`View ${kep} on GitHub`}
                        >
                          {kep}
                        </a>
                      ) : (
                        <span key={kep} className={styles.kepBadge}>{kep}</span>
                      )
                    })}
                  </div>
                )}

                {/* Linked Releases */}
                {expandedItem === item.url && item.linked_releases && item.linked_releases.length > 0 && (
                  <div className={styles.linkedItems}>
                    <span className={styles.linkedLabel}>Releases:</span>
                    {item.linked_releases.map(rel => (
                      <span key={rel} className={styles.releaseBadge}>{rel}</span>
                    ))}
                  </div>
                )}

                <div className={styles.cardFooter}>
                  <div className={styles.cardMeta}>
                    <span className={styles.cardSource}>{item.source}</span>
                    {item.published_date && (
                      <>
                        <span className={styles.metaDot}>•</span>
                        <span className={styles.cardDate}>
                          {new Date(item.published_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </>
                    )}
                    {item.author && (
                      <>
                        <span className={styles.metaDot}>•</span>
                        <span className={styles.cardAuthor}>{item.author}</span>
                      </>
                    )}
                  </div>
                  <span className={styles.expandHint}>
                    {expandedItem === item.url ? '▲ Less' : '▼ More'}
                  </span>
                </div>
              </article>
            ))}
            
            {/* Deep Dive Cards at end when sorting by upcoming */}
            {sortOption === 'upcoming' && filteredDeepDives.map((deepDive) => (
              <DeepDiveCard
                key={deepDive.id}
                metadata={deepDive}
                onClick={handleDeepDiveClick}
                onLabelClick={handleLabelClick}
                selectedLabels={selectedLabels}
                expanded={expandedItem === `deep-dive:${deepDive.id}`}
                className={styles.deepDiveCard}
              />
            ))}
          </div>

          {filteredContent.length === 0 && filteredDeepDives.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🔍</span>
              <p>No resources found matching your filters</p>
              <button 
                className={styles.clearFilters}
                onClick={() => {
                  setContentType('all')
                  setSourceFilter('all')
                  setSelectedLabels(new Set())
                }}
              >
                Clear all filters
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
