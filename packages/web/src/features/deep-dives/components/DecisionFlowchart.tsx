/**
 * DecisionFlowchart Component
 *
 * An interactive SVG-based flowchart that guides users through decisions.
 * Supports question, answer, and recommendation node types with
 * path highlighting and click handlers.
 *
 * @module features/deep-dives/components/DecisionFlowchart
 */

import { useState, useMemo, useCallback } from 'react'
import type { FlowchartNode } from '../index'
import styles from './DecisionFlowchart.module.css'

// =============================================================================
// Types
// =============================================================================

interface DecisionFlowchartProps {
  /** Array of flowchart nodes */
  nodes: FlowchartNode[]
  /** ID of the root node to start from */
  rootNodeId: string
  /** Callback when a recommendation is reached */
  onComplete?: (recommendation: FlowchartNode['recommendation']) => void
  /** Callback when a node is selected */
  onNodeSelect?: (nodeId: string) => void
  /** Optional title for the flowchart */
  title?: string
  /** Optional description */
  description?: string
}

interface LayoutNode {
  id: string
  node: FlowchartNode
  x: number
  y: number
  width: number
  height: number
  level: number
  parentId?: string
  edgeLabel?: string
}

interface LayoutEdge {
  id: string
  from: LayoutNode
  to: LayoutNode
  label: string
}

// =============================================================================
// Constants
// =============================================================================

const NODE_WIDTH = 220
const NODE_HEIGHT_QUESTION = 100
const NODE_HEIGHT_ANSWER = 70
const NODE_HEIGHT_RECOMMENDATION = 120
const HORIZONTAL_GAP = 60
const VERTICAL_GAP = 80
const PADDING = 40

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get node height based on type
 */
function getNodeHeight(type: FlowchartNode['type']): number {
  switch (type) {
    case 'question':
      return NODE_HEIGHT_QUESTION
    case 'recommendation':
      return NODE_HEIGHT_RECOMMENDATION
    default:
      return NODE_HEIGHT_ANSWER
  }
}

/**
 * Build a map of nodes by ID for quick lookup
 */
function buildNodeMap(nodes: FlowchartNode[]): Map<string, FlowchartNode> {
  const map = new Map<string, FlowchartNode>()
  for (const node of nodes) {
    map.set(node.id, node)
  }
  return map
}

/**
 * Calculate tree layout for nodes
 */
