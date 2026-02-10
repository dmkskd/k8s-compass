import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useExplorerStore } from '../../shared/store/explorerStore'
import { useTheme } from '../../shared/hooks/useTheme'
import type { K8sRelationship, SchemaProperty } from '../../shared/types'
import { SpecStructure } from './SpecStructure'
import { ApiGroupSidebar } from './ApiGroupSidebar'
import { loadSchemasForVersion, getSchemaForKind, getKindDescription } from '../../shared/data/schemas'
import { setFilter, isAudioPlaying, AUDIO_ENABLED } from '../../shared/audio'
import styles from './ConstellationView.module.css'

interface ConstellationNode {
  id: string
  kind: string
  group: string
  groupColor: string
  fieldCount: number
  scope: 'Namespaced' | 'Cluster'
  relationships: K8sRelationship[]
  shortNames?: string[]
}

interface ConstellationEdge {
  source: string
  target: string
  type: K8sRelationship['type']
  description: string
}

interface APIGroupInfo {
  name: string
  displayName: string
  description?: string
  color: string
  kindCount: number
}

interface ConstellationViewProps {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
  groups: { name: string; color: string }[]
  sidebarGroups: APIGroupInfo[]
  embedded?: boolean // Hide UI elements when embedded in home preview
}

// Helper to determine shape type based on node properties
function getShapeType(node: { scope: string; group: string; kind: string }): 'sphere' | 'octahedron' | 'box' | 'dodecahedron' {
  // Cluster-scoped resources get octahedron (diamond shape)
  if (node.scope === 'Cluster') return 'octahedron'
  // Storage-related get box
  if (node.group.includes('storage') || node.kind.includes('Volume') || node.kind.includes('Storage')) return 'box'
  // Network-related get dodecahedron
  if (node.group.includes('networking') || node.kind === 'Service' || node.kind === 'Ingress') return 'dodecahedron'
  // Default sphere for namespaced resources
  return 'sphere'
}

// Force simulation to position nodes
function useForceLayout(nodes: ConstellationNode[], edges: ConstellationEdge[]) {
  return useMemo(() => {
    // Group nodes by their API group for clustering
    const groupPositions: Record<string, { x: number; y: number; z: number }> = {}
    const groups = [...new Set(nodes.map((n) => n.group))]
    
    // Position groups in a circle
    groups.forEach((group, i) => {
      const angle = (i / groups.length) * Math.PI * 2
      const radius = 12
      groupPositions[group] = {
        x: Math.cos(angle) * radius,
        y: (Math.random() - 0.5) * 4,
        z: Math.sin(angle) * radius,
      }
    })

    // Position nodes within their group cluster
    const nodesByGroup: Record<string, ConstellationNode[]> = {}
    nodes.forEach((node) => {
      if (!nodesByGroup[node.group]) nodesByGroup[node.group] = []
      nodesByGroup[node.group].push(node)
    })

    const positions: Record<string, [number, number, number]> = {}
    
    Object.entries(nodesByGroup).forEach(([group, groupNodes]) => {
      const base = groupPositions[group]
      groupNodes.forEach((node, i) => {
        const angle = (i / groupNodes.length) * Math.PI * 2
        const localRadius = 2 + Math.sqrt(groupNodes.length) * 0.8
        positions[node.id] = [
          base.x + Math.cos(angle) * localRadius + (Math.random() - 0.5) * 1.5,
          base.y + (Math.random() - 0.5) * 3,
          base.z + Math.sin(angle) * localRadius + (Math.random() - 0.5) * 1.5,
        ]
      })
    })

    return positions
  }, [nodes, edges])
}

