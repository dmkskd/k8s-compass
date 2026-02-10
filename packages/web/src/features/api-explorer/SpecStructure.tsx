import { useState, useCallback, useMemo, useEffect } from 'react'
import styles from './SpecStructure.module.css'
import type { SchemaProperty, SchemaType } from '../../shared/types'
import { getKindHistory, ensureKindHistoryLoaded } from '../../shared/data/schemas'
import { useAPITree, useKindKepLinks } from '../../shared/hooks'
import { useExplorerStore } from '../../shared/store/explorerStore'

interface SpecStructureProps {
  kind: string
  group: string
  schema: SchemaProperty[]
  description?: string
  onClose: () => void
}

// Type colors matching K8s conventions
const typeColors: Record<SchemaType, string> = {
  string: '#22c55e',
  integer: '#3b82f6',
  number: '#06b6d4',
  boolean: '#f59e0b',
  object: '#8b5cf6',
  array: '#ec4899',
  map: '#a855f7',
  intOrString: '#14b8a6',
}

const typeIcons: Record<SchemaType, string> = {
  string: '"abc"',
  integer: '123',
  number: '1.5',
  boolean: 'T/F',
  object: '{ }',
  array: '[ ]',
  map: '{k:v}',
  intOrString: '±',
}

// Helper to highlight search matches in text
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>
  
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  
  if (index === -1) return <>{text}</>
  
  return (
    <>
      {text.slice(0, index)}
      <mark className={styles.highlight}>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

// Helper to extract a snippet around a match
function getMatchSnippet(text: string, query: string): string | null {
  if (!text || !query) return null
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  if (index === -1) return null
  
  // Find word boundaries around the match
  const words = text.split(/\s+/)
  let charCount = 0
  let startWordIndex = 0
  let endWordIndex = words.length - 1
  
  for (let i = 0; i < words.length; i++) {
    if (charCount + words[i].length >= index) {
      startWordIndex = Math.max(0, i - 1)
      break
    }
    charCount += words[i].length + 1 // +1 for space
  }
  
  charCount = 0
  for (let i = 0; i < words.length; i++) {
    charCount += words[i].length + 1
    if (charCount > index + query.length) {
      endWordIndex = Math.min(words.length - 1, i + 1)
      break
    }
  }
  
  const snippet = words.slice(startWordIndex, endWordIndex + 1).join(' ')
  return snippet.length > 60 ? snippet.slice(0, 60) + '…' : snippet
}

function PropertyNode({
  property,
  depth = 0,
  expanded,
  onToggle,
  onSelect,
  selectedPath,
  searchQuery = '',
  matchedPaths,
  descriptionMatches,
}: {
  property: SchemaProperty
  depth?: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (property: SchemaProperty) => void
  selectedPath?: string
  searchQuery?: string
  matchedPaths?: Set<string>
  descriptionMatches?: Set<string>
}) {
  const hasChildren = property.properties && property.properties.length > 0
  const hasItems = property.items !== undefined
  const isExpanded = expanded.has(property.path)
  const canExpand = hasChildren || hasItems
  const isMatched = matchedPaths?.has(property.path)
  const isDescriptionMatch = descriptionMatches?.has(property.path)
  const isSelected = selectedPath === property.path
  
  // Get snippet for description matches
  const descSnippet = isDescriptionMatch ? getMatchSnippet(property.description, searchQuery) : null

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (canExpand) {
      onToggle(property.path)
    }
  }, [canExpand, onToggle, property.path])

  const handleSelect = useCallback(() => {
    onSelect(property)
  }, [onSelect, property])

  return (
    <div className={styles.propertyNode}>
      <div 
        className={`${styles.propertyRow} ${canExpand ? styles.expandable : ''} ${isMatched && !isDescriptionMatch ? styles.matched : ''} ${isDescriptionMatch ? styles.matchedDesc : ''} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleSelect}
      >
        {/* Expand/collapse button */}
        {canExpand ? (
          <button className={styles.expandBtn} onClick={handleToggle}>
            <span className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ''}`}>▶</span>
          </button>
        ) : (
          <span className={styles.expandPlaceholder} />
        )}
        
        {/* Property name */}
        <span className={styles.propertyName}>
          <HighlightText text={property.name} query={searchQuery} />
          {property.required && <span className={styles.requiredBadge}>*</span>}
        </span>
        
        {/* Type badge */}
        <span 
          className={styles.typeBadge}
          style={{ 
            color: typeColors[property.type],
            borderColor: typeColors[property.type] + '40',
            background: typeColors[property.type] + '15',
          }}
        >
          {property.type}
          {hasItems && '[]'}
        </span>
        
        {/* Reference type indicator */}
        {property.refKind && (
          <span className={styles.refIndicator} title={`References ${property.refKind}`}>
            → {property.refKind}
          </span>
        )}
        
        {/* Description match snippet */}
        {descSnippet && (
          <span className={styles.descSnippet}>
            "…<HighlightText text={descSnippet} query={searchQuery} />…"
          </span>
        )}
        
        {/* Selection indicator */}
        {isSelected && <span className={styles.selectedIndicator}>→</span>}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className={styles.childrenContainer}>
          {property.properties!.map((child) => (
            <PropertyNode
              key={child.path}
              property={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedPath={selectedPath}
              searchQuery={searchQuery}
              matchedPaths={matchedPaths}
              descriptionMatches={descriptionMatches}
            />
          ))}
        </div>
      )}

      {/* Array items */}
      {isExpanded && hasItems && property.items && (
        <div className={styles.childrenContainer}>
          <PropertyNode
            property={property.items}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            selectedPath={selectedPath}
            searchQuery={searchQuery}
            matchedPaths={matchedPaths}
            descriptionMatches={descriptionMatches}
          />
        </div>
      )}
    </div>
  )
}

