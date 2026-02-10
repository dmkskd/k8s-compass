import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Float, Sparkles } from '@react-three/drei'
import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import styles from './ControlPlaneView.module.css'
import { ComponentSpec } from './ComponentSpec'
import { useExplorerStore } from '../../shared/store/explorerStore'
import { 
  ApiServerIcon, 
  EtcdIcon, 
  ControllerManagerIcon, 
  SchedulerIcon,
  NodeIcon,
  KubeletIcon,
  KubeProxyIcon,
  ContainerdIcon,
  CoreDNSIcon,
  CNIIcon,
  KubectlIcon
} from '../../shared/components/K8sIcons'

// Component types
interface ControlPlaneComponent {
  id: string
  name: string
  type: 'control-plane' | 'node-component' | 'satellite'
  description: string
  position: [number, number, number]
  color: string
  emissive: string
  relatedKEPs?: string[]
  subComponents?: string[]
}

// Controller satellites that orbit the controller-manager
const CONTROLLER_SATELLITES = [
  { id: 'deployment-controller', name: 'Deployment', angle: 0 },
  { id: 'replicaset-controller', name: 'ReplicaSet', angle: Math.PI * 0.4 },
  { id: 'node-controller', name: 'Node', angle: Math.PI * 0.8 },
  { id: 'service-controller', name: 'Service', angle: Math.PI * 1.2 },
  { id: 'endpoint-controller', name: 'Endpoint', angle: Math.PI * 1.6 },
]

const CONTROL_PLANE_COMPONENTS: ControlPlaneComponent[] = [
  {
    id: 'kube-apiserver',
    name: 'kube-apiserver',
    type: 'control-plane',
    description: 'The API server is the front end for the Kubernetes control plane. It exposes the Kubernetes API and is the central management entity.',
    position: [0, 0, 0],
    color: '#6366f1',
    emissive: '#4f46e5',
    relatedKEPs: ['KEP-3325', 'KEP-2799'],
  },
  {
    id: 'etcd',
    name: 'etcd',
    type: 'control-plane',
    description: 'Consistent and highly-available key value store for all cluster data. The single source of truth for cluster state.',
    position: [0, 3.5, 0],
    color: '#22c55e',
    emissive: '#16a34a',
  },
  {
    id: 'kube-controller-manager',
    name: 'controller-manager',
    type: 'control-plane',
    description: 'Runs controller processes that regulate the state of the cluster. Each controller is a separate process, but they are compiled into a single binary.',
    position: [-8, 0, 0],
    color: '#f59e0b',
    emissive: '#d97706',
    subComponents: ['Deployment', 'ReplicaSet', 'Node', 'Service', 'Endpoint', 'Job', 'CronJob'],
  },
  {
    id: 'kube-scheduler',
    name: 'kube-scheduler',
    type: 'control-plane',
    description: 'Watches for newly created Pods with no assigned node, and selects a node for them to run on based on resource requirements, constraints, and policies.',
    position: [8, 0, 0],
    color: '#ec4899',
    emissive: '#db2777',
    relatedKEPs: ['KEP-3633', 'KEP-4381'],
  },

]

// Cluster addons
const CLUSTER_ADDONS: ControlPlaneComponent[] = [
  {
    id: 'coredns',
    name: 'CoreDNS',
    type: 'satellite',
    description: 'CoreDNS is the cluster DNS server. It provides DNS-based service discovery for pods and services within the cluster.',
    position: [4, -3, -5],
    color: '#3b82f6',
    emissive: '#2563eb',
    relatedKEPs: ['KEP-2593'],
  },
  {
    id: 'cni',
    name: 'CNI Plugin',
    type: 'satellite',
    description: 'Container Network Interface plugin provides networking for pods. Common implementations include Calico, Cilium, Flannel, and kindnet.',
    position: [-4, -3, -5],
    color: '#10b981',
    emissive: '#059669',
    relatedKEPs: ['KEP-3178'],
  },
]

// Flow animation steps
const FLOW_STEPS = [
  { from: 'client', to: 'kube-apiserver', label: '1. kubectl apply' },
  { from: 'kube-apiserver', to: 'etcd', label: '2. Store in etcd' },
  { from: 'etcd', to: 'kube-apiserver', label: '3. Confirm write' },
  { from: 'kube-apiserver', to: 'kube-controller-manager', label: '4. Watch event' },
  { from: 'kube-controller-manager', to: 'kube-apiserver', label: '5. Create Pod' },
  { from: 'kube-apiserver', to: 'kube-scheduler', label: '6. Schedule Pod' },
  { from: 'kube-scheduler', to: 'kube-apiserver', label: '7. Bind to Node' },
  { from: 'kube-apiserver', to: 'node', label: '8. Kubelet watches' },
  { from: 'node', to: 'container', label: '9. Start container' },
]