// Individual star/node component
function StarNode({ 
  node, 
  position, 
  isSelected,
  isHighlighted,
  onSelect,
  onHover,
}: { 
  node: ConstellationNode
  position: [number, number, number]
  isSelected: boolean
  isHighlighted: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const wireframeRef = useRef<THREE.LineSegments>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const innerGlowRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  
  // Size based on field count (normalized)
  const baseSize = 0.15 + Math.log(node.fieldCount + 1) * 0.08
  const size = hovered || isSelected ? baseSize * 1.3 : baseSize
  
  // Only animate selected/highlighted nodes to reduce CPU usage
  const needsAnimation = isSelected || isHighlighted || hovered
  
  // Determine shape based on scope and group
  const shapeType = useMemo(() => getShapeType(node), [node.scope, node.group, node.kind])
  
  useFrame((state) => {
    // Always rotate on own axis (all nodes)
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.2
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.15) * 0.3
      meshRef.current.rotation.z = Math.cos(state.clock.elapsedTime * 0.1) * 0.15
    }
    
    // Sync wireframe rotation with mesh
    if (wireframeRef.current && meshRef.current) {
      wireframeRef.current.rotation.copy(meshRef.current.rotation)
    }
    
    // Only animate scale/pulse for selected/highlighted nodes
    if (needsAnimation) {
      if (meshRef.current) {
        const pulse = Math.sin(state.clock.elapsedTime * 0.15) * 0.03 + 1
        meshRef.current.scale.setScalar(size * pulse)
      }
      if (wireframeRef.current && meshRef.current) {
        wireframeRef.current.scale.copy(meshRef.current.scale)
      }
      if (innerGlowRef.current) {
        const innerPulse = Math.sin(state.clock.elapsedTime * 0.2) * 0.08 + 0.92
        innerGlowRef.current.scale.setScalar(size * 0.5 * innerPulse)
        const mat = innerGlowRef.current.material as THREE.MeshBasicMaterial
        mat.opacity = 0.5 + Math.sin(state.clock.elapsedTime * 0.2) * 0.1
      }
    }
  })
  
  // Update glow opacity without animation (disabled - all set to 0)
  useEffect(() => {
    if (glowRef.current) {
      // Halo disabled - set all to 0. To re-enable, use:
      // const opacity = isSelected ? 0.35 : isHighlighted ? 0.25 : hovered ? 0.2 : 0.1
      ;(glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0
    }
  }, [isSelected, isHighlighted, hovered])
  
  // Update scale when not animating
  useEffect(() => {
    if (meshRef.current && !needsAnimation) {
      meshRef.current.scale.setScalar(size)
    }
    if (wireframeRef.current && !needsAnimation) {
      wireframeRef.current.scale.setScalar(size)
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(size * 2.5)
    }
    if (innerGlowRef.current && !needsAnimation) {
      innerGlowRef.current.scale.setScalar(size * 0.5)
    }
  }, [size, needsAnimation])

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

  // Brighten color for highlights
  const brightenColor = (hex: string, factor: number) => {
    const color = new THREE.Color(hex)
    color.multiplyScalar(factor)
    return color
  }
  
  // Create wireframe geometry based on shape (skip for spheres)
  const wireframeGeometry = useMemo(() => {
    if (shapeType === 'sphere') return null // No wireframe for spheres
    
    let geo: THREE.BufferGeometry
    switch (shapeType) {
      case 'octahedron':
        geo = new THREE.OctahedronGeometry(1, 0)
        break
      case 'box':
        geo = new THREE.BoxGeometry(1.4, 1.4, 1.4)
        break
      case 'dodecahedron':
        geo = new THREE.DodecahedronGeometry(1, 0)
        break
      default:
        return null
    }
    return new THREE.EdgesGeometry(geo)
  }, [shapeType])

  return (
    <group position={position}>
      {/* Outer glow - soft ambient (disabled - set opacity > 0 to enable) */}
      <mesh ref={glowRef} scale={size * 2.5}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color={node.groupColor}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
      
      {/* Main shape - glass-like material */}
      <mesh
        ref={meshRef}
        scale={size}
        onClick={onSelect}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        {shapeType === 'sphere' && <icosahedronGeometry args={[1, 2]} />}
        {shapeType === 'octahedron' && <octahedronGeometry args={[1, 0]} />}
        {shapeType === 'box' && <boxGeometry args={[1.4, 1.4, 1.4]} />}
        {shapeType === 'dodecahedron' && <dodecahedronGeometry args={[1, 0]} />}
        <meshPhysicalMaterial
          color={node.groupColor}
          emissive={node.groupColor}
          emissiveIntensity={hovered || isSelected ? 0.6 : 0.25}
          roughness={0.15}
          metalness={0.9}
          clearcoat={1}
          clearcoatRoughness={0.1}
          transparent
          opacity={0.85}
        />
      </mesh>
      
      {/* Wireframe overlay (non-spheres only) */}
      {wireframeGeometry && (
        <lineSegments ref={wireframeRef} scale={size * 1.02} geometry={wireframeGeometry}>
          <lineBasicMaterial
            color={brightenColor(node.groupColor, 1.8)}
            transparent
            opacity={hovered || isSelected ? 0.8 : 0.3}
            linewidth={1}
          />
        </lineSegments>
      )}
      
      {/* Inner core glow - bright center */}
      <mesh ref={innerGlowRef} scale={size * 0.5}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color={brightenColor(node.groupColor, 2)}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Label */}
      <Html
        position={[0, size + 0.5, 0]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div className={`${styles.nodeLabel} ${(hovered || isSelected || isHighlighted) ? styles.nodeLabelHighlighted : styles.nodeLabelDimmed}`}>
          <span className={styles.nodeName}>{node.kind}</span>
          {(hovered || isSelected) && (
            <>
              <span className={styles.nodeGroup}>{node.group}</span>
              {node.scope === 'Cluster' && (
                <span className={styles.clusterBadge}>Cluster</span>
              )}
            </>
          )}
        </div>
      </Html>
    </group>
  )
}

// Connection line between nodes
function ConnectionLine({
  start,
  end,
  type,
  sourceKind,
  targetKind,
}: {
  start: [number, number, number]
  end: [number, number, number]
  type: K8sRelationship['type']
  sourceKind: string
  targetKind: string
}) {
  const colorMap: Record<string, string> = {
    owns: '#10b981',
    selects: '#06b6d4',
    references: '#64748b',
    mounts: '#8b5cf6',
    configures: '#f59e0b',
  }

  const color = colorMap[type] || '#64748b'

  // Create curved line
  const midPoint: [number, number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2 + 1,
    (start[2] + end[2]) / 2,
  ]

  return (
    <group>
      <Line
        points={[start, midPoint, end]}
        color={color}
        lineWidth={2}
        opacity={0.6}
        transparent
      />
      {/* Relationship label on connection */}
      <Html
        position={midPoint}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div className={styles.connectionLabel} style={{ borderColor: color }}>
          <span className={styles.connectionType} style={{ color }}>{type}</span>
          <span className={styles.connectionDescription}>{sourceKind} → {targetKind}</span>
        </div>
      </Html>
    </group>
  )
}