function calculateLayout(
  nodes: FlowchartNode[],
  rootNodeId: string
): { layoutNodes: LayoutNode[]; layoutEdges: LayoutEdge[]; width: number; height: number } {
  const nodeMap = buildNodeMap(nodes)
  const layoutNodes: LayoutNode[] = []
  const layoutEdges: LayoutEdge[] = []
  const levelWidths: Map<number, number> = new Map()
  const levelNodes: Map<number, LayoutNode[]> = new Map()

  // BFS to assign levels and collect nodes per level
  const visited = new Set<string>()
  const queue: Array<{ id: string; level: number; parentId?: string; edgeLabel?: string }> = [
    { id: rootNodeId, level: 0 },
  ]

  while (queue.length > 0) {
    const { id, level, parentId, edgeLabel } = queue.shift()!

    if (visited.has(id)) continue
    visited.add(id)

    const node = nodeMap.get(id)
    if (!node) continue

    const height = getNodeHeight(node.type)
    const layoutNode: LayoutNode = {
      id,
      node,
      x: 0, // Will be calculated later
      y: 0, // Will be calculated later
      width: NODE_WIDTH,
      height,
      level,
      parentId,
      edgeLabel,
    }

    layoutNodes.push(layoutNode)

    // Track nodes per level
    if (!levelNodes.has(level)) {
      levelNodes.set(level, [])
    }
    levelNodes.get(level)!.push(layoutNode)

    // Queue children
    if (node.children) {
      for (const child of node.children) {
        if (!visited.has(child.nodeId)) {
          queue.push({
            id: child.nodeId,
            level: level + 1,
            parentId: id,
            edgeLabel: child.label,
          })
        }
      }
    }
  }

  // Calculate level widths
  for (const [level, nodesAtLevel] of levelNodes) {
    const width = nodesAtLevel.length * NODE_WIDTH + (nodesAtLevel.length - 1) * HORIZONTAL_GAP
    levelWidths.set(level, width)
  }

  // Find max width for centering
  const maxWidth = Math.max(...Array.from(levelWidths.values()), 0)

  // Calculate positions
  let currentY = PADDING
  const maxLevel = Math.max(...Array.from(levelNodes.keys()), 0)

  for (let level = 0; level <= maxLevel; level++) {
    const nodesAtLevel = levelNodes.get(level) || []
    const levelWidth = levelWidths.get(level) || 0
    const startX = PADDING + (maxWidth - levelWidth) / 2

    let maxHeightAtLevel = 0
    nodesAtLevel.forEach((layoutNode, index) => {
      layoutNode.x = startX + index * (NODE_WIDTH + HORIZONTAL_GAP)
      layoutNode.y = currentY
      maxHeightAtLevel = Math.max(maxHeightAtLevel, layoutNode.height)
    })

    currentY += maxHeightAtLevel + VERTICAL_GAP
  }

  // Create edges
  const layoutNodeMap = new Map<string, LayoutNode>()
  for (const ln of layoutNodes) {
    layoutNodeMap.set(ln.id, ln)
  }

  for (const layoutNode of layoutNodes) {
    if (layoutNode.parentId && layoutNode.edgeLabel) {
      const parentLayoutNode = layoutNodeMap.get(layoutNode.parentId)
      if (parentLayoutNode) {
        layoutEdges.push({
          id: `${layoutNode.parentId}-${layoutNode.id}`,
          from: parentLayoutNode,
          to: layoutNode,
          label: layoutNode.edgeLabel,
        })
      }
    }
  }

  const totalWidth = maxWidth + PADDING * 2
  const totalHeight = currentY - VERTICAL_GAP + PADDING

  return { layoutNodes, layoutEdges, width: totalWidth, height: totalHeight }
}

/**
 * Get path from root to a specific node
 */
function getPathToNode(
  nodes: FlowchartNode[],
  rootNodeId: string,
  targetNodeId: string
): Set<string> {
  const nodeMap = buildNodeMap(nodes)
  const path = new Set<string>()

  // Build parent map
  const parentMap = new Map<string, string>()
  const visited = new Set<string>()
  const queue = [rootNodeId]

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const node = nodeMap.get(id)
    if (!node?.children) continue

    for (const child of node.children) {
      if (!visited.has(child.nodeId)) {
        parentMap.set(child.nodeId, id)
        queue.push(child.nodeId)
      }
    }
  }

  // Trace back from target to root
  let current: string | undefined = targetNodeId
  while (current) {
    path.add(current)
    current = parentMap.get(current)
  }

  return path
}

// =============================================================================
// Sub-Components
// =============================================================================

interface NodeShapeProps {
  layoutNode: LayoutNode
  isSelected: boolean
  isOnPath: boolean
  isDimmed: boolean
  onClick: () => void
}

