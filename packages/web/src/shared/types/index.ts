// Core data types for K8s API Explorer

// Re-export all generated DB row types (source of truth for DuckDB queries)
export * from './db-types'

// ============================================================================
// API Structure Types
// ============================================================================

export interface K8sVersion {
  version: string;          // e.g., "1.30"
  releaseDate: string;      // ISO date
  endOfLife?: string;       // ISO date if known
  isLatest: boolean;
}

export interface APIGroup {
  name: string;             // e.g., "apps", "core", "networking.k8s.io"
  displayName: string;      // e.g., "Apps", "Core", "Networking"
  description?: string;
  versions: APIVersion[];
}

export interface APIVersion {
  name: string;             // e.g., "v1", "v1beta1"
  isPreferred: boolean;
  kinds: K8sKind[];
}

export interface K8sKind {
  name: string;             // e.g., "Pod", "Deployment"
  singularName: string;
  pluralName: string;       // e.g., "pods", "deployments"
  scope: 'Namespaced' | 'Cluster';
  shortNames?: string[];    // e.g., ["po", "deploy"]
  categories?: string[];    // e.g., ["all", "workloads"]
  schemaRef: string;        // Path to full schema JSON
  fieldCount: number;       // Total fields for sizing visualization
  description?: string;     // Description from OpenAPI spec
  docsUrl?: string;         // Link to official K8s documentation
  
  // Relationships to other kinds
  relationships: K8sRelationship[];
}

export interface K8sRelationship {
  type: 'owns' | 'selects' | 'references' | 'mounts' | 'configures';
  targetKind: string;
  targetGroup: string;
  description: string;
  fieldPath?: string;       // e.g., "spec.template" for Deployment -> Pod
}

// ============================================================================
// Schema Types
// ============================================================================

export interface K8sSchema {
  group: string;
  version: string;
  kind: string;
  description: string;
  properties: SchemaProperty[];
  
  // Metadata
  introducedIn: string;     // K8s version
  deprecatedIn?: string;
}

export interface SchemaProperty {
  name: string;
  path: string;             // Full dotted path, e.g., "spec.containers[].image"
  type: SchemaType;
  description: string;
  required: boolean;
  default?: unknown;
  
  // Nested properties for objects/arrays
  properties?: SchemaProperty[];
  items?: SchemaProperty;   // For arrays
  
  // Type reference (for navigation to other K8s types)
  refKind?: string;         // e.g., "PodTemplateSpec", "ObjectMeta"
  
  // Version tracking
  introducedIn?: string;    // e.g., "1.25"
  deprecatedIn?: string;    // e.g., "1.28"
  removedIn?: string;       // e.g., "1.31"
  
  // Validation
  enum?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  
  // Annotations (the curated content)
  annotation?: FieldAnnotation;
}

export type SchemaType = 
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'map'                   // map[string]T
  | 'intOrString';

// ============================================================================
// KEP Types
// ============================================================================

export interface KEP {
  id: string;               // e.g., "693"
  title: string;
  status: KEPStatus;
  sig: string;              // e.g., "sig-node"
  authors: string[];
  
  // Tracking
  createdDate: string;
  lastUpdated: string;
  targetRelease?: string;
  
  // Content
  summary: string;
  motivation: string;
  
  // What it affects
  affectedComponents: ('kubelet' | 'scheduler' | 'api-server' | 'controller-manager' | 'kubectl')[];
  affectedKinds: string[];  // e.g., ["Pod", "KubeletConfiguration"]
  affectedFields: string[]; // Paths like "pod.spec.topologySpreadConstraints"
  
  // Feature gates
  featureGates?: FeatureGate[];
  
  // Links
  url: string;
  prLinks?: string[];
}

export type KEPStatus = 
  | 'provisional'
  | 'implementable'
  | 'implemented'
  | 'alpha'
  | 'beta'
  | 'stable'
  | 'deprecated'
  | 'withdrawn'
  | 'replaced';

export interface FeatureGate {
  name: string;
  stage: 'alpha' | 'beta' | 'stable' | 'deprecated';
  defaultValue: boolean;
  lockToDefault: boolean;
  description?: string;
  kep?: string;
  kepTitle?: string;
  kepPath?: string;
  versionHistory?: {
    version: string;
    stage: 'alpha' | 'beta' | 'stable' | 'deprecated';
    default: boolean;
    lockToDefault: boolean;
    toVersion?: string;
  }[];
}

