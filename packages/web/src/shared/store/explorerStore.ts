import { create } from 'zustand'
import type { ExplorerState, AppSection, APIExplorerViewMode, ReleasesViewMode } from '../types'
import { 
  parseUrlHash, 
  updateUrlHash, 
  type UrlState,
  type LearnUrlState,
  type AnalyticsUrlState,
  type ReleasesUrlState,
} from '../utils/urlState'

interface ExplorerStore extends ExplorerState {
  // URL state for each section (persisted to URL)
  learnUrlState: LearnUrlState
  analyticsUrlState: AnalyticsUrlState
  releasesUrlState: ReleasesUrlState
  
  // Actions
  setActiveSection: (section: AppSection) => void
  setViewMode: (mode: APIExplorerViewMode) => void
  setSpecPanelOpen: (open: boolean) => void
  setReleasesViewMode: (mode: ReleasesViewMode) => void
  setSelectedRelease: (version: string | undefined) => void
  setSelectedVersion: (version: string) => void
  setCompareVersion: (version: string | undefined) => void
  setControlPlaneComponent: (component: string | undefined) => void
  setControlPlaneSearch: (search: string | undefined) => void
  setSelectedGroup: (group: string | undefined) => void
  setSelectedKind: (kind: string | undefined) => void
  setSelectedField: (field: string | undefined) => void
  setSearchQuery: (query: string) => void
  toggleSidebar: () => void
  toggleDetailPanel: () => void
  toggleShowDeprecated: () => void
  toggleShowAlphaFeatures: () => void
  toggleShowBetaFeatures: () => void
  reset: () => void
  initFromUrl: () => void
  
  // URL state actions
  setLearnUrlState: (state: Partial<LearnUrlState>) => void
  setAnalyticsUrlState: (state: Partial<AnalyticsUrlState>) => void
  setReleasesUrlState: (state: Partial<ReleasesUrlState>) => void
  getShareableUrl: () => string
}

// Build URL state from current store state
function buildCurrentUrlState(state: ExplorerStore): UrlState {
  const urlState: UrlState = { section: state.activeSection }
  
  switch (state.activeSection) {
    case 'api-explorer':
      urlState.apiExplorer = {
        view: state.viewMode,
        version: state.selectedVersion,
        kind: state.selectedKind,
        group: state.selectedGroup,
        panel: state.specPanelOpen ? 'spec' : undefined,
      }
      break
    case 'releases':
      urlState.releases = {
        ...state.releasesUrlState,
        version: state.selectedRelease,
      }
      break
    case 'learn':
      urlState.learn = {
        ...state.learnUrlState,
        search: state.searchQuery || undefined,
      }
      break
    case 'analytics':
      urlState.analytics = state.analyticsUrlState
      break
  }
  
  return urlState
}

// Parse URL hash to get initial state
function parseUrlHashLegacy(): Partial<ExplorerState> {
  const urlState = parseUrlHash()
  if (!urlState) return {}
  
  const result: Partial<ExplorerState> = {
    activeSection: urlState.section,
  }
  
  if (urlState.apiExplorer) {
    if (urlState.apiExplorer.view) result.viewMode = urlState.apiExplorer.view
    if (urlState.apiExplorer.version) result.selectedVersion = urlState.apiExplorer.version
    if (urlState.apiExplorer.kind) {
      result.selectedKind = urlState.apiExplorer.kind
      result.detailPanelOpen = true
    }
    if (urlState.apiExplorer.group) result.selectedGroup = urlState.apiExplorer.group
    if (urlState.apiExplorer.panel === 'spec') result.specPanelOpen = true
  }
  
  if (urlState.releases?.version) {
    result.selectedRelease = urlState.releases.version
  }
  
  if (urlState.learn?.search) {
    result.searchQuery = urlState.learn.search
  }
  
  return result
}

// Parse URL for section-specific state
function parseUrlSectionState(): {
  learn: LearnUrlState
  analytics: AnalyticsUrlState
  releases: ReleasesUrlState
} {
  const urlState = parseUrlHash()
  return {
    learn: urlState?.learn || {},
    analytics: urlState?.analytics || {},
    releases: urlState?.releases || {},
  }
}

const initialState: ExplorerState = {
  activeSection: 'home',
  viewMode: 'constellation',
  specPanelOpen: false,
  releasesViewMode: 'timeline',
  selectedRelease: undefined,
  selectedVersion: '1.35',
  compareVersion: undefined,
  selectedGroup: undefined,
  selectedKind: undefined,
  selectedField: undefined,
  showDeprecated: false,
  showAlphaFeatures: true,
  showBetaFeatures: true,
  searchQuery: '',
  sidebarOpen: false,
  detailPanelOpen: false,
  controlPlaneComponent: undefined,
  controlPlaneSearch: undefined,
}