function NodeShape({ layoutNode, isSelected, isOnPath, isDimmed, onClick }: NodeShapeProps) {
  const { node, x, y, width, height } = layoutNode
  const centerX = x + width / 2
  const centerY = y + height / 2

  // Get appropriate class names
  const nodeClasses = [
    styles.node,
    styles[`node${node.type.charAt(0).toUpperCase() + node.type.slice(1)}`],
    isSelected && styles.nodeSelected,
    isOnPath && styles.nodeOnPath,
    isDimmed && styles.nodeDimmed,
  ]
    .filter(Boolean)
    .join(' ')

  // Render different shapes based on type
  if (node.type === 'question') {
    // Diamond shape for questions
    const points = [
      `${centerX},${y}`,
      `${x + width},${centerY}`,
      `${centerX},${y + height}`,
      `${x},${centerY}`,
    ].join(' ')

    return (
      <g className={nodeClasses} onClick={onClick} role="button" tabIndex={0}>
        <polygon points={points} className={styles.nodeBackground} />
        <foreignObject x={x + 30} y={y + 20} width={width - 60} height={height - 40}>
          <div className={styles.nodeContent}>
            <span className={styles.nodeIcon}>?</span>
            <span className={styles.nodeText}>{node.text}</span>
          </div>
        </foreignObject>
      </g>
    )
  }

  if (node.type === 'recommendation') {
    // Rounded rectangle with highlight for recommendations
    return (
      <g className={nodeClasses} onClick={onClick} role="button" tabIndex={0}>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={12}
          ry={12}
          className={styles.nodeBackground}
        />
        <foreignObject x={x + 12} y={y + 12} width={width - 24} height={height - 24}>
          <div className={styles.nodeContent}>
            <span className={styles.nodeText}>{node.text}</span>
            {node.description && (
              <span className={styles.nodeDescription}>{node.description}</span>
            )}
          </div>
        </foreignObject>
      </g>
    )
  }

  // Default: Rectangle for answers
  return (
    <g className={nodeClasses} onClick={onClick} role="button" tabIndex={0}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        ry={8}
        className={styles.nodeBackground}
      />
      <foreignObject x={x + 12} y={y + 10} width={width - 24} height={height - 20}>
        <div className={styles.nodeContent}>
          <span className={styles.nodeText}>{node.text}</span>
        </div>
      </foreignObject>
    </g>
  )
}

interface EdgeLineProps {
  edge: LayoutEdge
  isOnPath: boolean
  isDimmed: boolean
}

