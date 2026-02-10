/**
 * NUMATopology3D - Interactive 3D visualization of NUMA architecture
 *
 * Renders NUMA nodes as 3D boxes with CPU cores as spheres,
 * memory bars, cache hierarchy visualization, and interconnect lines.
 * Supports policy-based allocation animation.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/visualizations
 */

import { useRef, useMemo, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type {
  NUMATopologyData,
  NUMANode,
  CPUCore,
  CacheLevel,
  NUMAInterconnect,
} from '../../../index'
import styles from './NUMATopology3D.module.css'

// =============================================================================
// Types
// =============================================================================

type TopologyPolicy = 'none' | 'static' | 'single-numa-node' | 'restricted' | 'best-effort'

interface NUMATopology3DProps {
  /** NUMA topology data */
  topology?: NUMATopologyData
  /** Selected Topology Manager policy */
  selectedPolicy?: TopologyPolicy
  /** Callback when a core is clicked */
  onCoreClick?: (nodeId: number, coreId: number) => void
  /** Whether to animate pod placement */
  animatePlacement?: boolean
}

interface HoveredElement {
  type: 'core' | 'cache' | 'memory' | 'interconnect'
  nodeId: number
  coreId?: number
  cacheLevel?: string
  data: CPUCore | CacheLevel | NUMAInterconnect | { memoryGB: number }
}

// =============================================================================
// WebGL Detection
// =============================================================================

/**
 * Check if WebGL is supported in the browser
 */
function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

// =============================================================================
// Constants
// =============================================================================


const COLORS = {
  // Core states
  coreFree: '#10b981',      // Green - available
  coreAllocated: '#3b82f6', // Blue - allocated to pod
  coreBusy: '#ef4444',      // Red - system reserved
  coreHovered: '#f59e0b',   // Amber - hovered

  // NUMA node
  nodeBox: '#6366f1',       // Indigo - node border
  nodeBoxFill: '#1e1b4b',   // Dark indigo - node fill

  // Memory
  memoryBar: '#8b5cf6',     // Purple - memory
  memoryUsed: '#a855f7',    // Lighter purple - used memory

  // Cache hierarchy
  cacheL1: '#06b6d4',       // Cyan - L1
  cacheL2: '#0ea5e9',       // Sky - L2
  cacheL3: '#3b82f6',       // Blue - L3/LLC

  // Interconnects
  interconnect: '#64748b',  // Slate - default
  interconnectHigh: '#10b981', // Green - high bandwidth
  interconnectLow: '#f59e0b',  // Amber - low bandwidth
}

// Default sample topology for demonstration
const DEFAULT_TOPOLOGY: NUMATopologyData = {
  nodes: [
    {
      id: 0,
      cpuCores: [
        { id: 0, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 1, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 2, allocated: true, podName: 'latency-app-0', l1Cache: 32, l2Cache: 256 },
        { id: 3, allocated: true, podName: 'latency-app-0', l1Cache: 32, l2Cache: 256 },
        { id: 4, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 5, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 6, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 7, allocated: false, l1Cache: 32, l2Cache: 256 },
      ],
      memoryGB: 64,
      cacheHierarchy: [
        { level: 'L1', sizeKB: 32, shared: false },
        { level: 'L2', sizeKB: 256, shared: false },
        { level: 'L3', sizeKB: 16384, shared: true, sharedWith: [0, 1, 2, 3, 4, 5, 6, 7] },
      ],
    },
    {
      id: 1,
      cpuCores: [
        { id: 8, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 9, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 10, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 11, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 12, allocated: true, podName: 'gpu-worker-0', l1Cache: 32, l2Cache: 256 },
        { id: 13, allocated: true, podName: 'gpu-worker-0', l1Cache: 32, l2Cache: 256 },
        { id: 14, allocated: false, l1Cache: 32, l2Cache: 256 },
        { id: 15, allocated: false, l1Cache: 32, l2Cache: 256 },
      ],
      memoryGB: 64,
      cacheHierarchy: [
        { level: 'L1', sizeKB: 32, shared: false },
        { level: 'L2', sizeKB: 256, shared: false },
        { level: 'L3', sizeKB: 16384, shared: true, sharedWith: [8, 9, 10, 11, 12, 13, 14, 15] },
      ],
    },
  ],
  interconnects: [
    { from: 0, to: 1, bandwidthGBps: 25.6, latencyNs: 120 },
  ],
}


// =============================================================================
// Helper Functions
// =============================================================================

function getCoreColor(core: CPUCore, isHovered: boolean): string {
  if (isHovered) return COLORS.coreHovered
  if (core.allocated) return COLORS.coreAllocated
  return COLORS.coreFree
}

function getCacheColor(level: CacheLevel['level']): string {
  switch (level) {
    case 'L1': return COLORS.cacheL1
    case 'L2': return COLORS.cacheL2
    case 'L3':
    case 'LLC': return COLORS.cacheL3
    default: return COLORS.cacheL3
  }
}

function getInterconnectColor(bandwidth: number): string {
  if (bandwidth >= 20) return COLORS.interconnectHigh
  if (bandwidth >= 10) return COLORS.interconnect
  return COLORS.interconnectLow
}

// =============================================================================
// 3D Components
// =============================================================================

/**
 * Single CPU Core rendered as a sphere
 */
function CPUCoreSphere({
  core,
  position,
  nodeId: _nodeId,
  isHovered,
  onHover,
  onClick,
}: {
  core: CPUCore
  position: [number, number, number]
  nodeId: number
  isHovered: boolean
  onHover: (hovered: boolean) => void
  onClick: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const color = getCoreColor(core, isHovered)

  useFrame((state) => {
    if (meshRef.current && (isHovered || core.allocated)) {
      const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.05 + 1
      meshRef.current.scale.setScalar(0.15 * pulse)
    }
    if (glowRef.current) {
      const glowPulse = Math.sin(state.clock.elapsedTime * 1.5) * 0.1 + 0.3
      ;(glowRef.current.material as THREE.MeshBasicMaterial).opacity = isHovered ? 0.5 : glowPulse
    }
  })

  const handlePointerOver = useCallback(() => {
    onHover(true)
    document.body.style.cursor = 'pointer'
  }, [onHover])

  const handlePointerOut = useCallback(() => {
    onHover(false)
    document.body.style.cursor = 'auto'
  }, [onHover])

  return (
    <group position={position}>
      {/* Glow effect */}
      <mesh ref={glowRef} scale={0.25}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </mesh>

      {/* Core sphere */}
      <mesh
        ref={meshRef}
        scale={0.15}
        onClick={onClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isHovered ? 0.6 : 0.3}
          roughness={0.2}
          metalness={0.8}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>

      {/* Core ID label */}
      {isHovered && (
        <Html position={[0, 0.3, 0]} center style={{ pointerEvents: 'none' }}>
          <div className={styles.coreLabel}>
            <span className={styles.coreId}>Core {core.id}</span>
            {core.allocated && core.podName && (
              <span className={styles.podName}>{core.podName}</span>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}


/**
 * Cache hierarchy visualization as concentric rings
 */
function CacheHierarchy({
  cacheHierarchy,
  position,
  nodeId: _nodeId,
  onHover,
}: {
  cacheHierarchy: CacheLevel[]
  position: [number, number, number]
  nodeId: number
  onHover: (level: CacheLevel | null) => void
}) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1
    }
  })

  // Sort by level (L1 innermost, L3/LLC outermost)
  const sortedCache = useMemo(() => {
    const order = { L1: 0, L2: 1, L3: 2, LLC: 3 }
    return [...cacheHierarchy].sort((a, b) => order[a.level] - order[b.level])
  }, [cacheHierarchy])

  return (
    <group position={position} ref={groupRef}>
      {sortedCache.map((cache, index) => {
        const innerRadius = 0.3 + index * 0.15
        const outerRadius = innerRadius + 0.1
        const color = getCacheColor(cache.level)

        return (
          <mesh
            key={cache.level}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerOver={() => onHover(cache)}
            onPointerOut={() => onHover(null)}
          >
            <ringGeometry args={[innerRadius, outerRadius, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.4}
              side={THREE.DoubleSide}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * Memory bar visualization
 */
function MemoryBar({
  memoryGB,
  position,
  nodeId: _nodeId,
  onHover,
}: {
  memoryGB: number
  position: [number, number, number]
  nodeId: number
  onHover: (hovered: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
  const barHeight = Math.min(memoryGB / 32, 2) // Scale: 32GB = 1 unit height, max 2

  const handlePointerOver = useCallback(() => {
    setHovered(true)
    onHover(true)
    document.body.style.cursor = 'pointer'
  }, [onHover])

  const handlePointerOut = useCallback(() => {
    setHovered(false)
    onHover(false)
    document.body.style.cursor = 'auto'
  }, [onHover])

  return (
    <group position={position}>
      {/* Memory bar */}
      <mesh
        position={[0, barHeight / 2, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <boxGeometry args={[0.3, barHeight, 0.3]} />
        <meshPhysicalMaterial
          color={COLORS.memoryBar}
          emissive={COLORS.memoryBar}
          emissiveIntensity={hovered ? 0.5 : 0.2}
          roughness={0.3}
          metalness={0.7}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Memory label */}
      <Html position={[0, barHeight + 0.3, 0]} center style={{ pointerEvents: 'none' }}>
        <div className={styles.memoryLabel}>
          <span className={styles.memoryValue}>{memoryGB} GB</span>
          {hovered && <span className={styles.memoryType}>DDR4</span>}
        </div>
      </Html>
    </group>
  )
}


/**
 * NUMA Node box containing cores, memory, and cache
 */
function NUMANodeBox({
  node,
  position,
  hoveredCore,
  onCoreHover,
  onCoreClick,
  onCacheHover,
  onMemoryHover,
}: {
  node: NUMANode
  position: [number, number, number]
  hoveredCore: number | null
  onCoreHover: (nodeId: number, coreId: number | null) => void
  onCoreClick: (nodeId: number, coreId: number) => void
  onCacheHover: (nodeId: number, cache: CacheLevel | null) => void
  onMemoryHover: (nodeId: number, hovered: boolean) => void
}) {
  const boxRef = useRef<THREE.Mesh>(null)
  const edgesRef = useRef<THREE.LineSegments>(null)

  // Calculate box size based on core count
  const coreCount = node.cpuCores.length
  const gridSize = Math.ceil(Math.sqrt(coreCount))
  const boxWidth = gridSize * 0.5 + 0.5
  const boxDepth = gridSize * 0.5 + 0.5
  const boxHeight = 0.8

  // Position cores in a grid
  const corePositions = useMemo(() => {
    return node.cpuCores.map((_, index) => {
      const row = Math.floor(index / gridSize)
      const col = index % gridSize
      const x = (col - (gridSize - 1) / 2) * 0.4
      const z = (row - (gridSize - 1) / 2) * 0.4
      return [x, 0.2, z] as [number, number, number]
    })
  }, [node.cpuCores.length, gridSize])

  // Create edges geometry
  const edgesGeometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth)
    return new THREE.EdgesGeometry(geo)
  }, [boxWidth, boxHeight, boxDepth])

  useFrame((state) => {
    if (edgesRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * 0.5) * 0.1 + 0.6
      ;(edgesRef.current.material as THREE.LineBasicMaterial).opacity = pulse
    }
  })

  return (
    <group position={position}>
      {/* Node label */}
      <Html position={[0, boxHeight + 0.5, 0]} center style={{ pointerEvents: 'none' }}>
        <div className={styles.nodeLabel}>
          <span className={styles.nodeName}>NUMA Node {node.id}</span>
          <span className={styles.nodeStats}>
            {node.cpuCores.length} cores • {node.memoryGB} GB
          </span>
        </div>
      </Html>

      {/* Semi-transparent box fill */}
      <mesh ref={boxRef} position={[0, boxHeight / 2, 0]}>
        <boxGeometry args={[boxWidth, boxHeight, boxDepth]} />
        <meshPhysicalMaterial
          color={COLORS.nodeBoxFill}
          transparent
          opacity={0.3}
          roughness={0.5}
          metalness={0.2}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Glowing edges */}
      <lineSegments
        ref={edgesRef}
        geometry={edgesGeometry}
        position={[0, boxHeight / 2, 0]}
      >
        <lineBasicMaterial
          color={COLORS.nodeBox}
          transparent
          opacity={0.6}
          linewidth={2}
        />
      </lineSegments>

      {/* CPU Cores */}
      {node.cpuCores.map((core, index) => (
        <CPUCoreSphere
          key={core.id}
          core={core}
          position={corePositions[index]}
          nodeId={node.id}
          isHovered={hoveredCore === core.id}
          onHover={(hovered) => onCoreHover(node.id, hovered ? core.id : null)}
          onClick={() => onCoreClick(node.id, core.id)}
        />
      ))}

      {/* Cache hierarchy (below cores) */}
      <CacheHierarchy
        cacheHierarchy={node.cacheHierarchy}
        position={[0, -0.2, 0]}
        nodeId={node.id}
        onHover={(cache) => onCacheHover(node.id, cache)}
      />

      {/* Memory bar (to the side) */}
      <MemoryBar
        memoryGB={node.memoryGB}
        position={[boxWidth / 2 + 0.4, 0, 0]}
        nodeId={node.id}
        onHover={(hovered) => onMemoryHover(node.id, hovered)}
      />
    </group>
  )
}


/**
 * Interconnect line between NUMA nodes
 */
function InterconnectLine({
  interconnect,
  startPos,
  endPos,
  onHover,
}: {
  interconnect: NUMAInterconnect
  startPos: [number, number, number]
  endPos: [number, number, number]
  onHover: (hovered: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [opacity, setOpacity] = useState(0.8)
  const color = getInterconnectColor(interconnect.bandwidthGBps)

  // Create curved path
  const points = useMemo(() => {
    const start = new THREE.Vector3(...startPos)
    const end = new THREE.Vector3(...endPos)
    const mid = start.clone().lerp(end, 0.5)
    mid.y += 0.5 // Curve upward

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    return curve.getPoints(20)
  }, [startPos, endPos])

  // Animate opacity with useFrame
  useFrame((state) => {
    const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.2 + 0.8
    setOpacity(hovered ? 1 : pulse)
  })

  const handlePointerOver = useCallback(() => {
    setHovered(true)
    onHover(true)
    document.body.style.cursor = 'pointer'
  }, [onHover])

  const handlePointerOut = useCallback(() => {
    setHovered(false)
    onHover(false)
    document.body.style.cursor = 'auto'
  }, [onHover])

  // Calculate midpoint for label
  const midPoint = useMemo(() => {
    const start = new THREE.Vector3(...startPos)
    const end = new THREE.Vector3(...endPos)
    const mid = start.clone().lerp(end, 0.5)
    mid.y += 0.7
    return [mid.x, mid.y, mid.z] as [number, number, number]
  }, [startPos, endPos])

  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={hovered ? 3 : 2}
        transparent
        opacity={opacity}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      />

      {/* Bandwidth/latency label */}
      {hovered && (
        <Html position={midPoint} center style={{ pointerEvents: 'none' }}>
          <div className={styles.interconnectLabel}>
            <span className={styles.bandwidth}>{interconnect.bandwidthGBps} GB/s</span>
            <span className={styles.latency}>{interconnect.latencyNs} ns</span>
          </div>
        </Html>
      )}
    </group>
  )
}

/**
 * Pod placement animation indicator
 */
function PodPlacementIndicator({
  position,
  podName,
  visible,
}: {
  position: [number, number, number]
  podName: string
  visible: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    if (visible) {
      setScale(0)
      const animate = () => {
        setScale((prev) => {
          if (prev >= 1) return 1
          return prev + 0.05
        })
      }
      const interval = setInterval(animate, 16)
      return () => clearInterval(interval)
    } else {
      setScale(0)
    }
  }, [visible])

  useFrame((state) => {
    if (meshRef.current && visible) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 2
    }
  })

  if (!visible || scale === 0) return null

  return (
    <group position={position}>
      <mesh ref={meshRef} scale={scale * 0.3}>
        <octahedronGeometry args={[1, 0]} />
        <meshPhysicalMaterial
          color="#f59e0b"
          emissive="#f59e0b"
          emissiveIntensity={0.5}
          transparent
          opacity={0.8}
        />
      </mesh>
      <Html position={[0, 0.5, 0]} center style={{ pointerEvents: 'none' }}>
        <div className={styles.podIndicator}>
          <span>{podName}</span>
        </div>
      </Html>
    </group>
  )
}


/**
 * Camera controller with OrbitControls
 */
function CameraController() {
  const { camera } = useThree()

  useEffect(() => {
    camera.position.set(0, 5, 8)
    camera.lookAt(0, 0, 0)
  }, [camera])

  return (
    <OrbitControls
      enablePan={true}
      enableZoom={true}
      enableRotate={true}
      minDistance={3}
      maxDistance={20}
      autoRotate={false}
      maxPolarAngle={Math.PI / 2 + 0.3}
    />
  )
}

/**
 * Main scene containing all NUMA topology elements
 */
function NUMAScene({
  topology,
  selectedPolicy,
  onCoreClick,
  onHoveredElementChange,
  animatePlacement,
}: {
  topology: NUMATopologyData
  selectedPolicy: TopologyPolicy
  onCoreClick?: (nodeId: number, coreId: number) => void
  onHoveredElementChange: (element: HoveredElement | null) => void
  animatePlacement: boolean
}) {
  const [hoveredCore, setHoveredCore] = useState<{ nodeId: number; coreId: number } | null>(null)
  const [placementAnimation, setPlacementAnimation] = useState<{
    nodeId: number
    coreIds: number[]
    podName: string
  } | null>(null)

  // Calculate node positions (spread horizontally)
  const nodePositions = useMemo(() => {
    const spacing = 4
    const totalWidth = (topology.nodes.length - 1) * spacing
    return topology.nodes.map((_, index) => {
      const x = index * spacing - totalWidth / 2
      return [x, 0, 0] as [number, number, number]
    })
  }, [topology.nodes.length])

  // Handle policy change animation
  useEffect(() => {
    if (!animatePlacement || selectedPolicy === 'none') {
      setPlacementAnimation(null)
      return
    }

    // Simulate pod placement based on policy
    const timer = setTimeout(() => {
      switch (selectedPolicy) {
        case 'single-numa-node':
          // Place all cores on node 0
          setPlacementAnimation({
            nodeId: 0,
            coreIds: [0, 1],
            podName: 'new-pod',
          })
          break
        case 'restricted':
          // Place on node with most available resources
          setPlacementAnimation({
            nodeId: 0,
            coreIds: [4, 5],
            podName: 'new-pod',
          })
          break
        case 'best-effort':
          // May spread across nodes
          setPlacementAnimation({
            nodeId: 1,
            coreIds: [8, 9],
            podName: 'new-pod',
          })
          break
        case 'static':
          // Exclusive CPU allocation
          setPlacementAnimation({
            nodeId: 0,
            coreIds: [6, 7],
            podName: 'guaranteed-pod',
          })
          break
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [selectedPolicy, animatePlacement])

  const handleCoreHover = useCallback(
    (nodeId: number, coreId: number | null) => {
      if (coreId !== null) {
        setHoveredCore({ nodeId, coreId })
        const node = topology.nodes.find((n) => n.id === nodeId)
        const core = node?.cpuCores.find((c) => c.id === coreId)
        if (core) {
          onHoveredElementChange({
            type: 'core',
            nodeId,
            coreId,
            data: core,
          })
        }
      } else {
        setHoveredCore(null)
        onHoveredElementChange(null)
      }
    },
    [topology.nodes, onHoveredElementChange]
  )

  const handleCacheHover = useCallback(
    (nodeId: number, cache: CacheLevel | null) => {
      if (cache) {
        onHoveredElementChange({
          type: 'cache',
          nodeId,
          cacheLevel: cache.level,
          data: cache,
        })
      } else {
        onHoveredElementChange(null)
      }
    },
    [onHoveredElementChange]
  )

  const handleMemoryHover = useCallback(
    (nodeId: number, hovered: boolean) => {
      if (hovered) {
        const node = topology.nodes.find((n) => n.id === nodeId)
        if (node) {
          onHoveredElementChange({
            type: 'memory',
            nodeId,
            data: { memoryGB: node.memoryGB },
          })
        }
      } else {
        onHoveredElementChange(null)
      }
    },
    [topology.nodes, onHoveredElementChange]
  )

  const handleInterconnectHover = useCallback(
    (interconnect: NUMAInterconnect, hovered: boolean) => {
      if (hovered) {
        onHoveredElementChange({
          type: 'interconnect',
          nodeId: interconnect.from,
          data: interconnect,
        })
      } else {
        onHoveredElementChange(null)
      }
    },
    [onHoveredElementChange]
  )

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={0.5} color="#ffffff" />
      <pointLight position={[-10, -10, -10]} intensity={0.3} color="#8b5cf6" />
      <pointLight position={[0, 10, 0]} intensity={0.2} color="#6366f1" />

      {/* Camera controls */}
      <CameraController />

      {/* NUMA Nodes */}
      {topology.nodes.map((node, index) => (
        <NUMANodeBox
          key={node.id}
          node={node}
          position={nodePositions[index]}
          hoveredCore={hoveredCore?.nodeId === node.id ? hoveredCore.coreId : null}
          onCoreHover={handleCoreHover}
          onCoreClick={onCoreClick || (() => {})}
          onCacheHover={handleCacheHover}
          onMemoryHover={handleMemoryHover}
        />
      ))}

      {/* Interconnects */}
      {topology.interconnects.map((interconnect, index) => {
        const fromPos = nodePositions[interconnect.from]
        const toPos = nodePositions[interconnect.to]
        if (!fromPos || !toPos) return null

        return (
          <InterconnectLine
            key={index}
            interconnect={interconnect}
            startPos={fromPos}
            endPos={toPos}
            onHover={(hovered) => handleInterconnectHover(interconnect, hovered)}
          />
        )
      })}

      {/* Pod placement animation */}
      {placementAnimation && (
        <PodPlacementIndicator
          position={nodePositions[placementAnimation.nodeId]}
          podName={placementAnimation.podName}
          visible={true}
        />
      )}
    </>
  )
}


// =============================================================================
// Tooltip Component
// =============================================================================

function Tooltip({ element }: { element: HoveredElement | null }) {
  if (!element) return null

  return (
    <div className={styles.tooltip}>
      {element.type === 'core' && (
        <>
          <div className={styles.tooltipTitle}>CPU Core {(element.data as CPUCore).id}</div>
          <div className={styles.tooltipContent}>
            <div className={styles.tooltipRow}>
              <span>Status:</span>
              <span className={(element.data as CPUCore).allocated ? styles.allocated : styles.free}>
                {(element.data as CPUCore).allocated ? 'Allocated' : 'Free'}
              </span>
            </div>
            {(element.data as CPUCore).podName && (
              <div className={styles.tooltipRow}>
                <span>Pod:</span>
                <span>{(element.data as CPUCore).podName}</span>
              </div>
            )}
            <div className={styles.tooltipRow}>
              <span>L1 Cache:</span>
              <span>{(element.data as CPUCore).l1Cache} KB</span>
            </div>
            <div className={styles.tooltipRow}>
              <span>L2 Cache:</span>
              <span>{(element.data as CPUCore).l2Cache} KB</span>
            </div>
          </div>
        </>
      )}

      {element.type === 'cache' && (
        <>
          <div className={styles.tooltipTitle}>{(element.data as CacheLevel).level} Cache</div>
          <div className={styles.tooltipContent}>
            <div className={styles.tooltipRow}>
              <span>Size:</span>
              <span>
                {(element.data as CacheLevel).sizeKB >= 1024
                  ? `${((element.data as CacheLevel).sizeKB / 1024).toFixed(0)} MB`
                  : `${(element.data as CacheLevel).sizeKB} KB`}
              </span>
            </div>
            <div className={styles.tooltipRow}>
              <span>Shared:</span>
              <span>{(element.data as CacheLevel).shared ? 'Yes' : 'No'}</span>
            </div>
            {(element.data as CacheLevel).sharedWith && (
              <div className={styles.tooltipRow}>
                <span>Shared with:</span>
                <span>Cores {(element.data as CacheLevel).sharedWith?.join(', ')}</span>
              </div>
            )}
          </div>
        </>
      )}

      {element.type === 'memory' && (
        <>
          <div className={styles.tooltipTitle}>Memory</div>
          <div className={styles.tooltipContent}>
            <div className={styles.tooltipRow}>
              <span>Capacity:</span>
              <span>{(element.data as { memoryGB: number }).memoryGB} GB</span>
            </div>
            <div className={styles.tooltipRow}>
              <span>Type:</span>
              <span>DDR4</span>
            </div>
            <div className={styles.tooltipRow}>
              <span>NUMA Local:</span>
              <span>Node {element.nodeId}</span>
            </div>
          </div>
        </>
      )}

      {element.type === 'interconnect' && (
        <>
          <div className={styles.tooltipTitle}>NUMA Interconnect</div>
          <div className={styles.tooltipContent}>
            <div className={styles.tooltipRow}>
              <span>Bandwidth:</span>
              <span>{(element.data as NUMAInterconnect).bandwidthGBps} GB/s</span>
            </div>
            <div className={styles.tooltipRow}>
              <span>Latency:</span>
              <span>{(element.data as NUMAInterconnect).latencyNs} ns</span>
            </div>
            <div className={styles.tooltipRow}>
              <span>Connection:</span>
              <span>
                Node {(element.data as NUMAInterconnect).from} ↔ Node{' '}
                {(element.data as NUMAInterconnect).to}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// =============================================================================
// Policy Selector Component
// =============================================================================

const POLICIES: { value: TopologyPolicy; label: string; description: string }[] = [
  {
    value: 'none',
    label: 'None',
    description: 'No topology alignment (default)',
  },
  {
    value: 'best-effort',
    label: 'Best Effort',
    description: 'Prefer aligned resources, but allow spreading',
  },
  {
    value: 'restricted',
    label: 'Restricted',
    description: 'Require alignment for Guaranteed QoS pods',
  },
  {
    value: 'single-numa-node',
    label: 'Single NUMA Node',
    description: 'All resources must come from one NUMA node',
  },
  {
    value: 'static',
    label: 'Static (CPU Manager)',
    description: 'Exclusive CPU allocation for Guaranteed pods',
  },
]

function PolicySelector({
  selectedPolicy,
  onPolicyChange,
}: {
  selectedPolicy: TopologyPolicy
  onPolicyChange: (policy: TopologyPolicy) => void
}) {
  return (
    <div className={styles.policySelector}>
      <div className={styles.policySelectorTitle}>Topology Policy</div>
      <div className={styles.policyOptions}>
        {POLICIES.map((policy) => (
          <button
            key={policy.value}
            className={`${styles.policyOption} ${
              selectedPolicy === policy.value ? styles.policyOptionActive : ''
            }`}
            onClick={() => onPolicyChange(policy.value)}
            title={policy.description}
          >
            <span className={styles.policyLabel}>{policy.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.policyDescription}>
        {POLICIES.find((p) => p.value === selectedPolicy)?.description}
      </div>
    </div>
  )
}


// =============================================================================
// Legend Component
// =============================================================================

function Legend() {
  return (
    <div className={styles.legend}>
      <div className={styles.legendTitle}>Legend</div>
      <div className={styles.legendItems}>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: COLORS.coreFree }} />
          <span>Free Core</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: COLORS.coreAllocated }} />
          <span>Allocated Core</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: COLORS.memoryBar }} />
          <span>Memory</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: COLORS.cacheL3 }} />
          <span>L3/LLC Cache</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: COLORS.interconnect }} />
          <span>Interconnect</span>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// 2D Fallback Component (for browsers without WebGL)
// =============================================================================

function NUMATopology2DFallback({
  topology,
  selectedPolicy,
}: {
  topology: NUMATopologyData
  selectedPolicy: TopologyPolicy
}) {
  return (
    <div className={styles.fallbackContainer}>
      <div className={styles.fallbackHeader}>
        <h3 className={styles.fallbackTitle}>NUMA Topology</h3>
        <p className={styles.fallbackSubtitle}>
          Policy: <strong>{selectedPolicy}</strong>
        </p>
      </div>

      <div className={styles.fallbackNodes}>
        {topology.nodes.map((node) => (
          <div key={node.id} className={styles.fallbackNode}>
            <div className={styles.fallbackNodeHeader}>
              <span className={styles.fallbackNodeName}>NUMA Node {node.id}</span>
              <span className={styles.fallbackNodeStats}>
                {node.cpuCores.length} cores • {node.memoryGB} GB
              </span>
            </div>

            <div className={styles.fallbackCores}>
              {node.cpuCores.map((core) => (
                <div
                  key={core.id}
                  className={`${styles.fallbackCore} ${
                    core.allocated ? styles.fallbackCoreAllocated : styles.fallbackCoreFree
                  }`}
                  title={core.allocated ? `Core ${core.id}: ${core.podName}` : `Core ${core.id}: Free`}
                >
                  {core.id}
                </div>
              ))}
            </div>

            <div className={styles.fallbackCache}>
              {node.cacheHierarchy.map((cache) => (
                <span key={cache.level} className={styles.fallbackCacheLevel}>
                  {cache.level}: {cache.sizeKB >= 1024 ? `${cache.sizeKB / 1024}MB` : `${cache.sizeKB}KB`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {topology.interconnects.length > 0 && (
        <div className={styles.fallbackInterconnects}>
          <span className={styles.fallbackInterconnectLabel}>Interconnects:</span>
          {topology.interconnects.map((ic, i) => (
            <span key={i} className={styles.fallbackInterconnect}>
              Node {ic.from} ↔ Node {ic.to} ({ic.bandwidthGBps} GB/s, {ic.latencyNs}ns)
            </span>
          ))}
        </div>
      )}

      <div className={styles.fallbackNote}>
        <p>WebGL is not available. Showing simplified 2D view.</p>
        <p>For the full 3D experience, use a browser with WebGL support.</p>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * NUMATopology3D - Interactive 3D visualization of NUMA architecture
 *
 * Renders NUMA nodes as 3D boxes with CPU cores as spheres,
 * memory bars, cache hierarchy visualization, and interconnect lines.
 * Supports policy-based allocation animation.
 * Falls back to 2D view if WebGL is not available.
 */
export function NUMATopology3D({
  topology = DEFAULT_TOPOLOGY,
  selectedPolicy: initialPolicy = 'none',
  onCoreClick,
  animatePlacement = true,
}: NUMATopology3DProps) {
  const [selectedPolicy, setSelectedPolicy] = useState<TopologyPolicy>(initialPolicy)
  const [hoveredElement, setHoveredElement] = useState<HoveredElement | null>(null)
  const [webGLSupported, setWebGLSupported] = useState<boolean | null>(null)

  // Check WebGL support on mount
  useEffect(() => {
    setWebGLSupported(isWebGLSupported())
  }, [])

  // Update policy when prop changes
  useEffect(() => {
    setSelectedPolicy(initialPolicy)
  }, [initialPolicy])

  // Show loading state while checking WebGL
  if (webGLSupported === null) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading visualization...</div>
      </div>
    )
  }

  // Show 2D fallback if WebGL is not supported
  if (!webGLSupported) {
    return (
      <div className={styles.container}>
        <NUMATopology2DFallback topology={topology} selectedPolicy={selectedPolicy} />
        <div className={styles.overlay}>
          <PolicySelector
            selectedPolicy={selectedPolicy}
            onPolicyChange={setSelectedPolicy}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* 3D Canvas */}
      <div className={styles.canvasWrapper}>
        <Canvas
          camera={{ fov: 50, near: 0.1, far: 100 }}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={['#030712']} />
          <fog attach="fog" args={['#030712', 15, 30]} />
          <NUMAScene
            topology={topology}
            selectedPolicy={selectedPolicy}
            onCoreClick={onCoreClick}
            onHoveredElementChange={setHoveredElement}
            animatePlacement={animatePlacement}
          />
        </Canvas>
      </div>

      {/* Overlay UI */}
      <div className={styles.overlay}>
        {/* Policy selector */}
        <PolicySelector
          selectedPolicy={selectedPolicy}
          onPolicyChange={setSelectedPolicy}
        />

        {/* Legend */}
        <Legend />

        {/* Tooltip */}
        <Tooltip element={hoveredElement} />
      </div>

      {/* Instructions */}
      <div className={styles.instructions}>
        <p>Drag to rotate • Scroll to zoom • Hover for details</p>
      </div>
    </div>
  )
}

export default NUMATopology3D