const initialSectionState = parseUrlSectionState()

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  ...initialState,
  // Apply URL hash on initial load
  ...parseUrlHashLegacy(),
  
  // Section-specific URL state
  learnUrlState: initialSectionState.learn,
  analyticsUrlState: initialSectionState.analytics,
  releasesUrlState: initialSectionState.releases,
  
  setActiveSection: (section) => set((state) => {
    const newState = { 
      ...state,
      activeSection: section,
      // Clear search when switching sections
      searchQuery: '',
    }
    updateUrlHash(buildCurrentUrlState({ ...newState, activeSection: section } as ExplorerStore))
    return { activeSection: section, searchQuery: '' }
  }),
  
  setViewMode: (mode) => set((state) => {
    const newState = {
      viewMode: mode,
      selectedKind: undefined,
      selectedField: undefined,
      detailPanelOpen: false,
      specPanelOpen: false,
    }
    const fullState = { ...state, ...newState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return newState
  }),
  
  setSpecPanelOpen: (open) => set((state) => {
    const newState = { specPanelOpen: open }
    const fullState = { ...state, ...newState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return newState
  }),
  
  setReleasesViewMode: (mode) => set({ releasesViewMode: mode }),
  
  setSelectedRelease: (version) => set((state) => {
    const releasesUrlState = { ...state.releasesUrlState, version }
    const newState = { selectedRelease: version, releasesUrlState }
    const fullState = { ...state, ...newState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return newState
  }),
  
  setSelectedVersion: (version) => set((state) => {
    const newState = { 
      selectedVersion: version,
      selectedKind: undefined,
      selectedField: undefined,
    }
    const fullState = { ...state, ...newState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return newState
  }),
  
  setCompareVersion: (version) => set({ compareVersion: version }),
  
  setControlPlaneComponent: (component) => set({ controlPlaneComponent: component }),
  
  setControlPlaneSearch: (search) => set({ controlPlaneSearch: search }),
  
  setSelectedGroup: (group) => set({ 
    selectedGroup: group,
    selectedKind: undefined,
    selectedField: undefined,
  }),
  
  setSelectedKind: (kind) => set((state) => {
    const newState = { 
      selectedKind: kind,
      selectedField: undefined,
      detailPanelOpen: kind !== undefined,
      specPanelOpen: false, // Reset spec panel when kind changes
    }
    const fullState = { ...state, ...newState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return newState
  }),
  
  setSelectedField: (field) => set({ selectedField: field }),
  
  setSearchQuery: (query) => set((state) => {
    // Update URL for learn section search
    if (state.activeSection === 'learn') {
      const fullState = { ...state, searchQuery: query } as ExplorerStore
      fullState.learnUrlState = { ...fullState.learnUrlState, search: query || undefined }
      updateUrlHash(buildCurrentUrlState(fullState))
    }
    return { searchQuery: query }
  }),
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  toggleDetailPanel: () => set((state) => ({ detailPanelOpen: !state.detailPanelOpen })),
  
  toggleShowDeprecated: () => set((state) => ({ showDeprecated: !state.showDeprecated })),
  
  toggleShowAlphaFeatures: () => set((state) => ({ showAlphaFeatures: !state.showAlphaFeatures })),
  
  toggleShowBetaFeatures: () => set((state) => ({ showBetaFeatures: !state.showBetaFeatures })),
  
  reset: () => set(initialState),
  
  initFromUrl: () => {
    const urlState = parseUrlHashLegacy()
    const sectionState = parseUrlSectionState()
    if (Object.keys(urlState).length > 0) {
      set({
        ...urlState,
        learnUrlState: sectionState.learn,
        analyticsUrlState: sectionState.analytics,
        releasesUrlState: sectionState.releases,
      })
    }
  },
  
  // Section-specific URL state setters
  setLearnUrlState: (newState) => set((state) => {
    const learnUrlState = { ...state.learnUrlState, ...newState }
    const fullState = { ...state, learnUrlState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return { learnUrlState }
  }),
  
  setAnalyticsUrlState: (newState) => set((state) => {
    const analyticsUrlState = { ...state.analyticsUrlState, ...newState }
    const fullState = { ...state, analyticsUrlState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return { analyticsUrlState }
  }),
  
  setReleasesUrlState: (newState) => set((state) => {
    const releasesUrlState = { ...state.releasesUrlState, ...newState }
    const fullState = { ...state, releasesUrlState } as ExplorerStore
    updateUrlHash(buildCurrentUrlState(fullState))
    return { releasesUrlState }
  }),
  
  getShareableUrl: () => {
    const state = get()
    const urlState = buildCurrentUrlState(state as ExplorerStore)
    const hash = '#' + urlState.section
    // Build full URL
    return window.location.origin + window.location.pathname + hash
  },
}))

// Listen for hash changes (browser back/forward)
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const urlState = parseUrlHashLegacy()
    const sectionState = parseUrlSectionState()
    if (Object.keys(urlState).length > 0) {
      useExplorerStore.setState({
        ...urlState,
        learnUrlState: sectionState.learn,
        analyticsUrlState: sectionState.analytics,
        releasesUrlState: sectionState.releases,
      })
    }
  })
  
  // Set initial URL hash if none exists
  if (!window.location.hash) {
    const state = useExplorerStore.getState()
    updateUrlHash(buildCurrentUrlState(state as ExplorerStore))
  }
}