// Canvas-based 3D text label that respects depth
function TextSprite({ 
  text, 
  subText,
  position, 
  visible = true,
  scale = 1
}: { 
  text: string
  subText?: string
  position: [number, number, number]
  visible?: boolean
  scale?: number
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    // High resolution for crisp text
    const pixelRatio = 2
    canvas.width = 512 * pixelRatio
    canvas.height = 96 * pixelRatio
    ctx.scale(pixelRatio, pixelRatio)
    
    // Measure text to fit box tightly
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    const mainWidth = ctx.measureText(text).width
    ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    const subWidth = subText ? ctx.measureText(subText.toUpperCase()).width : 0
    const textWidth = Math.max(mainWidth, subWidth)
    
    const padding = 28
    const boxWidth = textWidth + padding * 2
    const boxHeight = subText ? 78 : 56
    const boxX = (512 - boxWidth) / 2
    const boxY = (96 - boxHeight) / 2
    
    // Subtle background with rounded corners
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)'
    const radius = 6
    ctx.beginPath()
    ctx.moveTo(boxX + radius, boxY)
    ctx.lineTo(boxX + boxWidth - radius, boxY)
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius)
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius)
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight)
    ctx.lineTo(boxX + radius, boxY + boxHeight)
    ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius)
    ctx.lineTo(boxX, boxY + radius)
    ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY)
    ctx.closePath()
    ctx.fill()
    
    // Subtle border
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)'
    ctx.lineWidth = 1
    ctx.stroke()
    
    // Main text
    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, subText ? 38 : 48)
    
    // Sub text
    if (subText) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      ctx.fillText(subText.toUpperCase(), 256, 62)
    }
    
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [text, subText])

  if (!visible) return null

  return (
    <sprite position={position} scale={[4 * scale, 0.75 * scale, 1]}>
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

// Smaller text label for inner components (no background box)
function SmallTextSprite({ 
  text, 
  position, 
  color = '#e2e8f0',
  visible = true,
  scale = 1
}: { 
  text: string
  position: [number, number, number]
  color?: string
  visible?: boolean
  scale?: number
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    const pixelRatio = 2
    canvas.width = 256 * pixelRatio
    canvas.height = 64 * pixelRatio
    ctx.scale(pixelRatio, pixelRatio)
    
    // Text with subtle shadow for readability
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    
    ctx.fillStyle = color
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 32)
    
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [text, color])

  if (!visible) return null

  return (
    <sprite position={position} scale={[1.5 * scale, 0.4 * scale, 1]}>
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


// API Server - Central dodecahedron with glow
function APIServer({ 
  onClick, 
  isHighlighted,
  hideLabel
}: { 
  onClick: () => void
  isHighlighted: boolean
  hideLabel: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const wireframeRef = useRef<THREE.LineSegments>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.15
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1
    }
    if (wireframeRef.current && meshRef.current) {
      wireframeRef.current.rotation.copy(meshRef.current.rotation)
    }
  })

  const wireframeGeo = useMemo(() => {
    return new THREE.EdgesGeometry(new THREE.DodecahedronGeometry(1.2, 0))
  }, [])

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
      <group position={[0, 0, 0]}>
        {/* Main shape */}
        <mesh
          ref={meshRef}
          onClick={onClick}
          onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
        >
          <dodecahedronGeometry args={[1.2, 0]} />
          <meshPhysicalMaterial
            color="#6366f1"
            emissive="#4f46e5"
            emissiveIntensity={hovered || isHighlighted ? 0.8 : 0.4}
            roughness={0.1}
            metalness={0.9}
            clearcoat={1}
            clearcoatRoughness={0.1}
            transparent
            opacity={0.9}
          />
        </mesh>

        {/* Wireframe */}
        <lineSegments ref={wireframeRef} scale={1.22}>
          <bufferGeometry attach="geometry" {...wireframeGeo} />
          <lineBasicMaterial color="#a5b4fc" transparent opacity={hovered ? 0.8 : 0.4} />
        </lineSegments>

        {/* Inner core */}
        <mesh scale={0.4}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color="#c7d2fe" transparent opacity={0.8} />
        </mesh>

        {/* Sparkles */}
        <Sparkles count={30} scale={3} size={2} speed={0.3} color="#a5b4fc" />

        {/* Label */}
        <TextSprite 
          text="kube-apiserver" 
          subText="Control Plane"
          position={[0, -2.2, 0]} 
          visible={!hideLabel}
        />
      </group>
    </Float>
  )
}

