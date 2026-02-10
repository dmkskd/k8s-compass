import { useState, useCallback, useRef, useEffect, Suspense, useMemo } from 'react'
import { ConstellationView } from '../api-explorer/ConstellationView'
import { ReleasesView } from '../releases/ReleasesView'
import { ControlPlaneView } from '../control-plane/ControlPlaneView'
import { LearnView } from '../learn/LearnView'
import { AnalyticsView } from '../analytics/AnalyticsView'
import { useExplorerStore } from '../../shared/store/explorerStore'
import { useConstellationData, useAPIGroups } from '../../shared/hooks'
import { isFeatureEnabled } from '../../shared/utils/featureFlags'
import type { AppSection } from '../../shared/types'
import styles from './HomeView.module.css'

// Interactive mode toggle - when true, you can interact with embedded views
const ALLOW_INTERACTIVE_PREVIEWS = true

// Feature card data
interface FeatureCard {
  id: AppSection
  title: string
  description: string
}

const FEATURES: FeatureCard[] = [
  {
    id: 'api-explorer',
    title: 'API Explorer',
    description: 'Explore the Kubernetes APIs.',
  },
  {
    id: 'releases',
    title: 'Releases',
    description: 'Annotated Kubernetes releases notes.',
  },
  {
    id: 'control-plane',
    title: 'Control Plane',
    description: 'Visualize control plane components and their configuration options.',
  },
  {
    id: 'learn',
    title: 'Learn',
    description: 'Discover conference talks, documentation and deep dives.',
  },
  {
    id: 'analytics',
    title: 'Analytics',
    description: 'Query K8s datasets using SQL.',
  },
]

// Loading placeholder
function LoadingPlaceholder() {
  return (
    <div 
      className={styles.loadingPlaceholder}
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '0.8rem',
        fontWeight: 500,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'rgba(99, 102, 241, 0.6)',
      }}
    >
      <div className={styles.loadingSpinner} />
      <span>Loading preview</span>
    </div>
  )
}

// Wrapper for ConstellationView that fetches its own data
function EmbeddedConstellation() {
  const { selectedVersion } = useExplorerStore()
  const { nodes, edges, groups, loading } = useConstellationData(selectedVersion)
  const { groups: sidebarGroups } = useAPIGroups(selectedVersion)
  
  if (loading || nodes.length === 0) {
    return <LoadingPlaceholder />
  }
  
  return <ConstellationView nodes={nodes} edges={edges} groups={groups} sidebarGroups={sidebarGroups} embedded />
}

