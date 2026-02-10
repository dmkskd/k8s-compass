/**
 * Configuration Section - CPU/NUMA Deep Dive
 *
 * Complete configuration guide including kernel parameters, kubelet flags,
 * and Pod specifications for low-latency workloads.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/Configuration
 */

import { KubeletFlagCard } from '../../../components/KubeletFlagCard'
import { CodeBlock } from '../../../components/CodeBlock'
import { Info, Warning, Tip } from '../../../components/InfoCallout'
import { QoSFlowchart } from '../visualizations/QoSFlowchart'
import styles from '../styles.module.css'

// =============================================================================
// Code Examples
// =============================================================================

const KERNEL_PARAMS = `# /etc/default/grub - GRUB_CMDLINE_LINUX additions

# CPU isolation for latency-critical workloads
isolcpus=4-15 nohz_full=4-15 rcu_nocbs=4-15

# Hugepages configuration
hugepagesz=2M hugepages=1024 default_hugepagesz=2M
hugepagesz=1G hugepages=4

# NUMA balancing (disable for predictable latency)
numa_balancing=disable

# Kernel preemption for lower latency
preempt=full

# Disable CPU frequency scaling (use performance governor)
intel_pstate=disable

# After editing, run:
# sudo update-grub && sudo reboot`

const SYSCTL_CONFIG = `# /etc/sysctl.d/99-low-latency.conf

# Disable swap (also set in kubelet)
vm.swappiness = 0

# Reduce memory overcommit
vm.overcommit_memory = 0

# Increase max memory map areas (for large apps)
vm.max_map_count = 262144

# Network tuning for low latency
net.core.busy_read = 50
net.core.busy_poll = 50
net.ipv4.tcp_fastopen = 3

# Disable transparent hugepages (use explicit hugepages instead)
# Note: Also disable via kernel param or at runtime

# Apply with: sudo sysctl -p /etc/sysctl.d/99-low-latency.conf`

const KUBELET_COMPLETE = `# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration

# CPU Manager
cpuManagerPolicy: static
cpuManagerReconcilePeriod: 5s
cpuManagerPolicyOptions:
  full-pcpus-only: "true"

# Topology Manager
topologyManagerPolicy: single-numa-node
topologyManagerScope: container

# Memory Manager
memoryManagerPolicy: Static
reservedMemory:
  - numaNode: 0
    limits:
      memory: "1Gi"
      hugepages-2Mi: "256Mi"
  - numaNode: 1
    limits:
      memory: "1Gi"
      hugepages-2Mi: "256Mi"

# System reserved resources
reservedSystemCPUs: "0-3"
kubeReserved:
  cpu: "1"
  memory: "2Gi"
  ephemeral-storage: "10Gi"
systemReserved:
  cpu: "1"
  memory: "2Gi"
  ephemeral-storage: "10Gi"

# Eviction thresholds
evictionHard:
  memory.available: "500Mi"
  nodefs.available: "10%"
  imagefs.available: "15%"

# Feature gates
featureGates:
  CPUManagerPolicyOptions: true
  TopologyManagerPolicyOptions: true
  MemoryManager: true`

const POD_COMPLETE = `apiVersion: v1
kind: Pod
metadata:
  name: low-latency-app
  annotations:
    # Disable CPU throttling (requires kernel support)
    cpu-quota.crio.io: "disable"
spec:
  # Prevent eviction
  priorityClassName: system-node-critical
  
  # Node selection
  nodeSelector:
    node-role.kubernetes.io/worker: ""
    topology.kubernetes.io/zone: "zone-a"
  
  # Tolerations for dedicated nodes
  tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "low-latency"
    effect: "NoSchedule"
  
  containers:
  - name: app
    image: my-low-latency-app:latest
    
    # Guaranteed QoS (requests = limits)
    resources:
      requests:
        cpu: "4"
        memory: "8Gi"
        hugepages-2Mi: "1Gi"
      limits:
        cpu: "4"
        memory: "8Gi"
        hugepages-2Mi: "1Gi"
    
    # Security context
    securityContext:
      privileged: false
      capabilities:
        add:
        - SYS_NICE        # For setting thread priorities
        - IPC_LOCK        # For locking memory
    
    # Hugepage volume mount
    volumeMounts:
    - name: hugepage
      mountPath: /hugepages
    
    # Environment for NUMA-aware apps
    env:
    - name: GOMAXPROCS
      value: "4"
    - name: OMP_NUM_THREADS
      value: "4"
  
  volumes:
  - name: hugepage
    emptyDir:
      medium: HugePages-2Mi`