// Background stars
function BackgroundStars() {
  const starsRef = useRef<THREE.Points>(null)
  
  const [positions] = useState(() => {
    const positions = new Float32Array(2000 * 3)
    for (let i = 0; i < 2000; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 100
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100
    }
    return positions
  })

  useFrame((state) => {
    if (starsRef.current) {
      starsRef.current.rotation.y = state.clock.elapsedTime * 0.01
    }
  })

  return (
    <points ref={starsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#ffffff"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  )
}

// Camera controls component
function CameraController({ paused, embedded }: { paused?: boolean; embedded?: boolean }) {
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)
  
  useEffect(() => {
    // When embedded, position camera closer and centered
    if (embedded) {
      camera.position.set(0, 0, 22)
      camera.lookAt(0, 0, 0)
    } else {
      camera.position.set(0, 8, 25)
      camera.lookAt(0, 0, 0)
    }
    
    // Update controls target
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    }
  }, [camera, embedded])

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={!paused && !embedded}
      enableZoom={!paused && !embedded}
      enableRotate={!paused && !embedded}
      minDistance={5}
      maxDistance={60}
      autoRotate={!paused}
      autoRotateSpeed={embedded ? 0.15 : 0.3}
    />
  )
}

// Container style options: 'box' | 'sphere' | 'rings'
type ContainerStyle = 'box' | 'sphere' | 'rings'

// ============================================
// CONTAINER CONFIGURATION - Easy to tweak!
// ============================================
const CONTAINER_STYLE: ContainerStyle = 'box'
const CONTAINER_INTENSITY = 0.6  // 0.5 = subtle, 1.0 = normal, 2.0 = strong

