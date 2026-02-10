/**
 * 3D Chart Components using Three.js / react-three-fiber
 * Beautiful, interactive 3D visualizations for SQL query results
 */
import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, RoundedBox, Html, Float } from '@react-three/drei'
import * as THREE from 'three'

// Helper to get CSS variable values for theme-aware styling
function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Hook to get theme-aware chart colors
function useChartTheme() {
  const [theme, setTheme] = useState(() => ({
    chartBg: getCSSVar('--chart-bg') || 'linear-gradient(180deg, #0f172a 0%, #020617 100%)',
    legendBg: getCSSVar('--chart-legend-bg') || 'rgba(15, 23, 42, 0.5)',
    legendBorder: getCSSVar('--chart-legend-border') || 'rgba(148, 163, 184, 0.2)',
    legendText: getCSSVar('--chart-legend-text') || '#94a3b8',
    legendTextHover: getCSSVar('--chart-legend-text-hover') || '#e2e8f0',
    legendValue: getCSSVar('--chart-legend-value') || '#64748b',
    buttonBg: getCSSVar('--chart-button-bg') || 'rgba(15, 23, 42, 0.6)',
    labelBg: getCSSVar('--chart-label-bg') || 'rgba(15, 23, 42, 0.85)',
    gridPrimary: getCSSVar('--chart-grid-primary') || '#1e293b',
    gridSecondary: getCSSVar('--chart-grid-secondary') || '#0f172a',
    isDark: document.documentElement.getAttribute('data-theme') !== 'light',
  }))

  useEffect(() => {
    const updateTheme = () => {
      setTheme({
        chartBg: getCSSVar('--chart-bg') || 'linear-gradient(180deg, #0f172a 0%, #020617 100%)',
        legendBg: getCSSVar('--chart-legend-bg') || 'rgba(15, 23, 42, 0.5)',
        legendBorder: getCSSVar('--chart-legend-border') || 'rgba(148, 163, 184, 0.2)',
        legendText: getCSSVar('--chart-legend-text') || '#94a3b8',
        legendTextHover: getCSSVar('--chart-legend-text-hover') || '#e2e8f0',
        legendValue: getCSSVar('--chart-legend-value') || '#64748b',
        buttonBg: getCSSVar('--chart-button-bg') || 'rgba(15, 23, 42, 0.6)',
        labelBg: getCSSVar('--chart-label-bg') || 'rgba(15, 23, 42, 0.85)',
        gridPrimary: getCSSVar('--chart-grid-primary') || '#1e293b',
        gridSecondary: getCSSVar('--chart-grid-secondary') || '#0f172a',
        isDark: document.documentElement.getAttribute('data-theme') !== 'light',
      })
    }

    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          updateTheme()
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])

  return theme
}

// Fullscreen button component - expands chart to fill browser window
function FullscreenButton({ 
  containerRef, 
  onExpandChange,
  initialExpanded = false
}: { 
  containerRef: React.RefObject<HTMLDivElement>
  onExpandChange?: (expanded: boolean) => void
  initialExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const hasInitialized = useRef(false)
  
  // Apply initial fullscreen state on mount
  useEffect(() => {
    if (initialExpanded && !hasInitialized.current && containerRef.current) {
      hasInitialized.current = true
      // Expand to fill viewport
      containerRef.current.style.position = 'fixed'
      containerRef.current.style.top = '0'
      containerRef.current.style.left = '0'
      containerRef.current.style.right = '0'
      containerRef.current.style.bottom = '0'
      containerRef.current.style.width = '100vw'
      containerRef.current.style.height = '100vh'
      containerRef.current.style.zIndex = '9999'
      containerRef.current.style.borderRadius = '0'
    }
  }, [initialExpanded, containerRef])
  
  const toggleExpanded = useCallback(() => {
    if (!containerRef.current) return
    
    if (!isExpanded) {
      // Expand to fill viewport
      containerRef.current.style.position = 'fixed'
      containerRef.current.style.top = '0'
      containerRef.current.style.left = '0'
      containerRef.current.style.right = '0'
      containerRef.current.style.bottom = '0'
      containerRef.current.style.width = '100vw'
      containerRef.current.style.height = '100vh'
      containerRef.current.style.zIndex = '9999'
      containerRef.current.style.borderRadius = '0'
      setIsExpanded(true)
      onExpandChange?.(true)
    } else {
      // Restore original size
      containerRef.current.style.position = 'relative'
      containerRef.current.style.top = ''
      containerRef.current.style.left = ''
      containerRef.current.style.right = ''
      containerRef.current.style.bottom = ''
      containerRef.current.style.width = '100%'
      containerRef.current.style.height = '100%'
      containerRef.current.style.zIndex = ''
      containerRef.current.style.borderRadius = ''
      setIsExpanded(false)
      onExpandChange?.(false)
    }
  }, [containerRef, isExpanded, onExpandChange])
  
  // ESC key to exit expanded mode, 'f' key to toggle fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      if (e.key === 'Escape' && isExpanded) {
        toggleExpanded()
      } else if (e.key === 'f' || e.key === 'F') {
        toggleExpanded()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isExpanded, toggleExpanded])
  
  return (
    <button
      onClick={toggleExpanded}
      title={isExpanded ? 'Exit fullscreen (ESC or F)' : 'Fullscreen (F)'}
      style={{
        position: 'absolute',
        bottom: '12px',
        right: '12px',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.6)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        borderRadius: '4px',
        color: '#94a3b8',
        cursor: 'pointer',
        zIndex: 100,
        transition: 'all 0.15s ease',
        fontSize: '16px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(99, 102, 241, 0.3)'
        e.currentTarget.style.color = '#e2e8f0'
        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(15, 23, 42, 0.6)'
        e.currentTarget.style.color = '#94a3b8'
        e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.2)'
      }}
    >
      {isExpanded ? '✕' : '⛶'}
    </button>
  )
}

// Chart title/description overlay - positioned in top-left corner
function ChartHeader({ title, description, isFullscreen, isDark = true }: { title?: string; description?: string; isFullscreen?: boolean; isDark?: boolean }) {
  if (!title && !description) return null
  
  return (
    <div style={{
      position: 'absolute',
      top: isFullscreen ? '140px' : '16px',
      left: '16px',
      maxWidth: '45%',
      zIndex: 10,
      pointerEvents: 'none',
      transition: 'top 0.2s ease',
    }}>
      {title && (
        <div style={{
          color: isDark ? '#e2e8f0' : '#1e293b',
          fontSize: '16px',
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textShadow: isDark ? '0 2px 4px rgba(0,0,0,0.5)' : '0 1px 2px rgba(255,255,255,0.8)',
          marginBottom: description ? '4px' : 0,
        }}>
          {title}
        </div>
      )}
      {description && (
        <div style={{
          color: isDark ? '#94a3b8' : '#475569',
          fontSize: '12px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textShadow: isDark ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
          lineHeight: 1.4,
        }}>
          {description}
        </div>
      )}
    </div>
  )
}

