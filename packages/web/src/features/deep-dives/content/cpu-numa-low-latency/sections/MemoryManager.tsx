/**
 * Memory Manager Section - CPU/NUMA Deep Dive
 *
 * Covers Memory Manager configuration, hugepages, and NUMA-aware memory allocation
 * for high-performance workloads.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/MemoryManager
 */

import { KepStatusBadge } from '../../../components/KepStatusBadge'
import { FeatureGateBadge } from '../../../components/FeatureGateCard'
import { KubeletFlagCard } from '../../../components/KubeletFlagCard'
import { CodeBlock } from '../../../components/CodeBlock'
import { Info, Warning, Tip } from '../../../components/InfoCallout'
import styles from '../styles.module.css'

// =============================================================================
// Code Examples
// =============================================================================

const KUBELET_CONFIG_MEMORY = `# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
memoryManagerPolicy: Static
reservedMemory:
  - numaNode: 0
    limits:
      memory: "1Gi"
      hugepages-2Mi: "512Mi"
  - numaNode: 1
    limits:
      memory: "1Gi"
      hugepages-1Gi: "2Gi"`

const HUGEPAGES_KERNEL = `# Check current hugepage configuration
cat /proc/meminfo | grep -i huge

# Configure 2Mi hugepages at boot (grub)
# Add to GRUB_CMDLINE_LINUX:
hugepagesz=2M hugepages=1024 default_hugepagesz=2M

# Configure 1Gi hugepages at boot
hugepagesz=1G hugepages=4

# Runtime configuration (2Mi pages)
echo 1024 > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages

# Per-NUMA node configuration
echo 512 > /sys/devices/system/node/node0/hugepages/hugepages-2048kB/nr_hugepages
echo 512 > /sys/devices/system/node/node1/hugepages/hugepages-2048kB/nr_hugepages`

const POD_HUGEPAGES_2MI = `apiVersion: v1
kind: Pod
metadata:
  name: hugepages-2mi-app
spec:
  containers:
  - name: app
    image: my-app:latest
    resources:
      requests:
        cpu: "4"
        memory: "4Gi"
        hugepages-2Mi: "1Gi"
      limits:
        cpu: "4"
        memory: "4Gi"
        hugepages-2Mi: "1Gi"
    volumeMounts:
    - name: hugepage-2mi
      mountPath: /hugepages-2Mi
  volumes:
  - name: hugepage-2mi
    emptyDir:
      medium: HugePages-2Mi`

const POD_HUGEPAGES_1GI = `apiVersion: v1
kind: Pod
metadata:
  name: hugepages-1gi-app
spec:
  containers:
  - name: database
    image: my-database:latest
    resources:
      requests:
        cpu: "8"
        memory: "16Gi"
        hugepages-1Gi: "8Gi"
      limits:
        cpu: "8"
        memory: "16Gi"
        hugepages-1Gi: "8Gi"
    volumeMounts:
    - name: hugepage-1gi
      mountPath: /hugepages-1Gi
  volumes:
  - name: hugepage-1gi
    emptyDir:
      medium: HugePages-1Gi`

const VERIFY_MEMORY = `# Check Memory Manager state
cat /var/lib/kubelet/memory_manager_state

# Verify hugepage allocation in pod
kubectl exec hugepages-2mi-app -- cat /proc/meminfo | grep -i huge

# Check NUMA memory binding
kubectl exec hugepages-2mi-app -- numactl --show

# Verify hugepage mount
kubectl exec hugepages-2mi-app -- ls -la /hugepages-2Mi`

// =============================================================================
// Component
// =============================================================================