// Etcd - 3 box cluster representing distributed key-value store
function Etcd({ onClick, isHighlighted, hideLabel }: { onClick: () => void; isHighlighted: boolean; hideLabel: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (groupRef.current) {
      // Gentle floating motion
      groupRef.current.position.y = 3.5 + Math.sin(state.clock.elapsedTime * 0.5) * 0.1
    }
  })

  // 3 etcd instances in a row
  const instances = useMemo(() => [
    { pos: [-1.2, 0, 0] as [number, number, number], delay: 0 },
    { pos: [0, 0, 0] as [number, number, number], delay: 0.3 },
    { pos: [1.2, 0, 0] as [number, number, number], delay: 0.6 },
  ], [])

  return (
    <group 
      position={[0, 3.5, 0]} 
      ref={groupRef}
      onClick={onClick}
      onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
    >
      {/* 3 etcd boxes */}
      {instances.map((inst, i) => (
        <group key={i} position={inst.pos}>
          {/* Main box */}
          <mesh>
            <boxGeometry args={[0.8, 1, 0.8]} />
            <meshPhysicalMaterial
              color="#22c55e"
              emissive="#16a34a"
              emissiveIntensity={hovered || isHighlighted ? 0.6 : 0.3}
              roughness={0.2}
              metalness={0.8}
              clearcoat={0.8}
              clearcoatRoughness={0.2}
            />
          </mesh>
          
          {/* Wireframe edge */}
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(0.82, 1.02, 0.82)]} />
            <lineBasicMaterial color="#86efac" transparent opacity={hovered ? 0.8 : 0.4} />
          </lineSegments>
        </group>
      ))}

      {/* Connection lines between boxes */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([-0.8, 0, 0, -0.4, 0, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#86efac" transparent opacity={0.5} />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0.4, 0, 0, 0.8, 0, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#86efac" transparent opacity={0.5} />
      </line>

      <Sparkles count={15} scale={4} size={1} speed={0.2} color="#86efac" />

      <TextSprite 
        text="etcd" 
        subText="Data Store"
        position={[0, -1.4, 0]} 
        visible={!hideLabel}
      />
    </group>
  )
}

// Controller Manager - Planet with orbiting satellites
function ControllerManager({ onClick, isHighlighted, hideLabel }: { onClick: () => void; isHighlighted: boolean; hideLabel: boolean }) {
  const planetRef = useRef<THREE.Mesh>(null)
  const orbitRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = state.clock.elapsedTime * 0.2
    }
    if (orbitRef.current) {
      orbitRef.current.rotation.y = state.clock.elapsedTime * 0.3
    }
  })

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.25}>
      <group position={[-8, 0, 0]}>
        {/* Main planet */}
        <mesh
          ref={planetRef}
          onClick={onClick}
          onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
        >
          <icosahedronGeometry args={[1, 2]} />
          <meshPhysicalMaterial
            color="#f59e0b"
            emissive="#d97706"
            emissiveIntensity={hovered || isHighlighted ? 0.6 : 0.3}
            roughness={0.2}
            metalness={0.8}
            clearcoat={0.8}
            clearcoatRoughness={0.2}
          />
        </mesh>

        {/* Orbit ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.2, 0.02, 8, 64]} />
          <meshBasicMaterial color="#fcd34d" transparent opacity={0.4} />
        </mesh>

        {/* Orbiting satellites (controllers) */}
        <group ref={orbitRef}>
          {CONTROLLER_SATELLITES.map((sat) => {
            const x = Math.cos(sat.angle) * 2.2
            const z = Math.sin(sat.angle) * 2.2
            return (
              <group key={sat.id} position={[x, 0, z]}>
                <mesh scale={0.25}>
                  <octahedronGeometry args={[1, 0]} />
                  <meshPhysicalMaterial
                    color="#fbbf24"
                    emissive="#f59e0b"
                    emissiveIntensity={0.5}
                    roughness={0.1}
                    metalness={0.9}
                    clearcoat={1}
                  />
                </mesh>
              </group>
            )
          })}
        </group>

        <Sparkles count={15} scale={4} size={1} speed={0.4} color="#fcd34d" />

        <TextSprite 
          text="kube-controller-manager" 
          subText="Controllers"
          position={[0, -2.2, 0]} 
          visible={!hideLabel}
        />
      </group>
    </Float>
  )
}

// Scheduler - Pyramid shape
function Scheduler({ onClick, isHighlighted, hideLabel }: { onClick: () => void; isHighlighted: boolean; hideLabel: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const wireframeRef = useRef<THREE.LineSegments>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.2
      const hover = Math.sin(state.clock.elapsedTime * 1.5) * 0.05
      meshRef.current.position.y = hover
    }
    if (wireframeRef.current && meshRef.current) {
      wireframeRef.current.rotation.copy(meshRef.current.rotation)
      wireframeRef.current.position.copy(meshRef.current.position)
    }
  })

  const wireframeGeo = useMemo(() => {
    return new THREE.EdgesGeometry(new THREE.ConeGeometry(1, 1.5, 4))
  }, [])

  return (
    <Float speed={1.3} rotationIntensity={0.1} floatIntensity={0.2}>
      <group position={[8, 0, 0]}>
        {/* Pyramid */}
        <mesh
          ref={meshRef}
          onClick={onClick}
          onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
        >
          <coneGeometry args={[1, 1.5, 4]} />
          <meshPhysicalMaterial
            color="#ec4899"
            emissive="#db2777"
            emissiveIntensity={hovered || isHighlighted ? 0.7 : 0.35}
            roughness={0.1}
            metalness={0.9}
            clearcoat={1}
            clearcoatRoughness={0.1}
            transparent
            opacity={0.9}
          />
        </mesh>

        {/* Wireframe */}
        <lineSegments ref={wireframeRef} scale={1.02}>
          <bufferGeometry attach="geometry" {...wireframeGeo} />
          <lineBasicMaterial color="#f9a8d4" transparent opacity={hovered ? 0.8 : 0.4} />
        </lineSegments>

        <Sparkles count={15} scale={3} size={1.5} speed={0.3} color="#f9a8d4" />

        <TextSprite 
          text="kube-scheduler" 
          subText="Scheduling"
          position={[0, -2, 0]} 
          visible={!hideLabel}
        />
      </group>
    </Float>
  )
}