// Simple 3D label using HTML overlay (works on file:// protocol)
// Uses zIndexRange to control depth sorting - labels with higher z appear on top
function Label3D({ 
  position, 
  children, 
  fontSize = 12, 
  color = '#e2e8f0',
  occlude = true,
  background = false,
  style = {},
  isDark = true,
}: { 
  position: [number, number, number]
  children: React.ReactNode
  fontSize?: number
  color?: string
  occlude?: boolean
  background?: boolean
  style?: React.CSSProperties
  isDark?: boolean
}) {
  return (
    <Html 
      position={position} 
      center 
      // Use raycast occlusion - properly hides when geometry is in front
      occlude={occlude ? "raycast" : undefined}
      style={{ pointerEvents: 'none' }}
      // zIndexRange for depth sorting between labels
      zIndexRange={[100, 0]}
    >
      <div style={{
        color,
        fontSize: `${fontSize}px`,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 600,
        textShadow: isDark 
          ? '0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5)'
          : '0 1px 2px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.7)',
        whiteSpace: 'nowrap',
        ...(background ? {
          background: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.95)',
          padding: '2px 6px',
          borderRadius: '4px',
          border: isDark ? '1px solid rgba(148, 163, 184, 0.3)' : '1px solid rgba(0, 0, 0, 0.15)',
        } : {}),
        ...style
      }}>
        {children}
      </div>
    </Html>
  )
}

// 3D Sprite-based label that properly participates in depth testing
// This is rendered as actual 3D geometry so it gets occluded correctly by other meshes
function SpriteLabel3D({ 
  position, 
  children, 
  fontSize = 14, 
  color = '#ffffff',
  background = false,
  backgroundColor,
  scale = 1,
  isDark = true,
}: { 
  position: [number, number, number]
  children: React.ReactNode
  fontSize?: number
  color?: string
  background?: boolean
  backgroundColor?: string
  scale?: number
  isDark?: boolean
}) {
  const spriteRef = useRef<THREE.Sprite>(null)
  const text = String(children)
  
  // Use theme-aware default background color
  const bgColor = backgroundColor || (isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.95)')
  const borderColor = isDark ? 'rgba(148, 163, 184, 0.3)' : 'rgba(0, 0, 0, 0.15)'
  
  // Create canvas texture for the label
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    // Set up font for measuring
    const fontWeight = '600'
    const fontFamily = 'system-ui, -apple-system, sans-serif'
    ctx.font = `${fontWeight} ${fontSize * 4}px ${fontFamily}`
    
    // Measure text
    const metrics = ctx.measureText(text)
    const textWidth = metrics.width
    const textHeight = fontSize * 4 * 1.4
    
    // Add padding for background
    const paddingX = background ? 24 : 8
    const paddingY = background ? 16 : 8
    
    canvas.width = textWidth + paddingX * 2
    canvas.height = textHeight + paddingY * 2
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw background if needed
    if (background) {
      ctx.fillStyle = bgColor
      ctx.beginPath()
      const radius = 16
      // Use roundRect if available, otherwise draw regular rect
      if (ctx.roundRect) {
        ctx.roundRect(0, 0, canvas.width, canvas.height, radius)
      } else {
        // Fallback for older browsers
        ctx.rect(0, 0, canvas.width, canvas.height)
      }
      ctx.fill()
      
      // Border
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 4
      ctx.stroke()
    }
    
    // Draw text
    ctx.font = `${fontWeight} ${fontSize * 4}px ${fontFamily}`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [text, fontSize, color, background, bgColor, borderColor])
  
  // Calculate sprite scale based on canvas size
  const spriteScale = useMemo(() => {
    const baseScale = 0.01 * scale
    return [texture.image.width * baseScale, texture.image.height * baseScale, 1] as [number, number, number]
  }, [texture, scale])
  
  return (
    <sprite ref={spriteRef} position={position} scale={spriteScale}>
      <spriteMaterial 
        map={texture} 
        transparent 
        depthTest={true}
        depthWrite={false}
        sizeAttenuation={true}
      />
    </sprite>
  )
}

// Color palette for charts - stage-specific colors
const STAGE_COLORS: Record<string, string> = {
  stable: '#10b981',
  beta: '#f59e0b',
  alpha: '#8b5cf6',
}

export interface ChartDataPoint {
  label: string
  value: number
  color: string
}

export interface GroupedChartData {
  label: string
  groups: { name: string; value: number; color: string }[]
}