// API Group Container - transparent bounding shape grouping kinds by API group
function APIGroupContainer({ 
  groupName,
  displayName,
  nodePositions,
  color,
  style = CONTAINER_STYLE,
  intensity = CONTAINER_INTENSITY,
}: { 
  groupName: string
  displayName: string
  nodePositions: [number, number, number][]
  color: string
  style?: ContainerStyle
  intensity?: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const ringsRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  
  // Calculate bounding box from node positions
  const bounds = useMemo(() => {
    if (nodePositions.length === 0) return null
    
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    
    nodePositions.forEach(([x, y, z]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    })
    
    const padding = 1.5 // Space around nodes
    const sizeX = Math.max(maxX - minX + padding * 2, 3)
    const sizeY = Math.max(maxY - minY + padding * 2, 3)
    const sizeZ = Math.max(maxZ - minZ + padding * 2, 3)
    
    return {
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as [number, number, number],
      size: [sizeX, sizeY, sizeZ] as [number, number, number],
      // For sphere: use the largest dimension as radius
      radius: Math.max(sizeX, sizeY, sizeZ) / 2 + 0.5,
    }
  }, [nodePositions])
  
  // Subtle breathing animation for mesh, rotation for rings
  useFrame((state) => {
    if (meshRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 0.3) * 0.01
      meshRef.current.scale.setScalar(scale)
    }
    if (ringsRef.current) {
      ringsRef.current.rotation.y = state.clock.elapsedTime * 0.1
      ringsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.15) * 0.1
    }
  })
  
  if (!bounds) return null
  
  // Create edges geometry for box style
  const edgesGeo = useMemo(() => {
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(...bounds.size))
  }, [bounds.size])
  
  // Label position depends on style
  const labelY = style === 'sphere' 
    ? bounds.radius + 0.3 
    : style === 'rings'
    ? bounds.radius + 0.5
    : bounds.size[1] / 2 + 0.3
  
  return (
    <group position={bounds.center}>
      {/* === BOX STYLE === */}
      {style === 'box' && (
        <>
          <mesh 
            ref={meshRef}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <boxGeometry args={bounds.size} />
            <meshPhysicalMaterial
              color={color}
              emissive={color}
              emissiveIntensity={(hovered ? 0.15 : 0.08) * intensity}
              roughness={0.5}
              metalness={0.1}
              transparent
              opacity={(hovered ? 0.18 : 0.12) * intensity}
              side={THREE.BackSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments geometry={edgesGeo}>
            <lineBasicMaterial color={color} transparent opacity={0.35 * intensity} />
          </lineSegments>
        </>
      )}
      
      {/* === SPHERE STYLE === */}
      {style === 'sphere' && (
        <>
          <mesh 
            ref={meshRef}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <sphereGeometry args={[bounds.radius, 32, 24]} />
            <meshPhysicalMaterial
              color={color}
              emissive={color}
              emissiveIntensity={(hovered ? 0.12 : 0.06) * intensity}
              roughness={0.5}
              metalness={0.1}
              transparent
              opacity={(hovered ? 0.12 : 0.08) * intensity}
              side={THREE.BackSide}
              depthWrite={false}
            />
          </mesh>
          {/* Latitude/longitude wireframe lines */}
          <mesh>
            <sphereGeometry args={[bounds.radius * 1.01, 16, 12]} />
            <meshBasicMaterial color={color} wireframe transparent opacity={0.15 * intensity} />
          </mesh>
        </>
      )}
      
      {/* === ORBITAL RINGS STYLE === */}
      {style === 'rings' && (
        <group ref={ringsRef}>
          {/* Invisible hover sphere for rings */}
          <mesh
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <sphereGeometry args={[bounds.radius, 16, 12]} />
            <meshBasicMaterial transparent opacity={0} />
          </mesh>
          {/* Equatorial ring */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[bounds.radius, 0.03, 8, 64]} />
            <meshBasicMaterial color={color} transparent opacity={(hovered ? 0.6 : 0.4) * intensity} />
          </mesh>
          {/* Tilted ring 1 */}
          <mesh rotation={[Math.PI / 2 + 0.5, 0.3, 0]}>
            <torusGeometry args={[bounds.radius * 0.85, 0.025, 8, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.3 * intensity} />
          </mesh>
          {/* Tilted ring 2 */}
          <mesh rotation={[Math.PI / 2 - 0.4, -0.2, 0.3]}>
            <torusGeometry args={[bounds.radius * 0.95, 0.02, 8, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.25 * intensity} />
          </mesh>
        </group>
      )}
      
      {/* Floating label at top - only show on hover */}
      {hovered && (
        <Html
          position={[0, labelY, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className={styles.groupContainerLabel} style={{ borderColor: color, color }}>
            {displayName || groupName}
          </div>
        </Html>
      )}
    </group>
  )
}

// Main scene content
function ConstellationScene({ 
  nodes, 
  edges,
  paused,
  embedded,
}: { 
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
  paused?: boolean
  embedded?: boolean
}) {
  const positions = useForceLayout(nodes, edges)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const { selectedKind, setSelectedKind, selectedGroup, searchQuery } = useExplorerStore()

  // Get connected node IDs for highlighting
  const connectedIds = useMemo(() => {
    if (!hoveredNode && !selectedKind) return new Set<string>()
    const targetId = hoveredNode || nodes.find(n => n.kind === selectedKind)?.id
    if (!targetId) return new Set<string>()
    
    const connected = new Set<string>([targetId])
    edges.forEach((edge) => {
      if (edge.source === targetId) connected.add(edge.target)
      if (edge.target === targetId) connected.add(edge.source)
    })
    return connected
  }, [hoveredNode, selectedKind, edges, nodes])

  // Filter nodes by selected group and search query
  const filteredNodes = useMemo(() => {
    let result = nodes
    
    // Filter by group
    if (selectedGroup) {
      result = result.filter((n) => n.group === selectedGroup)
    }
    
    // Filter by search query - match kind name, group name, or short names
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter((n) => 
        n.kind.toLowerCase().includes(query) ||
        n.group.toLowerCase().includes(query) ||
        n.shortNames?.some(sn => sn.toLowerCase().includes(query))
      )
    }
    
    return result
  }, [nodes, selectedGroup, searchQuery])

  // Filter edges to only show connections between visible nodes
  const filteredEdges = useMemo(() => {
    const visibleIds = new Set(filteredNodes.map((n) => n.id))
    return edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
    )
  }, [edges, filteredNodes])

  // Calculate group containers - group nodes by API group and get their positions
  const groupContainers = useMemo(() => {
    // Don't show containers when filtering by group or search (too cluttered)
    if (selectedGroup || (searchQuery && searchQuery.trim())) return []
    
    const groupMap = new Map<string, { color: string; positions: [number, number, number][] }>()
    
    filteredNodes.forEach((node) => {
      const pos = positions[node.id]
      if (!pos) return
      
      if (!groupMap.has(node.group)) {
        groupMap.set(node.group, { color: node.groupColor, positions: [] })
      }
      groupMap.get(node.group)!.positions.push(pos)
    })
    
    // Only show containers for groups with 2+ kinds
    return Array.from(groupMap.entries())
      .filter(([_, data]) => data.positions.length >= 2)
      .map(([groupName, data]) => ({
        groupName,
        displayName: groupName === 'core' ? 'Core' : groupName.split('.')[0],
        color: data.color,
        positions: data.positions,
      }))
  }, [filteredNodes, positions, selectedGroup, searchQuery])

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={0.4} color="#ffffff" />
      <pointLight position={[-10, -10, -10]} intensity={0.2} color="#8b5cf6" />
      <pointLight position={[0, 15, 0]} intensity={0.15} color="#6366f1" />
      
      <BackgroundStars />
      <CameraController paused={paused} embedded={embedded} />

      {/* API Group containers - transparent bounding boxes */}
      {groupContainers.map((group) => (
        <APIGroupContainer
          key={group.groupName}
          groupName={group.groupName}
          displayName={group.displayName}
          nodePositions={group.positions}
          color={group.color}
        />
      ))}

      {/* Connection lines - only show when something is highlighted */}
      {(hoveredNode || selectedKind) && filteredEdges.map((edge, i) => {
        const startPos = positions[edge.source]
        const endPos = positions[edge.target]
        if (!startPos || !endPos) return null
        
        const isHighlighted = connectedIds.has(edge.source) && connectedIds.has(edge.target)
        if (!isHighlighted) return null

        const sourceNode = filteredNodes.find(n => n.id === edge.source)
        const targetNode = filteredNodes.find(n => n.id === edge.target)
        if (!sourceNode || !targetNode) return null
        
        return (
          <ConnectionLine
            key={i}
            start={startPos}
            end={endPos}
            type={edge.type}
            sourceKind={sourceNode.kind}
            targetKind={targetNode.kind}
          />
        )
      })}

      {/* Star nodes */}
      {filteredNodes.map((node) => {
        const pos = positions[node.id]
        if (!pos) return null
        
        return (
          <StarNode
            key={node.id}
            node={node}
            position={pos}
            isSelected={selectedKind === node.kind}
            isHighlighted={connectedIds.has(node.id)}
            onSelect={() => setSelectedKind(node.kind)}
            onHover={(h) => setHoveredNode(h ? node.id : null)}
          />
        )
      })}
    </>
  )
}

// 3D Shape for overlay nodes
function OverlayShape3D({ 
  node, 
  onClick 
}: { 
  node: ConstellationNode
  onClick: () => void 
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const wireframeRef = useRef<THREE.LineSegments>(null)
  const [hovered, setHovered] = useState(false)
  
  const shapeType = useMemo(() => getShapeType(node), [node.scope, node.group, node.kind])
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.3
    }
    if (wireframeRef.current && meshRef.current) {
      wireframeRef.current.rotation.copy(meshRef.current.rotation)
    }
  })
  
  const wireframeGeometry = useMemo(() => {
    if (shapeType === 'sphere') return null
    let geo: THREE.BufferGeometry
    switch (shapeType) {
      case 'octahedron': geo = new THREE.OctahedronGeometry(0.65, 0); break
      case 'box': geo = new THREE.BoxGeometry(0.9, 0.9, 0.9); break
      case 'dodecahedron': geo = new THREE.DodecahedronGeometry(0.65, 0); break
      default: return null
    }
    return new THREE.EdgesGeometry(geo)
  }, [shapeType])
  
  const brightenColor = (hex: string, factor: number) => {
    const color = new THREE.Color(hex)
    color.multiplyScalar(factor)
    return color
  }
  
  const handlePointerOver = useCallback(() => {
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }, [])
  
  const handlePointerOut = useCallback(() => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }, [])
  
  const handleClick = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    onClick()
  }, [onClick])
  
  return (
    <group>
      {/* Invisible larger hit area for easier clicking */}
      <mesh
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[1.8, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      
      {/* Visible shape */}
      <mesh ref={meshRef}>
        {shapeType === 'sphere' && <icosahedronGeometry args={[0.65, 2]} />}
        {shapeType === 'octahedron' && <octahedronGeometry args={[0.65, 0]} />}
        {shapeType === 'box' && <boxGeometry args={[0.9, 0.9, 0.9]} />}
        {shapeType === 'dodecahedron' && <dodecahedronGeometry args={[0.65, 0]} />}
        <meshPhysicalMaterial
          color={node.groupColor}
          emissive={node.groupColor}
          emissiveIntensity={hovered ? 0.7 : 0.4}
          roughness={0.15}
          metalness={0.9}
          clearcoat={1}
          clearcoatRoughness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>
      {wireframeGeometry && (
        <lineSegments ref={wireframeRef} scale={1.02} geometry={wireframeGeometry}>
          <lineBasicMaterial
            color={brightenColor(node.groupColor, 1.8)}
            transparent
            opacity={hovered ? 0.8 : 0.5}
          />
        </lineSegments>
      )}
      {/* Inner glow */}
      <mesh scale={0.3}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color={brightenColor(node.groupColor, 2)}
          transparent
          opacity={0.6}
        />
      </mesh>
    </group>
  )
}

