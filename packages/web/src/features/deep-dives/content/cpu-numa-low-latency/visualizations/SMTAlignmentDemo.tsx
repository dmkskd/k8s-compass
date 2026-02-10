/**
 * SMTAlignmentDemo - Interactive visualization of SMT alignment with full-pcpus-only
 *
 * Demonstrates how the full-pcpus-only CPU Manager policy option works:
 * - Shows physical cores with their hyperthreads
 * - Visualizes why odd CPU requests are rejected
 * - Explains the SMTAlignmentError
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/visualizations
 */

import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import styles from './SMTAlignmentDemo.module.css'

// =============================================================================
// Types
// =============================================================================

interface PhysicalCore {
  id: number
  thread0: { id: number; allocated: boolean; animating: boolean }
  thread1: { id: number; allocated: boolean; animating: boolean }
}

interface AllocationResult {
  success: boolean
  allocatedCores: number[]
  message: string
  explanation: string
}

// =============================================================================
// Constants
// =============================================================================

const THREADS_PER_CORE = 2

// Create 8 physical cores (16 logical CPUs)
function createCores(): PhysicalCore[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i,
    thread0: { id: i * 2, allocated: false, animating: false },
    thread1: { id: i * 2 + 1, allocated: false, animating: false },
  }))
}

// =============================================================================
// Helper Functions
// =============================================================================

function calculateAllocation(
  requestedCpus: number,
  fullPcpusOnly: boolean
): AllocationResult {
  if (!fullPcpusOnly) {
    // Without full-pcpus-only, any request is valid
    return {
      success: true,
      allocatedCores: Array.from({ length: Math.min(requestedCpus, 16) }, (_, i) => i),
      message: 'Allocation Successful',
      explanation: `Allocated ${requestedCpus} logical CPUs. May include split physical cores.`,
    }
  }
  
  // With full-pcpus-only
  const remainder = requestedCpus % THREADS_PER_CORE
  
  if (remainder !== 0) {
    return {
      success: false,
      allocatedCores: [],
      message: 'SMTAlignmentError',
      explanation: `Request for ${requestedCpus} CPUs rejected. With full-pcpus-only, you must request a multiple of ${THREADS_PER_CORE} (threads per core). Try ${requestedCpus - remainder} or ${requestedCpus + (THREADS_PER_CORE - remainder)} CPUs.`,
    }
  }
  
  const physicalCoresNeeded = requestedCpus / THREADS_PER_CORE
  
  if (physicalCoresNeeded > 8) {
    return {
      success: false,
      allocatedCores: [],
      message: 'Insufficient Resources',
      explanation: `Request for ${requestedCpus} CPUs (${physicalCoresNeeded} physical cores) exceeds available capacity (8 physical cores).`,
    }
  }
  
  // Allocate full physical cores
  const allocatedCores: number[] = []
  for (let i = 0; i < physicalCoresNeeded; i++) {
    allocatedCores.push(i * 2, i * 2 + 1)
  }
  
  return {
    success: true,
    allocatedCores,
    message: 'Allocation Successful',
    explanation: `Allocated ${physicalCoresNeeded} full physical cores (${requestedCpus} logical CPUs). No hyperthread siblings are shared with other containers.`,
  }
}

// =============================================================================
// Components
// =============================================================================

function ThreadBox({
  thread,
  isHighlighted,
}: {
  thread: { id: number; allocated: boolean; animating: boolean }
  isHighlighted: boolean
}) {
  return (
    <motion.div
      className={`${styles.thread} ${thread.allocated ? styles.allocated : ''} ${thread.animating ? styles.animating : ''} ${isHighlighted ? styles.highlighted : ''}`}
      animate={thread.animating ? { scale: [1, 1.1, 1] } : {}}
      transition={{ duration: 0.3, repeat: thread.animating ? Infinity : 0 }}
    >
      <span className={styles.threadId}>{thread.id}</span>
      {thread.id % 2 === 1 && <span className={styles.htBadge}>HT</span>}
    </motion.div>
  )
}

