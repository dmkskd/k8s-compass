/**
 * Deep Dives Feature
 *
 * Rich, interactive technical content for the Learn section.
 * Deep dives are full TSX components with unlimited interactivity,
 * including 3D visualizations, animated diagrams, decision flowcharts,
 * and live data integration from existing parquet tables.
 *
 * @module features/deep-dives
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Deep dive content status
 */
export type DeepDiveStatus = 'draft' | 'wip' | 'review' | 'published'

/**
 * Deep dive metadata for discovery and routing
 */
export interface DeepDiveMetadata {
  /** URL slug (e.g., 'cpu-numa-low-latency') */
  id: string
  /** Display title */
  title: string
  /** Optional subtitle */
  subtitle?: string
  /** Short description for cards */
  description: string
  /** Content status (draft, wip, review, published) */
  status: DeepDiveStatus
  /** Author name */
  author?: string
  /** ISO date when published */
  publishedDate: string
  /** Last update date */
  updatedDate?: string
  /** Estimated reading time in minutes */
  estimatedReadTime: number
  /** Searchable tags */
  labels: string[]
  /** KEP IDs referenced */
  relatedKeps: string[]
  /** Feature gates referenced */
  relatedFeatureGates: string[]
  /** Optional thumbnail image */
  thumbnail?: string
}

/**
 * Section definition for table of contents
 */
export interface DeepDiveSection {
  /** URL hash anchor */
  id: string
  /** Display title */
  title: string
  /** Heading level */
  level: 1 | 2 | 3
  /** Optional custom component */
  component?: React.ComponentType
}

/**
 * Deep dive component props
 */
export interface DeepDiveProps {
  metadata: DeepDiveMetadata
  sections: DeepDiveSection[]
}

/**
 * Layout wrapper props
 */
export interface DeepDiveLayoutProps {
  metadata: DeepDiveMetadata
  sections: DeepDiveSection[]
  children: React.ReactNode
  /** Currently visible section */
  activeSection?: string
  onSectionChange?: (sectionId: string) => void
}

/**
 * Decision flowchart node
 */
export interface FlowchartNode {
  id: string
  type: 'question' | 'answer' | 'recommendation'
  text: string
  description?: string
  children?: {
    /** Edge label (e.g., "Yes", "No") */
    label: string
    /** Target node ID */
    nodeId: string
  }[]
  recommendation?: {
    kubeletFlags?: Record<string, string>
    /** YAML snippet */
    podSpec?: string
    keps?: string[]
    featureGates?: string[]
  }
}

/**
 * Sequence diagram message
 */
export interface SequenceMessage {
  id: string
  /** Component name */
  from: string
  /** Component name */
  to: string
  /** Message label */
  label: string
  /** Detailed description */
  description?: string
  /** Animation duration (ms) */
  duration?: number
}

/**
 * NUMA topology data for 3D visualization
 */
export interface NUMATopologyData {
  nodes: NUMANode[]
  interconnects: NUMAInterconnect[]
}

export interface NUMANode {
  id: number
  cpuCores: CPUCore[]
  memoryGB: number
  cacheHierarchy: CacheLevel[]
}

export interface CPUCore {
  id: number
  allocated: boolean
  podName?: string
  /** L1 cache in KB */
  l1Cache: number
  /** L2 cache in KB */
  l2Cache: number
}

export interface CacheLevel {
  level: 'L1' | 'L2' | 'L3' | 'LLC'
  sizeKB: number
  shared: boolean
  /** Core IDs this cache is shared with */
  sharedWith?: number[]
}

export interface NUMAInterconnect {
  /** Source node ID */
  from: number
  /** Target node ID */
  to: number
  bandwidthGBps: number
  latencyNs: number
}

// =============================================================================
// Components
// =============================================================================

// Main view and layout components
export { DeepDiveView, parseDeepDiveUrl, buildDeepDiveUrlState } from './DeepDiveView'
export { DeepDiveLayout } from './DeepDiveLayout'
export { DeepDiveCard } from './DeepDiveCard'

// =============================================================================
// Hooks
// =============================================================================

export { useKepStatus, getKepStage, getKepGitHubUrl } from './hooks/useKepStatus'
export type { KepStatusData, UseKepStatusResult } from './hooks/useKepStatus'

export {
  useFeatureGate,
  useFeatureGates,
  getFeatureGateStageColor,
  formatDefaultValue,
} from './hooks/useFeatureGate'
export type {
  FeatureGateData,
  UseFeatureGateResult,
  UseFeatureGatesResult,
} from './hooks/useFeatureGate'

export {
  useKubeletFlags,
  useComponentFlags,
  formatFlagWithDefault,
  getFlagTypeColor,
} from './hooks/useKubeletFlags'
export type { ComponentFlagData, UseKubeletFlagsResult } from './hooks/useKubeletFlags'

export {
  deepDiveQueryCache,
  CACHE_PREFIXES,
  getCachedOrFetch,
} from './hooks/queryCache'

// =============================================================================
// Shared Components
// =============================================================================

export { KepStatusBadge, KepStatusBadgeList } from './components/KepStatusBadge'
export { FeatureGateCard, FeatureGateBadge } from './components/FeatureGateCard'
export {
  KubeletFlagCard,
  KubeletFlagBadge,
  KubeletFlagList,
} from './components/KubeletFlagCard'
export { CodeBlock, InlineCode } from './components/CodeBlock'
export {
  InfoCallout,
  Tip,
  Warning,
  Note,
  Info,
  Danger,
} from './components/InfoCallout'
export { DecisionFlowchart } from './components/DecisionFlowchart'
export { SequenceDiagram } from './components/SequenceDiagram'