// Get shape radius based on node type (for line endpoint calculation)
function getShapeRadius(node: ConstellationNode): number {
  const shapeType = getShapeType(node)
  switch (shapeType) {
    case 'sphere': return 0.65
    case 'octahedron': return 0.65
    case 'box': return 0.6 // Box diagonal is larger, but we use face distance
    case 'dodecahedron': return 0.65
    default: return 0.65
  }
}

// 3D Relationship Scene - renders inside a Canvas
function RelationshipScene3D({
  selectedNode,
  connections,
  relationshipColors,
  relationshipLabels,
  onNodeClick,
  onCentralNodeClick,
}: {
  selectedNode: ConstellationNode
  connections: { node: ConstellationNode; edge: ConstellationEdge; direction: 'outgoing' | 'incoming' }[]
  relationshipColors: Record<string, string>
  relationshipLabels: Record<string, { outgoing: string; incoming: string }>
  onNodeClick: (kind: string) => void
  onCentralNodeClick: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  
  // Start flat (no rotation) - rotation will begin from 0
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = 0
    }
  }, [])
  
  // Very gentle auto-rotation (anti-clockwise when viewed from above)
  useFrame((_state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.02 // Positive = anti-clockwise from above
    }
  })
  
  // Calculate 3D positions (in a circle on XZ plane)
  const radius = 3.5 + connections.length * 0.2
  const nodePositions = useMemo(() => {
    return connections.map((_conn, i) => {
      const angle = (i / connections.length) * Math.PI * 2 - Math.PI / 2
      return {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
        angle,
      }
    })
  }, [connections, radius])
  
  // Central node shape radius
  const centralRadius = getShapeRadius(selectedNode)
  
  return (
    <group ref={groupRef}>
      {/* Central node */}
      <group position={[0, 0, 0]}>
        <OverlayShape3D node={selectedNode} onClick={onCentralNodeClick} />
        <Html center style={{ pointerEvents: 'none' }} zIndexRange={[1, 10]}>
          <div 
            className={styles.overlayLabel} 
            onClick={(e) => { e.stopPropagation(); onCentralNodeClick(); }}
          >
            <span className={styles.overlayLabelName}>{selectedNode.kind}</span>
            <span className={styles.overlayLabelGroup}>{selectedNode.group}</span>
            <span className={styles.overlayLabelHint}>VIEW SPEC →</span>
          </div>
        </Html>
      </group>
      
      {/* Connected nodes and lines */}
      {connections.map((conn, i) => {
        const pos = nodePositions[i]
        const color = relationshipColors[conn.edge.type] || '#64748b'
        const label = relationshipLabels[conn.edge.type]?.[conn.direction === 'outgoing' ? 'outgoing' : 'incoming'] || conn.edge.type
        
        // Calculate line endpoints that stop at shape edges
        const center = new THREE.Vector3(0, 0, 0)
        const nodePos = new THREE.Vector3(pos.x, pos.y, pos.z)
        const direction = nodePos.clone().sub(center).normalize()
        
        // Connected node shape radius
        const connectedRadius = getShapeRadius(conn.node)
        
        // Line starts at edge of central shape, ends at edge of connected shape
        const lineStart = center.clone().add(direction.clone().multiplyScalar(centralRadius + 0.15))
        const lineEnd = nodePos.clone().sub(direction.clone().multiplyScalar(connectedRadius + 0.15))
        const lineMid = lineStart.clone().lerp(lineEnd, 0.5)
        
        return (
          <group key={conn.node.id}>
            {/* Connection line */}
            <Line
              points={[lineStart, lineEnd]}
              color={color}
              lineWidth={2}
              opacity={0.7}
              transparent
            />
            
            {/* Relationship label at midpoint */}
            <Html position={[lineMid.x, lineMid.y + 0.3, lineMid.z]} center>
              <div className={styles.overlayRelLabel} style={{ borderColor: color, color }}>
                {label}
              </div>
            </Html>
            
            {/* Connected node */}
            <group position={[pos.x, pos.y, pos.z]}>
              <OverlayShape3D node={conn.node} onClick={() => onNodeClick(conn.node.kind)} />
              <Html center style={{ pointerEvents: 'none' }} zIndexRange={[1, 10]}>
                <div 
                  className={styles.overlayLabel}
                  onClick={(e) => { e.stopPropagation(); onNodeClick(conn.node.kind); }}
                >
                  <span className={styles.overlayLabelName}>{conn.node.kind}</span>
                  <span className={styles.overlayLabelGroup}>{conn.node.group}</span>
                </div>
              </Html>
            </group>
          </group>
        )
      })}
    </group>
  )
}