// Embedded real view component
function EmbeddedView({ featureId }: { featureId: AppSection }) {
  const [isInteractive, setIsInteractive] = useState(false)
  
  return (
    <div className={styles.embeddedViewWrapper}>
      <div className={`${styles.embeddedViewScaler} ${isInteractive ? styles.interactive : ''}`}>
        <Suspense fallback={<LoadingPlaceholder />}>
          {featureId === 'api-explorer' && <EmbeddedConstellation />}
          {featureId === 'releases' && <ReleasesView />}
          {featureId === 'control-plane' && <ControlPlaneView />}
          {featureId === 'learn' && <LearnView />}
          {featureId === 'analytics' && <AnalyticsView />}
        </Suspense>
      </div>
      {/* Overlay to capture clicks - hidden when interactive */}
      {!isInteractive && <div className={styles.embeddedViewOverlay} />}
      
      {/* Interactive mode toggle */}
      {ALLOW_INTERACTIVE_PREVIEWS && (
        <button
          className={`${styles.interactiveToggle} ${isInteractive ? styles.active : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setIsInteractive(!isInteractive)
          }}
          title={isInteractive ? 'Exit interactive mode' : 'Enter interactive mode'}
        >
          {isInteractive ? '🔓' : '🔒'}
        </button>
      )}
    </div>
  )
}

// Slide component with embedded real view
function SlideCard({ 
  feature, 
  onNavigate,
  onHover,
  isActive,
  isVisible,
}: { 
  feature: FeatureCard
  onNavigate: (section: AppSection) => void
  onHover: () => void
  isActive: boolean
  isVisible: boolean
}) {
  const handleMouseEnter = useCallback(() => {
    if (!isActive) {
      onHover()
    }
  }, [isActive, onHover])

  return (
    <div 
      className={`${styles.slide} ${isActive ? styles.activeSlide : ''}`}
      onMouseEnter={handleMouseEnter}
    >
      {/* Card info bar at top */}
      <button 
        className={styles.slideInfo}
        onClick={() => onNavigate(feature.id)}
      >
        <h3 className={styles.slideTitle}>{feature.title}</h3>
        
        <p className={styles.slideDescription}>{feature.description}</p>
        
        <div className={styles.slideAction}>
          <span>Open {feature.title}</span>
          <span className={styles.arrow}>→</span>
        </div>
      </button>

      {/* Embedded real view - only render if visible for performance */}
      <div className={styles.slidePreview}>
        {isVisible ? (
          <EmbeddedView featureId={feature.id} />
        ) : (
          <LoadingPlaceholder />
        )}
      </div>
    </div>
  )
}

export function HomeView() {
  const { setActiveSection } = useExplorerStore()
  const [activeIndex, setActiveIndex] = useState(0)
  const [visibleSlides, setVisibleSlides] = useState<Set<number>>(new Set([0, 1]))
  const [isPaused, setIsPaused] = useState(false)
  const [hoverCooldown, setHoverCooldown] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoAdvanceRef = useRef<NodeJS.Timeout | null>(null)

  // Filter features based on feature flags
  const enabledFeatures = useMemo(() => 
    FEATURES.filter(f => isFeatureEnabled(f.id)),
    []
  )

  const handleNavigate = useCallback((section: AppSection) => {
    setActiveSection(section)
  }, [setActiveSection])

  // Scroll to slide programmatically
  const scrollToSlide = useCallback((index: number) => {
    if (!scrollRef.current) return
    const container = scrollRef.current
    
    // Get direct children that are slides
    const slides = Array.from(container.children).filter(
      child => child.classList.contains(styles.slide)
    )
    if (index >= slides.length) return
    
    const targetSlide = slides[index] as HTMLElement
    const containerWidth = container.offsetWidth
    const slideCenter = targetSlide.offsetLeft + targetSlide.offsetWidth / 2
    const scrollTarget = slideCenter - containerWidth / 2
    
    container.scrollTo({
      left: scrollTarget,
      behavior: 'smooth'
    })
  }, [])

  // Auto-advance to next slide every 5 seconds
  useEffect(() => {
    if (isPaused || enabledFeatures.length <= 1) return
    
    autoAdvanceRef.current = setInterval(() => {
      setActiveIndex(prev => {
        const nextIndex = (prev + 1) % enabledFeatures.length
        scrollToSlide(nextIndex)
        return nextIndex
      })
    }, 5000)
    
    return () => {
      if (autoAdvanceRef.current) {
        clearInterval(autoAdvanceRef.current)
      }
    }
  }, [isPaused, enabledFeatures.length, scrollToSlide])

  // Pause auto-advance on user interaction, resume after 15 seconds
  const pauseAutoAdvance = useCallback(() => {
    setIsPaused(true)
    // Resume after 15 seconds of no interaction
    setTimeout(() => setIsPaused(false), 15000)
  }, [])

  // Handle scroll to update active index and visible slides
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const scrollLeft = scrollRef.current.scrollLeft
    const container = scrollRef.current
    
    // Get direct children that are slides
    const slides = Array.from(container.children).filter(
      child => child.classList.contains(styles.slide)
    )
    if (slides.length === 0) return
    
    // Find which slide is most centered
    const containerCenter = scrollLeft + container.offsetWidth / 2
    let closestIndex = 0
    let closestDistance = Infinity
    
    slides.forEach((slide, index) => {
      const slideElement = slide as HTMLElement
      const slideCenter = slideElement.offsetLeft + slideElement.offsetWidth / 2
      const distance = Math.abs(containerCenter - slideCenter)
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    })
    
    setActiveIndex(closestIndex)
    
    // Mark adjacent slides as visible for preloading
    setVisibleSlides(new Set([
      Math.max(0, closestIndex - 1),
      closestIndex,
      Math.min(enabledFeatures.length - 1, closestIndex + 1)
    ]))
  }, [enabledFeatures.length])

  // Handle manual dot click - pause and scroll
  const handleDotClick = useCallback((index: number) => {
    pauseAutoAdvance()
    scrollToSlide(index)
  }, [pauseAutoAdvance, scrollToSlide])

  // Handle hover on non-active slide - scroll it to center (with cooldown to prevent chain reactions)
  const handleSlideHover = useCallback((index: number) => {
    if (hoverCooldown) return
    pauseAutoAdvance()
    scrollToSlide(index)
    // Set cooldown to prevent rapid-fire hover triggers
    setHoverCooldown(true)
    setTimeout(() => setHoverCooldown(false), 1000)
  }, [pauseAutoAdvance, scrollToSlide, hoverCooldown])

  // Pause on manual scroll
  const handleManualScroll = useCallback(() => {
    pauseAutoAdvance()
    handleScroll()
  }, [pauseAutoAdvance, handleScroll])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', handleManualScroll)
    return () => el.removeEventListener('scroll', handleManualScroll)
  }, [handleScroll])

  return (
    <div className={styles.container}>
      {/* Compact hero */}
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>
          <span className={styles.heroIcon}>⎈</span>
          K8s Compass
        </h1>
        <p className={styles.heroSubtitle}>
          Explore APIs, track releases, discover learning resources and run analytics on K8s datasets.
        </p>
      </div>

      {/* Horizontal slideshow */}
      <div className={styles.slideshow}>
        <div className={styles.slidesContainer} ref={scrollRef}>
          {enabledFeatures.map((feature, index) => (
            <SlideCard
              key={feature.id}
              feature={feature}
              onNavigate={handleNavigate}
              onHover={() => handleSlideHover(index)}
              isActive={index === activeIndex}
              isVisible={visibleSlides.has(index)}
            />
          ))}
        </div>
        
        {/* Dot indicators */}
        <div className={styles.slideDots}>
          {enabledFeatures.map((feature, index) => (
            <button
              key={feature.id}
              className={`${styles.slideDot} ${index === activeIndex ? styles.activeDot : ''}`}
              onClick={() => handleDotClick(index)}
              title={feature.title}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <p className={styles.footerLinks}>
          <a href="https://github.com/kubernetes/kubernetes" target="_blank" rel="noopener noreferrer">
            Kubernetes
          </a>
          <span>•</span>
          <a href="https://github.com/kubernetes/enhancements" target="_blank" rel="noopener noreferrer">
            KEPs
          </a>
          <span>•</span>
          <a href="https://kubernetes.io/docs/" target="_blank" rel="noopener noreferrer">
            Documentation
          </a>
        </p>
      </div>
    </div>
  )
}
