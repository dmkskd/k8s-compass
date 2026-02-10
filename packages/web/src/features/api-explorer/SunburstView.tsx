import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { useExplorerStore } from '../../shared/store/explorerStore'
import type { APIGroup } from '../../shared/types'
import styles from './SunburstView.module.css'

interface SunburstGroup extends APIGroup {
  color: string
}

interface SunburstViewProps {
  groups: SunburstGroup[]
}

interface HierarchyData {
  name: string
  value?: number
  children?: HierarchyData[]
  data?: {
    type: 'root' | 'group' | 'version' | 'kind'
    group?: string
    kind?: string
    color?: string
    fieldCount?: number
  }
}

function buildHierarchy(groups: SunburstGroup[]): HierarchyData {
  return {
    name: 'Kubernetes API',
    data: { type: 'root' },
    children: groups.map((group) => ({
      name: group.displayName,
      data: { type: 'group' as const, group: group.name, color: group.color },
      children: group.versions.map((version) => ({
        name: version.name,
        data: { type: 'version' as const, group: group.name, color: group.color },
        children: version.kinds.map((kind) => ({
          name: kind.name,
          value: Math.max(kind.fieldCount, 10),
          data: {
            type: 'kind' as const,
            group: group.name,
            kind: kind.name,
            color: group.color,
            fieldCount: kind.fieldCount,
          },
        })),
      })),
    })),
  }
}

type PartitionedNode = d3.HierarchyRectangularNode<HierarchyData>