// Relationship Overlay Component
function RelationshipOverlay({
  nodes,
  edges,
  selectedNodeId,
  onClose,
  onNodeClick,
  onCentralNodeClick,
}: {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
  selectedNodeId: string
  onClose: () => void
  onNodeClick: (kind: string) => void
  onCentralNodeClick: () => void
}) {
  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  
  if (!selectedNode) return null

  // Find all connected nodes and their relationships
  const connections = useMemo(() => {
    const result: {
      node: ConstellationNode
      edge: ConstellationEdge
      direction: 'outgoing' | 'incoming'
    }[] = []

    edges.forEach((edge) => {
      if (edge.source === selectedNodeId) {
        const targetNode = nodes.find((n) => n.id === edge.target)
        if (targetNode) {
          result.push({ node: targetNode, edge, direction: 'outgoing' })
        }
      } else if (edge.target === selectedNodeId) {
        const sourceNode = nodes.find((n) => n.id === edge.source)
        if (sourceNode) {
          result.push({ node: sourceNode, edge, direction: 'incoming' })
        }
      }
    })

    return result
  }, [edges, nodes, selectedNodeId])

  const relationshipColors: Record<string, string> = {
    owns: '#10b981',
    selects: '#06b6d4',
    references: '#64748b',
    mounts: '#8b5cf6',
    configures: '#f59e0b',
  }

  const relationshipLabels: Record<string, { outgoing: string; incoming: string }> = {
    owns: { outgoing: 'creates/manages', incoming: 'created by' },
    selects: { outgoing: 'selects', incoming: 'selected by' },
    references: { outgoing: 'references', incoming: 'referenced by' },
    mounts: { outgoing: 'mounts', incoming: 'mounted by' },
    configures: { outgoing: 'configures', incoming: 'configured by' },
  }

  // Calculate camera distance based on connection count
  const cameraZ = 18 + connections.length * 0.5

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div 
        className={styles.overlayWrapper3D}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button className={styles.closeButton3D} onClick={onClose}>
          ✕
        </button>
        
        {/* 3D Canvas */}
        <Canvas
          camera={{ position: [0, cameraZ, 0.1], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0)
          }}
        >
          <ambientLight intensity={0.4} />
          <pointLight position={[5, 5, 5]} intensity={0.5} />
          <pointLight position={[-5, -5, -5]} intensity={0.3} color="#8b5cf6" />
          
          <RelationshipScene3D
            selectedNode={selectedNode}
            connections={connections}
            relationshipColors={relationshipColors}
            relationshipLabels={relationshipLabels}
            onNodeClick={onNodeClick}
            onCentralNodeClick={onCentralNodeClick}
          />
          
          <OrbitControls
            enablePan={false}
            enableZoom={true}
            minDistance={5}
            maxDistance={20}
            autoRotate={false}
          />
        </Canvas>
        
        {/* Legend */}
        <div className={styles.legend3D}>
          <div className={styles.legendTitle}>RELATIONSHIPS</div>
          <div className={styles.legendItems}>
            <span><span className={styles.legendDot} style={{ background: relationshipColors.owns }} /> owns (creates & manages lifecycle)</span>
            <span><span className={styles.legendDot} style={{ background: relationshipColors.selects }} /> selects (via label selector)</span>
            <span><span className={styles.legendDot} style={{ background: relationshipColors.references }} /> references (points to)</span>
            <span><span className={styles.legendDot} style={{ background: relationshipColors.mounts }} /> mounts (uses as volume)</span>
            <span><span className={styles.legendDot} style={{ background: relationshipColors.configures }} /> configures (applies settings)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