// Worker Node - Box containing components
function WorkerNode({ 
  position, 
  nodeId,
  onClick, 
  isHighlighted,
  hideLabel
}: { 
  position: [number, number, number]
  nodeId: string
  onClick: () => void
  isHighlighted: boolean
  hideLabel: boolean
}) {
  const boxRef = useRef<THREE.Mesh>(null)
  const innerRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (innerRef.current) {
      innerRef.current.rotation.y = state.clock.elapsedTime * 0.1
    }
  })

  return (
    <Float speed={0.8} rotationIntensity={0.05} floatIntensity={0.15}>
      <group position={position}>
        {/* Main box container */}
        <mesh
          ref={boxRef}
          onClick={onClick}
          onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
        >
          <boxGeometry args={[3, 2.5, 2]} />
          <meshPhysicalMaterial
            color="#0e7490"
            emissive="#06b6d4"
            emissiveIntensity={hovered || isHighlighted ? 0.3 : 0.15}
            roughness={0.2}
            metalness={0.3}
            clearcoat={0.5}
            clearcoatRoughness={0.3}
            transparent
            opacity={0.3}
          />
        </mesh>
        
        {/* Wireframe edge */}
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(3, 2.5, 2)]} />
          <lineBasicMaterial color="#67e8f9" transparent opacity={hovered ? 0.8 : 0.4} />
        </lineSegments>

        {/* Inner components */}
        <group ref={innerRef}>
          {/* Kubelet - center */}
          <group position={[0, 0.3, 0]}>
            <mesh scale={0.35}>
              <boxGeometry args={[1, 1, 1]} />
              <meshPhysicalMaterial
                color="#06b6d4"
                emissive="#0891b2"
                emissiveIntensity={0.5}
                roughness={0.2}
                metalness={0.8}
                clearcoat={0.5}
              />
            </mesh>
            <SmallTextSprite text="kubelet" position={[0, 0.45, 0]} color="#67e8f9" visible={!hideLabel} scale={0.7} />
          </group>

          {/* kube-proxy */}
          <group position={[0.6, -0.3, 0.3]}>
            <mesh scale={0.22}>
              <octahedronGeometry args={[1, 0]} />
              <meshPhysicalMaterial
                color="#8b5cf6"
                emissive="#7c3aed"
                emissiveIntensity={0.5}
                roughness={0.2}
                metalness={0.8}
              />
            </mesh>
            <SmallTextSprite text="kube-proxy" position={[0, 0.35, 0]} color="#c4b5fd" visible={!hideLabel} scale={0.6} />
          </group>

          {/* Container runtime */}
          <group position={[-0.5, -0.3, -0.2]}>
            <mesh scale={0.25}>
              <cylinderGeometry args={[0.5, 0.5, 0.8, 8]} />
              <meshPhysicalMaterial
                color="#64748b"
                emissive="#475569"
                emissiveIntensity={0.4}
                roughness={0.3}
                metalness={0.7}
              />
            </mesh>
            <SmallTextSprite text="containerd" position={[0, 0.4, 0]} color="#94a3b8" visible={!hideLabel} scale={0.6} />
          </group>
        </group>

        <Sparkles count={8} scale={3.5} size={1} speed={0.2} color="#67e8f9" />

        <TextSprite 
          text={nodeId} 
          subText="Worker Node"
          position={[0, -2, 0]} 
          visible={!hideLabel}
        />
      </group>
    </Float>
  )
}

// CoreDNS - Floating DNS server
function CoreDNS({ onClick, isHighlighted, hideLabel }: { onClick: () => void; isHighlighted: boolean; hideLabel: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.3
    }
  })

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
      <group 
        position={[4, -3, -5]}
        onClick={onClick}
        onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
      >
        {/* DNS symbol - stacked rings */}
        <group ref={groupRef}>
          <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.5, 0.08, 8, 32]} />
            <meshPhysicalMaterial
              color="#3b82f6"
              emissive="#2563eb"
              emissiveIntensity={hovered || isHighlighted ? 0.7 : 0.4}
              roughness={0.1}
              metalness={0.9}
              clearcoat={1}
            />
          </mesh>
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.4, 0.08, 8, 32]} />
            <meshPhysicalMaterial
              color="#60a5fa"
              emissive="#3b82f6"
              emissiveIntensity={hovered || isHighlighted ? 0.6 : 0.35}
              roughness={0.1}
              metalness={0.9}
              clearcoat={1}
            />
          </mesh>
          <mesh position={[0, -0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.3, 0.08, 8, 32]} />
            <meshPhysicalMaterial
              color="#93c5fd"
              emissive="#60a5fa"
              emissiveIntensity={hovered || isHighlighted ? 0.5 : 0.3}
              roughness={0.1}
              metalness={0.9}
              clearcoat={1}
            />
          </mesh>
        </group>

        <Sparkles count={12} scale={2} size={1} speed={0.4} color="#93c5fd" />

        <TextSprite 
          text="CoreDNS" 
          subText="Cluster DNS"
          position={[0, -1.5, 0]} 
          visible={!hideLabel}
          scale={0.8}
        />
      </group>
    </Float>
  )
}