function PhysicalCoreBox({
  core,
  highlightedThreads,
}: {
  core: PhysicalCore
  highlightedThreads: number[]
}) {
  const bothAllocated = core.thread0.allocated && core.thread1.allocated
  const partiallyAllocated = core.thread0.allocated !== core.thread1.allocated
  
  return (
    <div className={`${styles.physicalCore} ${bothAllocated ? styles.fullyAllocated : ''} ${partiallyAllocated ? styles.partiallyAllocated : ''}`}>
      <div className={styles.coreLabel}>P{core.id}</div>
      <div className={styles.threads}>
        <ThreadBox
          thread={core.thread0}
          isHighlighted={highlightedThreads.includes(core.thread0.id)}
        />
        <ThreadBox
          thread={core.thread1}
          isHighlighted={highlightedThreads.includes(core.thread1.id)}
        />
      </div>
      {bothAllocated && (
        <div className={styles.coreStatus}>✓ Full</div>
      )}
      {partiallyAllocated && (
        <div className={`${styles.coreStatus} ${styles.warning}`}>⚠ Split</div>
      )}
    </div>
  )
}

function CPUTopology({
  cores,
  highlightedThreads,
}: {
  cores: PhysicalCore[]
  highlightedThreads: number[]
}) {
  return (
    <div className={styles.topology}>
      <div className={styles.topologyHeader}>
        <span className={styles.topologyTitle}>CPU Topology</span>
        <span className={styles.topologySubtitle}>8 Physical Cores × 2 Threads = 16 Logical CPUs</span>
      </div>
      <div className={styles.coresGrid}>
        {cores.map(core => (
          <PhysicalCoreBox
            key={core.id}
            core={core}
            highlightedThreads={highlightedThreads}
          />
        ))}
      </div>
    </div>
  )
}

function RequestSlider({
  value,
  onChange,
  max,
}: {
  value: number
  onChange: (value: number) => void
  max: number
}) {
  return (
    <div className={styles.slider}>
      <div className={styles.sliderHeader}>
        <span className={styles.sliderLabel}>CPU Request:</span>
        <span className={styles.sliderValue}>{value} CPUs</span>
      </div>
      <input
        type="range"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className={styles.sliderInput}
      />
      <div className={styles.sliderMarks}>
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`${styles.mark} ${(i + 1) % 2 === 0 ? styles.even : styles.odd}`}
          >
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  )
}

