import { useRef, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import styles from './TotalCard.module.css'

// Create text sprite for slice labels with segment color
function createSliceLabel(label: string, value: number, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  canvas.width = 128
  canvas.height = 64
  
  ctx.fillStyle = 'transparent'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // Draw value (larger) in segment color
  ctx.font = 'bold 28px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1
  ctx.fillStyle = color
  ctx.fillText(String(value), canvas.width / 2, 22)
  
  // Draw label (smaller, below) in white
  ctx.font = 'bold 12px Arial'
  ctx.shadowBlur = 4
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, canvas.width / 2, 46)
  
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ 
    map: texture, 
    transparent: true,
    depthTest: false
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.2, 0.6, 1)
  
  return sprite
}

interface Segment {
  value: number
  color: string
  label: string
}

interface TotalCardProps {
  segments: Segment[]
  total: number
  totalLabel?: string
  totalSublabel?: string
}

export function TotalCard({ segments, total, totalLabel = 'Total', totalSublabel }: TotalCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const frameRef = useRef<number>(0)
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; group: THREE.Group; meshes: THREE.Mesh[] } | null>(null)
  
  const [isHovered, setIsHovered] = useState(false)
  const [hoveredSegment, setHoveredSegment] = useState<Segment | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; rotationY: number; rotationX: number } | null>(null)

  const segmentTotal = useMemo(() => segments.reduce((sum, s) => sum + s.value, 0), [segments])
  const maxValue = useMemo(() => Math.max(...segments.map(s => s.value)), [segments])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Get actual container size
    const container = canvas.parentElement
    if (!container) return
    
    const width = container.clientWidth || 280
    const height = container.clientHeight || 140
    const aspect = width / height

    // Setup renderer
    const renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true, 
      alpha: true
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    rendererRef.current = renderer

    // Setup scene
    const scene = new THREE.Scene()

    // Setup camera - close up for big pie
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100)
    camera.position.set(0, 2.5, 1.5)
    camera.lookAt(0, 0, 0)

    // Lighting - matching Analytics style
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    
    // Main directional light
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8)
    mainLight.position.set(5, 10, 5)
    scene.add(mainLight)
    
    // Accent directional light
    const accentLight = new THREE.DirectionalLight(0x8b5cf6, 0.3)
    accentLight.position.set(-5, 5, -5)
    scene.add(accentLight)

    // Create group for rotation
    const group = new THREE.Group()
    scene.add(group)

    // Create segments
    const innerRadius = 0.3
    const outerRadius = 1.6
    let currentAngle = 0
    const meshes: THREE.Mesh[] = []

    segments.forEach((seg, index) => {
      const angleSize = (seg.value / segmentTotal) * Math.PI * 2
      
      const shape = new THREE.Shape()
      const segs = Math.max(4, Math.floor(angleSize * 8))
      
      for (let j = 0; j <= segs; j++) {
        const a = currentAngle + (j / segs) * angleSize
        const x = Math.cos(a) * innerRadius
        const y = Math.sin(a) * innerRadius
        if (j === 0) shape.moveTo(x, y)
        else shape.lineTo(x, y)
      }
      
      for (let j = segs; j >= 0; j--) {
        const a = currentAngle + (j / segs) * angleSize
        const x = Math.cos(a) * outerRadius
        const y = Math.sin(a) * outerRadius
        shape.lineTo(x, y)
      }
      shape.closePath()
      
      const height = 0.12 + (seg.value / maxValue) * 0.25
      const geometry = new THREE.ExtrudeGeometry(shape, { 
        depth: height, 
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2
      })
      
      // Assign different materials to top/bottom vs sides - matching Analytics style
      // ExtrudeGeometry has groups: 0 = top, 1 = bottom, 2+ = sides
      const topMaterial = new THREE.MeshStandardMaterial({
        color: seg.color,
        metalness: 0.4,
        roughness: 0.3,
        emissive: seg.color,
        emissiveIntensity: 0.15,
      })
      
      // Darker side material for depth
      const sideMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(seg.color).multiplyScalar(0.6),
        metalness: 0.3,
        roughness: 0.4,
        emissive: seg.color,
        emissiveIntensity: 0.08,
      })
      
      const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial])
      mesh.rotation.x = -Math.PI / 2
      mesh.userData = { segment: seg, index }
      group.add(mesh)
      meshes.push(mesh)
      
      // Add text label on the slice
      const midAngle = currentAngle + angleSize / 2
      const labelRadius = (innerRadius + outerRadius) * 0.55
      const labelX = Math.cos(midAngle) * labelRadius
      const labelZ = Math.sin(midAngle) * labelRadius
      const labelY = height + 0.08
      
      const sprite = createSliceLabel(seg.label, seg.value, seg.color)
      sprite.position.set(labelX, labelY, labelZ)
      sprite.scale.set(0.7, 0.35, 1)
      group.add(sprite)
      
      currentAngle += angleSize
    })

    // Center sphere - glowing
    const sphereGeo = new THREE.SphereGeometry(0.15, 16, 16)
    const sphereMat = new THREE.MeshPhongMaterial({
      color: '#6366f1',
      emissive: '#6366f1',
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
      shininess: 100
    })
    const sphere = new THREE.Mesh(sphereGeo, sphereMat)
    sphere.position.y = 0.15
    group.add(sphere)

    sceneRef.current = { scene, camera, group, meshes }

    // Animation loop
    let targetZoom = 1
    let currentZoom = 1
    let autoRotate = true
    let manualRotationY = 0
    let manualRotationX = 0
    let velocityY = 0
    let velocityX = 0
    const baseTiltX = -0.3 // Default tilt
    
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate)
      
      // Auto-rotate or apply manual rotation with momentum
      if (autoRotate) {
        group.rotation.y += 0.002  // Slower rotation like Analytics
        // Ease back to default tilt (slower)
        group.rotation.x += (baseTiltX - group.rotation.x) * 0.02
      } else {
        group.rotation.y = manualRotationY
        group.rotation.x = manualRotationX
        // Apply friction to velocity
        velocityY *= 0.95
        velocityX *= 0.95
        manualRotationY += velocityY
        manualRotationX += velocityX
        // Clamp tilt
        manualRotationX = Math.max(-1.2, Math.min(0.3, manualRotationX))
        // Resume auto-rotate when velocity is very low
        if (Math.abs(velocityY) < 0.0001 && Math.abs(velocityX) < 0.0001) {
          autoRotate = true
        }
      }
      
      // Smooth zoom (slower)
      currentZoom += (targetZoom - currentZoom) * 0.03
      camera.position.y = 2.5 * currentZoom
      camera.position.z = 1.5 * currentZoom
      camera.lookAt(0, 0, 0)
      
      renderer.render(scene, camera)
    }
    animate()

    // Store zoom setter for reset on leave
    ;(canvas as any)._resetZoom = () => {
      targetZoom = 1
    }
    
    // Reset all to defaults (zoom + tilt)
    ;(canvas as any)._resetAll = () => {
      targetZoom = 1
      autoRotate = true // This will ease tilt back to baseTiltX
    }
    
    // Manual zoom control
    ;(canvas as any)._zoom = (delta: number) => {
      targetZoom = Math.max(0.3, Math.min(2, targetZoom + delta))
    }
    
    // Store rotation controls
    ;(canvas as any)._startDrag = () => {
      autoRotate = false
      manualRotationY = group.rotation.y
      manualRotationX = group.rotation.x
      velocityY = 0
      velocityX = 0
      return { rotationY: manualRotationY, rotationX: manualRotationX }
    }
    ;(canvas as any)._drag = (deltaX: number, deltaY: number, startRotationY: number, startRotationX: number) => {
      manualRotationY = startRotationY + deltaX * 0.01
      manualRotationX = Math.max(-1.2, Math.min(0.3, startRotationX + deltaY * 0.01))
      velocityY = deltaX * 0.001
      velocityX = deltaY * 0.001
    }
    ;(canvas as any)._endDrag = () => {
      // Keep momentum going, will auto-resume when slowed
    }

    // Cleanup
    return () => {
      cancelAnimationFrame(frameRef.current)
      renderer.dispose()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose()
          }
        }
        if (obj instanceof THREE.Sprite) {
          const mat = obj.material as THREE.SpriteMaterial
          mat.map?.dispose()
          mat.dispose()
        }
      })
    }
  }, [segments, segmentTotal, maxValue])

  // Handle hover zoom - disabled, user controls zoom now
  // useEffect(() => {
  //   const canvas = canvasRef.current
  //   if (canvas && (canvas as any)._setZoom) {
  //     (canvas as any)._setZoom(isHovered)
  //   }
  // }, [isHovered])

  // Raycasting for segment hover - need to account for group rotation
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const sceneData = sceneRef.current
    if (!canvas || !sceneData) return

    // Handle drag rotation
    if (isDragging && dragStartRef.current) {
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y
      ;(canvas as any)._drag?.(deltaX, deltaY, dragStartRef.current.rotationY, dragStartRef.current.rotationX)
      return // Don't do hover detection while dragging
    }

    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(x, y), sceneData.camera)
    
    // Raycast against all children in the group (meshes rotate with group)
    const intersects = raycaster.intersectObjects(sceneData.group.children, true)
    
    // Find first mesh intersection (skip lines and sprites)
    const meshHit = intersects.find(i => i.object instanceof THREE.Mesh && i.object.userData.segment)
    
    if (meshHit) {
      setHoveredSegment((meshHit.object as THREE.Mesh).userData.segment)
    } else {
      setHoveredSegment(null)
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    setIsDragging(true)
    const rotations = (canvas as any)._startDrag?.() || { rotationY: 0, rotationX: 0 }
    dragStartRef.current = { x: e.clientX, y: e.clientY, rotationY: rotations.rotationY, rotationX: rotations.rotationX }
  }

  const handleMouseUp = () => {
    const canvas = canvasRef.current
    if (isDragging && canvas) {
      ;(canvas as any)._endDrag?.()
    }
    setIsDragging(false)
    dragStartRef.current = null
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    setHoveredSegment(null)
    
    const canvas = canvasRef.current
    if (canvas) {
      // Reset everything smoothly (zoom + tilt + resume auto-rotate)
      ;(canvas as any)._resetAll?.()
      
      if (isDragging) {
        ;(canvas as any)._endDrag?.()
      }
    }
    setIsDragging(false)
    dragStartRef.current = null
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    
    const delta = e.deltaY > 0 ? 0.1 : -0.1
    ;(canvas as any)._zoom?.(delta)
  }

  return (
    <div 
      className={`${styles.card} ${isHovered ? styles.hovered : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.canvasContainer}>
        <canvas 
          ref={canvasRef} 
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        />
      </div>
      
      <div className={styles.overlay}>
        {hoveredSegment ? (
          <>
            <div className={styles.number} style={{ color: hoveredSegment.color }}>{hoveredSegment.value}</div>
            <div className={styles.label}>{hoveredSegment.label}</div>
          </>
        ) : (
          <>
            <div className={styles.number}>{total}</div>
            <div className={styles.label}>{totalLabel}</div>
            {totalSublabel && <div className={styles.sublabel}>{totalSublabel}</div>}
          </>
        )}
      </div>
    </div>
  )
}