// Auto-rotate wrapper for gentle spinning animation (pauses when something is hovered)
function AutoRotate({ children, speed = 0.03, paused = false }: { children: React.ReactNode, speed?: number, paused?: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  
  useFrame((_, delta) => {
    if (groupRef.current && !paused) {
      groupRef.current.rotation.y += delta * speed
    }
  })
  
  return <group ref={groupRef}>{children}</group>
}

// Animated 3D Bar without label (for grouped charts where label is shown once per group)
function Bar3DNoLabel({ 
  position, 
  height, 
  color, 
  value,
  groupName,
  isDark = true,
}: { 
  position: [number, number, number]
  height: number
  color: string
  value: number
  groupName?: string
  isDark?: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const [animatedHeight, setAnimatedHeight] = useState(0)
  
  useFrame((_, delta) => {
    if (animatedHeight < height) {
      setAnimatedHeight(Math.min(animatedHeight + delta * 3, height))
    }
  })
  
  useFrame(() => {
    if (meshRef.current) {
      const targetScale = hovered ? 1.05 : 1
      meshRef.current.scale.x = THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.1)
      meshRef.current.scale.z = THREE.MathUtils.lerp(meshRef.current.scale.z, targetScale, 0.1)
    }
  })
  
  const barHeight = Math.max(0.1, animatedHeight)
  
  return (
    <group position={position}>
      <Float speed={hovered ? 2 : 0} rotationIntensity={0} floatIntensity={hovered ? 0.1 : 0}>
        <RoundedBox
          ref={meshRef}
          args={[0.6, barHeight, 0.6]}
          radius={0.05}
          smoothness={4}
          position={[0, barHeight / 2, 0]}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
        >
          <meshStandardMaterial
            color={color}
            metalness={0.3}
            roughness={0.4}
            emissive={color}
            emissiveIntensity={hovered ? 0.3 : 0.1}
          />
        </RoundedBox>
      </Float>
      
      {/* Value label on top - using sprite for proper depth testing */}
      {(animatedHeight > 0.05 || hovered) && (
        <SpriteLabel3D position={[0, barHeight + 0.4, 0]} fontSize={11} color={isDark ? '#ffffff' : '#1e293b'} background={true} scale={0.5} isDark={isDark}>
          {value.toLocaleString()}
        </SpriteLabel3D>
      )}
      
      {/* Group name tooltip on hover */}
      {hovered && groupName && (
        <SpriteLabel3D position={[0, barHeight + 0.8, 0]} fontSize={10} color={isDark ? '#94a3b8' : '#475569'} background={true} scale={0.45} isDark={isDark}>
          {groupName}
        </SpriteLabel3D>
      )}
      
      {hovered && (
        <pointLight position={[0, barHeight / 2, 0]} color={color} intensity={0.5} distance={2} />
      )}
    </group>
  )
}

// Animated 3D Bar with external hover control
function Bar3D({ 
  position, 
  height, 
  color, 
  value,
  isHovered,
  onHover,
  isDark = true,
}: { 
  position: [number, number, number]
  height: number
  color: string
  value: number
  isHovered?: boolean
  onHover?: (hovered: boolean) => void
  isDark?: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [localHovered, setLocalHovered] = useState(false)
  const [animatedHeight, setAnimatedHeight] = useState(0)
  
  // Use external hover state if provided, otherwise use local
  const hovered = isHovered !== undefined ? isHovered : localHovered
  
  // Animate height on mount
  useFrame((_, delta) => {
    if (animatedHeight < height) {
      setAnimatedHeight(Math.min(animatedHeight + delta * 3, height))
    }
  })
  
  // Hover animation
  useFrame(() => {
    if (meshRef.current) {
      const targetScale = hovered ? 1.05 : 1
      meshRef.current.scale.x = THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.1)
      meshRef.current.scale.z = THREE.MathUtils.lerp(meshRef.current.scale.z, targetScale, 0.1)
    }
  })
  
  const barHeight = Math.max(0.1, animatedHeight)
  
  const handlePointerOver = () => {
    setLocalHovered(true)
    onHover?.(true)
  }
  
  const handlePointerOut = () => {
    setLocalHovered(false)
    onHover?.(false)
  }
  
  return (
    <group position={position}>
      {/* Bar */}
      <Float speed={hovered ? 2 : 0} rotationIntensity={0} floatIntensity={hovered ? 0.1 : 0}>
        <RoundedBox
          ref={meshRef}
          args={[0.6, barHeight, 0.6]}
          radius={0.05}
          smoothness={4}
          position={[0, barHeight / 2, 0]}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <meshStandardMaterial
            color={color}
            metalness={0.3}
            roughness={0.4}
            emissive={color}
            emissiveIntensity={hovered ? 0.3 : 0.1}
          />
        </RoundedBox>
      </Float>
      
      {/* Value label on top - can be occluded */}
      {animatedHeight > 0.05 && (
        <Label3D position={[0, barHeight + 0.3, 0]} fontSize={14} color={isDark ? '#e2e8f0' : '#1e293b'} isDark={isDark}>
          {value.toLocaleString()}
        </Label3D>
      )}
      
      {/* Glow effect when hovered */}
      {hovered && (
        <pointLight position={[0, barHeight / 2, 0]} color={color} intensity={0.5} distance={2} />
      )}
    </group>
  )
}

// 3D Bar Chart
export function BarChart3D({ data, title, description, initialFullscreen, onFullscreenChange }: { data: ChartDataPoint[]; title?: string; description?: string; initialFullscreen?: boolean; onFullscreenChange?: (fs: boolean) => void }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen || false)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  const maxValue = Math.max(...data.map(d => d.value), 1)
  const maxHeight = 5
  
  const handleFullscreenChange = useCallback((fs: boolean) => {
    setIsFullscreen(fs)
    onFullscreenChange?.(fs)
  }, [onFullscreenChange])
  
  // Calculate positions to center the chart
  const spacing = 1.2
  const totalWidth = (data.length - 1) * spacing
  const startX = -totalWidth / 2
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}>
      <ChartHeader title={title} description={description} isFullscreen={isFullscreen} isDark={theme.isDark} />
      <FullscreenButton containerRef={containerRef} onExpandChange={handleFullscreenChange} initialExpanded={initialFullscreen} />
      <Canvas
        camera={{ position: [0, 4, 10], fov: 50 }}
        style={{ background: theme.chartBg, position: 'relative', zIndex: 1 }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <directionalLight position={[-10, 10, -5]} intensity={0.3} color="#6366f1" />
        
        {/* Floor grid - shifted down */}
        <gridHelper args={[20, 20, theme.gridPrimary, theme.gridSecondary]} position={[0, -2, 0]} />
        
        {/* Bars with gentle rotation - shifted down */}
        <group position={[0, -2, 0]}>
        <AutoRotate speed={0.02} paused={hoveredIndex !== null}>
          {data.slice(0, 20).map((d, i) => (
            <Bar3D
              key={i}
              position={[startX + i * spacing, 0, 0]}
              height={(d.value / maxValue) * maxHeight}
              color={d.color}
              value={d.value}
              isHovered={hoveredIndex === i}
              onHover={(hovered) => setHoveredIndex(hovered ? i : null)}
              isDark={theme.isDark}
            />
          ))}
          
          {/* X-axis labels in front of bars */}
          {data.slice(0, 20).map((d, i) => {
            const x = startX + i * spacing
            return (
              <Label3D
                key={`xlabel-${i}`}
                position={[x, 0.1, 1.2]}
                fontSize={10}
                color={theme.legendText}
                occlude={true}
                isDark={theme.isDark}
              >
                {d.label.length > 8 ? d.label.slice(0, 8) + '…' : d.label}
              </Label3D>
            )
          })}
        </AutoRotate>
        </group>
        
        <OrbitControls
          enablePan={false}
          minDistance={5}
          maxDistance={20}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>
      
      {/* Legend outside Canvas */}
      <div style={{
        position: 'absolute',
        top: isFullscreen ? '140px' : '20px',
        right: '20px',
        maxHeight: isFullscreen ? 'calc(100% - 160px)' : 'calc(100% - 40px)',
        overflowY: 'auto',
        background: theme.legendBg,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.legendBorder}`,
        backdropFilter: 'blur(8px)',
        minWidth: '160px',
        zIndex: 10,
        transition: 'top 0.2s ease, max-height 0.2s ease',
      }}>
        {data.slice(0, 20).map((d, i) => (
          <div 
            key={i} 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: i < Math.min(data.length, 20) - 1 ? '4px' : 0,
              padding: '3px 4px',
              borderRadius: '4px',
              background: hoveredIndex === i ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              transition: 'background 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '2px',
              background: d.color,
              flexShrink: 0,
              boxShadow: hoveredIndex === i ? `0 0 8px ${d.color}` : 'none',
              transition: 'box-shadow 0.15s ease',
            }} />
            <span style={{
              color: hoveredIndex === i ? theme.legendTextHover : theme.legendText,
              fontSize: '10px',
              fontFamily: 'system-ui, sans-serif',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: hoveredIndex === i ? 500 : 400,
              transition: 'color 0.15s ease, font-weight 0.15s ease',
            }}>
              {d.label}
            </span>
            <span style={{
              color: hoveredIndex === i ? theme.legendTextHover : theme.legendValue,
              fontSize: '10px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s ease',
            }}>
              {d.value.toLocaleString()}
            </span>
          </div>
        ))}
        {data.length > 20 && (
          <div style={{
            color: theme.legendValue,
            fontSize: '10px',
            fontStyle: 'italic',
            marginTop: '8px',
            textAlign: 'center',
          }}>
            +{data.length - 20} more...
          </div>
        )}
      </div>
    </div>
  )
}

// Pie segment with external hover state
function PieSegment3DControlled({
  startAngle,
  endAngle,
  color,
  label,
  value,
  isHovered,
  onHover,
  innerRadius = 1.5,
  outerRadius = 3,
  height = 0.8,
  isDark = true,
}: {
  startAngle: number
  endAngle: number
  color: string
  label: string
  value: number
  isHovered: boolean
  onHover: (hovered: boolean) => void
  innerRadius?: number
  outerRadius?: number
  height?: number
  isDark?: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  
  // Create donut segment geometry
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    const segments = 32
    
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / segments)
      const x = Math.cos(angle) * outerRadius
      const y = Math.sin(angle) * outerRadius
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    }
    
    for (let i = segments; i >= 0; i--) {
      const angle = startAngle + (endAngle - startAngle) * (i / segments)
      const x = Math.cos(angle) * innerRadius
      const y = Math.sin(angle) * innerRadius
      shape.lineTo(x, y)
    }
    
    shape.closePath()
    
    return new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 3,
    })
  }, [startAngle, endAngle, innerRadius, outerRadius, height])
  
  // Hover animation - lift the entire group (slice + labels together)
  useFrame(() => {
    if (groupRef.current) {
      const targetY = isHovered ? 0.3 : 0
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, targetY, 0.1)
    }
  })
  
  // Label position - on top of the slice
  // The mesh is rotated -90° on X, so we need to calculate position in world space
  const midAngle = (startAngle + endAngle) / 2
  const labelRadius = (innerRadius + outerRadius) / 2
  // After -90° X rotation: X stays X, Y becomes Z (negative)
  const labelX = Math.cos(midAngle) * labelRadius
  const labelZ = -Math.sin(midAngle) * labelRadius
  
  // Check if slice is big enough to show count (> 3% of circle)
  const angleSpan = endAngle - startAngle
  const showCount = angleSpan > (Math.PI * 2 * 0.03)
  
  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true) }}
        onPointerOut={(e) => { e.stopPropagation(); onHover(false) }}
      >
        <meshStandardMaterial
          color={color}
          metalness={0.4}
          roughness={0.3}
          emissive={color}
          emissiveIntensity={isHovered ? 0.5 : 0.15}
        />
      </mesh>
      
      {/* Show label on the slice when hovered */}
      {isHovered && (
        <Label3D position={[labelX, height + 0.5, labelZ]} fontSize={13} color={isDark ? '#ffffff' : '#1e293b'} occlude={false} isDark={isDark}>
          {label}
        </Label3D>
      )}
      
      {/* Show count on slice */}
      {showCount && (
        <Label3D position={[labelX, height + 0.2, labelZ]} fontSize={16} color={isDark ? '#ffffff' : '#1e293b'} occlude={false} isDark={isDark}>
          {value.toLocaleString()}
        </Label3D>
      )}
      
      {isHovered && (
        <pointLight position={[labelX, height / 2, labelZ]} color={color} intensity={0.8} distance={3} />
      )}
    </group>
  )
}

// Inner 3D scene component that can use hover state
function PieChart3DScene({ 
  segments, 
  total, 
  hoveredIndex, 
  setHoveredIndex,
  isDark = true,
}: { 
  segments: Array<ChartDataPoint & { startAngle: number; endAngle: number; percentage: number; index: number }>
  total: number
  hoveredIndex: number | null
  setHoveredIndex: (index: number | null) => void
  isDark?: boolean
}) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <directionalLight position={[-5, 5, -5]} intensity={0.3} color="#8b5cf6" />
      
      <AutoRotate speed={0.025} paused={hoveredIndex !== null}>
        {segments.map((seg, i) => (
          <PieSegment3DControlled
            key={i}
            startAngle={seg.startAngle}
            endAngle={seg.endAngle}
            color={seg.color}
            label={seg.label}
            value={seg.value}
            isHovered={hoveredIndex === i}
            onHover={(hovered) => setHoveredIndex(hovered ? i : null)}
            isDark={isDark}
          />
        ))}
        
        <Label3D position={[0, 0.5, 0]} fontSize={22} color={isDark ? '#e2e8f0' : '#1e293b'} occlude={false} isDark={isDark}>
          {total.toLocaleString()}
        </Label3D>
        <Label3D position={[0, 0.1, 0]} fontSize={12} color={isDark ? '#64748b' : '#475569'} occlude={false} isDark={isDark}>
          total
        </Label3D>
      </AutoRotate>
      
      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={15}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.5}
      />
      
      
    </>
  )
}

// 3D Pie/Donut Chart
export function PieChart3D({ data, title, description, initialFullscreen, onFullscreenChange }: { data: ChartDataPoint[]; title?: string; description?: string; initialFullscreen?: boolean; onFullscreenChange?: (fs: boolean) => void }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen || false)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  const total = data.reduce((sum, d) => sum + d.value, 0)
  
  const handleFullscreenChange = useCallback((fs: boolean) => {
    setIsFullscreen(fs)
    onFullscreenChange?.(fs)
  }, [onFullscreenChange])
  
  // Sort by value descending, show top 11 + "Other" if more than 12 items
  const sortedData = [...data].sort((a, b) => b.value - a.value)
  
  let displayData: ChartDataPoint[]
  if (sortedData.length <= 12) {
    displayData = sortedData
  } else {
    // Take top 11, combine rest into "Other"
    const top11 = sortedData.slice(0, 11)
    const otherValue = sortedData.slice(11).reduce((sum, d) => sum + d.value, 0)
    displayData = [
      ...top11,
      { label: `Other (${sortedData.length - 11})`, value: otherValue, color: '#475569' }
    ]
  }
  
  // Calculate angles for each segment
  let currentAngle = -Math.PI / 2
  const segments = displayData.map((d, i) => {
    const angle = total > 0 ? (d.value / total) * Math.PI * 2 : 0
    const segment = {
      ...d,
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
      percentage: total > 0 ? (d.value / total) * 100 : 0,
      index: i,
    }
    currentAngle += angle
    return segment
  })
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}>
      <ChartHeader title={title} description={description} isFullscreen={isFullscreen} isDark={theme.isDark} />
      <FullscreenButton containerRef={containerRef} onExpandChange={handleFullscreenChange} initialExpanded={initialFullscreen} />
      <Canvas
        camera={{ position: [0, 6, 8], fov: 50 }}
        style={{ background: theme.chartBg, position: 'relative', zIndex: 1 }}
      >
        <PieChart3DScene 
          segments={segments} 
          total={total} 
          hoveredIndex={hoveredIndex}
          setHoveredIndex={setHoveredIndex}
          isDark={theme.isDark}
        />
      </Canvas>
      
      {/* Fixed legend outside Canvas */}
      <div style={{
        position: 'absolute',
        top: isFullscreen ? '140px' : '20px',
        right: '20px',
        maxHeight: isFullscreen ? 'calc(100% - 160px)' : 'calc(100% - 40px)',
        overflowY: 'auto',
        background: theme.legendBg,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.legendBorder}`,
        backdropFilter: 'blur(8px)',
        minWidth: '160px',
        zIndex: 10,
        transition: 'top 0.2s ease, max-height 0.2s ease',
      }}>
        {segments.slice(0, 12).map((seg, i) => (
          <div 
            key={i} 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: i < Math.min(segments.length, 12) - 1 ? '4px' : 0,
              padding: '3px 4px',
              borderRadius: '4px',
              background: hoveredIndex === i ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              transition: 'background 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '2px',
              background: seg.color,
              flexShrink: 0,
              boxShadow: hoveredIndex === i ? `0 0 8px ${seg.color}` : 'none',
              transition: 'box-shadow 0.15s ease',
            }} />
            <span style={{
              color: hoveredIndex === i ? theme.legendTextHover : theme.legendText,
              fontSize: '10px',
              fontFamily: 'system-ui, sans-serif',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: hoveredIndex === i ? 500 : 400,
              transition: 'color 0.15s ease, font-weight 0.15s ease',
            }}>
              {seg.label}
            </span>
            <span style={{
              color: hoveredIndex === i ? theme.legendTextHover : theme.legendValue,
              fontSize: '10px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s ease',
            }}>
              {seg.value.toLocaleString()}
            </span>
          </div>
        ))}
        {segments.length > 12 && (
          <div style={{
            color: theme.legendValue,
            fontSize: '10px',
            fontStyle: 'italic',
            marginTop: '8px',
            textAlign: 'center',
          }}>
            +{segments.length - 12} more...
          </div>
        )}
      </div>
    </div>
  )
}