// CNI Plugin - Network mesh
function CNIPlugin({ onClick, isHighlighted, hideLabel }: { onClick: () => void; isHighlighted: boolean; hideLabel: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.2
      meshRef.current.rotation.z = state.clock.elapsedTime * 0.15
    }
  })

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.25}>
      <group 
        position={[-4, -3, -5]}
        onClick={onClick}
        onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
      >
        {/* Network mesh - icosahedron wireframe */}
        <mesh ref={meshRef}>
          <icosahedronGeometry args={[0.7, 1]} />
          <meshPhysicalMaterial
            color="#10b981"
            emissive="#059669"
            emissiveIntensity={hovered || isHighlighted ? 0.6 : 0.3}
            roughness={0.1}
            metalness={0.9}
            clearcoat={1}
            wireframe
          />
        </mesh>

        {/* Inner core */}
        <mesh scale={0.3}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color="#6ee7b7" transparent opacity={0.7} />
        </mesh>

        <Sparkles count={12} scale={2} size={1} speed={0.3} color="#6ee7b7" />

        <TextSprite 
          text="CNI" 
          subText="Networking"
          position={[0, -1.5, 0]} 
          visible={!hideLabel}
          scale={0.8}
        />
      </group>
    </Float>
  )
}

// Control Plane Container - transparent box grouping control plane components
function ControlPlaneContainer({ hideLabel }: { hideLabel: boolean }) {
  return (
    <group position={[0, 1.5, -1]}>
      {/* Transparent container box - smaller now that etcd is closer */}
      <mesh>
        <boxGeometry args={[22, 9, 6]} />
        <meshPhysicalMaterial
          color="#6366f1"
          emissive="#4f46e5"
          emissiveIntensity={0.1}
          roughness={0.5}
          metalness={0.1}
          transparent
          opacity={0.12}
          side={THREE.BackSide}
        />
      </mesh>
      
      {/* Wireframe edges - more visible */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(22, 9, 6)]} />
        <lineBasicMaterial color="#818cf8" transparent opacity={0.35} />
      </lineSegments>
      
      {/* Label on front face of box */}
      <TextSprite 
        text="Control Plane" 
        position={[0, 4, 3.1]} 
        visible={!hideLabel}
        scale={0.85}
      />
    </group>
  )
}

// Worker Nodes Container - transparent box grouping worker nodes
function WorkerNodesContainer({ hideLabel }: { hideLabel: boolean }) {
  return (
    <group position={[0, -7, 3]}>
      {/* Transparent container box */}
      <mesh>
        <boxGeometry args={[14, 5, 4]} />
        <meshPhysicalMaterial
          color="#06b6d4"
          emissive="#0891b2"
          emissiveIntensity={0.08}
          roughness={0.5}
          metalness={0.1}
          transparent
          opacity={0.1}
          side={THREE.BackSide}
        />
      </mesh>
      
      {/* Wireframe edges */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(14, 5, 4)]} />
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.3} />
      </lineSegments>
      
      {/* Label on front face */}
      <TextSprite 
        text="Worker Nodes" 
        position={[0, 2.2, 2.1]} 
        visible={!hideLabel}
        scale={0.75}
      />
    </group>
  )
}

// Client / kubectl - terminal-like box with container
function KubectlClient({ 
  onClick, 
  isHighlighted,
  hideLabel
}: { 
  onClick: () => void
  isHighlighted: boolean
  hideLabel: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (groupRef.current) {
      // Gentle floating
      groupRef.current.position.y = 0 + Math.sin(state.clock.elapsedTime * 0.5) * 0.1
    }
  })

  return (
    <group position={[0, 0, 12]}>
      {/* Client container box */}
      <mesh>
        <boxGeometry args={[5, 4, 2]} />
        <meshPhysicalMaterial
          color="#22c55e"
          emissive="#16a34a"
          emissiveIntensity={0.05}
          roughness={0.5}
          metalness={0.1}
          transparent
          opacity={0.1}
          side={THREE.BackSide}
        />
      </mesh>
      
      {/* Container wireframe */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(5, 4, 2)]} />
        <lineBasicMaterial color="#4ade80" transparent opacity={0.3} />
      </lineSegments>
      
      {/* Container label on front face */}
      <TextSprite 
        text="Client" 
        position={[0, 1.7, 1.1]} 
        visible={!hideLabel}
        scale={0.7}
      />
      
      {/* Terminal box inside container */}
      <group 
        ref={groupRef}
        onClick={onClick}
        onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
      >
        {/* Terminal-like box */}
        <mesh>
          <boxGeometry args={[2.5, 1.5, 0.3]} />
          <meshPhysicalMaterial
            color="#1e293b"
            emissive="#334155"
            emissiveIntensity={hovered || isHighlighted ? 0.5 : 0.2}
            roughness={0.3}
            metalness={0.5}
            clearcoat={0.8}
          />
        </mesh>
        
        {/* Screen glow */}
        <mesh position={[0, 0, 0.16]}>
          <planeGeometry args={[2.2, 1.2]} />
          <meshBasicMaterial 
            color="#22c55e" 
            transparent 
            opacity={hovered || isHighlighted ? 0.4 : 0.2} 
          />
        </mesh>
        
        {/* Terminal prompt lines */}
        <mesh position={[-0.5, 0.3, 0.17]}>
          <planeGeometry args={[1, 0.08]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.8} />
        </mesh>
        <mesh position={[-0.3, 0, 0.17]}>
          <planeGeometry args={[1.4, 0.08]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.6} />
        </mesh>
        <mesh position={[-0.6, -0.3, 0.17]}>
          <planeGeometry args={[0.8, 0.08]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.4} />
        </mesh>
        
        {/* Wireframe */}
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(2.5, 1.5, 0.3)]} />
          <lineBasicMaterial color="#475569" transparent opacity={hovered ? 0.8 : 0.4} />
        </lineSegments>

        <Sparkles count={8} scale={3} size={1} speed={0.3} color="#22c55e" />

        <SmallTextSprite 
          text="kubectl" 
          position={[0, -1, 0]} 
          color="#4ade80"
          visible={!hideLabel}
          scale={0.9}
        />
      </group>
    </group>
  )
}

