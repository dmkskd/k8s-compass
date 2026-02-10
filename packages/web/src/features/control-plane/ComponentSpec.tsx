/**
 * ComponentSpec - Centered modal for Kubernetes component details
 * Focused on showing all parameters/flags with version tracking
 */
import { useState, useMemo, useCallback, useEffect } from 'react'
import styles from './ComponentSpec.module.css'
import { 
  useComponentWithFlags, 
  useRelatedKeps,
  useKubectlCommandWithDetails,
  useKubectlCommands,
  useFeatureGates,
  parseVersionHistory,
  type ComponentFlag,
  type KubectlCommand,
  type KubectlCommandWithDetails,
  type FeatureGate,
} from '../../shared/hooks/useComponentData'
import { useExplorerStore } from '../../shared/store/explorerStore'
import { getComponentIcon } from '../../shared/components/K8sIcons'

interface ComponentSpecProps {
  componentId: string
  onClose: () => void
  initialSearch?: string
}

// Map visual component IDs to database component IDs
const COMPONENT_ID_MAP: Record<string, string> = {
  'kube-apiserver': 'kube-apiserver',
  'etcd': 'etcd',
  'kube-controller-manager': 'kube-controller-manager',
  'kube-scheduler': 'kube-scheduler',
  'coredns': 'coredns',
  'cni': 'cni',
  // Worker nodes map to kubelet (the main node agent)
  'node-1': 'kubelet',
  'node-2': 'kubelet',
  'node-3': 'kubelet',
  'kubelet': 'kubelet',
  'kube-proxy': 'kube-proxy',
  'containerd': 'containerd',
  'container-runtime': 'containerd',
  // kubectl is special - uses kubectl_commands table
  'kubectl': 'kubectl',
  // feature-gates is special - uses feature_gates table
  'feature-gates': 'feature-gates',
}

// Components that use kubectl data instead of component_flags
const KUBECTL_COMPONENTS = new Set(['kubectl'])

// Components that use feature gates data
const FEATURE_GATE_COMPONENTS = new Set(['feature-gates'])

// Helper to highlight search matches
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