// 3D Shape Legend Component
function LegendShape({ 
  type, 
  color 
}: { 
  type: 'sphere' | 'octahedron' | 'box' | 'dodecahedron'
  color: string 
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const wireframeRef = useRef<THREE.LineSegments>(null)
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.3
      meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.4) * 0.2
    }
    if (wireframeRef.current) {
      wireframeRef.current.rotation.copy(meshRef.current!.rotation)
    }
  })
  
  const wireframeGeometry = useMemo(() => {
    if (type === 'sphere') return null
    let geo: THREE.BufferGeometry
    switch (type) {
      case 'octahedron': geo = new THREE.OctahedronGeometry(0.8, 0); break
      case 'box': geo = new THREE.BoxGeometry(1.1, 1.1, 1.1); break
      case 'dodecahedron': geo = new THREE.DodecahedronGeometry(0.8, 0); break
      default: return null
    }
    return new THREE.EdgesGeometry(geo)
  }, [type])
  
  return (
    <group>
      <mesh ref={meshRef}>
        {type === 'sphere' && <icosahedronGeometry args={[0.8, 2]} />}
        {type === 'octahedron' && <octahedronGeometry args={[0.8, 0]} />}
        {type === 'box' && <boxGeometry args={[1.1, 1.1, 1.1]} />}
        {type === 'dodecahedron' && <dodecahedronGeometry args={[0.8, 0]} />}
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.3}
          roughness={0.2}
          metalness={0.8}
          transparent
          opacity={0.9}
        />
      </mesh>
      {wireframeGeometry && (
        <lineSegments ref={wireframeRef} geometry={wireframeGeometry}>
          <lineBasicMaterial color={color} transparent opacity={0.5} />
        </lineSegments>
      )}
    </group>
  )
}