function EdgeLine({ edge, isOnPath, isDimmed }: EdgeLineProps) {
  const { from, to, label } = edge

  // Calculate connection points
  const fromX = from.x + from.width / 2
  const fromY = from.y + from.height
  const toX = to.x + to.width / 2
  const toY = to.y

  // Create curved path
  const midY = (fromY + toY) / 2
  const path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`

  // Label position
  const labelX = (fromX + toX) / 2
  const labelY = midY - 8

  const edgeClasses = [styles.edge, isOnPath && styles.edgeOnPath, isDimmed && styles.edgeDimmed]
    .filter(Boolean)
    .join(' ')

  return (
    <g className={edgeClasses}>
      <path d={path} className={styles.edgePath} markerEnd="url(#arrowhead)" />
      <rect
        x={labelX - 20}
        y={labelY - 10}
        width={40}
        height={20}
        rx={4}
        className={styles.edgeLabelBg}
      />
      <text x={labelX} y={labelY + 4} className={styles.edgeLabel}>
        {label}
      </text>
    </g>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function DecisionFlowchart({
  nodes,
  rootNodeId,
  onComplete,
  onNodeSelect,
  title,
  description,
}: DecisionFlowchartProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // Calculate layout
  const { layoutNodes, layoutEdges, width, height } = useMemo(
    () => calculateLayout(nodes, rootNodeId),
    [nodes, rootNodeId]
  )

  // Get path to selected node
  const selectedPath = useMemo(() => {
    if (!selectedNodeId) return new Set<string>()
    return getPathToNode(nodes, rootNodeId, selectedNodeId)
  }, [nodes, rootNodeId, selectedNodeId])

  // Get selected node
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null
    return nodes.find((n) => n.id === selectedNodeId) || null
  }, [nodes, selectedNodeId])

  // Handle node click
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId)
      onNodeSelect?.(nodeId)

      // Check if this is a recommendation node
      const node = nodes.find((n) => n.id === nodeId)
      if (node?.type === 'recommendation' && node.recommendation) {
        onComplete?.(node.recommendation)
      }
    },
    [nodes, onNodeSelect, onComplete]
  )

  // Handle reset
  const handleReset = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  // Check if we have a selection
  const hasSelection = selectedNodeId !== null

  return (
    <div className={styles.container}>
      {/* Header */}
      {(title || description) && (
        <div className={styles.header}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
      )}

      {/* Controls */}
      <div className={styles.controls}>
        <button
          className={styles.resetButton}
          onClick={handleReset}
          disabled={!hasSelection}
          title="Reset flowchart"
        >
          ↺ Reset
        </button>
        {hasSelection && (
          <span className={styles.hint}>Click nodes to explore different paths</span>
        )}
      </div>

      {/* SVG Flowchart */}
      <div className={styles.flowchartWrapper}>
        <svg
          className={styles.flowchart}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
        >
          {/* Defs for arrow marker */}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" className={styles.arrowhead} />
            </marker>
            <marker
              id="arrowhead-active"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" className={styles.arrowheadActive} />
            </marker>
          </defs>

          {/* Edges (render first so nodes appear on top) */}
          <g className={styles.edges}>
            {layoutEdges.map((edge) => {
              const isOnPath = selectedPath.has(edge.from.id) && selectedPath.has(edge.to.id)
              const isDimmed = hasSelection && !isOnPath
              return (
                <EdgeLine key={edge.id} edge={edge} isOnPath={isOnPath} isDimmed={isDimmed} />
              )
            })}
          </g>

          {/* Nodes */}
          <g className={styles.nodes}>
            {layoutNodes.map((layoutNode) => {
              const isSelected = layoutNode.id === selectedNodeId
              const isOnPath = selectedPath.has(layoutNode.id)
              const isDimmed = hasSelection && !isOnPath
              return (
                <NodeShape
                  key={layoutNode.id}
                  layoutNode={layoutNode}
                  isSelected={isSelected}
                  isOnPath={isOnPath}
                  isDimmed={isDimmed}
                  onClick={() => handleNodeClick(layoutNode.id)}
                />
              )
            })}
          </g>
        </svg>
      </div>

      {/* Recommendation Panel */}
      {selectedNode?.type === 'recommendation' && selectedNode.recommendation && (
        <div className={styles.recommendationPanel}>
          <h4 className={styles.recommendationTitle}>Recommendation</h4>

          {selectedNode.recommendation.kubeletFlags &&
            Object.keys(selectedNode.recommendation.kubeletFlags).length > 0 && (
              <div className={styles.recommendationSection}>
                <h5 className={styles.recommendationSectionTitle}>Kubelet Flags</h5>
                <div className={styles.flagList}>
                  {Object.entries(selectedNode.recommendation.kubeletFlags).map(([flag, value]) => (
                    <code key={flag} className={styles.flagItem}>
                      --{flag}={value}
                    </code>
                  ))}
                </div>
              </div>
            )}

          {selectedNode.recommendation.featureGates &&
            selectedNode.recommendation.featureGates.length > 0 && (
              <div className={styles.recommendationSection}>
                <h5 className={styles.recommendationSectionTitle}>Feature Gates</h5>
                <div className={styles.tagList}>
                  {selectedNode.recommendation.featureGates.map((gate) => (
                    <span key={gate} className={styles.featureGateTag}>
                      {gate}
                    </span>
                  ))}
                </div>
              </div>
            )}

          {selectedNode.recommendation.keps && selectedNode.recommendation.keps.length > 0 && (
            <div className={styles.recommendationSection}>
              <h5 className={styles.recommendationSectionTitle}>Related KEPs</h5>
              <div className={styles.tagList}>
                {selectedNode.recommendation.keps.map((kep) => (
                  <span key={kep} className={styles.kepTag}>
                    {kep}
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectedNode.recommendation.podSpec && (
            <div className={styles.recommendationSection}>
              <h5 className={styles.recommendationSectionTitle}>Pod Spec Example</h5>
              <pre className={styles.codeBlock}>{selectedNode.recommendation.podSpec}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DecisionFlowchart
