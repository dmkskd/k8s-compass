/**
 * Overview Section - CPU/NUMA Deep Dive
 *
 * Introduces CPU affinity and NUMA concepts, explaining why they matter
 * for low-latency workloads in Kubernetes.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/Overview
 */

import { useState, useEffect } from 'react'
import { KepStatusBadgeList } from '../../../components/KepStatusBadge'
import { Info, Tip } from '../../../components/InfoCallout'
import styles from '../styles.module.css'

// =============================================================================
// Architecture Diagram Component
// =============================================================================

function ArchitectureDiagram() {
  // Detect theme for SVG colors
  const [isDark, setIsDark] = useState(true)
  
  useEffect(() => {
    const checkTheme = () => {
      setIsDark(document.documentElement.getAttribute('data-theme') !== 'light')
    }
    checkTheme()
    
    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  
  // Theme-aware colors
  const textPrimary = isDark ? '#fff' : '#0f172a'
  const textSecondary = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'
  
  return (
    <div className={styles.architectureDiagram}>
      <svg viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Background */}
        <rect width="800" height="400" fill="transparent" />

        {/* NUMA Node 0 */}
        <g>
          <rect
            x="50"
            y="80"
            width="300"
            height="240"
            rx="12"
            fill="rgba(99, 102, 241, 0.1)"
            stroke="rgba(99, 102, 241, 0.4)"
            strokeWidth="2"
          />
          <text x="200" y="60" textAnchor="middle" fill={textPrimary} fontSize="16" fontWeight="600">
            NUMA Node 0
          </text>

          {/* CPU Cores */}
          <g>
            <text x="100" y="115" fill={textSecondary} fontSize="12">
              CPU Cores
            </text>
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <circle
                  cx={100 + i * 60}
                  cy={150}
                  r="20"
                  fill={i < 2 ? 'rgba(59, 130, 246, 0.6)' : 'rgba(16, 185, 129, 0.6)'}
                  stroke={i < 2 ? '#3b82f6' : '#10b981'}
                  strokeWidth="2"
                />
                <text
                  x={100 + i * 60}
                  y={155}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="12"
                  fontWeight="500"
                >
                  {i}
                </text>
              </g>
            ))}
          </g>

          {/* L3 Cache */}
          <rect
            x="70"
            y="190"
            width="260"
            height="30"
            rx="6"
            fill="rgba(6, 182, 212, 0.2)"
            stroke="rgba(6, 182, 212, 0.5)"
            strokeWidth="1"
          />
          <text x="200" y="210" textAnchor="middle" fill="rgba(6, 182, 212, 0.9)" fontSize="12">
            L3 Cache (16 MB shared)
          </text>

          {/* Memory */}
          <rect
            x="70"
            y="240"
            width="260"
            height="60"
            rx="6"
            fill="rgba(139, 92, 246, 0.2)"
            stroke="rgba(139, 92, 246, 0.5)"
            strokeWidth="1"
          />
          <text x="200" y="265" textAnchor="middle" fill="rgba(139, 92, 246, 0.9)" fontSize="14" fontWeight="500">
            Local Memory
          </text>
          <text x="200" y="285" textAnchor="middle" fill="rgba(139, 92, 246, 0.7)" fontSize="12">
            64 GB DDR4 • ~80ns latency
          </text>
        </g>

        {/* NUMA Node 1 */}
        <g>
          <rect
            x="450"
            y="80"
            width="300"
            height="240"
            rx="12"
            fill="rgba(99, 102, 241, 0.1)"
            stroke="rgba(99, 102, 241, 0.4)"
            strokeWidth="2"
          />
          <text x="600" y="60" textAnchor="middle" fill={textPrimary} fontSize="16" fontWeight="600">
            NUMA Node 1
          </text>

          {/* CPU Cores */}
          <g>
            <text x="500" y="115" fill={textSecondary} fontSize="12">
              CPU Cores
            </text>
            {[4, 5, 6, 7].map((i, idx) => (
              <g key={i}>
                <circle
                  cx={500 + idx * 60}
                  cy={150}
                  r="20"
                  fill="rgba(16, 185, 129, 0.6)"
                  stroke="#10b981"
                  strokeWidth="2"
                />
                <text
                  x={500 + idx * 60}
                  y={155}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="12"
                  fontWeight="500"
                >
                  {i}
                </text>
              </g>
            ))}
          </g>

          {/* L3 Cache */}
          <rect
            x="470"
            y="190"
            width="260"
            height="30"
            rx="6"
            fill="rgba(6, 182, 212, 0.2)"
            stroke="rgba(6, 182, 212, 0.5)"
            strokeWidth="1"
          />
          <text x="600" y="210" textAnchor="middle" fill="rgba(6, 182, 212, 0.9)" fontSize="12">
            L3 Cache (16 MB shared)
          </text>

          {/* Memory */}
          <rect
            x="470"
            y="240"
            width="260"
            height="60"
            rx="6"
            fill="rgba(139, 92, 246, 0.2)"
            stroke="rgba(139, 92, 246, 0.5)"
            strokeWidth="1"
          />
          <text x="600" y="265" textAnchor="middle" fill="rgba(139, 92, 246, 0.9)" fontSize="14" fontWeight="500">
            Local Memory
          </text>
          <text x="600" y="285" textAnchor="middle" fill="rgba(139, 92, 246, 0.7)" fontSize="12">
            64 GB DDR4 • ~80ns latency
          </text>
        </g>

        {/* Interconnect */}
        <g>
          <line
            x1="350"
            y1="200"
            x2="450"
            y2="200"
            stroke="rgba(245, 158, 11, 0.6)"
            strokeWidth="3"
            strokeDasharray="8 4"
          />
          <text x="400" y="185" textAnchor="middle" fill="rgba(245, 158, 11, 0.9)" fontSize="11">
            QPI/UPI
          </text>
          <text x="400" y="220" textAnchor="middle" fill="rgba(245, 158, 11, 0.7)" fontSize="10">
            ~120ns cross-node
          </text>
        </g>

        {/* Legend */}
        <g>
          <circle cx="80" cy="360" r="10" fill="rgba(59, 130, 246, 0.6)" stroke="#3b82f6" strokeWidth="2" />
          <text x="100" y="365" fill={textSecondary} fontSize="11">
            Allocated to Pod
          </text>

          <circle cx="220" cy="360" r="10" fill="rgba(16, 185, 129, 0.6)" stroke="#10b981" strokeWidth="2" />
          <text x="240" y="365" fill={textSecondary} fontSize="11">
            Available
          </text>

          <rect x="350" y="350" width="20" height="20" rx="4" fill="rgba(139, 92, 246, 0.3)" stroke="rgba(139, 92, 246, 0.5)" />
          <text x="380" y="365" fill={textSecondary} fontSize="11">
            Local Memory (fast)
          </text>

          <line x1="520" y1="360" x2="560" y2="360" stroke="rgba(245, 158, 11, 0.6)" strokeWidth="3" strokeDasharray="8 4" />
          <text x="570" y="365" fill={textSecondary} fontSize="11">
            Remote Access (slow)
          </text>
        </g>
      </svg>
    </div>
  )
}