export function ComponentSpec({ componentId, onClose, initialSearch }: ComponentSpecProps) {
  const { selectedVersion } = useExplorerStore()
  
  // Map visual ID to database ID
  const dbComponentId = COMPONENT_ID_MAP[componentId] || componentId
  const isKubectl = KUBECTL_COMPONENTS.has(dbComponentId)
  const isFeatureGates = FEATURE_GATE_COMPONENTS.has(dbComponentId)
  
  // For kubectl, use kubectl data; for feature-gates, use feature gates data; for others, use component data
  const { data: component, loading, error } = useComponentWithFlags(
    isKubectl || isFeatureGates ? null : dbComponentId
  )
  const { data: kubectlCommands, loading: kubectlLoading, error: kubectlError } = useKubectlCommands(
    isKubectl ? selectedVersion : null
  )
  const { data: featureGates, loading: fgLoading, error: fgError } = useFeatureGates(
    isFeatureGates ? selectedVersion : null
  )
  // Collect all KEP IDs from component and its flags
  const allKepIds = useMemo(() => {
    const ids = new Set<string>(component?.related_keps || [])
    component?.flags?.forEach(flag => {
      flag.related_keps?.forEach(kep => ids.add(kep))
    })
    return Array.from(ids)
  }, [component])
  
  const { data: kepDetails } = useRelatedKeps(allKepIds)
  
  const [searchQuery, setSearchQuery] = useState(initialSearch || '')
  const [filterType, setFilterType] = useState<'all' | 'new' | 'deprecated'>('all')
  const [stageFilter, setStageFilter] = useState<'all' | 'alpha' | 'beta' | 'stable' | 'deprecated'>('all')
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null)
  const [loadingTimeout, setLoadingTimeout] = useState(false)
  
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])
  
  // Timeout for loading state (5 seconds)
  useEffect(() => {
    const isLoading = isKubectl ? kubectlLoading : isFeatureGates ? fgLoading : loading
    if (isLoading) {
      const timer = setTimeout(() => {
        setLoadingTimeout(true)
      }, 5000)
      return () => clearTimeout(timer)
    } else {
      setLoadingTimeout(false)
    }
  }, [loading, kubectlLoading, fgLoading, isKubectl, isFeatureGates])
  
  // Filter flags by search and type (for non-kubectl, non-feature-gates components)
  const filteredFlags = useMemo(() => {
    if (isKubectl || isFeatureGates || !component?.flags) return []
    
    let flags = component.flags
    
    // Filter by type
    if (filterType === 'new') {
      flags = flags.filter(f => f.introduced_in && f.introduced_in >= '1.25')
    } else if (filterType === 'deprecated') {
      flags = flags.filter(f => f.deprecated_in || f.removed_in)
    }
    
    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      flags = flags.filter(f => 
        f.name.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q) ||
        f.values?.some(v => v.toLowerCase().includes(q))
      )
    }
    
    return flags
  }, [component?.flags, searchQuery, filterType, isKubectl])
  
  // Filter kubectl commands by search
  const filteredCommands = useMemo(() => {
    if (!isKubectl || !kubectlCommands) return []
    
    if (!searchQuery.trim()) return kubectlCommands
    
    const q = searchQuery.toLowerCase()
    return kubectlCommands.filter(cmd => 
      cmd.name.toLowerCase().includes(q) ||
      cmd.synopsis?.toLowerCase().includes(q)
    )
  }, [kubectlCommands, searchQuery, isKubectl])
  
  // Filter feature gates by search and stage
  const filteredFeatureGates = useMemo(() => {
    if (!isFeatureGates || !featureGates) return []
    
    let gates = featureGates
    
    // Filter by stage
    if (stageFilter !== 'all') {
      gates = gates.filter(g => g.stage === stageFilter)
    }
    
    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      gates = gates.filter(g => 
        g.name.toLowerCase().includes(q) ||
        g.kep_title?.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q)
      )
    }
    
    return gates
  }, [featureGates, searchQuery, stageFilter, isFeatureGates])
  
  // Count feature gates by stage
  const featureGateCounts = useMemo(() => {
    if (!featureGates) return { all: 0, alpha: 0, beta: 0, stable: 0, deprecated: 0 }
    
    return {
      all: featureGates.length,
      alpha: featureGates.filter(g => g.stage === 'alpha').length,
      beta: featureGates.filter(g => g.stage === 'beta').length,
      stable: featureGates.filter(g => g.stage === 'stable').length,
      deprecated: featureGates.filter(g => g.stage === 'deprecated').length,
    }
  }, [featureGates])
  
  // Count flags by type
  const flagCounts = useMemo(() => {
    if (!component?.flags) return { all: 0, new: 0, deprecated: 0 }
    return {
      all: component.flags.length,
      new: component.flags.filter(f => f.introduced_in && f.introduced_in >= '1.25').length,
      deprecated: component.flags.filter(f => f.deprecated_in || f.removed_in).length,
    }
  }, [component?.flags])
  
  // Build KEP lookup map
  const kepMap = useMemo(() => {
    const map = new Map<string, { title: string; path: string | null }>()
    kepDetails?.forEach(k => {
      map.set(k.kep, { title: k.title, path: k.kep_path })
    })
    return map
  }, [kepDetails])
  
  // Handle overlay click (close on background click)
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])
  
  if ((isKubectl ? kubectlLoading : isFeatureGates ? fgLoading : loading) && !loadingTimeout) {
    return (
      <div className={styles.overlay} onClick={handleOverlayClick}>
        <div className={styles.container}>
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading {isKubectl ? 'kubectl commands' : isFeatureGates ? 'feature gates' : 'component data'}...</span>
          </div>
        </div>
      </div>
    )
  }
  
  const hasError = isKubectl ? kubectlError : isFeatureGates ? fgError : error
  const hasData = isKubectl 
    ? (kubectlCommands && kubectlCommands.length > 0) 
    : isFeatureGates 
      ? (featureGates && featureGates.length > 0)
      : component
  
  if (loadingTimeout || hasError || !hasData) {
    return (
      <div className={styles.overlay} onClick={handleOverlayClick}>
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <h2 className={styles.componentName}>
                {isKubectl ? 'kubectl' : isFeatureGates ? 'Feature Gates' : componentId}
              </h2>
              <p className={styles.componentDescription}>
                {isKubectl 
                  ? 'Kubernetes command-line tool'
                  : isFeatureGates
                    ? 'Feature flags that control experimental and optional features'
                    : componentId.startsWith('node-') 
                      ? 'Worker node containing kubelet, kube-proxy, and container runtime'
                      : 'Kubernetes component'}
              </p>
            </div>
            <div className={styles.headerRight}>
              <button className={styles.closeButton} onClick={onClose}>✕</button>
            </div>
          </div>
          <div className={styles.content}>
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>{loadingTimeout ? '⏱️' : '⚠️'}</div>
              <p className={styles.emptyText}>
                {loadingTimeout 
                  ? 'Loading is taking longer than expected'
                  : hasError 
                    ? 'Error loading data' 
                    : isKubectl
                      ? `No kubectl data for version ${selectedVersion}`
                      : isFeatureGates
                        ? `No feature gates data for version ${selectedVersion}`
                        : 'Component data not available'}
              </p>
              <p className={styles.emptySubtext}>
                {loadingTimeout
                  ? 'The database may still be initializing. Try again in a moment.'
                  : isKubectl
                    ? `kubectl data is available for versions 1.29-1.35. Try selecting a different version.`
                    : isFeatureGates
                      ? `Feature gates data is available for versions 1.25-1.35. Try selecting a different version.`
                      : 'Detailed flag information for this component is not yet in the database.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // Render kubectl view
  if (isKubectl) {
    return (
      <KubectlSpec 
        commands={filteredCommands}
        allCommands={kubectlCommands || []}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedCommand={selectedCommand}
        setSelectedCommand={setSelectedCommand}
        selectedVersion={selectedVersion}
        onClose={onClose}
        handleOverlayClick={handleOverlayClick}
      />
    )
  }
  
  // Render feature gates view
  if (isFeatureGates) {
    return (
      <FeatureGatesSpec
        featureGates={filteredFeatureGates}
        allFeatureGates={featureGates || []}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        stageFilter={stageFilter}
        setStageFilter={setStageFilter}
        featureGateCounts={featureGateCounts}
        selectedVersion={selectedVersion}
        onClose={onClose}
        handleOverlayClick={handleOverlayClick}
      />
    )
  }
  
  // At this point, component is guaranteed to be non-null (checked in hasData above)
  if (!component) return null
  
  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.componentName}>
              {(() => {
                const Icon = getComponentIcon(dbComponentId)
                // Color based on component type
                const iconColor = {
                  'kube-apiserver': '#6366f1',
                  'etcd': '#22c55e',
                  'kube-controller-manager': '#f59e0b',
                  'kube-scheduler': '#ec4899',
                  'kubelet': '#06b6d4',
                  'kube-proxy': '#8b5cf6',
                  'coredns': '#3b82f6',
                  'cni': '#10b981',
                  'containerd': '#64748b',
                }[dbComponentId] || '#6366f1'
                return Icon ? <Icon size={36} color={iconColor} className={styles.componentIcon} /> : null
              })()}
              {component.display_name}
              {component.docs_url && (
                <a 
                  href={component.docs_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.docsLink}
                >
                  📖 Official Docs
                </a>
              )}
            </h2>
            <div className={styles.componentMeta}>
              <span className={styles.typeBadge} data-type={component.type}>
                {component.type}
              </span>
            </div>
            <p className={styles.componentDescription}>{component.description}</p>
          </div>
          <div className={styles.headerRight}>
            <span className={styles.flagCount}>
              {filteredFlags.length} / {component.flags.length} flags
            </span>
            <button className={styles.closeButton} onClick={onClose}>✕</button>
          </div>
        </div>
        
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchContainer}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search flags by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          
          <div className={styles.filterChips}>
            <button 
              className={`${styles.filterChip} ${filterType === 'all' ? styles.active : ''}`}
              onClick={() => setFilterType('all')}
            >
              All ({flagCounts.all})
            </button>
            {flagCounts.new > 0 && (
              <button 
                className={`${styles.filterChip} ${filterType === 'new' ? styles.active : ''}`}
                onClick={() => setFilterType('new')}
              >
                New ({flagCounts.new})
              </button>
            )}
            {flagCounts.deprecated > 0 && (
              <button 
                className={`${styles.filterChip} ${filterType === 'deprecated' ? styles.active : ''}`}
                onClick={() => setFilterType('deprecated')}
              >
                Deprecated ({flagCounts.deprecated})
              </button>
            )}
          </div>
        </div>
        
        {/* Content */}
        <div className={styles.content}>
          {filteredFlags.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🔍</div>
              <p className={styles.emptyText}>No flags match your search</p>
              <p className={styles.emptySubtext}>
                Try a different search term or clear filters
              </p>
            </div>
          ) : (
            <div className={styles.flagsGrid}>
              {filteredFlags.map(flag => (
                <FlagCard 
                  key={flag.name} 
                  flag={flag} 
                  searchQuery={searchQuery}
                  kepMap={kepMap}
                  selectedVersion={selectedVersion}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Individual flag card
function FlagCard({ 
  flag, 
  searchQuery,
  kepMap,
  selectedVersion,
}: { 
  flag: ComponentFlag
  searchQuery: string
  kepMap: Map<string, { title: string; path: string | null }>
  selectedVersion: string
}) {
  // Determine if flag is new in selected version
  const isNew = flag.introduced_in === selectedVersion
  const isDeprecated = !!flag.deprecated_in
  const isRemoved = !!flag.removed_in
  
  return (
    <div className={`${styles.flagCard} ${isNew ? styles.isNew : ''} ${isDeprecated ? styles.isDeprecated : ''}`}>
      <div className={styles.flagHeader}>
        <div className={styles.flagNameRow}>
          <code className={styles.flagName}>
            <HighlightText text={flag.name} query={searchQuery} />
          </code>
          {isNew && <span className={styles.newBadge}>New in {flag.introduced_in}</span>}
          {isDeprecated && <span className={styles.deprecatedBadge}>Deprecated {flag.deprecated_in}</span>}
          {isRemoved && <span className={styles.deprecatedBadge}>Removed {flag.removed_in}</span>}
        </div>
        <span className={styles.flagType} data-type={flag.type}>
          {flag.type}
        </span>
      </div>
      
      {flag.description && (
        <p className={styles.flagDescription}>
          <HighlightText text={flag.description} query={searchQuery} />
        </p>
      )}
      
      <div className={styles.flagMeta}>
        {flag.default_value && (
          <span className={styles.flagMetaItem}>
            <span className={styles.flagMetaLabel}>Default:</span>
            <code className={`${styles.flagMetaValue} ${styles.flagDefault}`}>
              {flag.default_value}
            </code>
          </span>
        )}
        
        {flag.introduced_in && (
          <span className={styles.flagMetaItem}>
            <span className={styles.flagMetaLabel}>Since:</span>
            <span className={`${styles.flagMetaValue} ${styles.flagVersion}`}>
              {flag.introduced_in}
            </span>
          </span>
        )}
        
        {flag.deprecated_in && (
          <span className={styles.flagMetaItem}>
            <span className={styles.flagMetaLabel}>Deprecated:</span>
            <span className={`${styles.flagMetaValue} ${styles.flagDeprecatedVersion}`}>
              {flag.deprecated_in}
            </span>
          </span>
        )}
      </div>
      
      {/* Enum values */}
      {flag.values && flag.values.length > 0 && (
        <div className={styles.flagValues}>
          <div className={styles.flagValuesLabel}>Allowed values:</div>
          <div className={styles.flagValuesList}>
            {flag.values.map(val => (
              <code 
                key={val} 
                className={`${styles.flagValue} ${val === flag.default_value ? styles.isDefault : ''}`}
                title={val === flag.default_value ? 'Default value' : undefined}
              >
                <HighlightText text={val} query={searchQuery} />
                {val === flag.default_value && ' ✓'}
              </code>
            ))}
          </div>
        </div>
      )}
      
      {/* Related KEPs and Feature Gates */}
      {((flag.related_keps && flag.related_keps.length > 0) || 
        (flag.related_feature_gates && flag.related_feature_gates.length > 0)) && (
        <div className={styles.flagLinks}>
          {flag.related_keps?.map(kepId => {
            const kep = kepMap.get(kepId)
            return (
              <a
                key={kepId}
                href={kep?.path 
                  ? `https://github.com/kubernetes/enhancements/tree/master/keps/${kep.path}`
                  : `https://github.com/kubernetes/enhancements/issues?q=${kepId.replace('KEP-', '')}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className={styles.flagKepLink}
                title={kep?.title || kepId}
              >
                {kepId}
              </a>
            )
          })}
          {flag.related_feature_gates?.map(gate => (
            <code key={gate} className={styles.featureGateName}>
              {gate}
            </code>
          ))}
        </div>
      )}
    </div>
  )
}


// =============================================================================
// kubectl Spec Component
// =============================================================================

interface KubectlSpecProps {
  commands: KubectlCommand[]
  allCommands: KubectlCommand[]
  searchQuery: string
  setSearchQuery: (q: string) => void
  selectedCommand: string | null
  setSelectedCommand: (cmd: string | null) => void
  selectedVersion: string
  onClose: () => void
  handleOverlayClick: (e: React.MouseEvent) => void
}

function KubectlSpec({
  commands,
  allCommands,
  searchQuery,
  setSearchQuery,
  selectedCommand,
  setSelectedCommand,
  selectedVersion,
  onClose,
  handleOverlayClick,
}: KubectlSpecProps) {
  const { data: commandDetails } = useKubectlCommandWithDetails(
    selectedCommand ? selectedVersion : null,
    selectedCommand
  )
  
  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.componentName}>
              {(() => {
                const Icon = getComponentIcon('kubectl')
                return Icon ? <Icon size={36} color="#22c55e" className={styles.componentIcon} /> : null
              })()}
              kubectl
              <a 
                href="https://kubernetes.io/docs/reference/kubectl/"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.docsLink}
              >
                📖 Official Docs
              </a>
            </h2>
            <div className={styles.componentMeta}>
              <span className={styles.typeBadge} data-type="cli">
                cli
              </span>
              <span className={styles.versionBadge}>
                v{selectedVersion}
              </span>
            </div>
            <p className={styles.componentDescription}>
              Kubernetes command-line tool for running commands against clusters
            </p>
          </div>
          <div className={styles.headerRight}>
            <span className={styles.flagCount}>
              {commands.length} / {allCommands.length} commands
            </span>
            <button className={styles.closeButton} onClick={onClose}>✕</button>
          </div>
        </div>
        
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchContainer}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        
        {/* Content - Two column layout */}
        <div className={styles.kubectlContent}>
          {/* Command list */}
          <div className={styles.commandList}>
            {commands.map(cmd => (
              <button
                key={cmd.name}
                className={`${styles.commandItem} ${selectedCommand === cmd.name ? styles.selected : ''}`}
                onClick={() => setSelectedCommand(selectedCommand === cmd.name ? null : cmd.name)}
              >
                <code className={styles.commandName}>
                  <HighlightText text={cmd.name} query={searchQuery} />
                </code>
                {cmd.synopsis && (
                  <span className={styles.commandSynopsis}>
                    <HighlightText text={cmd.synopsis.slice(0, 80) + (cmd.synopsis.length > 80 ? '...' : '')} query={searchQuery} />
                  </span>
                )}
              </button>
            ))}
          </div>
          
          {/* Command details */}
          <div className={styles.commandDetails}>
            {selectedCommand && commandDetails ? (
              <KubectlCommandDetails 
                command={commandDetails} 
              />
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>👈</div>
                <p className={styles.emptyText}>Select a command</p>
                <p className={styles.emptySubtext}>
                  Click on a command to see its options and examples
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// kubectl command details panel
function KubectlCommandDetails({ 
  command, 
}: { 
  command: KubectlCommandWithDetails
}) {
  const [showAllOptions, setShowAllOptions] = useState(false)
  const [optionSearch, setOptionSearch] = useState('')
  
  // Filter options
  const filteredOptions = useMemo(() => {
    if (!optionSearch.trim()) return command.options
    const q = optionSearch.toLowerCase()
    return command.options.filter(opt =>
      opt.name.toLowerCase().includes(q) ||
      opt.description?.toLowerCase().includes(q)
    )
  }, [command.options, optionSearch])
  
  const displayedOptions = showAllOptions ? filteredOptions : filteredOptions.slice(0, 10)
  
  return (
    <div className={styles.commandDetailsContent}>
      {/* Synopsis */}
      <div className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>Synopsis</h3>
        <p className={styles.synopsis}>{command.synopsis || 'No description available'}</p>
      </div>
      
      {/* Usage */}
      {command.usage && (
        <div className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Usage</h3>
          <pre className={styles.usageBlock}>{command.usage}</pre>
        </div>
      )}
      
      {/* Options */}
      {command.options.length > 0 && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionHeader}>
            <h3 className={styles.detailSectionTitle}>
              Options ({filteredOptions.length})
            </h3>
            {command.options.length > 10 && (
              <input
                type="text"
                className={styles.optionSearchInput}
                placeholder="Filter options..."
                value={optionSearch}
                onChange={(e) => setOptionSearch(e.target.value)}
              />
            )}
          </div>
          <div className={styles.optionsList}>
            {displayedOptions.map(opt => (
              <div key={opt.name} className={styles.optionItem}>
                <div className={styles.optionHeader}>
                  <code className={styles.optionName}>
                    {opt.short && <span className={styles.optionShort}>{opt.short}, </span>}
                    {opt.name}
                  </code>
                  {opt.type && (
                    <span className={styles.optionType}>{opt.type}</span>
                  )}
                </div>
                {opt.description && (
                  <p className={styles.optionDescription}>{opt.description}</p>
                )}
                {opt.default_value && (
                  <span className={styles.optionDefault}>
                    Default: <code>{opt.default_value}</code>
                  </span>
                )}
              </div>
            ))}
          </div>
          {!showAllOptions && filteredOptions.length > 10 && (
            <button 
              className={styles.showMoreButton}
              onClick={() => setShowAllOptions(true)}
            >
              Show all {filteredOptions.length} options
            </button>
          )}
        </div>
      )}
      
      {/* Examples */}
      {command.examples.length > 0 && (
        <div className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Examples ({command.examples.length})</h3>
          <div className={styles.examplesList}>
            {command.examples.map((ex, i) => (
              <div key={i} className={styles.exampleItem}>
                {ex.description && (
                  <p className={styles.exampleDescription}># {ex.description}</p>
                )}
                <pre className={styles.exampleCode}>{ex.example}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Subcommands */}
      {command.subcommands.length > 0 && (
        <div className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Subcommands</h3>
          <div className={styles.subcommandsList}>
            {command.subcommands.map(sub => (
              <code key={sub} className={styles.subcommandItem}>{sub}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// =============================================================================
// Feature Gates Spec Component
// =============================================================================

interface FeatureGatesSpecProps {
  featureGates: FeatureGate[]
  allFeatureGates: FeatureGate[]
  searchQuery: string
  setSearchQuery: (q: string) => void
  stageFilter: 'all' | 'alpha' | 'beta' | 'stable' | 'deprecated'
  setStageFilter: (s: 'all' | 'alpha' | 'beta' | 'stable' | 'deprecated') => void
  featureGateCounts: { all: number; alpha: number; beta: number; stable: number; deprecated: number }
  selectedVersion: string
  onClose: () => void
  handleOverlayClick: (e: React.MouseEvent) => void
}

function FeatureGatesSpec({
  featureGates,
  allFeatureGates,
  searchQuery,
  setSearchQuery,
  stageFilter,
  setStageFilter,
  featureGateCounts,
  selectedVersion,
  onClose,
  handleOverlayClick,
}: FeatureGatesSpecProps) {
  const [selectedGate, setSelectedGate] = useState<string | null>(null)
  
  const selectedGateData = useMemo(() => {
    if (!selectedGate) return null
    return featureGates.find(g => g.name === selectedGate) || null
  }, [featureGates, selectedGate])
  
  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.componentName}>
              Feature Gates
              <a 
                href="https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.docsLink}
              >
                📖 Official Docs
              </a>
            </h2>
            <div className={styles.componentMeta}>
              <span className={styles.typeBadge} data-type="config">
                config
              </span>
              <span className={styles.versionBadge}>
                v{selectedVersion}
              </span>
            </div>
            <p className={styles.componentDescription}>
              Feature flags that control experimental and optional Kubernetes features
            </p>
          </div>
          <div className={styles.headerRight}>
            <span className={styles.flagCount}>
              {featureGates.length} / {allFeatureGates.length} gates
            </span>
            <button className={styles.closeButton} onClick={onClose}>✕</button>
          </div>
        </div>
        
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchContainer}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search feature gates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          
          <div className={styles.filterChips}>
            <button 
              className={`${styles.filterChip} ${stageFilter === 'all' ? styles.active : ''}`}
              onClick={() => setStageFilter('all')}
            >
              All ({featureGateCounts.all})
            </button>
            {featureGateCounts.stable > 0 && (
              <button 
                className={`${styles.filterChip} ${styles.stageStable} ${stageFilter === 'stable' ? styles.active : ''}`}
                onClick={() => setStageFilter('stable')}
              >
                Stable ({featureGateCounts.stable})
              </button>
            )}
            {featureGateCounts.beta > 0 && (
              <button 
                className={`${styles.filterChip} ${styles.stageBeta} ${stageFilter === 'beta' ? styles.active : ''}`}
                onClick={() => setStageFilter('beta')}
              >
                Beta ({featureGateCounts.beta})
              </button>
            )}
            {featureGateCounts.alpha > 0 && (
              <button 
                className={`${styles.filterChip} ${styles.stageAlpha} ${stageFilter === 'alpha' ? styles.active : ''}`}
                onClick={() => setStageFilter('alpha')}
              >
                Alpha ({featureGateCounts.alpha})
              </button>
            )}
            {featureGateCounts.deprecated > 0 && (
              <button 
                className={`${styles.filterChip} ${styles.stageDeprecated} ${stageFilter === 'deprecated' ? styles.active : ''}`}
                onClick={() => setStageFilter('deprecated')}
              >
                Deprecated ({featureGateCounts.deprecated})
              </button>
            )}
          </div>
        </div>
        
        {/* Content - Two column layout */}
        <div className={styles.kubectlContent}>
          {/* Feature gate list */}
          <div className={styles.commandList}>
            {featureGates.map(gate => (
              <button
                key={gate.name}
                className={`${styles.commandItem} ${selectedGate === gate.name ? styles.selected : ''}`}
                onClick={() => setSelectedGate(selectedGate === gate.name ? null : gate.name)}
              >
                <div className={styles.featureGateHeader}>
                  <code className={styles.commandName}>
                    <HighlightText text={gate.name} query={searchQuery} />
                  </code>
                  <span className={`${styles.stageBadge} ${styles[`stage${gate.stage.charAt(0).toUpperCase() + gate.stage.slice(1)}`]}`}>
                    {gate.stage}
                  </span>
                </div>
                <div className={styles.featureGateMeta}>
                  <span className={gate.default_value ? styles.defaultOn : styles.defaultOff}>
                    {gate.default_value ? '✓ on' : '○ off'}
                  </span>
                  {gate.lock_to_default && (
                    <span className={styles.locked}>🔒 locked</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          
          {/* Feature gate details */}
          <div className={styles.commandDetails}>
            {selectedGateData ? (
              <FeatureGateDetails gate={selectedGateData} />
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>👈</div>
                <p className={styles.emptyText}>Select a feature gate</p>
                <p className={styles.emptySubtext}>
                  Click on a feature gate to see its details and version history
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Feature gate details panel
function FeatureGateDetails({ gate }: { gate: FeatureGate }) {
  const versionHistory = parseVersionHistory(gate.version_history_json)
  
  return (
    <div className={styles.commandDetailsContent}>
      {/* Description */}
      {gate.description && (
        <div className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Description</h3>
          <p className={styles.synopsis}>{gate.description}</p>
        </div>
      )}
      
      {/* Status */}
      <div className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>Status</h3>
        <div className={styles.featureGateStatus}>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Stage:</span>
            <span className={`${styles.stageBadge} ${styles[`stage${gate.stage.charAt(0).toUpperCase() + gate.stage.slice(1)}`]}`}>
              {gate.stage}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Default:</span>
            <span className={gate.default_value ? styles.defaultOn : styles.defaultOff}>
              {gate.default_value ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          {gate.lock_to_default && (
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Locked:</span>
              <span className={styles.locked}>🔒 Cannot be changed</span>
            </div>
          )}
        </div>
      </div>
      
      {/* KEP Link */}
      {gate.kep && (
        <div className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Related KEP</h3>
          <a
            href={gate.kep_path 
              ? `https://github.com/kubernetes/enhancements/tree/master/keps/${gate.kep_path}`
              : `https://github.com/kubernetes/enhancements/issues/${gate.kep.replace('KEP-', '')}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className={styles.kepLink}
          >
            {gate.kep}: {gate.kep_title || 'View KEP'}
          </a>
        </div>
      )}
      
      {/* Version History */}
      {versionHistory.length > 0 && versionHistory[0].version !== 'unknown' && (
        <div className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Version History</h3>
          <div className={styles.versionHistory}>
            {versionHistory.map((entry, i) => (
              <div key={i} className={styles.versionHistoryEntry}>
                <span className={styles.versionNumber}>v{entry.version}{entry.to_version ? ` - v${entry.to_version}` : ''}</span>
                <span className={`${styles.stageBadge} ${styles[`stage${entry.stage.charAt(0).toUpperCase() + entry.stage.slice(1)}`]}`}>
                  {entry.stage}
                </span>
                <span className={entry.default ? styles.defaultOn : styles.defaultOff}>
                  {entry.default ? 'on' : 'off'}
                </span>
                {entry.lock_to_default && (
                  <span className={styles.locked}>🔒</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