// Camera-facing label that only shows when the label is facing the camera
function CameraFacingLabel3D({ 
  position, 
  children, 
  fontSize = 12, 
  color = '#e2e8f0',
  isDark = true,
}: { 
  position: [number, number, number]
  children: React.ReactNode
  fontSize?: number
  color?: string
  isDark?: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [visible, setVisible] = useState(true)
  
  useFrame(({ camera }) => {
    if (groupRef.current) {
      // Get the label's world position
      const labelWorldPos = new THREE.Vector3()
      groupRef.current.getWorldPosition(labelWorldPos)
      
      // Get the label's forward direction in world space (local +Z transformed)
      const labelForward = new THREE.Vector3(0, 0, 1)
      labelForward.applyQuaternion(groupRef.current.getWorldQuaternion(new THREE.Quaternion()))
      
      // Vector from label to camera
      const labelToCamera = new THREE.Vector3().subVectors(camera.position, labelWorldPos).normalize()
      
      // If the label's forward direction points toward the camera (dot > 0), it's visible
      const dot = labelForward.dot(labelToCamera)
      const shouldBeVisible = dot > 0
      
      if (shouldBeVisible !== visible) {
        setVisible(shouldBeVisible)
      }
    }
  })
  
  // Always render the group so ref stays valid, just hide the content
  return (
    <group ref={groupRef}>
      {visible && (
        <Html 
          position={position} 
          center 
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div style={{
            color,
            fontSize: `${fontSize}px`,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 600,
            textShadow: isDark 
              ? '0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5)'
              : '0 1px 2px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.7)',
            whiteSpace: 'nowrap',
          }}>
            {children}
          </div>
        </Html>
      )}
    </group>
  )
}

// 3D Stacked Bar Chart
export function StackedBarChart3D({ 
  data,
  title,
  description,
  initialFullscreen,
  onFullscreenChange,
}: { 
  data: GroupedChartData[]
  orientation?: 'horizontal' | 'vertical'
  title?: string
  description?: string
  initialFullscreen?: boolean
  onFullscreenChange?: (fs: boolean) => void
}) {
  const [hoveredBar, setHoveredBar] = useState<{ groupIndex: number; segmentIndex: number } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen || false)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  
  const handleFullscreenChange = useCallback((fs: boolean) => {
    setIsFullscreen(fs)
    onFullscreenChange?.(fs)
  }, [onFullscreenChange])
  
  // Calculate max stacked value (sum of all groups per label)
  const stackedTotals = data.map(d => d.groups.reduce((sum, g) => sum + g.value, 0))
  const maxValue = Math.max(...stackedTotals, 1)
  const maxHeight = 5
  
  const spacing = 1.5
  const totalWidth = (data.length - 1) * spacing
  const startX = -totalWidth / 2
  
  // Get unique group names for legend
  const groupNames = data.length > 0 ? data[0].groups.map(g => g.name) : []
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}>
      <ChartHeader title={title} description={description} isFullscreen={isFullscreen} isDark={theme.isDark} />
      <FullscreenButton containerRef={containerRef} onExpandChange={handleFullscreenChange} initialExpanded={initialFullscreen} />
      <Canvas
        camera={{ position: [0, 4, 12], fov: 50 }}
        style={{ background: theme.chartBg, position: 'relative', zIndex: 1 }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <directionalLight position={[-10, 10, -5]} intensity={0.3} color="#6366f1" />
        
        {/* Floor grid - shifted down */}
        <gridHelper args={[30, 30, theme.gridPrimary, theme.gridSecondary]} position={[0, -2, 0]} />
        
        {/* Stacked bars with gentle rotation - shifted down */}
        <group position={[0, -2, 0]}>
        <AutoRotate speed={0.02} paused={hoveredBar !== null}>
          {data.slice(0, 15).map((group, gi) => {
            const barX = startX + gi * spacing
            let currentHeight = 0
            const totalHeight = group.groups.reduce((sum, g) => sum + (g.value / maxValue) * maxHeight, 0)
            
            return (
              <group key={gi} position={[barX, 0, 0]}>
                {/* Label in front of bar - only visible when facing camera */}
                <CameraFacingLabel3D position={[0, 0.1, 1.2]} fontSize={11} color={theme.legendText} isDark={theme.isDark}>
                  {group.label.length > 10 ? group.label.slice(0, 10) + '…' : group.label}
                </CameraFacingLabel3D>
                
                {/* Total value on top of bar - white color to distinguish from segment values */}
                <CameraFacingLabel3D position={[0, totalHeight + 0.3, 0.5]} fontSize={13} color={theme.isDark ? '#ffffff' : '#1e293b'} isDark={theme.isDark}>
                  {stackedTotals[gi]}
                </CameraFacingLabel3D>
                
                {/* Stacked segments */}
                {group.groups.map((bar, bi) => {
                  const barColor = STAGE_COLORS[bar.name] || bar.color
                  const segmentHeight = (bar.value / maxValue) * maxHeight
                  const yPos = currentHeight
                  currentHeight += segmentHeight
                  
                  return (
                    <StackedSegment3D
                      key={bi}
                      position={[0, yPos, 0]}
                      height={segmentHeight}
                      color={barColor}
                      value={bar.value}
                      groupName={bar.name}
                      isHovered={hoveredBar?.groupIndex === gi && hoveredBar?.segmentIndex === bi}
                      onHover={(hovered) => setHoveredBar(hovered ? { groupIndex: gi, segmentIndex: bi } : null)}
                      isDark={theme.isDark}
                    />
                  )
                })}
              </group>
            )
          })}
        </AutoRotate>
        </group>
        
        <OrbitControls
          enablePan={false}
          minDistance={6}
          maxDistance={25}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>
      
      {/* Legend outside Canvas */}
      <div style={{
        position: 'absolute',
        top: isFullscreen ? '140px' : '20px',
        right: '20px',
        background: theme.legendBg,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.legendBorder}`,
        backdropFilter: 'blur(8px)',
        zIndex: 10,
        transition: 'top 0.2s ease',
      }}>
        <div style={{
          color: theme.legendText,
          fontSize: '11px',
          fontWeight: 600,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Legend
        </div>
        {groupNames.map((name, i) => {
          const color = STAGE_COLORS[name] || data[0]?.groups[i]?.color || '#6366f1'
          return (
            <div 
              key={i} 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: i < groupNames.length - 1 ? '6px' : 0,
                padding: '4px 6px',
                borderRadius: '4px',
              }}
            >
              <div style={{
                width: '14px',
                height: '14px',
                borderRadius: '3px',
                background: color,
                flexShrink: 0,
              }} />
              <span style={{
                color: theme.legendTextHover,
                fontSize: '12px',
                fontFamily: 'system-ui, sans-serif',
              }}>
                {name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Stacked segment for 3D stacked bar chart
function StackedSegment3D({ 
  position, 
  height, 
  color, 
  value,
  groupName,
  isHovered,
  onHover,
  isDark = true,
}: { 
  position: [number, number, number]
  height: number
  color: string
  value: number
  groupName?: string
  isHovered?: boolean
  onHover?: (hovered: boolean) => void
  isDark?: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [animatedHeight, setAnimatedHeight] = useState(0)
  
  useFrame((_, delta) => {
    if (animatedHeight < height) {
      setAnimatedHeight(Math.min(animatedHeight + delta * 3, height))
    }
  })
  
  useFrame(() => {
    if (meshRef.current) {
      const targetScale = isHovered ? 1.08 : 1
      meshRef.current.scale.x = THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.1)
      meshRef.current.scale.z = THREE.MathUtils.lerp(meshRef.current.scale.z, targetScale, 0.1)
    }
  })
  
  const segmentHeight = Math.max(0.05, animatedHeight)
  
  return (
    <group position={position}>
      <RoundedBox
        ref={meshRef}
        args={[0.8, segmentHeight, 0.8]}
        radius={0.02}
        smoothness={4}
        position={[0, segmentHeight / 2, 0]}
        onPointerOver={() => onHover?.(true)}
        onPointerOut={() => onHover?.(false)}
      >
        <meshStandardMaterial
          color={color}
          metalness={0.3}
          roughness={0.4}
          emissive={color}
          emissiveIntensity={isHovered ? 0.4 : 0.1}
        />
      </RoundedBox>
      
      {/* Value label on segment - only visible on hover */}
      
      {/* Detailed label on hover */}
      {isHovered && (
        <>
          <Label3D position={[0, segmentHeight / 2 + 0.4, 0.6]} fontSize={12} color={isDark ? '#ffffff' : '#1e293b'} occlude={false} isDark={isDark}>
            {groupName}: {value.toLocaleString()}
          </Label3D>
          <pointLight position={[0, segmentHeight / 2, 0]} color={color} intensity={0.5} distance={2} />
        </>
      )}
    </group>
  )
}

// 3D Grouped Bar Chart
export function GroupedBarChart3D({ 
  data,
  title,
  description,
  initialFullscreen,
  onFullscreenChange,
}: { 
  data: GroupedChartData[]
  orientation?: 'horizontal' | 'vertical'
  title?: string
  description?: string
  initialFullscreen?: boolean
  onFullscreenChange?: (fs: boolean) => void
}) {
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen || false)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  const allValues = data.flatMap(d => d.groups.map(g => g.value))
  const maxValue = Math.max(...allValues, 1)
  const maxHeight = 5
  
  const handleFullscreenChange = useCallback((fs: boolean) => {
    setIsFullscreen(fs)
    onFullscreenChange?.(fs)
  }, [onFullscreenChange])
  
  const groupSpacing = 2
  const barSpacing = 0.7
  const totalWidth = (data.length - 1) * groupSpacing
  const startX = -totalWidth / 2
  
  // Get unique group names for legend
  const groupNames = data.length > 0 ? data[0].groups.map(g => g.name) : []
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}>
      <ChartHeader title={title} description={description} isFullscreen={isFullscreen} isDark={theme.isDark} />
      <FullscreenButton containerRef={containerRef} onExpandChange={handleFullscreenChange} initialExpanded={initialFullscreen} />
      <Canvas
        camera={{ position: [0, 4, 12], fov: 50, near: 0.1, far: 1000 }}
        style={{ background: theme.chartBg, position: 'relative', zIndex: 1 }}
        gl={{ antialias: true, depth: true }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <directionalLight position={[-10, 10, -5]} intensity={0.3} color="#6366f1" />
        
        {/* Floor grid - shifted down */}
        <gridHelper args={[30, 30, theme.gridPrimary, theme.gridSecondary]} position={[0, -2, 0]} />
        
        {/* Grouped bars with gentle rotation - shifted down */}
        <group position={[0, -2, 0]}>
        <AutoRotate speed={0.02}>
          {data.slice(0, 15).map((group, gi) => {
            const groupX = startX + gi * groupSpacing
            const groupWidth = (group.groups.length - 1) * barSpacing
            const groupStartZ = -groupWidth / 2
            
            return (
              <group key={gi} position={[groupX, 0, 0]}>
                {/* Group label (provider name) - using sprite for proper depth testing */}
                <SpriteLabel3D position={[0, 0.2, groupWidth / 2 + 1.5]} fontSize={10} color={theme.isDark ? '#e2e8f0' : '#1e293b'} background={true} scale={0.55} isDark={theme.isDark}>
                  {group.label.length > 12 ? group.label.slice(0, 12) + '…' : group.label}
                </SpriteLabel3D>
                
                {/* Bars in group - without individual labels */}
                {group.groups.map((bar, bi) => {
                  const barColor = STAGE_COLORS[bar.name] || bar.color
                  const barHeight = (bar.value / maxValue) * maxHeight
                  
                  return (
                    <Bar3DNoLabel
                      key={bi}
                      position={[0, 0, groupStartZ + bi * barSpacing]}
                      height={barHeight}
                      color={barColor}
                      value={bar.value}
                      groupName={bar.name}
                      isDark={theme.isDark}
                    />
                  )
                })}
              </group>
            )
          })}
        </AutoRotate>
        </group>
        
        <OrbitControls
          enablePan={false}
          minDistance={6}
          maxDistance={25}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>
      
      {/* Legend outside Canvas */}
      <div style={{
        position: 'absolute',
        top: isFullscreen ? '140px' : '20px',
        right: '20px',
        background: theme.legendBg,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.legendBorder}`,
        backdropFilter: 'blur(8px)',
        zIndex: 10,
        transition: 'top 0.2s ease',
      }}>
        <div style={{
          color: theme.legendText,
          fontSize: '11px',
          fontWeight: 600,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Legend
        </div>
        {groupNames.map((name, i) => {
          const color = STAGE_COLORS[name] || data[0]?.groups[i]?.color || '#6366f1'
          return (
            <div 
              key={i} 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: i < groupNames.length - 1 ? '6px' : 0,
                padding: '4px 6px',
                borderRadius: '4px',
              }}
            >
              <div style={{
                width: '14px',
                height: '14px',
                borderRadius: '3px',
                background: color,
                flexShrink: 0,
              }} />
              <span style={{
                color: theme.legendTextHover,
                fontSize: '12px',
                fontFamily: 'system-ui, sans-serif',
              }}>
                {name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 3D Line Chart with glowing path
function LinePath3D({ 
  points, 
  color = '#6366f1' 
}: { 
  points: THREE.Vector3[]
  color?: string
}) {
  return (
    <mesh>
      <tubeGeometry args={[
        new THREE.CatmullRomCurve3(points),
        64,
        0.05,
        8,
        false
      ]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.5}
        transparent
        opacity={0.8}
      />
    </mesh>
  )
}

// Data point sphere for line chart with external hover control
function DataPoint3D({
  position,
  color,
  label,
  value,
  isHovered,
  onHover,
  isDark = true,
}: {
  position: [number, number, number]
  color: string
  label: string
  value: number
  index?: number
  isHovered?: boolean
  onHover?: (hovered: boolean) => void
  isDark?: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [localHovered, setLocalHovered] = useState(false)
  
  // Use external hover state if provided, otherwise use local
  const hovered = isHovered !== undefined ? isHovered : localHovered
  
  useFrame(() => {
    if (meshRef.current) {
      const targetScale = hovered ? 1.5 : 1
      meshRef.current.scale.setScalar(
        THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.1)
      )
    }
  })
  
  const handlePointerOver = () => {
    setLocalHovered(true)
    onHover?.(true)
  }
  
  const handlePointerOut = () => {
    setLocalHovered(false)
    onHover?.(false)
  }
  
  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.8 : 0.3}
          metalness={0.5}
          roughness={0.3}
        />
      </mesh>
      
      {/* Always show value above the point */}
      <Label3D position={[0, 0.4, 0]} fontSize={12} color={isDark ? '#e2e8f0' : '#1e293b'} occlude={!hovered} isDark={isDark}>
        {value.toLocaleString()}
      </Label3D>
      
      {/* Show label on hover */}
      {hovered && (
        <>
          <Label3D position={[0, 0.7, 0]} fontSize={10} color={isDark ? '#94a3b8' : '#475569'} occlude={false} isDark={isDark}>
            {label}
          </Label3D>
          <pointLight color={color} intensity={1} distance={2} />
        </>
      )}
    </group>
  )
}

// 3D Line Chart
export function LineChart3D({ data, title, description, initialFullscreen, onFullscreenChange }: { data: ChartDataPoint[]; title?: string; description?: string; initialFullscreen?: boolean; onFullscreenChange?: (fs: boolean) => void }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen || false)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  const maxValue = Math.max(...data.map(d => d.value), 1)
  const minValue = Math.min(...data.map(d => d.value))
  const range = maxValue - minValue || 1
  const maxHeight = 4
  
  const handleFullscreenChange = useCallback((fs: boolean) => {
    setIsFullscreen(fs)
    onFullscreenChange?.(fs)
  }, [onFullscreenChange])
  
  const spacing = 1
  const totalWidth = (data.length - 1) * spacing
  const startX = -totalWidth / 2
  
  // Create points for the line
  const points = useMemo(() => {
    return data.slice(0, 30).map((d, i) => {
      const x = startX + i * spacing
      const y = ((d.value - minValue) / range) * maxHeight + 0.5
      return new THREE.Vector3(x, y, 0)
    })
  }, [data, startX, spacing, minValue, range, maxHeight])
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}>
      <ChartHeader title={title} description={description} isFullscreen={isFullscreen} isDark={theme.isDark} />
      <FullscreenButton containerRef={containerRef} onExpandChange={handleFullscreenChange} initialExpanded={initialFullscreen} />
      <Canvas
        camera={{ position: [0, 3, 10], fov: 50 }}
        style={{ background: theme.chartBg, position: 'relative', zIndex: 1 }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.6} />
        <directionalLight position={[-5, 5, 10]} intensity={0.3} color="#6366f1" />
        
        {/* Floor grid - shifted down */}
        <gridHelper args={[20, 20, theme.gridPrimary, theme.gridSecondary]} position={[0, -2, 0]} />
        
        {/* Line chart content with gentle rotation - shifted down */}
        <group position={[0, -2, 0]}>
        <AutoRotate speed={0.015} paused={hoveredIndex !== null}>
          {/* Y-axis line */}
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([startX - 0.3, 0.5, 0, startX - 0.3, maxHeight + 0.5, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#475569" />
          </line>
          
          {/* X-axis line */}
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([startX - 0.3, 0.5, 0, startX + totalWidth + 0.3, 0.5, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#475569" />
          </line>
          
          {/* Y-axis reference lines and labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = t * maxHeight + 0.5
            const value = Math.round(minValue + t * range)
            return (
              <group key={i}>
                <line>
                  <bufferGeometry>
                    <bufferAttribute
                      attach="attributes-position"
                      count={2}
                      array={new Float32Array([startX - 0.3, y, 0, startX + totalWidth + 0.3, y, 0])}
                      itemSize={3}
                    />
                  </bufferGeometry>
                  <lineBasicMaterial color={theme.gridPrimary} transparent opacity={0.5} />
                </line>
                <Label3D position={[startX - 0.6, y, 0]} fontSize={11} color={theme.legendText} occlude={false} isDark={theme.isDark}>
                  {value.toLocaleString()}
                </Label3D>
              </group>
            )
          })}
          
          {/* Line path */}
          <LinePath3D points={points} color="#6366f1" />
          
          {/* Data points */}
          {data.slice(0, 30).map((d, i) => {
            const x = startX + i * spacing
            const y = ((d.value - minValue) / range) * maxHeight + 0.5
            return (
              <DataPoint3D
                key={i}
                position={[x, y, 0]}
                color={d.color}
                label={d.label}
                value={d.value}
                index={i}
                isHovered={hoveredIndex === i}
                onHover={(hovered) => setHoveredIndex(hovered ? i : null)}
                isDark={theme.isDark}
              />
            )
          })}
          
          {/* X-axis labels - show all labels */}
          {data.slice(0, 30).map((d, i) => {
            const x = startX + i * spacing
            // Show every label if <= 15 items, otherwise show every nth
            const showLabel = data.length <= 15 || i % Math.ceil(data.length / 12) === 0
            if (!showLabel) return null
            return (
              <Label3D
                key={`xlabel-${i}`}
                position={[x, 0.15, 0.3]}
                fontSize={10}
                color={theme.legendText}
                occlude={false}
                isDark={theme.isDark}
              >
                {d.label}
              </Label3D>
            )
          })}
        </AutoRotate>
        </group>
        
        <OrbitControls
          enablePan={false}
          minDistance={5}
          maxDistance={20}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>
      
      {/* Legend outside Canvas */}
      <div style={{
        position: 'absolute',
        top: isFullscreen ? '140px' : '20px',
        right: '20px',
        maxHeight: isFullscreen ? 'calc(100% - 160px)' : 'calc(100% - 40px)',
        overflowY: 'auto',
        background: theme.legendBg,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.legendBorder}`,
        backdropFilter: 'blur(8px)',
        minWidth: '160px',
        zIndex: 10,
        transition: 'top 0.2s ease, max-height 0.2s ease',
      }}>
        {data.slice(0, 30).map((d, i) => (
          <div 
            key={i} 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: i < Math.min(data.length, 30) - 1 ? '4px' : 0,
              padding: '3px 4px',
              borderRadius: '4px',
              background: hoveredIndex === i ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              transition: 'background 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '2px',
              background: d.color,
              flexShrink: 0,
              boxShadow: hoveredIndex === i ? `0 0 8px ${d.color}` : 'none',
              transition: 'box-shadow 0.15s ease',
            }} />
            <span style={{
              color: hoveredIndex === i ? theme.legendTextHover : theme.legendText,
              fontSize: '10px',
              fontFamily: 'system-ui, sans-serif',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: hoveredIndex === i ? 500 : 400,
              transition: 'color 0.15s ease, font-weight 0.15s ease',
            }}>
              {d.label}
            </span>
            <span style={{
              color: hoveredIndex === i ? theme.legendTextHover : theme.legendValue,
              fontSize: '10px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s ease',
            }}>
              {d.value.toLocaleString()}
            </span>
          </div>
        ))}
        {data.length > 30 && (
          <div style={{
            color: theme.legendValue,
            fontSize: '10px',
            fontStyle: 'italic',
            marginTop: '8px',
            textAlign: 'center',
          }}>
            +{data.length - 30} more...
          </div>
        )}
      </div>
    </div>
  )
}

// Provider-specific colors for grouped line chart
const PROVIDER_COLORS: Record<string, string> = {
  'Amazon EKS': '#ff9900',
  'Azure AKS': '#0078d4',
  'Google GKE': '#34a853',      // Google green (more distinct from Azure blue)
  'Red Hat OpenShift': '#ee0000',
}

// 3D Grouped Line Chart - multiple lines on the same chart
export function GroupedLineChart3D({ 
  data,
  title,
  description,
  initialFullscreen,
  onFullscreenChange,
}: { 
  data: GroupedChartData[]
  title?: string
  description?: string
  initialFullscreen?: boolean
  onFullscreenChange?: (fs: boolean) => void
}) {
  const [hoveredLine, setHoveredLine] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen || false)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  
  const handleFullscreenChange = useCallback((fs: boolean) => {
    setIsFullscreen(fs)
    onFullscreenChange?.(fs)
  }, [onFullscreenChange])
  
  // Get all unique group names (providers)
  const groupNames = data.length > 0 ? data[0].groups.map(g => g.name) : []
  
  // Calculate min/max across all values
  const allValues = data.flatMap(d => d.groups.map(g => g.value))
  const maxValue = Math.max(...allValues, 1)
  const minValue = Math.min(...allValues.filter(v => v > 0), 0)
  const range = maxValue - minValue || 1
  const maxHeight = 4
  
  const spacing = 1.2
  const totalWidth = (data.length - 1) * spacing
  const startX = -totalWidth / 2
  
  // Create points for each line (provider)
  const lineData = useMemo(() => {
    return groupNames.map((groupName, gi) => {
      const color = PROVIDER_COLORS[groupName] || STAGE_COLORS[groupName] || `hsl(${gi * 60}, 70%, 50%)`
      const points = data.map((d, i) => {
        const group = d.groups.find(g => g.name === groupName)
        const value = group?.value || 0
        const x = startX + i * spacing
        const y = value > 0 ? ((value - minValue) / range) * maxHeight + 0.5 : 0.5
        return {
          position: new THREE.Vector3(x, y, 0),
          value,
          label: d.label,
          hasValue: value > 0,
        }
      })
      return { name: groupName, color, points }
    })
  }, [data, groupNames, startX, spacing, minValue, range, maxHeight])
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', isolation: 'isolate' }}>
      <ChartHeader title={title} description={description} isFullscreen={isFullscreen} isDark={theme.isDark} />
      <FullscreenButton containerRef={containerRef} onExpandChange={handleFullscreenChange} initialExpanded={initialFullscreen} />
      <Canvas
        camera={{ position: [0, 3, 12], fov: 50 }}
        style={{ background: theme.chartBg, position: 'relative', zIndex: 1 }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={0.6} />
        <directionalLight position={[-5, 5, 10]} intensity={0.3} color="#6366f1" />
        
        {/* Floor grid */}
        <gridHelper args={[25, 25, theme.gridPrimary, theme.gridSecondary]} position={[0, -2, 0]} />
        
        {/* Chart content */}
        <group position={[0, -2, 0]}>
        <AutoRotate speed={0.012} paused={hoveredLine !== null}>
          {/* Y-axis line */}
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([startX - 0.3, 0.5, 0, startX - 0.3, maxHeight + 0.5, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#475569" />
          </line>
          
          {/* X-axis line */}
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([startX - 0.3, 0.5, 0, startX + totalWidth + 0.3, 0.5, 0])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#475569" />
          </line>
          
          {/* Y-axis reference lines and labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = t * maxHeight + 0.5
            const value = Math.round(minValue + t * range)
            return (
              <group key={i}>
                <line>
                  <bufferGeometry>
                    <bufferAttribute
                      attach="attributes-position"
                      count={2}
                      array={new Float32Array([startX - 0.3, y, 0, startX + totalWidth + 0.3, y, 0])}
                      itemSize={3}
                    />
                  </bufferGeometry>
                  <lineBasicMaterial color={theme.gridPrimary} transparent opacity={0.5} />
                </line>
                <Label3D position={[startX - 0.8, y, 0]} fontSize={10} color={theme.legendText} occlude={false} isDark={theme.isDark}>
                  {value.toLocaleString()}
                </Label3D>
              </group>
            )
          })}
          
          {/* Lines for each provider */}
          {lineData.map((line, li) => {
            const isHovered = hoveredLine === line.name
            const isOtherHovered = hoveredLine !== null && hoveredLine !== line.name
            // Filter to only points with values for the line path
            const validPoints = line.points.filter(p => p.hasValue).map(p => p.position)
            
            return (
              <group key={li}>
                {/* Line path */}
                {validPoints.length > 1 && (
                  <LinePath3D 
                    points={validPoints} 
                    color={line.color}
                  />
                )}
                
                {/* Data points */}
                {line.points.map((point, pi) => {
                  if (!point.hasValue) return null
                  return (
                    <group key={pi} position={point.position.toArray()}>
                      <mesh
                        onPointerOver={() => setHoveredLine(line.name)}
                        onPointerOut={() => setHoveredLine(null)}
                      >
                        <sphereGeometry args={[isHovered ? 0.18 : 0.12, 16, 16]} />
                        <meshStandardMaterial
                          color={line.color}
                          emissive={line.color}
                          emissiveIntensity={isHovered ? 0.8 : isOtherHovered ? 0.1 : 0.3}
                          metalness={0.5}
                          roughness={0.3}
                          transparent={isOtherHovered}
                          opacity={isOtherHovered ? 0.3 : 1}
                        />
                      </mesh>
                      
                      {/* Value label on hover */}
                      {isHovered && (
                        <Label3D position={[0, 0.4, 0]} fontSize={11} color={theme.isDark ? '#ffffff' : '#1e293b'} occlude={false} background={true} isDark={theme.isDark}>
                          {point.value.toLocaleString()}
                        </Label3D>
                      )}
                    </group>
                  )
                })}
              </group>
            )
          })}
          
          {/* X-axis labels (K8s versions) */}
          {data.map((d, i) => {
            const x = startX + i * spacing
            return (
              <Label3D
                key={`xlabel-${i}`}
                position={[x, 0.1, 0.5]}
                fontSize={10}
                color={theme.legendText}
                occlude={false}
                isDark={theme.isDark}
              >
                {d.label}
              </Label3D>
            )
          })}
        </AutoRotate>
        </group>
        
        <OrbitControls
          enablePan={false}
          minDistance={5}
          maxDistance={25}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>
      
      {/* Legend */}
      <div style={{
        position: 'absolute',
        top: isFullscreen ? '140px' : '20px',
        right: '20px',
        background: theme.legendBg,
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${theme.legendBorder}`,
        backdropFilter: 'blur(8px)',
        zIndex: 10,
        transition: 'top 0.2s ease',
      }}>
        <div style={{
          color: theme.legendText,
          fontSize: '11px',
          fontWeight: 600,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Providers
        </div>
        {groupNames.map((name, i) => {
          const color = PROVIDER_COLORS[name] || STAGE_COLORS[name] || `hsl(${i * 60}, 70%, 50%)`
          const isHovered = hoveredLine === name
          return (
            <div 
              key={i} 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: i < groupNames.length - 1 ? '6px' : 0,
                padding: '4px 6px',
                borderRadius: '4px',
                background: isHovered ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={() => setHoveredLine(name)}
              onMouseLeave={() => setHoveredLine(null)}
            >
              <div style={{
                width: '14px',
                height: '3px',
                borderRadius: '2px',
                background: color,
                flexShrink: 0,
                boxShadow: isHovered ? `0 0 8px ${color}` : 'none',
              }} />
              <span style={{
                color: isHovered ? theme.legendTextHover : theme.legendText,
                fontSize: '12px',
                fontFamily: 'system-ui, sans-serif',
                fontWeight: isHovered ? 500 : 400,
              }}>
                {name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