export function MemoryManager() {
  return (
    <section id="memory-manager" className={styles.section}>
      <h2 className={styles.sectionTitle}>Memory Manager</h2>

      <p className={styles.lead}>
        The Memory Manager provides NUMA-aware memory allocation and hugepage management.
        When configured with the <code>Static</code> policy, it ensures memory is allocated
        from specific NUMA nodes and provides topology hints to the Topology Manager.
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-1769" />
        <FeatureGateBadge gateName="MemoryManager" version="1.35" />
      </div>

      {/* Why Hugepages */}
      <h3 id="memory-manager-hugepages" className={styles.sectionSubtitle}>Hugepages</h3>

      <p className={styles.paragraph}>
        Standard memory pages on Linux are 4KB. For applications with large memory footprints,
        this means millions of page table entries, causing TLB (Translation Lookaside Buffer)
        misses and performance degradation. Hugepages solve this by using larger page sizes.
      </p>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>2Mi Hugepages</h4>
          <p className={styles.cardContent}>
            512x larger than standard pages. Good balance between TLB efficiency and
            memory flexibility. Supported on all modern x86_64 systems.
          </p>
          <p className={styles.policyUseCase}>
            Use case: General high-performance applications, databases
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>1Gi Hugepages</h4>
          <p className={styles.cardContent}>
            262,144x larger than standard pages. Maximum TLB efficiency but requires
            contiguous physical memory. Must be reserved at boot time.
          </p>
          <p className={styles.policyUseCase}>
            Use case: Large databases, in-memory caches, DPDK applications
          </p>
        </div>
      </div>

      <Info title="TLB and Performance">
        <p>
          The TLB is a CPU cache for virtual-to-physical address translations. With 4KB pages,
          a 1GB memory region requires 262,144 page table entries. With 2Mi pages, only 512
          entries are needed. Fewer entries mean fewer TLB misses and faster memory access.
        </p>
      </Info>

      {/* Kernel Configuration */}
      <h4 className={styles.sectionSubtitle}>Kernel Configuration</h4>

      <p className={styles.paragraph}>
        Hugepages must be configured at the kernel level before Kubernetes can use them.
        1Gi hugepages must be reserved at boot time, while 2Mi pages can be configured
        at runtime:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={HUGEPAGES_KERNEL}
          language="bash"
          title="Kernel Hugepage Configuration"
          highlightLines={[6, 9]}
        />
      </div>

      <Warning title="1Gi Hugepages Require Boot-Time Reservation">
        <p>
          1Gi hugepages require contiguous physical memory that can only be guaranteed
          at boot time. You cannot allocate 1Gi hugepages on a running system. Plan
          your hugepage requirements before deploying nodes.
        </p>
      </Warning>

      {/* Kubelet Configuration */}
      <h4 className={styles.sectionSubtitle}>Kubelet Configuration</h4>

      <p className={styles.paragraph}>
        Configure the Memory Manager with the <code>Static</code> policy and reserve
        memory per NUMA node:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={KUBELET_CONFIG_MEMORY}
          language="yaml"
          title="kubelet-config.yaml"
          highlightLines={[4, 5, 6, 7, 8]}
        />
      </div>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <KubeletFlagCard flagName="--memory-manager-policy" />
        <KubeletFlagCard flagName="--reserved-memory" />
      </div>

      <Tip title="Reserved Memory">
        <p>
          Always reserve memory for system processes on each NUMA node. The kubelet,
          container runtime, and OS services need memory. Without reserved memory,
          system processes may be OOM-killed or cause memory pressure.
        </p>
      </Tip>

      {/* Pod Examples */}
      <h4 className={styles.sectionSubtitle}>Pod Specifications</h4>

      <p className={styles.paragraph}>
        Pods request hugepages as a resource type. The hugepage size is specified in
        the resource name (<code>hugepages-2Mi</code> or <code>hugepages-1Gi</code>):
      </p>

      <h5 className={styles.sectionSubtitle}>2Mi Hugepages Example</h5>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_HUGEPAGES_2MI}
          language="yaml"
          title="hugepages-2mi-pod.yaml"
          highlightLines={[12, 15, 17, 18, 21, 22]}
        />
      </div>

      <h5 className={styles.sectionSubtitle}>1Gi Hugepages Example</h5>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_HUGEPAGES_1GI}
          language="yaml"
          title="hugepages-1gi-pod.yaml"
          highlightLines={[12, 15]}
        />
      </div>

      <Info title="Hugepage Volume Mounts">
        <p>
          To use hugepages in your application, mount them as an <code>emptyDir</code>
          volume with the <code>medium</code> set to the hugepage type. Your application
          can then use <code>mmap()</code> with <code>MAP_HUGETLB</code> or simply
          write to files in the mounted directory.
        </p>
      </Info>

      {/* Verification */}
      <h4 className={styles.sectionSubtitle}>Verification</h4>

      <p className={styles.paragraph}>
        After deploying a pod with hugepages, verify the allocation:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={VERIFY_MEMORY}
          language="bash"
          title="Verification Commands"
        />
      </div>

      {/* Comparison Table */}
      <h4 className={styles.sectionSubtitle}>Hugepage Size Comparison</h4>

      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>Aspect</th>
            <th>4KB (Standard)</th>
            <th>2Mi Hugepages</th>
            <th>1Gi Hugepages</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Page Size</td>
            <td>4 KB</td>
            <td>2 MB (2,048 KB)</td>
            <td>1 GB (1,048,576 KB)</td>
          </tr>
          <tr>
            <td>TLB Entries for 1GB</td>
            <td>262,144</td>
            <td>512</td>
            <td>1</td>
          </tr>
          <tr>
            <td>Runtime Allocation</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>No (boot only)</td>
          </tr>
          <tr>
            <td>Memory Flexibility</td>
            <td>High</td>
            <td>Medium</td>
            <td>Low</td>
          </tr>
          <tr>
            <td>TLB Efficiency</td>
            <td>Low</td>
            <td>Good</td>
            <td>Best</td>
          </tr>
          <tr>
            <td>Best For</td>
            <td>General workloads</td>
            <td>Databases, caches</td>
            <td>DPDK, large DBs</td>
          </tr>
        </tbody>
      </table>

      {/* Memory Manager Policies */}
      <h4 className={styles.sectionSubtitle}>Memory Manager Policies</h4>

      <p className={styles.paragraph}>
        The Memory Manager supports two policies:
      </p>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.policyCard}>
          <div className={styles.policyCardHeader}>
            <span className={styles.policyName}>None</span>
            <span className={`${styles.policyBadge} ${styles.policyBadgeDefault}`}>Default</span>
          </div>
          <p className={styles.policyDescription}>
            No NUMA-aware memory allocation. Memory is allocated from any available
            NUMA node. Topology hints are not provided.
          </p>
          <p className={styles.policyUseCase}>
            Use case: General workloads, development environments
          </p>
        </div>

        <div className={styles.policyCard}>
          <div className={styles.policyCardHeader}>
            <span className={styles.policyName}>Static</span>
            <span className={`${styles.policyBadge} ${styles.policyBadgeRecommended}`}>
              Recommended
            </span>
          </div>
          <p className={styles.policyDescription}>
            NUMA-aware memory allocation for Guaranteed QoS pods. Provides topology
            hints to Topology Manager. Ensures memory locality.
          </p>
          <p className={styles.policyUseCase}>
            Use case: Low-latency workloads, NUMA-sensitive applications
          </p>
        </div>
      </div>

      {/* Best Practices */}
      <h4 className={styles.sectionSubtitle}>Best Practices</h4>

      <div className={styles.card}>
        <ul className={styles.list}>
          <li>
            <span className={styles.strong}>Plan hugepage allocation:</span> Determine
            your hugepage requirements before deploying nodes. 1Gi pages cannot be
            added later.
          </li>
          <li>
            <span className={styles.strong}>Balance across NUMA nodes:</span> Distribute
            hugepages evenly across NUMA nodes to avoid scheduling constraints.
          </li>
          <li>
            <span className={styles.strong}>Reserve system memory:</span> Always reserve
            regular memory for system processes on each NUMA node.
          </li>
          <li>
            <span className={styles.strong}>Monitor hugepage usage:</span> Track hugepage
            allocation and fragmentation to avoid scheduling failures.
          </li>
          <li>
            <span className={styles.strong}>Use with Topology Manager:</span> Combine
            Memory Manager with Topology Manager for complete NUMA alignment.
          </li>
        </ul>
      </div>

      <Info title="Combining with Topology Manager">
        <p>
          Memory Manager provides topology hints to Topology Manager. When both are
          configured with their respective <code>Static</code> policies, the Topology
          Manager ensures that CPU, memory, and devices are all allocated from the
          same NUMA node.
        </p>
      </Info>
    </section>
  )
}

export default MemoryManager