function ShapeLegend3D() {
  const shapes = [
    { type: 'sphere' as const, label: 'Namespaced', color: '#6366f1' },
    { type: 'octahedron' as const, label: 'Cluster-scoped', color: '#8b5cf6' },
    { type: 'box' as const, label: 'Storage', color: '#f59e0b' },
    { type: 'dodecahedron' as const, label: 'Networking', color: '#06b6d4' },
  ]
  
  return (
    <div className={styles.shapeLegendInner}>
      {/* Single Canvas for all legend shapes */}
      <div className={styles.shapeLegendCanvas}>
        <Canvas
          camera={{ position: [0, 0, 12], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
          style={{ width: '100%', height: '100%' }}
        >
          <ambientLight intensity={0.5} />
          <pointLight position={[2, 2, 2]} intensity={0.5} />
          {shapes.map((shape, i) => (
            <group key={shape.type} position={[0, 3.6 - i * 2.4, 0]}>
              <LegendShape type={shape.type} color={shape.color} />
            </group>
          ))}
        </Canvas>
      </div>
      {/* Labels */}
      <div className={styles.shapeLegendLabels}>
        {shapes.map((shape) => (
          <span key={shape.type} style={{ color: shape.color }}>{shape.label}</span>
        ))}
      </div>
    </div>
  )
}

export function ConstellationView({ nodes, edges, sidebarGroups, embedded = false }: ConstellationViewProps) {
  const { selectedKind, setSelectedKind, sidebarOpen, toggleSidebar, specPanelOpen, setSpecPanelOpen } = useExplorerStore()
  const { theme } = useTheme()
  const [showOverlay, setShowOverlay] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Theme-aware colors for 3D scene
  const sceneColors = useMemo(() => ({
    background: theme === 'light' ? '#e2e8f0' : '#030712',
    fog: theme === 'light' ? '#e2e8f0' : '#030712',
  }), [theme])
  
  // Handle hover to expand sidebar
  const handleMouseEnter = useCallback(() => {
    if (sidebarOpen) return
    // Small delay to prevent accidental triggers
    hoverTimeoutRef.current = setTimeout(() => {
      toggleSidebar()
    }, 150)
  }, [sidebarOpen, toggleSidebar])
  
  const handleMouseLeave = useCallback(() => {
    // Clear pending hover timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    // Close if open
    if (sidebarOpen) {
      toggleSidebar()
    }
  }, [sidebarOpen, toggleSidebar])
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])
  
  // Mouse move handler - map X position to filter frequency
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Skip if audio is disabled or not playing
    if (!AUDIO_ENABLED || !isAudioPlaying()) return
    
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width // 0-1
    const y = (e.clientY - rect.top) / rect.height // 0-1
    
    // Map X to filter cutoff (200-6000 Hz)
    const cutoff = 200 + x * 5800
    // Map Y to resonance (1-15)
    const resonance = 1 + (1 - y) * 14
    
    setFilter(cutoff, resonance)
  }, [])
  
  // Find selected node ID and data
  const selectedNodeId = useMemo(() => {
    if (!selectedKind) return null
    return nodes.find((n) => n.kind === selectedKind)?.id || null
  }, [selectedKind, nodes])

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.kind === selectedKind)
  }, [selectedKind, nodes])

  // Load schemas for the current version
  const [schemasLoaded, setSchemasLoaded] = useState(false)
  const { selectedVersion } = useExplorerStore()
  
  useEffect(() => {
    loadSchemasForVersion(selectedVersion).then(() => {
      setSchemasLoaded(true)
    })
  }, [selectedVersion])

  // Get schema for selected kind
  const selectedSchema = useMemo((): SchemaProperty[] => {
    if (!selectedKind || !schemasLoaded) return []
    return getSchemaForKind(selectedKind, selectedVersion)
  }, [selectedKind, schemasLoaded, selectedVersion])

  // Get description for selected kind
  const selectedDescription = useMemo((): string => {
    if (!selectedKind || !schemasLoaded) return ''
    return getKindDescription(selectedKind, selectedVersion)
  }, [selectedKind, schemasLoaded, selectedVersion])

  // Show overlay when a node is selected
  useEffect(() => {
    if (selectedNodeId) {
      setShowOverlay(true)
    } else {
      // Reset spec panel when no node is selected
      if (specPanelOpen) {
        setSpecPanelOpen(false)
      }
    }
  }, [selectedNodeId, specPanelOpen, setSpecPanelOpen])

  // ESC key to close overlays
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (specPanelOpen) {
          setSpecPanelOpen(false)
        } else if (showOverlay) {
          setShowOverlay(false)
          setSelectedKind(undefined)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showOverlay, specPanelOpen, setSelectedKind, setSpecPanelOpen])

  const handleCloseOverlay = useCallback(() => {
    setShowOverlay(false)
    setSpecPanelOpen(false)
    setSelectedKind(undefined)
  }, [setSelectedKind, setSpecPanelOpen])

  const handleOverlayNodeClick = useCallback((kind: string) => {
    setSelectedKind(kind)
    setSpecPanelOpen(false) // Reset spec structure when switching nodes
  }, [setSelectedKind, setSpecPanelOpen])

  const handleCentralNodeClick = useCallback(() => {
    setSpecPanelOpen(true)
  }, [setSpecPanelOpen])

  const handleCloseSpecStructure = useCallback(() => {
    setSpecPanelOpen(false)
  }, [setSpecPanelOpen])

  return (
    <div className={styles.container} ref={containerRef} onMouseMove={embedded ? undefined : handleMouseMove}>
      <div className={`${styles.canvasWrapper} ${showOverlay && !embedded ? styles.canvasDimmed : ''}`}>
        <Canvas
          camera={{ 
            fov: 60, 
            near: 0.1, 
            far: 1000,
            position: embedded ? [0, 0, 22] : [0, 8, 25]
          }}
          gl={{ antialias: true, alpha: true }}
          style={{ position: 'relative', zIndex: 1 }}
        >
          <color attach="background" args={[sceneColors.background]} />
          <fog attach="fog" args={[sceneColors.fog, 30, 80]} />
          <ConstellationScene nodes={nodes} edges={edges} paused={showOverlay && !embedded} embedded={embedded} />
        </Canvas>
      </div>
      
      {!embedded && showOverlay && selectedNodeId && !specPanelOpen && (
        <RelationshipOverlay
          key={`overlay-${selectedNodeId}`}
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          onClose={handleCloseOverlay}
          onNodeClick={handleOverlayNodeClick}
          onCentralNodeClick={handleCentralNodeClick}
        />
      )}

      {!embedded && specPanelOpen && selectedNode && (
        <div className={styles.overlay} onClick={handleCloseSpecStructure}>
          <SpecStructure
            kind={selectedNode.kind}
            group={selectedNode.group}
            schema={selectedSchema}
            description={selectedDescription}
            onClose={handleCloseSpecStructure}
          />
        </div>
      )}
      
      {/* Collapsible left sidebar - hidden when embedded */}
      {!embedded && (
      <div 
        ref={sidebarRef} 
        className={`${styles.rightPanel} ${sidebarOpen ? styles.rightPanelOpen : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {sidebarOpen && <ApiGroupSidebar groups={sidebarGroups} />}
        <div 
          className={styles.panelToggle}
          aria-label={sidebarOpen ? 'API Groups panel' : 'Hover to show API Groups'}
          title={sidebarOpen ? '' : 'API Groups'}
        >
          <span className={styles.toggleIcon}>{sidebarOpen ? '‹' : '›'}</span>
          {!sidebarOpen && <span className={styles.toggleLabel}>Groups</span>}
        </div>
      </div>
      )}
      
      {!embedded && (
      <div className={styles.instructions}>
        <p>Drag to rotate • Scroll to zoom • Click a node to explore</p>
      </div>
      )}
      
      {/* 3D Shape legend - hidden when embedded */}
      {!embedded && (
      <div className={styles.shapeLegend}>
        <ShapeLegend3D />
      </div>
      )}
    </div>
  )
}