// =============================================================================
// Component
// =============================================================================

export function Overview() {
  return (
    <section id="overview" className={styles.section}>
      <h2 className={styles.sectionTitle}>Overview</h2>

      <p className={styles.lead}>
        Modern high-performance workloads—from real-time trading systems to AI inference
        engines—demand predictable, low-latency execution. Kubernetes provides a sophisticated
        set of resource managers that work together to ensure your pods get dedicated CPU cores,
        local memory, and properly aligned hardware resources.
      </p>

      <Info title="What You'll Learn">
        <p>
          This deep dive covers the four key kubelet managers that control hardware resource
          allocation: <strong>CPU Manager</strong>, <strong>Topology Manager</strong>,{' '}
          <strong>Memory Manager</strong>, and <strong>Device Manager</strong>. You'll learn
          how to configure them for optimal performance and understand the trade-offs involved.
        </p>
      </Info>

      {/* Why CPU Affinity Matters */}
      <h3 className={styles.sectionSubtitle}>Why CPU Affinity Matters</h3>

      <p className={styles.paragraph}>
        By default, the Linux kernel scheduler freely migrates processes between CPU cores
        to maximize overall system throughput. While this works well for general workloads,
        it introduces several problems for latency-sensitive applications:
      </p>

      <ul className={styles.list}>
        <li>
          <span className={styles.strong}>Cache thrashing:</span> When a process moves to a
          different core, its data must be reloaded into the new core's L1/L2 cache, causing
          cache misses and increased latency.
        </li>
        <li>
          <span className={styles.strong}>Context switch overhead:</span> Each migration
          involves saving and restoring CPU state, adding microseconds of delay.
        </li>
        <li>
          <span className={styles.strong}>Unpredictable latency:</span> The scheduler's
          decisions are based on system-wide optimization, not your application's needs,
          leading to latency spikes.
        </li>
        <li>
          <span className={styles.strong}>NUMA penalties:</span> On multi-socket systems,
          accessing memory from a remote NUMA node can be 2-3x slower than local access.
        </li>
      </ul>

      <Tip title="When to Use CPU Affinity">
        CPU affinity is most beneficial for workloads with tight latency requirements
        (sub-millisecond), high CPU utilization, or those that benefit from cache locality.
        Examples include financial trading systems, real-time analytics, game servers,
        and AI/ML inference.
      </Tip>

      {/* NUMA Architecture */}
      <h3 className={styles.sectionSubtitle}>Understanding NUMA Architecture</h3>

      <p className={styles.paragraph}>
        <span className={styles.highlight}>Non-Uniform Memory Access (NUMA)</span> is the
        memory architecture used in modern multi-socket servers. In a NUMA system, each CPU
        socket has its own local memory, and accessing remote memory (attached to another
        socket) incurs additional latency.
      </p>

      <div className={styles.diagramContainer}>
        <ArchitectureDiagram />
      </div>
      <p className={styles.diagramCaption}>
        Figure 1: Dual-socket NUMA architecture showing local vs. remote memory access paths
      </p>

      <p className={styles.paragraph}>
        The diagram above shows a typical dual-socket server. Cores 0-3 on NUMA Node 0 can
        access their local memory in ~80ns, but accessing memory on Node 1 requires traversing
        the QPI/UPI interconnect, adding ~40ns of latency. For latency-sensitive workloads,
        this 50% increase can be significant.
      </p>

      <Tip title="CPU Cache Hierarchy">
        <p>
          Each CPU core has its own private L1 and L2 caches (typically 32KB L1 and 256KB-1MB L2).
          The L3 cache (also called LLC or "uncore cache") is shared among cores within a NUMA node.
          On modern processors with "split uncore cache" architectures (like Intel's recent Xeon
          or AMD EPYC), the L3 may be split into multiple domains within a socket. Kubernetes 1.32+
          supports the <code>prefer-align-cpus-by-uncorecache</code> policy option (KEP-4800) to
          align CPU allocations within the same L3 cache domain, reducing cross-cache latency.
        </p>
      </Tip>

      {/* The Four Managers */}
      <h3 className={styles.sectionSubtitle}>The Four Resource Managers</h3>

      <p className={styles.paragraph}>
        Kubernetes uses four kubelet managers that work together to provide hardware-aware
        resource allocation:
      </p>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>
            CPU Manager
          </h4>
          <p className={styles.cardContent}>
            Allocates exclusive CPU cores to Guaranteed QoS pods, preventing other workloads
            from using those cores. Essential for eliminating CPU contention.
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>
            Topology Manager
          </h4>
          <p className={styles.cardContent}>
            Coordinates resource allocation across managers to ensure CPUs, memory, and
            devices come from the same NUMA node when possible.
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>
            Memory Manager
          </h4>
          <p className={styles.cardContent}>
            Manages NUMA-aware memory allocation and hugepages, ensuring memory is allocated
            from the same NUMA node as the assigned CPUs.
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>
            Device Manager
          </h4>
          <p className={styles.cardContent}>
            Handles device plugins (GPUs, FPGAs, etc.) and provides topology hints to ensure
            devices are allocated from the same NUMA node as compute resources.
          </p>
        </div>
      </div>

      {/* Related KEPs */}
      <h3 className={styles.sectionSubtitle}>Related KEPs</h3>

      <p className={styles.paragraph}>
        These features are defined and tracked through Kubernetes Enhancement Proposals (KEPs).
        The badges below show the current status of each KEP:
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadgeList
          kepIds={[
            'KEP-3570',  // CPU Manager
            'KEP-693',   // Topology Manager
            'KEP-1769',  // Memory Manager
            'KEP-2625',  // Device Manager topology hints
            'KEP-4540',  // CPU Manager strict reservation
            'KEP-4800',  // Uncore cache alignment
          ]}
          maxVisible={6}
        />
      </div>

      {/* Prerequisites */}
      <h3 className={styles.sectionSubtitle}>Prerequisites</h3>

      <p className={styles.paragraph}>
        Before diving into configuration, ensure your environment meets these requirements:
      </p>

      <ul className={styles.list}>
        <li>
          <span className={styles.strong}>Kubernetes 1.26+</span> for stable CPU Manager
          and Topology Manager features
        </li>
        <li>
          <span className={styles.strong}>Multi-core nodes</span> with at least 4 CPU cores
          (2 reserved for system, 2+ for workloads)
        </li>
        <li>
          <span className={styles.strong}>Guaranteed QoS pods</span> with integer CPU requests
          equal to limits
        </li>
        <li>
          <span className={styles.strong}>Node access</span> to configure kubelet flags
          (or managed Kubernetes with node pool configuration)
        </li>
      </ul>

      <Info title="Managed Kubernetes">
        <p>
          If you're using a managed Kubernetes service (EKS, GKE, AKS), check your provider's
          documentation for enabling CPU Manager and Topology Manager. Some providers offer
          this through node pool configuration or dedicated node types.
        </p>
      </Info>
    </section>
  )
}

export default Overview