// ============================================================================
// Field Annotation Types (Curated Content)
// ============================================================================

export interface FieldAnnotation {
  // Identity
  path: string;
  kind: string;
  group: string;
  
  // History
  introducedIn: string;
  deprecatedIn?: string;
  removedIn?: string;
  
  // KEP linkage
  kep?: {
    id: string;
    title: string;
    status: KEPStatus;
    url: string;
  };
  
  // Feature gate
  featureGate?: {
    name: string;
    defaultEnabled: boolean;
    currentState: 'alpha' | 'beta' | 'stable';
  };
  
  // Curated content
  curation: FieldCuration;
}

export interface FieldCuration {
  // Core content
  summary: string;              // 1-2 sentence explanation
  motivation?: string;          // Why this field exists
  useCases?: string[];          // When you'd use it
  
  // Practical guidance
  configExample?: string;       // YAML snippet
  gotchas?: string[];           // Common mistakes
  bestPractices?: string[];     // Recommendations
  
  // Relationships
  relatedFields?: string[];     // Often used together
  mutuallyExclusive?: string[]; // Can't use with these
  requires?: string[];          // Must also set these
  
  // Metadata
  source: 'llm' | 'manual' | 'official';
  confidence: 'high' | 'medium' | 'low';
  lastUpdated: string;
  overrideReason?: string;
}

// ============================================================================
// Version Diff Types
// ============================================================================

export interface VersionDiff {
  from: string;
  to: string;
  generatedAt: string;
  
  summary: {
    kindsAdded: number;
    kindsRemoved: number;
    fieldsAdded: number;
    fieldsRemoved: number;
    fieldsModified: number;
  };
  
  changes: KindDiff[];
}

export interface KindDiff {
  group: string;
  kind: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  
  fieldsAdded: FieldChange[];
  fieldsRemoved: FieldChange[];
  fieldsModified: FieldModification[];
}

export interface FieldChange {
  path: string;
  type: SchemaType;
  description: string;
  kep?: string;
  featureGate?: string;
}

export interface FieldModification {
  path: string;
  change: 'type' | 'default' | 'validation' | 'description' | 'deprecation';
  from: string;
  to: string;
}

// ============================================================================
// UI State Types
// ============================================================================

export type AppSection = 'home' | 'api-explorer' | 'control-plane' | 'releases' | 'learn' | 'analytics';
export type APIExplorerViewMode = 'constellation' | 'sunburst';
export type ReleasesViewMode = 'timeline' | 'features';

export interface ExplorerState {
  // Top-level navigation
  activeSection: AppSection;
  
  // API Explorer view
  viewMode: APIExplorerViewMode;
  specPanelOpen: boolean;  // Whether spec structure panel is open (constellation view)
  
  // Releases view
  releasesViewMode: ReleasesViewMode;
  selectedRelease?: string;  // e.g., "1.35"
  
  // Selection
  selectedVersion: string;
  compareVersion?: string;
  selectedGroup?: string;
  selectedKind?: string;
  selectedField?: string;
  
  // Control Plane view
  controlPlaneComponent?: string;  // Component to open on mount (e.g., 'feature-gates')
  controlPlaneSearch?: string;     // Search query to pre-fill (e.g., feature gate name)
  
  // Filters
  showDeprecated: boolean;
  showAlphaFeatures: boolean;
  showBetaFeatures: boolean;
  searchQuery: string;
  
  // UI state
  sidebarOpen: boolean;
  detailPanelOpen: boolean;
}

// ============================================================================
// Release Notes Types
// ============================================================================

export interface ReleaseFeature {
  kep: string;
  kepPath?: string;  // Path to KEP doc in enhancements repo (e.g., 'sig-node/1287-in-place-update-pod-resources')
  title: string;
  stage: 'alpha' | 'beta' | 'stable';
  sig: string;
  category: string;
  labels?: string[];  // Topic labels for cross-referencing (e.g., numa, cpu-manager, scheduling)
  description: string;
  impact?: string;
  featureGate?: string;
  isHighlight?: boolean;
  affectedKinds?: string[];
  affectedFields?: string[];
  history: {
    alpha?: string;
    beta?: string;
    stable?: string;
    tentative?: string[];  // Stages that are planned but not yet verified
    verified?: string[];   // Stages that were planned and have been verified as achieved
  };
}