const QOS_EXAMPLES = `# Guaranteed QoS - Gets exclusive CPUs
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "4"        # Integer, equals limits
        memory: "8Gi"   # Equals limits
      limits:
        cpu: "4"
        memory: "8Gi"

---
# Burstable QoS - Shares CPU pool
apiVersion: v1
kind: Pod
metadata:
  name: burstable-pod
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "500m"     # Fractional OR different from limits
        memory: "1Gi"
      limits:
        cpu: "2"
        memory: "4Gi"

---
# BestEffort QoS - No guarantees
apiVersion: v1
kind: Pod
metadata:
  name: besteffort-pod
spec:
  containers:
  - name: app
    # No resources specified`

// =============================================================================
// Component
// =============================================================================

export function Configuration() {
  return (
    <section id="configuration" className={styles.section}>
      <h2 className={styles.sectionTitle}>Configuration</h2>

      <p className={styles.lead}>
        Achieving optimal low-latency performance requires configuration at multiple
        levels: kernel parameters, system settings, kubelet configuration, and Pod
        specifications. This section provides a complete reference.
      </p>

      {/* Kernel Parameters */}
      <h3 id="configuration-kernel" className={styles.sectionSubtitle}>Kernel Parameters</h3>

      <p className={styles.paragraph}>
        Kernel boot parameters are set in the GRUB configuration and require a reboot
        to take effect. These settings isolate CPUs, configure hugepages, and tune
        the kernel for low latency:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={KERNEL_PARAMS}
          language="bash"
          title="GRUB Configuration"
          highlightLines={[4, 7, 8, 11]}
        />
      </div>

      <div className={styles.card}>
        <h4 className={styles.cardTitle}>Key Kernel Parameters</h4>
        <dl className={styles.definitionList}>
          <dt><code>isolcpus</code></dt>
          <dd>
            Isolates CPUs from the kernel scheduler. Isolated CPUs won't run any
            kernel threads or user processes unless explicitly assigned.
          </dd>
          <dt><code>nohz_full</code></dt>
          <dd>
            Enables adaptive-ticks mode on specified CPUs. Reduces timer interrupts
            when only one task is running, improving latency.
          </dd>
          <dt><code>rcu_nocbs</code></dt>
          <dd>
            Offloads RCU callbacks from specified CPUs. Prevents RCU processing
            from interrupting latency-sensitive workloads.
          </dd>
          <dt><code>numa_balancing=disable</code></dt>
          <dd>
            Disables automatic NUMA balancing. Prevents the kernel from migrating
            memory between NUMA nodes, which can cause latency spikes.
          </dd>
        </dl>
      </div>

      <Warning title="CPU Isolation Coordination">
        <p>
          The CPUs specified in <code>isolcpus</code> should match the CPUs available
          for exclusive allocation by CPU Manager. Don't isolate CPUs that are reserved
          for system processes (<code>reservedSystemCPUs</code>).
        </p>
      </Warning>

      {/* Sysctl Settings */}
      <h4 className={styles.sectionSubtitle}>Sysctl Settings</h4>

      <p className={styles.paragraph}>
        Runtime kernel parameters can be set via sysctl without a reboot:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={SYSCTL_CONFIG}
          language="bash"
          title="Sysctl Configuration"
          highlightLines={[4, 10, 14, 15]}
        />
      </div>

      <Tip title="Transparent Hugepages">
        <p>
          Disable Transparent Hugepages (THP) for latency-sensitive workloads. THP
          can cause unpredictable latency spikes during memory compaction. Use
          explicit hugepages instead.
        </p>
      </Tip>

      {/* Kubelet Configuration */}
      <h4 className={styles.sectionSubtitle}>Complete Kubelet Configuration</h4>

      <p className={styles.paragraph}>
        Here's a complete kubelet configuration for low-latency workloads with all
        resource managers enabled:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={KUBELET_COMPLETE}
          language="yaml"
          title="kubelet-config.yaml"
          highlightLines={[6, 11, 15, 27, 28]}
        />
      </div>

      <div className={`${styles.grid} ${styles.gridThree}`}>
        <KubeletFlagCard flagName="--cpu-manager-policy" />
        <KubeletFlagCard flagName="--topology-manager-policy" />
        <KubeletFlagCard flagName="--memory-manager-policy" />
      </div>

      {/* Pod Specifications */}
      <h3 id="configuration-pod-spec" className={styles.sectionSubtitle}>Pod Specifications</h3>

      <p className={styles.paragraph}>
        A complete Pod specification for low-latency workloads includes resource
        requests/limits, security context, volume mounts, and scheduling constraints:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_COMPLETE}
          language="yaml"
          title="low-latency-pod.yaml"
          highlightLines={[30, 31, 32, 33, 34, 35, 36, 37, 43, 44]}
        />
      </div>

      {/* QoS Classes */}
      <h4 className={styles.sectionSubtitle}>QoS Classes</h4>

      <p className={styles.paragraph}>
        Kubernetes assigns QoS classes based on resource specifications. Only
        Guaranteed QoS pods receive exclusive CPUs from CPU Manager:
      </p>

      {/* QoS Flowchart Visualization */}
      <div className={styles.visualizationContainer}>
        <QoSFlowchart />
      </div>

      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>QoS Class</th>
            <th>Requirements</th>
            <th>CPU Manager Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className={styles.strong}>Guaranteed</span></td>
            <td>All containers: requests = limits for CPU and memory</td>
            <td>Exclusive CPUs (if integer request)</td>
          </tr>
          <tr>
            <td><span className={styles.strong}>Burstable</span></td>
            <td>At least one container has requests or limits</td>
            <td>Shared CPU pool</td>
          </tr>
          <tr>
            <td><span className={styles.strong}>BestEffort</span></td>
            <td>No requests or limits specified</td>
            <td>Shared CPU pool</td>
          </tr>
        </tbody>
      </table>

      <div className={styles.codeExample}>
        <CodeBlock
          code={QOS_EXAMPLES}
          language="yaml"
          title="QoS Class Examples"
        />
      </div>

      <Info title="Integer CPU Requests">
        <p>
          Even with Guaranteed QoS, pods only receive exclusive CPUs if the CPU
          request is an integer (e.g., <code>"4"</code>). Fractional requests
          (e.g., <code>"500m"</code> or <code>"1.5"</code>) result in shared pool
          allocation.
        </p>
      </Info>

      {/* Configuration Checklist */}
      <h4 className={styles.sectionSubtitle}>Configuration Checklist</h4>

      <div className={styles.card}>
        <h4 className={styles.cardTitle}>Pre-Deployment Checklist</h4>
        <ul className={styles.list}>
          <li>
            <span className={styles.strong}>Kernel:</span> CPU isolation, hugepages,
            NUMA balancing disabled
          </li>
          <li>
            <span className={styles.strong}>Sysctl:</span> Swap disabled, THP disabled,
            network tuning applied
          </li>
          <li>
            <span className={styles.strong}>Kubelet:</span> CPU Manager static policy,
            Topology Manager policy, Memory Manager enabled
          </li>
          <li>
            <span className={styles.strong}>Reserved resources:</span> System CPUs and
            memory reserved on each NUMA node
          </li>
          <li>
            <span className={styles.strong}>Hugepages:</span> Allocated and balanced
            across NUMA nodes
          </li>
          <li>
            <span className={styles.strong}>Device plugins:</span> Deployed for GPUs
            or other accelerators
          </li>
          <li>
            <span className={styles.strong}>Pod spec:</span> Guaranteed QoS, integer
            CPU requests, hugepage mounts
          </li>
        </ul>
      </div>
    </section>
  )
}

export default Configuration