// Connection lines between components
function ConnectionLines({ flowStep }: { flowStep: number }) {
  const connections = useMemo(() => [
    // kubectl to API Server
    { from: [0, 0, 10] as [number, number, number], to: [0, 0, 2] as [number, number, number], color: '#22c55e', activeAt: [1] },
    // API Server to etcd (etcd now at y=3.5)
    { from: [0, 1.5, 0] as [number, number, number], to: [0, 2.5, 0] as [number, number, number], color: '#22c55e', activeAt: [2, 3] },
    // Controller Manager to API Server
    { from: [-6, 0, 0] as [number, number, number], to: [-1.5, 0, 0] as [number, number, number], color: '#f59e0b', activeAt: [4, 5] },
    // Scheduler to API Server
    { from: [6, 0, 0] as [number, number, number], to: [1.5, 0, 0] as [number, number, number], color: '#ec4899', activeAt: [6, 7] },
    // API Server to Node 1
    { from: [0, -1.5, 0] as [number, number, number], to: [-5, -5.5, 3] as [number, number, number], color: '#06b6d4', activeAt: [8] },
    // API Server to Node 2
    { from: [0, -1.5, 0] as [number, number, number], to: [5, -5.5, 3] as [number, number, number], color: '#06b6d4', activeAt: [8] },
  ], [])

  return (
    <group>
      {connections.map((conn, i) => {
        const isActive = conn.activeAt.includes(flowStep)
        const midY = (conn.from[1] + conn.to[1]) / 2
        const midPoint: [number, number, number] = [
          (conn.from[0] + conn.to[0]) / 2,
          midY + 0.5,
          (conn.from[2] + conn.to[2]) / 2,
        ]

        return (
          <group key={i}>
            {/* Line */}
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  count={3}
                  array={new Float32Array([...conn.from, ...midPoint, ...conn.to])}
                  itemSize={3}
                />
              </bufferGeometry>
              <lineBasicMaterial 
                color={conn.color} 
                transparent 
                opacity={isActive ? 0.9 : 0.2}
                linewidth={2}
              />
            </line>

            {/* Animated pulse when active */}
            {isActive && (
              <mesh position={midPoint}>
                <sphereGeometry args={[0.15, 16, 16]} />
                <meshBasicMaterial color={conn.color} transparent opacity={0.8} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

// Background stars
function BackgroundStars() {
  const starsRef = useRef<THREE.Points>(null)

  const positions = useMemo(() => {
    const pos = new Float32Array(1500 * 3)
    for (let i = 0; i < 1500; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80
      pos[i * 3 + 1] = (Math.random() - 0.5) * 80
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80
    }
    return pos
  }, [])

  useFrame((state) => {
    if (starsRef.current) {
      starsRef.current.rotation.y = state.clock.elapsedTime * 0.005
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
      <pointsMaterial size={0.08} color="#ffffff" transparent opacity={0.5} sizeAttenuation />
    </points>
  )
}

// Main scene
function Scene({ 
  selectedComponent, 
  setSelectedComponent,
  flowStep,
  hideLabels
}: { 
  selectedComponent: string | null
  setSelectedComponent: (id: string | null) => void
  flowStep: number
  hideLabels: boolean
}) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.5} color="#ffffff" />
      <pointLight position={[-10, -10, -10]} intensity={0.3} color="#8b5cf6" />
      <pointLight position={[0, 15, 0]} intensity={0.2} color="#6366f1" />

      <BackgroundStars />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        minDistance={12}
        maxDistance={50}
        autoRotate={!selectedComponent}
        autoRotateSpeed={0.2}
      />

      {/* Connection lines */}
      <ConnectionLines flowStep={flowStep} />

      {/* Control Plane Container */}
      <ControlPlaneContainer hideLabel={hideLabels} />

      {/* Client */}
      <KubectlClient 
        onClick={() => setSelectedComponent('kubectl')} 
        isHighlighted={selectedComponent === 'kubectl' || flowStep === 1}
        hideLabel={hideLabels}
      />

      {/* Control Plane Components */}
      <APIServer 
        onClick={() => setSelectedComponent('kube-apiserver')} 
        isHighlighted={selectedComponent === 'kube-apiserver' || flowStep > 0}
        hideLabel={hideLabels}
      />
      <Etcd 
        onClick={() => setSelectedComponent('etcd')} 
        isHighlighted={selectedComponent === 'etcd' || [2, 3].includes(flowStep)}
        hideLabel={hideLabels}
      />
      <ControllerManager 
        onClick={() => setSelectedComponent('kube-controller-manager')} 
        isHighlighted={selectedComponent === 'kube-controller-manager' || [4, 5].includes(flowStep)}
        hideLabel={hideLabels}
      />
      <Scheduler 
        onClick={() => setSelectedComponent('kube-scheduler')} 
        isHighlighted={selectedComponent === 'kube-scheduler' || [6, 7].includes(flowStep)}
        hideLabel={hideLabels}
      />

      {/* Worker Nodes */}
      <WorkerNodesContainer hideLabel={hideLabels} />
      <WorkerNode 
        position={[-5, -7, 3]} 
        nodeId="node-1"
        onClick={() => setSelectedComponent('node-1')} 
        isHighlighted={selectedComponent === 'node-1' || flowStep >= 8}
        hideLabel={hideLabels}
      />
      <WorkerNode 
        position={[5, -7, 3]} 
        nodeId="node-2"
        onClick={() => setSelectedComponent('node-2')} 
        isHighlighted={selectedComponent === 'node-2'}
        hideLabel={hideLabels}
      />

      {/* Cluster Addons */}
      <CoreDNS 
        onClick={() => setSelectedComponent('coredns')} 
        isHighlighted={selectedComponent === 'coredns'}
        hideLabel={hideLabels}
      />
      <CNIPlugin 
        onClick={() => setSelectedComponent('cni')} 
        isHighlighted={selectedComponent === 'cni'}
        hideLabel={hideLabels}
      />
    </>
  )
}

// Main component
export function ControlPlaneView() {
  const { controlPlaneComponent, setControlPlaneComponent, controlPlaneSearch, setControlPlaneSearch } = useExplorerStore((state) => ({
    controlPlaneComponent: state.controlPlaneComponent,
    setControlPlaneComponent: state.setControlPlaneComponent,
    controlPlaneSearch: state.controlPlaneSearch,
    setControlPlaneSearch: state.setControlPlaneSearch,
  }))
  
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null)
  const [initialSearch, setInitialSearch] = useState<string | undefined>(undefined)
  const [flowStep, setFlowStep] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showComponentSpec, setShowComponentSpec] = useState(false)
  
  // Open component from store on mount (e.g., when navigating from deep dive)
  useEffect(() => {
    if (controlPlaneComponent) {
      setSelectedComponent(controlPlaneComponent)
      setShowComponentSpec(true)
      setInitialSearch(controlPlaneSearch)
      // Clear the store values so they don't re-apply on subsequent renders
      setControlPlaneComponent(undefined)
      setControlPlaneSearch(undefined)
    }
  }, [controlPlaneComponent, controlPlaneSearch, setControlPlaneComponent, setControlPlaneSearch])

  const startFlow = useCallback(() => {
    setIsAnimating(true)
    setFlowStep(1)
    
    // Animate through steps
    let step = 1
    const interval = setInterval(() => {
      step++
      if (step > FLOW_STEPS.length) {
        clearInterval(interval)
        setIsAnimating(false)
        setFlowStep(0)
      } else {
        setFlowStep(step)
      }
    }, 1500)
  }, [])

  // Handle component selection - show spec panel
  const handleComponentClick = useCallback((componentId: string | null) => {
    if (componentId) {
      setSelectedComponent(componentId)
      setShowComponentSpec(true)
    }
  }, [])

  // Close spec panel
  const handleCloseSpec = useCallback(() => {
    setShowComponentSpec(false)
  }, [])

  const selectedInfo = useMemo(() => {
    if (!selectedComponent) return null
    
    // Check control plane components
    const cp = CONTROL_PLANE_COMPONENTS.find(c => c.id === selectedComponent)
    if (cp) return cp

    // Check cluster addons
    const addon = CLUSTER_ADDONS.find(c => c.id === selectedComponent)
    if (addon) return addon
    
    // Check if it's kubectl
    if (selectedComponent === 'kubectl') {
      return {
        id: 'kubectl',
        name: 'kubectl',
        type: 'client' as const,
        description: 'The Kubernetes command-line tool. Allows you to run commands against Kubernetes clusters to deploy applications, inspect resources, and view logs.',
        position: [0, 0, 12] as [number, number, number],
        color: '#22c55e',
        emissive: '#16a34a',
        subComponents: [
          'kubectl apply - Apply configuration to resources',
          'kubectl get - Display resources',
          'kubectl describe - Show detailed resource info',
          'kubectl logs - Print container logs',
          'kubectl exec - Execute command in container',
          'kubectl delete - Delete resources',
          'kubectl scale - Scale deployments/replicas',
          'kubectl rollout - Manage rollouts',
          'kubectl create - Create resources',
          'kubectl edit - Edit resources in-place',
          'kubectl port-forward - Forward local port to pod',
          'kubectl cp - Copy files to/from containers',
          'kubectl top - Display resource usage',
          'kubectl config - Manage kubeconfig',
          'kubectl auth - Inspect authorization',
        ],
      }
    }
    
    // Check if it's a node
    if (selectedComponent.startsWith('node-')) {
      return {
        id: selectedComponent,
        name: selectedComponent,
        type: 'node-component' as const,
        description: 'A worker node runs your application workloads. It contains the kubelet, kube-proxy, and container runtime.',
        position: [0, 0, 0] as [number, number, number],
        color: '#06b6d4',
        emissive: '#0891b2',
        subComponents: ['kubelet', 'kube-proxy', 'containerd', 'CNI plugins'],
      }
    }
    
    return null
  }, [selectedComponent])

  return (
    <div className={styles.container}>
      <div className={styles.canvasContainer}>
        <Canvas
          camera={{ position: [0, 5, 25], fov: 50 }}
          gl={{ antialias: true, alpha: true }}
        >
          <Scene 
            selectedComponent={selectedComponent}
            setSelectedComponent={handleComponentClick}
            flowStep={flowStep}
            hideLabels={showComponentSpec}
          />
        </Canvas>
      </div>

      {/* Demoscene effects */}
      <div className={styles.scanlines} />
      <div className={styles.vignette} />

      {/* Toggle button */}
      <button 
        className={styles.sidebarToggle}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{ right: sidebarOpen ? '316px' : '1rem' }}
      >
        {sidebarOpen ? '→' : '☰'}
      </button>

      <div className={`${styles.sidebar} ${!sidebarOpen ? styles.collapsed : ''}`}>
        <div className={styles.sidebarHeader}>
          <h2>Kubernetes Architecture</h2>
          <p>Control plane and worker node components</p>
        </div>

        <div className={styles.flowControl}>
          <button 
            className={styles.flowButton}
            onClick={startFlow}
            disabled={isAnimating}
          >
            {isAnimating ? 'Animating...' : '▶ Show Deployment Flow'}
          </button>
          
          {flowStep > 0 && flowStep <= FLOW_STEPS.length && (
            <div className={styles.flowStep}>
              {FLOW_STEPS[flowStep - 1].label}
            </div>
          )}
        </div>

        {selectedInfo && (
          <div className={styles.componentInfo}>
            <h3>{selectedInfo.name}</h3>
            <span className={styles.componentType}>{selectedInfo.type}</span>
            <p>{selectedInfo.description}</p>
            
            {selectedInfo.subComponents && (
              <div className={styles.componentDetails}>
                <h4>Sub-components</h4>
                <ul>
                  {selectedInfo.subComponents.map(sub => (
                    <li key={sub}>{sub}</li>
                  ))}
                </ul>
              </div>
            )}

            {'relatedKEPs' in selectedInfo && selectedInfo.relatedKEPs && selectedInfo.relatedKEPs.length > 0 && (
              <div className={styles.relatedKeps}>
                <h4>Related KEPs</h4>
                <div className={styles.kepTags}>
                  {selectedInfo.relatedKEPs.map((kep: string) => (
                    <span key={kep} className={styles.kepTag}>{kep}</span>
                  ))}
                </div>
              </div>
            )}

            <button 
              className={styles.viewDetailsBtn}
              onClick={() => setShowComponentSpec(true)}
            >
              View Details →
            </button>
          </div>
        )}
      </div>

      {/* Floating Legend - bottom right */}
      <div className={styles.floatingLegend}>
        <h4>Client</h4>
        <div className={styles.legendItem}>
          <KubectlIcon size={18} color="#22c55e" />
          <span>kubectl</span>
        </div>
        
        <div className={styles.legendSection}>
          <h4>Control Plane</h4>
          <div className={styles.legendItem}>
            <ApiServerIcon size={18} color="#6366f1" />
            <span>API Server</span>
          </div>
          <div className={styles.legendItem}>
            <EtcdIcon size={18} color="#22c55e" />
            <span>etcd</span>
          </div>
          <div className={styles.legendItem}>
            <ControllerManagerIcon size={18} color="#f59e0b" />
            <span>Controller Manager</span>
          </div>
          <div className={styles.legendItem}>
            <SchedulerIcon size={18} color="#ec4899" />
            <span>Scheduler</span>
          </div>
        </div>
        
        <div className={styles.legendSection}>
          <h4>Node Components</h4>
          <div className={styles.legendItem}>
            <NodeIcon size={18} color="#06b6d4" />
            <span>Worker Node</span>
          </div>
          <div className={styles.legendItem}>
            <KubeletIcon size={18} color="#06b6d4" />
            <span>kubelet</span>
          </div>
          <div className={styles.legendItem}>
            <KubeProxyIcon size={18} color="#8b5cf6" />
            <span>kube-proxy</span>
          </div>
          <div className={styles.legendItem}>
            <ContainerdIcon size={18} color="#64748b" />
            <span>containerd</span>
          </div>
        </div>

        <div className={styles.legendSection}>
          <h4>Cluster Addons</h4>
          <div className={styles.legendItem}>
            <CoreDNSIcon size={18} color="#3b82f6" />
            <span>CoreDNS</span>
          </div>
          <div className={styles.legendItem}>
            <CNIIcon size={18} color="#10b981" />
            <span>CNI Plugin</span>
          </div>
        </div>

        <div className={styles.legendSection}>
          <h4>Configuration</h4>
          <button 
            className={styles.legendButton}
            onClick={() => handleComponentClick('feature-gates')}
          >
            <span className={styles.legendButtonIcon}>🚩</span>
            <span>Feature Gates</span>
          </button>
        </div>
      </div>

      {/* Component Spec Panel */}
      {showComponentSpec && selectedComponent && (
        <ComponentSpec 
          componentId={selectedComponent}
          onClose={handleCloseSpec}
          initialSearch={initialSearch}
        />
      )}
    </div>
  )
}