// Helper to render text with clickable links
function LinkedText({ text }: { text: string }) {
  // Regex to match URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlRegex)
  
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a 
              key={i} 
              href={part} 
              target="_blank" 
              rel="noopener noreferrer"
              className={styles.link}
            >
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// Field detail panel on the right
function FieldDetail({ 
  property,
  kepLink,
}: { 
  property: SchemaProperty | null
  kepLink?: {
    kep: string
    kepTitle: string
    kepPath: string | null
    confidence: number
    matchReason: string
    isCanonical: boolean
  } | null
}) {
  if (!property) {
    return (
      <div className={styles.fieldDetailEmpty}>
        <p>Select a field to view details</p>
      </div>
    )
  }

  return (
    <div className={styles.fieldDetail}>
      <div className={styles.fieldDetailHeader}>
        <code className={styles.fieldPath}>{property.path}</code>
      </div>
      
      <div className={styles.fieldMeta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Type</span>
          <span 
            className={styles.metaValue}
            style={{ color: typeColors[property.type] }}
          >
            {typeIcons[property.type]} {property.type}
          </span>
        </div>
        {property.refKind && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Type Reference</span>
            <code className={styles.refType}>{property.refKind}</code>
          </div>
        )}
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Required</span>
          <span className={styles.metaValue}>
            {property.required ? 'Yes' : 'No'}
          </span>
        </div>
        {property.default !== undefined && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Default</span>
            <code className={styles.metaValue}>{String(property.default)}</code>
          </div>
        )}
        {property.introducedIn && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Introduced</span>
            <a 
              href={`https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-${property.introducedIn}.md`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.versionBadge}
              title={`View ${property.introducedIn} release notes`}
            >
              {property.introducedIn}
            </a>
          </div>
        )}
        {property.deprecatedIn && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Deprecated</span>
            <a 
              href={`https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-${property.deprecatedIn}.md`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.versionBadge} ${styles.deprecated}`}
              title={`View ${property.deprecatedIn} release notes`}
            >
              {property.deprecatedIn}
            </a>
          </div>
        )}
        {property.removedIn && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Removed</span>
            <a 
              href={`https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-${property.removedIn}.md`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.versionBadge} ${styles.removed}`}
              title={`View ${property.removedIn} release notes`}
            >
              {property.removedIn}
            </a>
          </div>
        )}
      </div>

      {property.description && (
        <div className={styles.fieldSection}>
          <h4>Description</h4>
          <p className={styles.fieldDescription}>
            <LinkedText text={property.description} />
          </p>
        </div>
      )}

      {property.enum && property.enum.length > 0 && (
        <div className={styles.fieldSection}>
          <h4>Allowed Values</h4>
          <div className={styles.enumList}>
            {property.enum.map((val) => (
              <code 
                key={val} 
                className={`${styles.enumValue} ${property.default === val ? styles.defaultValue : ''}`}
                title={property.default === val ? 'Default value' : undefined}
              >
                {val}{property.default === val && ' ✓'}
              </code>
            ))}
          </div>
          <p className={styles.dataSourceHint}>
            Enum values extracted from Go source code; defaults parsed from API descriptions.
          </p>
        </div>
      )}

      {(property.minimum !== undefined || property.maximum !== undefined) && (
        <div className={styles.fieldSection}>
          <h4>Constraints</h4>
          <div className={styles.constraints}>
            {property.minimum !== undefined && (
              <span>Min: {property.minimum}</span>
            )}
            {property.maximum !== undefined && (
              <span>Max: {property.maximum}</span>
            )}
          </div>
        </div>
      )}

      {property.pattern && (
        <div className={styles.fieldSection}>
          <h4>Pattern</h4>
          <code className={styles.pattern}>{property.pattern}</code>
        </div>
      )}

      {/* KEP Link Section */}
      {kepLink ? (
        <div className={styles.kepSection}>
          <h4>Related KEP</h4>
          <a 
            href={kepLink.kepPath 
              ? `https://github.com/kubernetes/enhancements/tree/master/keps/${kepLink.kepPath}`
              : `https://github.com/kubernetes/enhancements/tree/master/keps`
            }
            target="_blank"
            rel="noopener noreferrer"
            className={styles.kepLink}
          >
            <span className={styles.kepId}>{kepLink.kep}</span>
            <span className={styles.kepTitle}>{kepLink.kepTitle}</span>
          </a>
          <div className={styles.kepMeta}>
            <span className={styles.kepConfidence} title={kepLink.matchReason}>
              {Math.round(kepLink.confidence * 100)}% confidence
            </span>
            {!kepLink.isCanonical && (
              <span className={styles.inheritedBadge} title="This field is inherited from Pod via PodSpec embedding">
                inherited
              </span>
            )}
          </div>
        </div>
      ) : property.introducedIn ? (
        <div className={styles.kepPlaceholder}>
          <p>No KEP link found for this field</p>
        </div>
      ) : null}
    </div>
  )
}

