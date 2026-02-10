/**
 * Best Practices Section - CPU/NUMA Deep Dive
 *
 * Recommendations, troubleshooting tips, and common pitfalls for
 * low-latency Kubernetes workloads.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/BestPractices
 */

import { CodeBlock } from '../../../components/CodeBlock'
import { Info, Warning, Tip } from '../../../components/InfoCallout'
import styles from '../styles.module.css'

// =============================================================================
// Code Examples
// =============================================================================

const TROUBLESHOOT_CPU = `# Check CPU Manager state
cat /var/lib/kubelet/cpu_manager_state | jq .

# Verify pod's CPU affinity
kubectl exec <pod> -- taskset -p 1

# Check if pod has exclusive CPUs
kubectl describe pod <pod> | grep -A10 "Limits:"

# View kubelet logs for CPU Manager
journalctl -u kubelet | grep -i "cpu.*manager"

# Check CPU isolation
cat /sys/devices/system/cpu/isolated`

const TROUBLESHOOT_NUMA = `# Check Topology Manager state
cat /var/lib/kubelet/memory_manager_state | jq .

# Verify NUMA binding
kubectl exec <pod> -- numactl --show

# Check NUMA topology
numactl --hardware

# View kubelet logs for Topology Manager
journalctl -u kubelet | grep -i "topology.*manager"

# Check pod admission failures
kubectl describe pod <pod> | grep -i "topology"`

const TROUBLESHOOT_MEMORY = `# Check hugepage allocation
cat /proc/meminfo | grep -i huge

# Per-NUMA node hugepages
cat /sys/devices/system/node/node*/hugepages/hugepages-*/nr_hugepages

# Check Memory Manager state
cat /var/lib/kubelet/memory_manager_state | jq .

# Verify hugepage mount in pod
kubectl exec <pod> -- ls -la /hugepages

# Check for OOM events
dmesg | grep -i "out of memory"`

const MONITORING_METRICS = `# Prometheus metrics to monitor

# CPU Manager
kubelet_cpu_manager_pinning_requests_total
kubelet_cpu_manager_pinning_errors_total

# Topology Manager  
kubelet_topology_manager_admission_requests_total
kubelet_topology_manager_admission_errors_total

# Memory Manager
kubelet_memory_manager_pinning_requests_total
kubelet_memory_manager_pinning_errors_total

# Node resources
node_memory_HugePages_Total
node_memory_HugePages_Free
node_cpu_seconds_total{mode="idle"}`

// =============================================================================
// Component
// =============================================================================