function ResultPanel({
  result,
  fullPcpusOnly,
}: {
  result: AllocationResult
  fullPcpusOnly: boolean
}) {
  return (
    <motion.div
      className={`${styles.result} ${result.success ? styles.success : styles.error}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      key={result.message + result.explanation}
    >
      <div className={styles.resultHeader}>
        <span className={`${styles.resultIcon} ${result.success ? styles.successIcon : styles.errorIcon}`}>
          {result.success ? '✓' : '✗'}
        </span>
        <span className={styles.resultMessage}>{result.message}</span>
      </div>
      <p className={styles.resultExplanation}>{result.explanation}</p>
      
      {!result.success && fullPcpusOnly && (
        <div className={styles.errorDetails}>
          <div className={styles.errorFormula}>
            <span>Request</span>
            <span className={styles.formulaOp}>%</span>
            <span>threads_per_cpu</span>
            <span className={styles.formulaOp}>=</span>
            <span className={styles.formulaResult}>
              {result.allocatedCores.length === 0 ? 'non-zero' : '0'}
            </span>
          </div>
          <p className={styles.errorHint}>
            The <code>full-pcpus-only</code> policy requires CPU requests to be 
            multiples of {THREADS_PER_CORE} (the number of hyperthreads per physical core).
          </p>
        </div>
      )}
    </motion.div>
  )
}

function ComparisonTable() {
  return (
    <div className={styles.comparison}>
      <h5 className={styles.comparisonTitle}>Allocation Comparison</h5>
      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>Request</th>
            <th>Without full-pcpus-only</th>
            <th>With full-pcpus-only</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>4 CPUs</td>
            <td className={styles.allowed}>✓ 4 logical CPUs (may split cores)</td>
            <td className={styles.allowed}>✓ 2 full physical cores</td>
          </tr>
          <tr>
            <td>5 CPUs</td>
            <td className={styles.allowed}>✓ 5 logical CPUs (splits 1 core)</td>
            <td className={styles.rejected}>✗ SMTAlignmentError</td>
          </tr>
          <tr>
            <td>6 CPUs</td>
            <td className={styles.allowed}>✓ 6 logical CPUs (may split cores)</td>
            <td className={styles.allowed}>✓ 3 full physical cores</td>
          </tr>
          <tr>
            <td>7 CPUs</td>
            <td className={styles.allowed}>✓ 7 logical CPUs (splits 1 core)</td>
            <td className={styles.rejected}>✗ SMTAlignmentError</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function SMTAlignmentDemo() {
  const [cpuRequest, setCpuRequest] = useState(4)
  const [fullPcpusOnly, setFullPcpusOnly] = useState(true)
  const [cores, setCores] = useState<PhysicalCore[]>(createCores)
  const [, setIsAnimating] = useState(false)
  
  const result = useMemo(
    () => calculateAllocation(cpuRequest, fullPcpusOnly),
    [cpuRequest, fullPcpusOnly]
  )
  
  // Update core allocation visualization
  useEffect(() => {
    const newCores = createCores()
    
    if (result.success) {
      // Animate allocation
      setIsAnimating(true)
      
      result.allocatedCores.forEach((threadId, index) => {
        const coreIndex = Math.floor(threadId / 2)
        const isThread1 = threadId % 2 === 1
        
        setTimeout(() => {
          setCores(prev => {
            const updated = [...prev]
            if (isThread1) {
              updated[coreIndex] = {
                ...updated[coreIndex],
                thread1: { ...updated[coreIndex].thread1, animating: true },
              }
            } else {
              updated[coreIndex] = {
                ...updated[coreIndex],
                thread0: { ...updated[coreIndex].thread0, animating: true },
              }
            }
            return updated
          })
        }, index * 100)
      })
      
      // Mark as allocated after animation
      setTimeout(() => {
        result.allocatedCores.forEach(threadId => {
          const coreIndex = Math.floor(threadId / 2)
          const isThread1 = threadId % 2 === 1
          
          setCores(prev => {
            const updated = [...prev]
            if (isThread1) {
              updated[coreIndex] = {
                ...updated[coreIndex],
                thread1: { ...updated[coreIndex].thread1, allocated: true, animating: false },
              }
            } else {
              updated[coreIndex] = {
                ...updated[coreIndex],
                thread0: { ...updated[coreIndex].thread0, allocated: true, animating: false },
              }
            }
            return updated
          })
        })
        setIsAnimating(false)
      }, result.allocatedCores.length * 100 + 300)
    } else {
      setCores(newCores)
    }
  }, [cpuRequest, fullPcpusOnly, result])
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>SMT Alignment with full-pcpus-only</h4>
        <p className={styles.subtitle}>
          See how the full-pcpus-only policy ensures complete physical core allocation
        </p>
      </div>
      
      {/* Controls */}
      <div className={styles.controls}>
        <RequestSlider
          value={cpuRequest}
          onChange={setCpuRequest}
          max={16}
        />
        
        <div className={styles.policyToggle}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={fullPcpusOnly}
              onChange={(e) => setFullPcpusOnly(e.target.checked)}
              className={styles.toggleInput}
            />
            <span className={styles.toggleSwitch} />
            <span className={styles.toggleText}>
              full-pcpus-only
              <span className={styles.toggleHint}>
                {fullPcpusOnly ? 'Enabled - requires full physical cores' : 'Disabled - allows split cores'}
              </span>
            </span>
          </label>
        </div>
      </div>
      
      {/* Topology Visualization */}
      <CPUTopology
        cores={cores}
        highlightedThreads={result.success ? result.allocatedCores : []}
      />
      
      {/* Result */}
      <ResultPanel result={result} fullPcpusOnly={fullPcpusOnly} />
      
      {/* Comparison Table */}
      <ComparisonTable />
      
      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.free}`} />
          <span>Free</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendColor} ${styles.allocated}`} />
          <span>Allocated</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.htBadgeSmall}>HT</span>
          <span>Hyperthread (sibling)</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.pLabel}>P0</span>
          <span>Physical Core ID</span>
        </div>
      </div>
    </div>
  )
}

export default SMTAlignmentDemo