export function SpecStructure({ 
  kind, 
  group, 
  schema,
  description,
  onClose,
}: SpecStructureProps) {
  const { selectedVersion, setSelectedKind } = useExplorerStore()
  const { data: apiTree } = useAPITree(selectedVersion)
  
  // Load KEP links for this kind
  const { data: kepLinks } = useKindKepLinks(selectedVersion, kind, group)
  
  // Find the kind data from the API tree to get docsUrl, scope, relationships
  const kindData = useMemo(() => {
    if (!apiTree) return null
    for (const g of apiTree.groups) {
      for (const ver of g.versions) {
        const found = ver.kinds.find((k) => k.name === kind)
        if (found) return found
      }
    }
    return null
  }, [apiTree, kind])

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    // Only expand first level, except metadata and status
    schema.forEach(prop => {
      if (prop.name !== 'metadata' && prop.name !== 'status') {
        if (prop.properties || prop.items) {
          initial.add(prop.path)
        }
      }
    })
    return initial
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProperty, setSelectedProperty] = useState<SchemaProperty | null>(null)
  const [isFlattened, setIsFlattened] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [versionFilter, setVersionFilter] = useState<string | null>(null)
  const [kepFilter, setKepFilter] = useState(false)
  const [kindHistory, setKindHistory] = useState<{introducedIn?: string, removedIn?: string} | null>(null)

  // Load kind history
  useEffect(() => {
    ensureKindHistoryLoaded().then(() => {
      setKindHistory(getKindHistory(group, kind))
    })
  }, [group, kind])

  // Collect all unique introducedIn versions from the schema
  const availableVersions = useMemo(() => {
    const versions = new Set<string>()
    
    const collectVersions = (props: SchemaProperty[]) => {
      props.forEach(p => {
        if (p.introducedIn) {
          versions.add(p.introducedIn)
        }
        if (p.properties) collectVersions(p.properties)
        if (p.items?.properties) collectVersions(p.items.properties)
      })
    }
    
    collectVersions(schema)
    return Array.from(versions).sort((a, b) => {
      const [aMajor, aMinor] = a.split('.').map(Number)
      const [bMajor, bMinor] = b.split('.').map(Number)
      return aMajor !== bMajor ? aMajor - bMajor : aMinor - bMinor
    })
  }, [schema])

  const handleToggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    const allPaths = new Set<string>()
    const collectPaths = (props: SchemaProperty[]) => {
      props.forEach(p => {
        if (p.properties || p.items) {
          allPaths.add(p.path)
          if (p.properties) collectPaths(p.properties)
          if (p.items?.properties) collectPaths(p.items.properties)
        }
      })
    }
    collectPaths(schema)
    setExpanded(allPaths)
  }, [schema])

  const handleCollapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  const handleSelectProperty = useCallback((property: SchemaProperty) => {
    setSelectedProperty(property)
  }, [])

  // Find matched paths and paths to expand
  const { matchedPaths, descriptionMatches, pathsToExpand } = useMemo(() => {
    const matched = new Set<string>()
    const descMatches = new Set<string>() // Tracks fields that matched on description only
    const toExpand = new Set<string>()
    
    if (!searchQuery.trim()) return { matchedPaths: matched, descriptionMatches: descMatches, pathsToExpand: toExpand }
    
    const query = searchQuery.toLowerCase()
    
    const findMatches = (props: SchemaProperty[], parentPaths: string[] = []) => {
      props.forEach(p => {
        const nameOrPathMatches = 
          p.name.toLowerCase().includes(query) ||
          p.path.toLowerCase().includes(query)
        
        const descriptionMatches = p.description && p.description.toLowerCase().includes(query)
        
        if (nameOrPathMatches || descriptionMatches) {
          matched.add(p.path)
          parentPaths.forEach(pp => toExpand.add(pp))
          
          // Track if it only matched on description
          if (!nameOrPathMatches && descriptionMatches) {
            descMatches.add(p.path)
          }
        }
        
        if (p.properties) {
          findMatches(p.properties, [...parentPaths, p.path])
        }
        if (p.items?.properties) {
          findMatches(p.items.properties, [...parentPaths, p.path])
        }
      })
    }
    
    findMatches(schema)
    return { matchedPaths: matched, descriptionMatches: descMatches, pathsToExpand: toExpand }
  }, [schema, searchQuery])

  // Auto-expand paths when search changes
  useEffect(() => {
    if (pathsToExpand.size > 0) {
      setExpanded(prev => {
        const next = new Set(prev)
        pathsToExpand.forEach(p => next.add(p))
        return next
      })
    }
  }, [pathsToExpand])

  // ESC key to close the panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Flatten schema into a single list
  const flattenedSchema = useMemo(() => {
    const result: SchemaProperty[] = []
    
    const flatten = (props: SchemaProperty[]) => {
      props.forEach(p => {
        result.push(p)
        if (p.properties) flatten(p.properties)
        if (p.items?.properties) flatten(p.items.properties)
      })
    }
    
    flatten(schema)
    return result
  }, [schema])

  // Filter properties by search, version, and KEP
  const filteredSchema = useMemo(() => {
    let result = schema
    
    // Apply version filter first
    if (versionFilter) {
      const filterByVersion = (props: SchemaProperty[]): SchemaProperty[] => {
        return props.filter(p => {
          // Include if this field was introduced in the selected version
          if (p.introducedIn === versionFilter) return true
          
          // Or if any nested field matches
          if (p.properties) {
            const filteredChildren = filterByVersion(p.properties)
            if (filteredChildren.length > 0) return true
          }
          if (p.items?.properties) {
            const filteredItems = filterByVersion(p.items.properties)
            if (filteredItems.length > 0) return true
          }
          
          return false
        })
      }
      result = filterByVersion(result)
    }
    
    // Apply KEP filter
    if (kepFilter && kepLinks.size > 0) {
      const filterByKep = (props: SchemaProperty[]): SchemaProperty[] => {
        return props.filter(p => {
          // Include if this field has a KEP link
          if (kepLinks.has(p.path)) return true
          
          // Or if any nested field has a KEP link
          if (p.properties) {
            const filteredChildren = filterByKep(p.properties)
            if (filteredChildren.length > 0) return true
          }
          if (p.items?.properties) {
            const filteredItems = filterByKep(p.items.properties)
            if (filteredItems.length > 0) return true
          }
          
          return false
        })
      }
      result = filterByKep(result)
    }
    
    // Then apply search filter
    if (!searchQuery.trim()) return result
    
    const query = searchQuery.toLowerCase()
    
    const filterProps = (props: SchemaProperty[]): SchemaProperty[] => {
      return props.filter(p => {
        const matches = 
          p.name.toLowerCase().includes(query) ||
          p.path.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query))
        
        if (matches) return true
        
        if (p.properties) {
          const filteredChildren = filterProps(p.properties)
          if (filteredChildren.length > 0) return true
        }
        if (p.items?.properties) {
          const filteredItems = filterProps(p.items.properties)
          if (filteredItems.length > 0) return true
        }
        
        return false
      })
    }
    
    return filterProps(result)
  }, [schema, searchQuery, versionFilter, kepFilter, kepLinks])

  // Count total fields
  const fieldStats = useMemo(() => {
    let total = 0
    let required = 0
    
    const countFields = (props: SchemaProperty[]) => {
      props.forEach(p => {
        total++
        if (p.required) required++
        if (p.properties) countFields(p.properties)
        if (p.items?.properties) countFields(p.items.properties)
      })
    }
    countFields(schema)
    
    return { total, required }
  }, [schema])

  return (
    <div className={styles.container} onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.kindInfo}>
            <h2 className={styles.kindName}>
              {kind}
              {kindData?.docsUrl && (
                <a 
                  href={kindData.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.docsLink}
                  title="View official documentation"
                >
                  📖 Docs
                </a>
              )}
              {kindHistory?.introducedIn && kindHistory.introducedIn !== '1.25' && (
                <a 
                  href={`https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-${kindHistory.introducedIn}.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.kindVersionBadge}
                  title={`Introduced in ${kindHistory.introducedIn} - click to view release notes`}
                >
                  {kindHistory.introducedIn}
                </a>
              )}
              {kindHistory?.removedIn && (
                <a
                  href={`https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-${kindHistory.removedIn}.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.kindVersionBadge} ${styles.removed}`}
                  title={`View ${kindHistory.removedIn} release notes`}
                >
                  Removed {kindHistory.removedIn}
                </a>
              )}
            </h2>
            <div className={styles.kindMeta}>
              <span className={styles.groupName}>{group}</span>
              {kindData?.scope && (
                <span className={styles.scopeBadge}>{kindData.scope}</span>
              )}
              {kindData?.shortNames && kindData.shortNames.length > 0 && (
                <span className={styles.shortNames}>
                  {kindData.shortNames.join(', ')}
                </span>
              )}
            </div>
            {description && (
              <p className={styles.kindDescription}>{description}</p>
            )}
            {kindData?.relationships && kindData.relationships.length > 0 && (
              <div className={styles.relationships}>
                {kindData.relationships.map((rel, i) => (
                  <span key={i} className={styles.relationship} data-type={rel.type}>
                    <span className={styles.relType}>{rel.type}</span>
                    <button 
                      className={styles.relTarget}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedKind(rel.targetKind)
                      }}
                      title={`View ${rel.targetKind} spec`}
                    >
                      {rel.targetKind}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.fieldCount}>
            {fieldStats.total} fields ({fieldStats.required} required)
          </span>
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchContainer}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search fields..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className={styles.clearSearch}
              onClick={() => setSearchQuery('')}
            >
              ✕
            </button>
          )}
        </div>
        
        <div className={styles.toolbarActions}>
          <button 
            className={`${styles.actionBtn} ${showFilters ? styles.active : ''}`} 
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters {availableVersions.length > 0 && `(${availableVersions.length})`}
          </button>
          <button 
            className={`${styles.actionBtn} ${isFlattened ? styles.active : ''}`} 
            onClick={() => setIsFlattened(!isFlattened)}
          >
            {isFlattened ? 'Tree View' : 'Flat View'}
          </button>
          <button className={styles.actionBtn} onClick={handleExpandAll} disabled={isFlattened}>
            Expand All
          </button>
          <button className={styles.actionBtn} onClick={handleCollapseAll} disabled={isFlattened}>
            Collapse All
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>Introduced in:</span>
            <div className={styles.filterChips}>
              {availableVersions.length > 0 ? (
                availableVersions.map(v => (
                  <button
                    key={v}
                    className={`${styles.filterChip} ${versionFilter === v ? styles.active : ''}`}
                    onClick={() => {
                      setVersionFilter(versionFilter === v ? null : v)
                      // Auto-switch to flat view when filtering by version
                      if (versionFilter !== v) setIsFlattened(true)
                    }}
                  >
                    {v}
                  </button>
                ))
              ) : (
                <span className={styles.noFilters}>No version data available</span>
              )}
              {versionFilter && (
                <button 
                  className={styles.clearFilter}
                  onClick={() => setVersionFilter(null)}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className={styles.filterSection}>
            <span className={styles.filterLabel}>KEP Links:</span>
            <div className={styles.filterChips}>
              <button
                className={`${styles.filterChip} ${kepFilter ? styles.active : ''}`}
                onClick={() => {
                  setKepFilter(!kepFilter)
                  if (!kepFilter) setIsFlattened(true)
                }}
              >
                Has KEP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content - split view */}
      <div className={styles.splitView}>
        {/* Left: Schema tree */}
        <div className={styles.treePanel}>
          <div className={styles.schemaContainer}>
            {isFlattened ? (
              // Flat view - show all fields as a list
              flattenedSchema.length > 0 ? (
                flattenedSchema
                  .filter(p => {
                    // Apply version filter
                    if (versionFilter && p.introducedIn !== versionFilter) return false
                    // Apply KEP filter
                    if (kepFilter && !kepLinks.has(p.path)) return false
                    // Apply search filter
                    if (!searchQuery.trim()) return true
                    const query = searchQuery.toLowerCase()
                    return p.name.toLowerCase().includes(query) ||
                           p.path.toLowerCase().includes(query) ||
                           (p.description && p.description.toLowerCase().includes(query))
                  })
                  .map((prop) => (
                    <div 
                      key={prop.path}
                      className={`${styles.flatRow} ${selectedProperty?.path === prop.path ? styles.selected : ''} ${matchedPaths?.has(prop.path) ? styles.matched : ''} ${kepLinks.has(prop.path) ? styles.hasKep : ''}`}
                      onClick={() => handleSelectProperty(prop)}
                    >
                      <code className={styles.flatPath}>{prop.path}</code>
                      <span 
                        className={styles.typeBadge}
                        style={{ 
                          color: typeColors[prop.type],
                          borderColor: typeColors[prop.type] + '40',
                          background: typeColors[prop.type] + '15',
                        }}
                      >
                        {prop.type}
                      </span>
                      {prop.required && <span className={styles.requiredBadge}>*</span>}
                      {kepLinks.has(prop.path) && <span className={styles.kepBadge} title={kepLinks.get(prop.path)?.kepTitle}>KEP</span>}
                    </div>
                  ))
              ) : (
                <div className={styles.noResults}>No fields</div>
              )
            ) : (
              // Tree view
              filteredSchema.length > 0 ? (
                filteredSchema.map((prop) => (
                  <PropertyNode
                    key={prop.path}
                    property={prop}
                    expanded={expanded}
                    onToggle={handleToggle}
                    onSelect={handleSelectProperty}
                    selectedPath={selectedProperty?.path}
                    searchQuery={searchQuery}
                    matchedPaths={matchedPaths}
                    descriptionMatches={descriptionMatches}
                  />
                ))
              ) : (
                <div className={styles.noResults}>
                  No fields match "{searchQuery}"
                </div>
              )
            )}
          </div>
        </div>

        {/* Right: Field detail */}
        <div className={styles.detailPanel}>
          <FieldDetail 
            property={selectedProperty} 
            kepLink={selectedProperty ? kepLinks.get(selectedProperty.path) : undefined}
          />
        </div>
      </div>

      {/* Type legend */}
      <div className={styles.typeLegend}>
        <span className={styles.legendTitle}>Types:</span>
        {Object.entries(typeColors).map(([type, color]) => (
          <span 
            key={type} 
            className={styles.legendItem}
            style={{ color }}
          >
            {typeIcons[type as SchemaType]} {type}
          </span>
        ))}
      </div>
    </div>
  )
}
