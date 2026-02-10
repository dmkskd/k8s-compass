/**
 * CPUPolicyPlacement - 2D SVG visualization of CPU Manager policy placement
 *
 * Shows how different CPU Manager policies affect pod placement on a
 * 2-socket NUMA topology with SMT (hyperthreading).
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import styles from './CPUPolicyPlacement.module.css'

// =============================================================================
// Types
// =============================================================================

type CPUManagerPolicy = 
  | 'none'
  | 'static'
  | 'static-full-pcpus'
  | 'static-distribute'
  | 'static-align-socket'

type AnimationPhase = 
  | 'idle'
  | 'pod-descending'
  | 'evaluating'
  | 'allocating'
  | 'complete'
  | 'failed'

interface CPUCore {
  id: number
  physicalCoreId: number
  isHyperthread: boolean
  numaNode: number
  allocated: boolean
  animating?: boolean
}

// =============================================================================
// Constants
// =============================================================================

// 2-socket, 2-NUMA node topology with SMT (16 logical CPUs = 8 physical cores)
const createTopology = (): CPUCore[] => {
  const cores: CPUCore[] = []
  for (let i = 0; i < 16; i++) {
    cores.push({
      id: i,
      physicalCoreId: Math.floor(i / 2),
      isHyperthread: i % 2 === 1,
      numaNode: i < 8 ? 0 : 1,
      allocated: false,
    })
  }
  return cores
}

// =============================================================================
// Helper Functions
// =============================================================================

function getAllocationForPolicy(policy: CPUManagerPolicy, cpuRequest: number): { allocated: number[]; valid: boolean; reason?: string } {
  switch (policy) {
    case 'none':
      return { allocated: [], valid: true, reason: 'No exclusive allocation — all pods share the CPU pool' }
      
    case 'static':
      // Pack onto NUMA 0, may split physical cores
      return { 
        allocated: Array.from({ length: cpuRequest }, (_, i) => i),
        valid: true,
        reason: `Packed ${cpuRequest} CPUs onto NUMA Node 0 (may split physical cores)`
      }
      
    case 'static-full-pcpus':
      if (cpuRequest % 2 !== 0) {
        return { allocated: [], valid: false, reason: `SMTAlignmentError: ${cpuRequest} CPUs is not a multiple of 2 (threads per core)` }
      }
      return { 
        allocated: Array.from({ length: cpuRequest }, (_, i) => i),
        valid: true,
        reason: `Allocated ${cpuRequest / 2} full physical cores (both hyperthreads together)`
      }
      
    case 'static-distribute': {
      // Spread across NUMA nodes
      const perNode = Math.floor(cpuRequest / 2)
      const remainder = cpuRequest % 2
      const distributed: number[] = []
      // NUMA 0: first half + remainder
      for (let i = 0; i < perNode + remainder; i++) distributed.push(i)
      // NUMA 1: second half
      for (let i = 0; i < perNode; i++) distributed.push(8 + i)
      return { 
        allocated: distributed,
        valid: true,
        reason: `Distributed: ${perNode + remainder} CPUs on NUMA 0, ${perNode} on NUMA 1`
      }
    }
      
    case 'static-align-socket':
      return { 
        allocated: Array.from({ length: cpuRequest }, (_, i) => i),
        valid: true,
        reason: `All ${cpuRequest} CPUs from Socket 0 (same NUMA node)`
      }
      
    default:
      return { allocated: [], valid: true }
  }
}

// =============================================================================
// Policy Descriptions
// =============================================================================

const POLICY_INFO: Record<CPUManagerPolicy, { name: string; description: string }> = {
  'none': {
    name: 'None (Default)',
    description: 'No CPU pinning. All containers share the CPU pool via CFS scheduler.',
  },
  'static': {
    name: 'Static',
    description: 'Exclusive CPUs for Guaranteed QoS pods. Packs onto fewest NUMA nodes.',
  },
  'static-full-pcpus': {
    name: 'Static + full-pcpus-only',
    description: 'Only allocate full physical cores. Prevents SMT noisy-neighbor effects.',
  },
  'static-distribute': {
    name: 'Static + distribute-cpus-across-numa',
    description: 'Spread CPUs across NUMA nodes for better memory bandwidth.',
  },
  'static-align-socket': {
    name: 'Static + align-by-socket',
    description: 'All CPUs from same socket. Maximizes cache efficiency.',
  },
}

// =============================================================================
// Sub-Components
// =============================================================================

function CPUCoreCircle({ 
  core, 
  cx, 
  cy, 
  radius = 22 
}: { 
  core: CPUCore
  cx: number
  cy: number
  radius?: number
}) {
  const fill = core.animating 
    ? '#f59e0b' 
    : core.allocated 
      ? '#3b82f6' 
      : '#10b981'
  
  return (
    <g className={core.animating ? styles.animatingCore : ''}>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={fill}
        stroke={core.allocated ? '#60a5fa' : '#34d399'}
        strokeWidth={2}
        className={styles.coreCircle}
      />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize="14"
        fontWeight="600"
        fontFamily="JetBrains Mono, monospace"
      >
        {core.id}
      </text>
      {core.isHyperthread && (
        <text
          x={cx + radius - 4}
          y={cy - radius + 8}
          textAnchor="middle"
          fill="#fbbf24"
          fontSize="8"
          fontWeight="600"
        >
          HT
        </text>
      )}
    </g>
  )
}

function NUMANode({
  nodeId,
  cores,
  x,
  y,
  width = 280,
  height = 200,
}: {
  nodeId: number
  cores: CPUCore[]
  x: number
  y: number
  width?: number
  height?: number
}) {
  const borderColor = nodeId === 0 ? '#6366f1' : '#8b5cf6'
  
  // Group cores by physical core
  const physicalCores: CPUCore[][] = []
  for (let i = 0; i < cores.length; i += 2) {
    physicalCores.push([cores[i], cores[i + 1]])
  }

  return (
    <g>
      {/* NUMA Node container */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        fill="rgba(30, 27, 75, 0.6)"
        stroke={borderColor}
        strokeWidth={2}
      />
      
      {/* Title */}
      <text
        x={x + width / 2}
        y={y + 24}
        textAnchor="middle"
        fill="#e0e7ff"
        fontSize="16"
        fontWeight="700"
      >
        NUMA Node {nodeId}
      </text>
      
      {/* CPU Cores label */}
      <text
        x={x + 16}
        y={y + 52}
        fill="#94a3b8"
        fontSize="11"
        fontWeight="500"
      >
        CPU Cores
      </text>
      
      {/* Physical cores with their hyperthreads */}
      {physicalCores.map((pair, idx) => {
        const coreX = x + 40 + (idx % 2) * 120
        const coreY = y + 80 + Math.floor(idx / 2) * 60
        
        return (
          <g key={pair[0].physicalCoreId}>
            {/* Physical core background */}
            <rect
              x={coreX - 30}
              y={coreY - 28}
              width={100}
              height={56}
              rx={6}
              fill="rgba(100, 116, 139, 0.15)"
              stroke="rgba(100, 116, 139, 0.3)"
              strokeWidth={1}
            />
            
            {/* Core 0 (primary) */}
            <CPUCoreCircle core={pair[0]} cx={coreX} cy={coreY} />
            
            {/* Core 1 (hyperthread) */}
            <CPUCoreCircle core={pair[1]} cx={coreX + 50} cy={coreY} />
            
            {/* Physical core label */}
            <text
              x={coreX + 25}
              y={coreY + 38}
              textAnchor="middle"
              fill="#64748b"
              fontSize="9"
              fontWeight="500"
            >
              P{pair[0].physicalCoreId % 4}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function StatusPanel({
  phase,
  allocationResult,
}: {
  phase: AnimationPhase
  allocationResult: { allocated: number[]; valid: boolean; reason?: string }
}) {
  const steps = [
    { id: 'pod-descending', label: '1. Pod Created', description: 'Scheduler assigns pod to node' },
    { id: 'evaluating', label: '2. Kubelet Evaluates', description: 'CPU Manager checks policy' },
    { id: 'allocating', label: '3. Allocating CPUs', description: 'Assigning exclusive cores' },
    { id: 'complete', label: '4. Complete', description: 'Container running' },
  ]

  const getStepStatus = (stepId: string) => {
    const order = ['idle', 'pod-descending', 'evaluating', 'allocating', 'complete', 'failed']
    const currentIdx = order.indexOf(phase)
    const stepIdx = order.indexOf(stepId)
    
    if (phase === 'failed' && stepId === 'evaluating') return 'failed'
    if (stepIdx < currentIdx) return 'done'
    if (stepIdx === currentIdx) return 'active'
    return 'pending'
  }

  return (
    <div className={styles.statusPanel}>
      <div className={styles.statusHeader}>
        <span className={styles.statusTitle}>Scheduling Progress</span>
        <span className={`${styles.statusBadge} ${styles[phase]}`}>
          {phase === 'idle' ? 'Ready' : 
           phase === 'failed' ? 'Failed' : 
           phase === 'complete' ? 'Success' : 'In Progress'}
        </span>
      </div>
      
      <div className={styles.steps}>
        {steps.map((step) => {
          const status = getStepStatus(step.id)
          return (
            <div key={step.id} className={`${styles.step} ${styles[status]}`}>
              <div className={styles.stepIndicator}>
                {status === 'done' ? '✓' : 
                 status === 'failed' ? '✗' : 
                 status === 'active' ? '●' : '○'}
              </div>
              <div className={styles.stepContent}>
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.stepDescription}>{step.description}</span>
              </div>
            </div>
          )
        })}
      </div>
      
      {(phase === 'complete' || phase === 'failed') && (
        <div className={`${styles.resultBox} ${phase === 'failed' ? styles.error : styles.success}`}>
          <div className={styles.resultTitle}>
            {phase === 'failed' ? 'Allocation Failed' : 'Allocation Successful'}
          </div>
          <div className={styles.resultReason}>{allocationResult.reason}</div>
          {phase === 'complete' && allocationResult.allocated.length > 0 && (
            <div className={styles.resultCores}>
              CPUs: [{allocationResult.allocated.join(', ')}]
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function CPUPolicyPlacement() {
  const [policy, setPolicy] = useState<CPUManagerPolicy>('static')
  const [cores, setCores] = useState<CPUCore[]>(createTopology)
  const [phase, setPhase] = useState<AnimationPhase>('idle')
  const [cpuRequest, setCpuRequest] = useState(4)

  const allocationResult = useMemo(
    () => getAllocationForPolicy(policy, cpuRequest),
    [policy, cpuRequest]
  )

  // Reset when policy or CPU request changes
  useEffect(() => {
    setCores(createTopology())
    setPhase('idle')
  }, [policy, cpuRequest])

  const runAnimation = useCallback(() => {
    setCores(createTopology())
    
    // Phase 1: Pod descending
    setPhase('pod-descending')
    
    setTimeout(() => {
      // Phase 2: Evaluating
      setPhase('evaluating')
      
      setTimeout(() => {
        if (!allocationResult.valid) {
          setPhase('failed')
          return
        }
        
        // Phase 3: Allocating - animate cores one by one
        setPhase('allocating')
        
        const { allocated } = allocationResult
        let delay = 0
        
        allocated.forEach((coreId) => {
          setTimeout(() => {
            setCores(prev => {
              const updated = [...prev]
              updated[coreId] = { ...updated[coreId], animating: true }
              return updated
            })
          }, delay)
          
          setTimeout(() => {
            setCores(prev => {
              const updated = [...prev]
              updated[coreId] = { ...updated[coreId], animating: false, allocated: true }
              return updated
            })
          }, delay + 250)
          
          delay += 150
        })
        
        // Phase 4: Complete
        setTimeout(() => {
          setPhase('complete')
        }, delay + 400)
        
      }, 600)
    }, 800)
  }, [allocationResult])

  const handleReset = useCallback(() => {
    setCores(createTopology())
    setPhase('idle')
  }, [])

  const policyInfo = POLICY_INFO[policy]
  const numa0Cores = cores.filter(c => c.numaNode === 0)
  const numa1Cores = cores.filter(c => c.numaNode === 1)

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>Interactive: CPU Manager Policy Placement</h4>
        <p className={styles.subtitle}>
          See how different policies affect CPU allocation on a 2-socket NUMA system
        </p>
      </div>
      
      <div className={styles.content}>
        {/* Controls */}
        <div className={styles.controls}>
          <div className={styles.controlGroup}>
            <label className={styles.label}>Policy:</label>
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as CPUManagerPolicy)}
              className={styles.select}
              disabled={phase !== 'idle'}
            >
              {Object.entries(POLICY_INFO).map(([key, info]) => (
                <option key={key} value={key}>{info.name}</option>
              ))}
            </select>
          </div>
          
          <div className={styles.controlGroup}>
            <label className={styles.label}>CPU Request:</label>
            <div className={styles.cpuSelector}>
              {[2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  className={`${styles.cpuButton} ${cpuRequest === n ? styles.active : ''}`}
                  onClick={() => setCpuRequest(n)}
                  disabled={phase !== 'idle'}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          
          <div className={styles.buttons}>
            <button
              onClick={runAnimation}
              disabled={phase !== 'idle'}
              className={styles.scheduleButton}
            >
              ▶ Schedule Pod
            </button>
            <button
              onClick={handleReset}
              disabled={phase === 'idle'}
              className={styles.resetButton}
            >
              ↺ Reset
            </button>
          </div>
        </div>
        
        {/* Policy Info */}
        <div className={styles.policyInfo}>
          <div className={styles.policyName}>{policyInfo.name}</div>
          <div className={styles.policyDescription}>{policyInfo.description}</div>
        </div>
        
        {/* Main Content: SVG + Status */}
        <div className={styles.mainContent}>
          <div className={styles.svgContainer}>
            <svg 
              viewBox="0 0 700 260" 
              className={styles.svg}
              preserveAspectRatio="xMidYMid meet"
            >
              {/* NUMA Node 0 */}
              <NUMANode
                nodeId={0}
                cores={numa0Cores}
                x={20}
                y={20}
                width={280}
                height={220}
              />
              
              {/* NUMA Node 1 */}
              <NUMANode
                nodeId={1}
                cores={numa1Cores}
                x={400}
                y={20}
                width={280}
                height={220}
              />
              
              {/* Cross-NUMA interconnect */}
              <g>
                <line
                  x1={300}
                  y1={130}
                  x2={400}
                  y2={130}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="6,4"
                />
                <text
                  x={350}
                  y={115}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="10"
                  fontWeight="500"
                >
                  QPI/UPI
                </text>
                <text
                  x={350}
                  y={148}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="9"
                >
                  ~120ns cross-node
                </text>
              </g>
            </svg>
          </div>
          
          <StatusPanel
            phase={phase}
            allocationResult={allocationResult}
          />
        </div>
        
        {/* Legend */}
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <span className={styles.legendCircle} style={{ background: '#3b82f6' }} />
            <span>Allocated to Pod</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendCircle} style={{ background: '#10b981' }} />
            <span>Available</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendHT}>HT</span>
            <span>Hyperthread</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendP}>P0</span>
            <span>Physical Core ID</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CPUPolicyPlacement