export function BestPractices() {
  return (
    <section id="best-practices" className={styles.section}>
      <h2 className={styles.sectionTitle}>Best Practices</h2>

      <p className={styles.lead}>
        Successfully running low-latency workloads on Kubernetes requires careful
        planning, proper configuration, and ongoing monitoring. This section
        summarizes key recommendations and troubleshooting techniques.
      </p>

      {/* Planning */}
      <h3 className={styles.sectionSubtitle}>Planning & Design</h3>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Hardware Planning</h4>
          <ul className={styles.list}>
            <li>Choose servers with balanced NUMA topology</li>
            <li>Ensure GPUs are distributed across NUMA nodes</li>
            <li>Plan hugepage allocation before deployment</li>
            <li>Consider NVMe placement for storage-intensive workloads</li>
          </ul>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Workload Sizing</h4>
          <ul className={styles.list}>
            <li>Size pods to fit within a single NUMA node</li>
            <li>Use integer CPU requests for exclusive allocation</li>
            <li>Account for system reserved resources</li>
            <li>Leave headroom for system processes</li>
          </ul>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Cluster Architecture</h4>
          <ul className={styles.list}>
            <li>Dedicate nodes for low-latency workloads</li>
            <li>Use taints/tolerations for workload isolation</li>
            <li>Separate control plane from worker nodes</li>
            <li>Consider node-local storage for state</li>
          </ul>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Capacity Planning</h4>
          <ul className={styles.list}>
            <li>Calculate maximum pods per NUMA node</li>
            <li>Plan for hugepage fragmentation over time</li>
            <li>Reserve capacity for rolling updates</li>
            <li>Monitor and alert on resource exhaustion</li>
          </ul>
        </div>
      </div>

      {/* Do's and Don'ts */}
      <h3 className={styles.sectionSubtitle}>Do's and Don'ts</h3>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.featureBox}>
          <h4 className={styles.featureBoxTitle}>Do</h4>
          <ul className={styles.list}>
            <li>Use Guaranteed QoS for latency-sensitive pods</li>
            <li>Request integer CPUs for exclusive allocation</li>
            <li>Combine CPU, Topology, and Memory Managers</li>
            <li>Reserve system resources on each NUMA node</li>
            <li>Test with realistic workloads before production</li>
            <li>Monitor kubelet metrics for admission failures</li>
            <li>Use node affinity for consistent placement</li>
            <li>Document your NUMA topology and configuration</li>
          </ul>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Don't</h4>
          <ul className={styles.list}>
            <li>Mix latency-sensitive and batch workloads on same node</li>
            <li>Use fractional CPU requests for critical workloads</li>
            <li>Ignore NUMA topology when sizing pods</li>
            <li>Forget to reserve hugepages for system use</li>
            <li>Enable NUMA balancing with static policies</li>
            <li>Overcommit resources on low-latency nodes</li>
            <li>Skip kernel tuning (isolcpus, nohz_full)</li>
            <li>Assume default settings are optimal</li>
          </ul>
        </div>
      </div>

      {/* Common Pitfalls */}
      <h3 className={styles.sectionSubtitle}>Common Pitfalls</h3>

      <Warning title="Pitfall: Pod Rejected by Topology Manager">
        <p>
          <span className={styles.strong}>Symptom:</span> Pod stays in Pending state
          with "TopologyAffinityError" in events.
        </p>
        <p>
          <span className={styles.strong}>Cause:</span> Resources can't be aligned on
          a single NUMA node (e.g., not enough CPUs, GPU on different node).
        </p>
        <p>
          <span className={styles.strong}>Solution:</span> Reduce resource requests,
          use <code>restricted</code> instead of <code>single-numa-node</code> policy,
          or ensure hardware topology supports your requirements.
        </p>
      </Warning>

      <Warning title="Pitfall: No Exclusive CPUs Despite Guaranteed QoS">
        <p>
          <span className={styles.strong}>Symptom:</span> Pod has Guaranteed QoS but
          shares CPUs with other workloads.
        </p>
        <p>
          <span className={styles.strong}>Cause:</span> CPU request is fractional
          (e.g., <code>500m</code>) or CPU Manager policy is <code>none</code>.
        </p>
        <p>
          <span className={styles.strong}>Solution:</span> Use integer CPU requests
          and verify <code>cpuManagerPolicy: static</code> in kubelet config.
        </p>
      </Warning>

      <Warning title="Pitfall: Hugepage Allocation Failures">
        <p>
          <span className={styles.strong}>Symptom:</span> Pod fails to schedule with
          "Insufficient hugepages" error.
        </p>
        <p>
          <span className={styles.strong}>Cause:</span> Not enough hugepages available,
          or hugepages not balanced across NUMA nodes.
        </p>
        <p>
          <span className={styles.strong}>Solution:</span> Increase hugepage allocation,
          distribute evenly across NUMA nodes, or reduce pod requests.
        </p>
      </Warning>

      {/* Troubleshooting */}
      <h3 className={styles.sectionSubtitle}>Troubleshooting</h3>

      <h4 className={styles.sectionSubtitle}>CPU Manager Issues</h4>

      <div className={styles.codeExample}>
        <CodeBlock
          code={TROUBLESHOOT_CPU}
          language="bash"
          title="CPU Manager Troubleshooting"
        />
      </div>

      <h4 className={styles.sectionSubtitle}>Topology Manager Issues</h4>

      <div className={styles.codeExample}>
        <CodeBlock
          code={TROUBLESHOOT_NUMA}
          language="bash"
          title="Topology Manager Troubleshooting"
        />
      </div>

      <h4 className={styles.sectionSubtitle}>Memory Manager Issues</h4>

      <div className={styles.codeExample}>
        <CodeBlock
          code={TROUBLESHOOT_MEMORY}
          language="bash"
          title="Memory Manager Troubleshooting"
        />
      </div>

      {/* Monitoring */}
      <h3 className={styles.sectionSubtitle}>Monitoring</h3>

      <p className={styles.paragraph}>
        Monitor these Prometheus metrics to track resource manager health and
        identify issues early:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={MONITORING_METRICS}
          language="yaml"
          title="Key Prometheus Metrics"
        />
      </div>

      <Tip title="Alerting Recommendations">
        <p>
          Set up alerts for: admission error rate {'>'} 0, hugepage free {'<'} 10%,
          and CPU Manager pinning errors. These indicate configuration issues or
          resource exhaustion that will affect new pod scheduling.
        </p>
      </Tip>

      {/* Performance Testing */}
      <h3 className={styles.sectionSubtitle}>Performance Testing</h3>

      <div className={styles.card}>
        <h4 className={styles.cardTitle}>Testing Checklist</h4>
        <ul className={styles.list}>
          <li>
            <span className={styles.strong}>Baseline measurement:</span> Measure
            latency without NUMA optimizations to establish baseline
          </li>
          <li>
            <span className={styles.strong}>Isolation testing:</span> Verify CPU
            isolation with stress tests on adjacent cores
          </li>
          <li>
            <span className={styles.strong}>NUMA verification:</span> Confirm memory
            access patterns using <code>numastat</code> and <code>perf</code>
          </li>
          <li>
            <span className={styles.strong}>Longevity testing:</span> Run workloads
            for extended periods to catch memory fragmentation
          </li>
          <li>
            <span className={styles.strong}>Failure testing:</span> Test pod eviction,
            node failure, and recovery scenarios
          </li>
        </ul>
      </div>

      {/* Summary */}
      <h3 className={styles.sectionSubtitle}>Summary</h3>

      <Info title="Key Takeaways">
        <ul className={styles.list}>
          <li>
            <span className={styles.strong}>CPU Manager</span> provides exclusive CPU
            allocation for Guaranteed QoS pods with integer CPU requests
          </li>
          <li>
            <span className={styles.strong}>Topology Manager</span> coordinates NUMA
            alignment across CPU, memory, and devices
          </li>
          <li>
            <span className={styles.strong}>Memory Manager</span> enables NUMA-aware
            memory allocation and hugepage management
          </li>
          <li>
            <span className={styles.strong}>Device Manager</span> handles GPU and
            accelerator allocation with NUMA topology hints
          </li>
          <li>
            All managers work together—configure them as a system, not individually
          </li>
          <li>
            Kernel tuning is essential—don't skip <code>isolcpus</code> and
            <code>nohz_full</code> for true low-latency
          </li>
        </ul>
      </Info>
    </section>
  )
}

export default BestPractices
