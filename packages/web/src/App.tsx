import { useState, useEffect, useCallback } from 'react'
import { ConstellationView } from './features/api-explorer/ConstellationView'
import { SunburstView } from './features/api-explorer/SunburstView'
import { ReleasesView } from './features/releases/ReleasesView'
import { ControlPlaneView } from './features/control-plane/ControlPlaneView'
import { LearnView } from './features/learn/LearnView'
import { HomeView } from './features/home'
import { DeepDiveView, parseDeepDiveUrl } from './features/deep-dives'
import { AnalyticsView } from './features/analytics/AnalyticsView'
import { Header } from './shared/components/Header'
import { SpecStructure } from './features/api-explorer/SpecStructure'
import { HelpModal, useHelpModal } from './shared/components/HelpModal'
import { useExplorerStore } from './shared/store/explorerStore'
import { useConstellationData, useAPIGroups } from './shared/hooks'
import { loadSchemasForVersion, getSchemaForKind, getKindDescription } from './shared/data/schemas'
import styles from './App.module.css'

function App() {
  const { 
    activeSection,
    viewMode, 
    selectedVersion,
    selectedKind,
    setSelectedKind,
    detailPanelOpen,
    learnUrlState,
  } = useExplorerStore()
  
  const { nodes, edges, groups, loading, error } = useConstellationData(selectedVersion)
  const { groups: sidebarGroups } = useAPIGroups(selectedVersion)
  
  // Check if we should show a deep dive instead of the learn view
  const deepDiveUrl = parseDeepDiveUrl(learnUrlState)
  
  // Determine the current help section based on active view
  const getCurrentHelpSection = useCallback(() => {
    if (activeSection === 'home') return 'constellation' // Use constellation help for home
    if (activeSection === 'api-explorer') {
      return viewMode === 'constellation' ? 'constellation' : 'sunburst'
    }
    if (activeSection === 'releases') return 'releases'
    if (activeSection === 'control-plane') return 'architecture'
    if (activeSection === 'learn') return 'learn'
    if (activeSection === 'analytics') return 'analytics'
    return 'constellation'
  }, [activeSection, viewMode])
  
  // Help modal state - pass the context getter for keyboard shortcut
  const helpModal = useHelpModal(getCurrentHelpSection)
  
  // Handler for help button that passes current context
  const handleHelpClick = useCallback(() => {
    helpModal.open(getCurrentHelpSection())
  }, [helpModal, getCurrentHelpSection])
  
  // Load schemas for the current version
  const [schemasLoaded, setSchemasLoaded] = useState(false)
  
  useEffect(() => {
    setSchemasLoaded(false)
    loadSchemasForVersion(selectedVersion).then(() => {
      setSchemasLoaded(true)
    })
  }, [selectedVersion])
  
  // Get schema for selected kind
  const selectedSchema = schemasLoaded && selectedKind 
    ? getSchemaForKind(selectedKind, selectedVersion) 
    : []
  
  // Get description for selected kind
  const selectedDescription = schemasLoaded && selectedKind
    ? getKindDescription(selectedKind, selectedVersion)
    : ''
  
  // Find the group for the selected kind
  const selectedGroup = selectedKind 
    ? nodes.find(n => n.kind === selectedKind)?.group || 'core'
    : 'core'
  
  // Close spec view
  const handleCloseSpec = useCallback(() => {
    setSelectedKind(undefined)
  }, [setSelectedKind])
  
  // Note: ESC handling is done in individual view components (ConstellationView, SunburstView)
  // to allow proper state management (e.g., closing spec structure before closing overlay)

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <h2>Failed to load API data</h2>
        <p>{error.message}</p>
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <Header onHelpClick={handleHelpClick} />
      
      <div className={styles.main}>
        <div className={styles.canvas}>
          {activeSection === 'home' ? (
            // Home view
            <HomeView />
          ) : activeSection === 'api-explorer' ? (
            // API Explorer views
            loading ? (
              <div className={styles.loading}>
                <div className={styles.loadingSpinner} />
                <p>Loading Kubernetes API...</p>
              </div>
            ) : (
              <>
                {viewMode === 'constellation' && (
                  <ConstellationView nodes={nodes} edges={edges} groups={groups} sidebarGroups={sidebarGroups} />
                )}
                {viewMode === 'sunburst' && (
                  <SunburstView groups={groups} />
                )}
              </>
            )
          ) : activeSection === 'releases' ? (
            // Releases view
            <ReleasesView />
          ) : activeSection === 'control-plane' ? (
            // Control Plane view
            <ControlPlaneView />
          ) : activeSection === 'learn' ? (
            // Learn view - show DeepDiveView if a deep dive is selected, otherwise LearnView
            // Using separate components with keys prevents "Rendered fewer hooks than expected" errors
            deepDiveUrl ? (
              <DeepDiveView 
                key={`deep-dive-${deepDiveUrl.deepDiveId}`}
                deepDiveId={deepDiveUrl.deepDiveId} 
                sectionId={deepDiveUrl.sectionId} 
              />
            ) : (
              <LearnView key="learn-view" />
            )
          ) : activeSection === 'analytics' ? (
            // Analytics view
            <AnalyticsView />
          ) : null}
          
          {/* Spec Structure overlay - shown when a kind is selected in sunburst mode */}
          {activeSection === 'api-explorer' && viewMode === 'sunburst' && detailPanelOpen && selectedKind && schemasLoaded && (
            <div className={styles.specOverlay} onClick={handleCloseSpec}>
              <SpecStructure
                kind={selectedKind}
                group={selectedGroup}
                schema={selectedSchema}
                description={selectedDescription}
                onClose={handleCloseSpec}
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Help Modal */}
      <HelpModal 
        isOpen={helpModal.isOpen} 
        onClose={helpModal.close} 
        initialSection={helpModal.initialSection}
      />
    </div>
  )
}

export default App