export function SunburstView({ groups }: SunburstViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const rotationRef = useRef<{ angle: number; velocity: number; animationId: number | null }>({
    angle: 0,
    velocity: 0,
    animationId: null,
  })
  const dragRef = useRef<{ startAngle: number; startRotation: number; lastAngle: number; lastTime: number } | null>(null)
  
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    content: { name: string; type: string; details?: string }
  } | null>(null)
  const [focusedNode, setFocusedNode] = useState<PartitionedNode | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  
  const { setSelectedKind, searchQuery } = useExplorerStore()

  // Compute matching kinds based on search query
  const matchingKinds = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) return null
    const query = searchQuery.toLowerCase().trim()
    const matches = new Set<string>()
    
    groups.forEach(group => {
      group.versions.forEach(version => {
        version.kinds.forEach(kind => {
          if (
            kind.name.toLowerCase().includes(query) ||
            group.name.toLowerCase().includes(query) ||
            group.displayName.toLowerCase().includes(query) ||
            kind.shortNames?.some(sn => sn.toLowerCase().includes(query))
          ) {
            matches.add(kind.name)
          }
        })
      })
    })
    
    return matches
  }, [searchQuery, groups])

  // Color function
  const getColor = useCallback((d: PartitionedNode): string => {
    if (d.data.data?.color) return d.data.data.color
    if (d.parent?.data.data?.color) return d.parent.data.data.color
    if (d.depth === 0) return '#1e293b'
    return '#64748b'
  }, [])

  // Main effect - handles everything
  useEffect(() => {
    if (!containerRef.current || !svgRef.current || groups.length === 0) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight
    const radius = Math.min(width, height) / 2 - 40

    // Clear SVG
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    // Create outer group for positioning and zoom
    const outerG = svg.append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`)
    
    // Create zoom container (this gets transformed by zoom)
    const zoomG = outerG.append('g')
      .attr('class', 'zoom-container')
    
    // Inner group for rotation animation
    const g = zoomG.append('g')
      .style('animation', 'gentleSpin 270s linear infinite')
      .style('transform-origin', '0 0')

    // Setup zoom behavior - zoom centered on the sunburst
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 5]) // Min zoom is 1 (current size), max is 5x
      .filter((event) => {
        // Only allow zoom on scroll, not on drag
        return event.type === 'wheel'
      })
      .on('zoom', (event) => {
        // Only apply scale, ignore translation for centered zoom
        const k = event.transform.k
        zoomG.attr('transform', `scale(${k})`)
      })

    svg.call(zoom)
    zoomBehaviorRef.current = zoom

    // Setup drag-to-spin behavior using D3 drag
    let currentRotation = rotationRef.current.angle
    
    // Helper to get current rotation from CSS animation
    const getCurrentCSSRotation = (): number => {
      const node = g.node() as SVGGElement
      if (!node) return 0
      const transform = window.getComputedStyle(node).transform
      if (transform === 'none') return rotationRef.current.angle
      
      // Parse matrix transform to get rotation
      const values = transform.match(/matrix\(([^)]+)\)/)
      if (values) {
        const parts = values[1].split(', ')
        const a = parseFloat(parts[0])
        const b = parseFloat(parts[1])
        return Math.atan2(b, a) * (180 / Math.PI)
      }
      return rotationRef.current.angle
    }
    
    const drag = d3.drag<SVGSVGElement, unknown>()
      .on('start', (event) => {
        // Cancel any momentum animation
        if (rotationRef.current.animationId) {
          cancelAnimationFrame(rotationRef.current.animationId)
          rotationRef.current.animationId = null
        }
        
        // Get current rotation from CSS animation before stopping it
        currentRotation = getCurrentCSSRotation()
        rotationRef.current.angle = currentRotation
        
        // Stop CSS animation and apply current rotation
        g.style('animation', 'none')
        g.style('transform', `rotate(${currentRotation}deg)`)
        
        const centerX = width / 2
        const centerY = height / 2
        const dx = event.x - centerX
        const dy = event.y - centerY
        const startAngle = Math.atan2(dy, dx) * (180 / Math.PI)
        
        dragRef.current = {
          startAngle,
          startRotation: currentRotation,
          lastAngle: startAngle,
          lastTime: performance.now(),
        }
        setIsDragging(true)
      })
      .on('drag', (event) => {
        if (!dragRef.current) return
        
        const centerX = width / 2
        const centerY = height / 2
        const dx = event.x - centerX
        const dy = event.y - centerY
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI)
        const currentTime = performance.now()
        
        // Calculate rotation delta
        let deltaAngle = currentAngle - dragRef.current.startAngle
        if (deltaAngle > 180) deltaAngle -= 360
        if (deltaAngle < -180) deltaAngle += 360
        
        currentRotation = dragRef.current.startRotation + deltaAngle
        rotationRef.current.angle = currentRotation
        g.style('transform', `rotate(${currentRotation}deg)`)
        
        // Calculate velocity for momentum
        const timeDelta = currentTime - dragRef.current.lastTime
        if (timeDelta > 0) {
          let angleDelta = currentAngle - dragRef.current.lastAngle
          if (angleDelta > 180) angleDelta -= 360
          if (angleDelta < -180) angleDelta += 360
          rotationRef.current.velocity = angleDelta / timeDelta * 16
        }
        
        dragRef.current.lastAngle = currentAngle
        dragRef.current.lastTime = currentTime
      })
      .on('end', () => {
        dragRef.current = null
        setIsDragging(false)
        
        // Start momentum if there's velocity
        if (Math.abs(rotationRef.current.velocity) > 0.5) {
          const friction = 0.92 // Higher friction = stops faster
          const minVelocity = 0.1
          
          const animate = () => {
            const rot = rotationRef.current
            if (Math.abs(rot.velocity) < minVelocity) {
              // Momentum done, start slow continuous rotation
              startSlowRotation()
              return
            }
            
            rot.angle += rot.velocity
            rot.velocity *= friction
            currentRotation = rot.angle
            g.style('transform', `rotate(${rot.angle}deg)`)
            
            rot.animationId = requestAnimationFrame(animate)
          }
          
          rotationRef.current.animationId = requestAnimationFrame(animate)
        } else {
          // No momentum, start slow continuous rotation immediately
          startSlowRotation()
        }
      })
    
    // Slow continuous rotation (replaces CSS animation)
    const startSlowRotation = () => {
      // CSS animation is 270 seconds for full rotation
      // At 60fps: 270 * 60 = 16200 frames for 360 degrees
      // So per frame: 360 / 16200 = 0.0222 degrees
      const rotationSpeed = 0.022 // degrees per frame, same direction as CSS
      
      const animate = () => {
        const rot = rotationRef.current
        rot.angle -= rotationSpeed // Negative to match CSS animation direction
        g.style('transform', `rotate(${rot.angle}deg)`)
        rot.animationId = requestAnimationFrame(animate)
      }
      
      rotationRef.current.animationId = requestAnimationFrame(animate)
    }

    svg.call(drag as any)

    // Build hierarchy
    const hierarchyData = buildHierarchy(groups)
    const root = d3.hierarchy<HierarchyData>(hierarchyData)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    // Create partition layout
    const partition = d3.partition<HierarchyData>().size([2 * Math.PI, radius])
    const partitionedRoot = partition(root) as PartitionedNode

    // Determine the focus (what we're zoomed into)
    // Need to find the equivalent node in the new partition if focusedNode exists
    let focus: PartitionedNode = partitionedRoot
    if (focusedNode) {
      // Find node with same name and type
      const found = partitionedRoot.descendants().find(d => 
        d.data.name === focusedNode.data.name && 
        d.data.data?.type === focusedNode.data.data?.type
      )
      if (found) focus = found
    }

    // Arc generator that takes focus into account
    const arc = d3.arc<PartitionedNode>()
      .startAngle((d) => {
        // Scale angle relative to focus
        const focusRange = focus.x1 - focus.x0
        return ((d.x0 - focus.x0) / focusRange) * 2 * Math.PI
      })
      .endAngle((d) => {
        const focusRange = focus.x1 - focus.x0
        return ((d.x1 - focus.x0) / focusRange) * 2 * Math.PI
      })
      .padAngle(0.002)
      .padRadius(radius / 2)
      .innerRadius((d) => {
        // Scale radius relative to focus
        const focusY0 = focus.y0
        const yRange = radius - focusY0
        return Math.max(0, ((d.y0 - focusY0) / yRange) * radius)
      })
      .outerRadius((d) => {
        const focusY0 = focus.y0
        const yRange = radius - focusY0
        return Math.max(0, ((d.y1 - focusY0) / yRange) * radius - 1)
      })

    // Filter: only show descendants of focus (excluding focus itself)
    const visibleNodes = partitionedRoot.descendants().filter(d => {
      if (d === partitionedRoot && focus === partitionedRoot) return false // Never show root arc
      if (focus === partitionedRoot) return d !== partitionedRoot // At root level, show all except root
      // When zoomed, only show descendants of focus (not focus itself)
      return d.ancestors().includes(focus) && d !== focus
    })

    // Create arcs
    g.selectAll('path.arc')
      .data(visibleNodes)
      .join('path')
      .attr('class', 'arc')
      .attr('d', arc as any)
      .attr('fill', (d) => getColor(d))
      .attr('fill-opacity', (d) => {
        const depthFromFocus = d.depth - focus.depth
        let baseOpacity = depthFromFocus === 1 ? 0.9 : depthFromFocus === 2 ? 0.7 : 0.85
        
        // If searching, dim non-matching kinds
        if (matchingKinds !== null) {
          if (d.data.data?.type === 'kind') {
            // Kind nodes: highlight if matching, dim if not
            if (!matchingKinds.has(d.data.name)) {
              return 0.15
            }
            return 1 // Full opacity for matches
          } else {
            // Group/version nodes: check if any descendant kind matches
            const hasMatchingDescendant = d.leaves().some(leaf => 
              leaf.data.data?.type === 'kind' && matchingKinds.has(leaf.data.name)
            )
            if (!hasMatchingDescendant) {
              return 0.15
            }
          }
        }
        
        return baseOpacity
      })
      .attr('stroke', '#030712')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('fill-opacity', 1)
          .attr('stroke', '#f8fafc')
          .attr('stroke-width', 2)

        const rect = container.getBoundingClientRect()
        let tooltipType: string
        let tooltipDetails: string | undefined
        
        if (d.data.data?.type === 'kind') {
          tooltipType = d.data.data.group || 'API'
          tooltipDetails = `${d.data.data.fieldCount} fields`
        } else if (d.data.data?.type === 'group') {
          tooltipType = 'API Group'
          tooltipDetails = `${d.leaves().length} resources`
        } else if (d.data.data?.type === 'version') {
          tooltipType = d.data.data.group || 'Version'
          tooltipDetails = `${d.children?.length || 0} resources`
        } else {
          tooltipType = d.data.data?.type || ''
        }
        
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          content: { name: d.data.name, type: tooltipType, details: tooltipDetails },
        })
      })
      .on('mouseout', function (_, d) {
        const depthFromFocus = d.depth - focus.depth
        let baseOpacity = depthFromFocus === 1 ? 0.9 : depthFromFocus === 2 ? 0.7 : 0.85
        
        // Restore search-based opacity
        if (matchingKinds !== null) {
          if (d.data.data?.type === 'kind') {
            baseOpacity = matchingKinds.has(d.data.name) ? 1 : 0.15
          } else {
            const hasMatchingDescendant = d.leaves().some(leaf => 
              leaf.data.data?.type === 'kind' && matchingKinds.has(leaf.data.name)
            )
            if (!hasMatchingDescendant) {
              baseOpacity = 0.15
            }
          }
        }
        
        d3.select(this)
          .transition()
          .duration(150)
          .attr('fill-opacity', baseOpacity)
          .attr('stroke', '#030712')
          .attr('stroke-width', 0.5)
        setTooltip(null)
      })
      .on('click', (event, d) => {
        event.stopPropagation()
        
        if (d.data.data?.type === 'kind' && d.data.data.kind) {
          setSelectedKind(d.data.data.kind)
          return
        }
        
        if (d.data.data?.type === 'group') {
          setFocusedNode(d)
        }
      })

    // Add labels
    const isZoomed = focus !== partitionedRoot
    const groupFontSize = isZoomed ? '14px' : '11px'
    const versionFontSize = isZoomed ? '12px' : '9px'
    const kindFontSize = isZoomed ? '11px' : '8px'

    const getLabelTransform = (d: PartitionedNode): string => {
      const focusRange = focus.x1 - focus.x0
      const x0 = ((d.x0 - focus.x0) / focusRange) * 2 * Math.PI
      const x1 = ((d.x1 - focus.x0) / focusRange) * 2 * Math.PI
      
      const focusY0 = focus.y0
      const yRange = radius - focusY0
      const y0 = ((d.y0 - focusY0) / yRange) * radius
      const y1 = ((d.y1 - focusY0) / yRange) * radius
      
      const angle = ((x0 + x1) / 2) * (180 / Math.PI) - 90
      const r = (y0 + y1) / 2
      const flip = angle > 90 || angle < -90
      return `rotate(${angle}) translate(${r}, 0) rotate(${flip ? 180 : 0})`
    }

    const getArcMetrics = (d: PartitionedNode) => {
      const focusRange = focus.x1 - focus.x0
      const x0 = ((d.x0 - focus.x0) / focusRange) * 2 * Math.PI
      const x1 = ((d.x1 - focus.x0) / focusRange) * 2 * Math.PI
      
      const focusY0 = focus.y0
      const yRange = radius - focusY0
      const y0 = ((d.y0 - focusY0) / yRange) * radius
      const y1 = ((d.y1 - focusY0) / yRange) * radius
      
      const arcLength = (x1 - x0) * ((y0 + y1) / 2)
      const arcWidth = y1 - y0
      return { arcLength, arcWidth }
    }

    const labelsG = g.append('g').attr('class', 'labels')

    // Group labels (depth 1 from focus)
    const groupNodes = visibleNodes.filter(d => d.depth - focus.depth === 1)
    labelsG.selectAll('text.group-label')
      .data(groupNodes)
      .join('text')
      .attr('class', 'group-label')
      .attr('transform', getLabelTransform)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#f8fafc')
      .attr('font-size', groupFontSize)
      .attr('font-family', "'Space Grotesk', sans-serif")
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')
      .text((d) => {
        const { arcLength } = getArcMetrics(d)
        return arcLength > 25 ? d.data.name : ''
      })

    // Version labels (depth 2 from focus)
    const versionNodes = visibleNodes.filter(d => d.depth - focus.depth === 2)
    labelsG.selectAll('text.version-label')
      .data(versionNodes)
      .join('text')
      .attr('class', 'version-label')
      .attr('transform', getLabelTransform)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#f8fafc')
      .attr('font-size', versionFontSize)
      .attr('font-family', "'JetBrains Mono', monospace")
      .attr('pointer-events', 'none')
      .text((d) => {
        const { arcLength } = getArcMetrics(d)
        return arcLength > 15 ? d.data.name : ''
      })

    // Kind labels (depth 3 from focus)
    const kindNodes = visibleNodes.filter(d => d.depth - focus.depth === 3)
    labelsG.selectAll('text.kind-label')
      .data(kindNodes)
      .join('text')
      .attr('class', 'kind-label')
      .attr('transform', getLabelTransform)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#f8fafc')
      .attr('font-size', kindFontSize)
      .attr('font-family', "'Space Grotesk', sans-serif")
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')
      .text((d) => {
        const { arcLength, arcWidth } = getArcMetrics(d)
        const minLen = isZoomed ? 10 : 18
        const minWidth = isZoomed ? 8 : 12
        if (arcLength > minLen && arcWidth > minWidth) {
          const name = d.data.name
          const maxLen = isZoomed ? 20 : 12
          return name.length > maxLen ? name.slice(0, maxLen - 2) + '…' : name
        }
        return ''
      })

    // Center label (added to zoomG so it zooms with the chart, but doesn't rotate)
    const centerG = zoomG.append('g').attr('class', 'center-label')
    
    if (focusedNode) {
      centerG.append('circle')
        .attr('r', 35)
        .attr('fill', 'rgba(3, 7, 18, 0.8)')
        .attr('stroke', '#334155')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('click', () => setFocusedNode(null))

      centerG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#f8fafc')
        .attr('font-size', '14px')
        .attr('font-family', "'Space Grotesk', sans-serif")
        .attr('font-weight', '600')
        .style('cursor', 'pointer')
        .text(focusedNode.data.name)
        .on('click', () => setFocusedNode(null))

      centerG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('y', 18)
        .attr('fill', '#64748b')
        .attr('font-size', '9px')
        .attr('font-family', "'Space Grotesk', sans-serif")
        .style('cursor', 'pointer')
        .text('← back')
        .on('click', () => setFocusedNode(null))
    } else {
      centerG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#f8fafc')
        .attr('font-size', '14px')
        .attr('font-family', "'Space Grotesk', sans-serif")
        .text('K8s API')

      centerG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('y', 18)
        .attr('fill', '#64748b')
        .attr('font-size', '9px')
        .attr('font-family', "'Space Grotesk', sans-serif")
        .text('click to zoom')
    }

    // Cleanup function
    return () => {
      if (rotationRef.current.animationId) {
        cancelAnimationFrame(rotationRef.current.animationId)
      }
    }

  }, [groups, focusedNode, getColor, setSelectedKind, matchingKinds])

  // ESC key to reset zoom or exit focused group
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (focusedNode) {
          setFocusedNode(null)
        } else if (zoomBehaviorRef.current && svgRef.current) {
          // Reset zoom on ESC if not focused
          d3.select(svgRef.current)
            .transition()
            .duration(300)
            .call(zoomBehaviorRef.current.transform, d3.zoomIdentity)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedNode])

  return (
    <div 
      ref={containerRef} 
      className={styles.container}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <svg ref={svgRef} />
      
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >
          <span className={styles.tooltipName}>{tooltip.content.name}</span>
          <span className={styles.tooltipType}>{tooltip.content.type}</span>
          {tooltip.content.details && (
            <span className={styles.tooltipDetails}>{tooltip.content.details}</span>
          )}
        </div>
      )}

      <div className={styles.instructions}>
        <p>
          {focusedNode 
            ? 'Press ESC or click center to zoom out • Drag to spin • Scroll to zoom'
            : 'Click groups to zoom in • Drag to spin • Scroll to zoom • Click kinds to explore'
          }
        </p>
      </div>
    </div>
  )
}