export interface ReleaseDeprecation {
  item: string;
  reason: string;
  replacement?: string;
  removalTarget?: string;
}

export interface ReleaseRemoval {
  item: string;
  reason: string;
}

export interface ReleaseReference {
  title: string;
  url: string;
  source: string;
  type: 'official' | 'blog' | 'video' | 'tutorial';
}

// Raw change entry from release-notes.json
export interface ChangeEntry {
  description: string;
  prNumber?: number;
  prUrl?: string;
  author?: string;
  sigs?: string[];
  kepLinks?: string[];
  // LLM-enriched fields (from change_enricher)
  enrichment?: {
    problem: string;
    affected: string;
    fix: string;
    impact: string;
    category: string;
    severity: string;
    affectedComponents: string[];
    labels: string[];
  };
}

// Changes organized by kind from release-notes.json
export interface ChangesByKind {
  feature?: ChangeEntry[];
  bugOrRegression?: ChangeEntry[];
  apiChange?: ChangeEntry[];
  deprecation?: ChangeEntry[];
  documentation?: ChangeEntry[];
  failingTest?: ChangeEntry[];
  other?: ChangeEntry[];
}

// Action required note from release
export interface ActionRequiredNote {
  description: string;
  prNumber?: number;
  prUrl?: string;
  author?: string;
  sigs?: string[];
  // Legacy format (from curated data)
  title?: string;
  action?: string;
  affectedComponents?: string[];
  // LLM-enriched fields
  enrichment?: {
    title: string;
    summary: string;
    action: string;
    severity: string;
    affectedComponents: string[];
    affectedWorkloads?: string[];
    breakingChange: boolean;
  };
}

// CVE/Security information from CHANGELOG
export interface SecurityCVE {
  cve: string;
  title: string;
  description: string;
  affectedVersions?: string[];
  fixedVersions?: string[];
  affectedComponents?: string[];
  reporter?: string;
  patchVersion?: string;
}

// Patch release from CHANGELOG
export interface PatchRelease {
  version: string;
  changelogSince?: string;
  securityFixes?: SecurityCVE[];
  changesByKind?: ChangesByKind;
  dependencies?: {
    added?: string[];
    changed?: string[];
    removed?: string[];
  };
}

export interface ReleaseNotes {
  version: string;
  codename?: string;
  description?: string;
  releaseDate: string;
  endOfLifeDate?: string;
  summary: {
    total: number;
    stable: number;
    beta: number;
    alpha: number;
  };
  themes?: string[];
  actionRequired?: ActionRequiredNote[];
  securityInformation?: SecurityCVE[];
  features: ReleaseFeature[];
  changesByKind?: ChangesByKind;  // Raw changes from release-notes.json
  deprecations?: ReleaseDeprecation[];
  removals?: ReleaseRemoval[];
  dependencies?: {
    added?: string[];
    changed?: string[];
    removed?: string[];
  };
  patchReleases?: PatchRelease[];
  references?: ReleaseReference[];
}

export interface ReleaseIndex {
  releases: {
    version: string;
    codename?: string;
    releaseDate: string;
    file: string;
  }[];
  latestVersion: string;
}

// ============================================================================
// Visualization Types
// ============================================================================

export interface ConstellationNode {
  id: string;
  kind: string;
  group: string;
  x: number;
  y: number;
  z: number;
  size: number;           // Based on field count or importance
  color: string;          // Based on API group
  glow: number;           // Intensity for hover/selection
  connections: string[];  // IDs of connected nodes
}

export interface ConstellationEdge {
  source: string;
  target: string;
  type: K8sRelationship['type'];
  strength: number;       // For force simulation
}

export interface SunburstNode {
  name: string;
  value: number;
  children?: SunburstNode[];
  data?: {
    type: 'root' | 'group' | 'version' | 'kind';
    ref?: string;
  };
}
