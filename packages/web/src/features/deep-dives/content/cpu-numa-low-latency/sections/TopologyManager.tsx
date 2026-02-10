/**
 * Topology Manager Section - CPU/NUMA Deep Dive
 *
 * Covers Topology Manager policies (none, best-effort, restricted, single-numa-node)
 * with configuration examples and trade-offs for NUMA-aware resource allocation.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/TopologyManager
 */

import { KepStatusBadge } from '../../../components/KepStatusBadge'
import { FeatureGateBadge } from '../../../components/FeatureGateCard'
import { KubeletFlagCard } from '../../../components/KubeletFlagCard'
import { CodeBlock } from '../../../components/CodeBlock'
import { Info, Warning, Tip } from '../../../components/InfoCallout'
import { TopologyHintProtocol } from '../visualizations/TopologyHintProtocol'
import { PolicyDecisionTree } from '../visualizations/PolicyDecisionTree'
import styles from '../styles.module.css'

// =============================================================================
// Code Examples
// =============================================================================

const KUBELET_CONFIG_TOPOLOGY = `# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
topologyManagerPolicy: single-numa-node
topologyManagerScope: container
cpuManagerPolicy: static
memoryManagerPolicy: Static
reservedSystemCPUs: "0-1"
reservedMemory:
  - numaNode: 0
    limits:
      memory: "1Gi"`

const POD_NUMA_ALIGNED = `apiVersion: v1
kind: Pod
metadata:
  name: numa-aligned-app
spec:
  containers:
  - name: app
    image: my-app:latest
    resources:
      requests:
        cpu: "4"
        memory: "8Gi"
        nvidia.com/gpu: "1"
      limits:
        cpu: "4"
        memory: "8Gi"
        nvidia.com/gpu: "1"`

const VERIFY_TOPOLOGY = `# Check Topology Manager state
cat /var/lib/kubelet/memory_manager_state

# Check pod's NUMA allocation
kubectl get pod numa-aligned-app -o jsonpath='{.status.qosClass}'
# Output: Guaranteed

# Verify NUMA node assignment (requires numactl)
kubectl exec numa-aligned-app -- numactl --show
# Output: 
# policy: bind
# preferred node: 0
# physcpubind: 4 5 6 7
# cpubind: 0
# nodebind: 0
# membind: 0`

// =============================================================================
// Component
// =============================================================================

export function TopologyManager() {
  return (
    <section id="topology-manager" className={styles.section}>
      <h2 className={styles.sectionTitle}>Topology Manager</h2>

      <p className={styles.lead}>
        The Topology Manager coordinates resource allocation across CPU Manager, Memory Manager,
        and Device Manager to ensure NUMA-aligned placement. It collects "topology hints" from
        each manager and makes admission decisions based on the configured policy.
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-693" />
        <FeatureGateBadge gateName="TopologyManager" version="1.35" />
      </div>

      <Info title="Why NUMA Alignment Matters">
        <p>
          On multi-socket systems, memory access latency varies depending on which CPU accesses
          which memory. Local memory access (same NUMA node) is significantly faster than remote
          access (different NUMA node). For latency-sensitive workloads, ensuring all resources
          come from the same NUMA node can reduce latency by 30-50%.
        </p>
      </Info>

      {/* Policies Overview */}
      <h3 id="topology-manager-policies" className={styles.sectionSubtitle}>Policies</h3>

      <p className={styles.paragraph}>
        Topology Manager supports four policies, each with different trade-offs between
        resource utilization and NUMA alignment guarantees:
      </p>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.policyCard}>
          <div className={styles.policyCardHeader}>
            <span className={styles.policyName}>none</span>
            <span className={`${styles.policyBadge} ${styles.policyBadgeDefault}`}>Default</span>
          </div>
          <p className={styles.policyDescription}>
            No topology alignment. Resources are allocated without considering NUMA topology.
            Topology hints are not collected or used.
          </p>
          <p className={styles.policyUseCase}>
            Use case: General workloads, development environments
          </p>
        </div>

        <div className={styles.policyCard}>
          <div className={styles.policyCardHeader}>
            <span className={styles.policyName}>best-effort</span>
          </div>
          <p className={styles.policyDescription}>
            Attempts NUMA alignment but allows pods even if alignment isn't possible.
            Collects hints and tries to satisfy them, but never rejects pods.
          </p>
          <p className={styles.policyUseCase}>
            Use case: Mixed workloads where some benefit from alignment
          </p>
        </div>

        <div className={styles.policyCard}>
          <div className={styles.policyCardHeader}>
            <span className={styles.policyName}>restricted</span>
          </div>
          <p className={styles.policyDescription}>
            Requires NUMA alignment for pods requesting topology-aware resources.
            Rejects pods if alignment cannot be achieved. Pods without such resources
            are admitted without alignment.
          </p>
          <p className={styles.policyUseCase}>
            Use case: Clusters with mixed latency-sensitive and general workloads
          </p>
        </div>

        <div className={styles.policyCard}>
          <div className={styles.policyCardHeader}>
            <span className={styles.policyName}>single-numa-node</span>
            <span className={`${styles.policyBadge} ${styles.policyBadgeRecommended}`}>
              Strictest
            </span>
          </div>
          <p className={styles.policyDescription}>
            Requires all resources to come from a single NUMA node. Rejects pods if
            resources cannot fit on one node. Provides strongest latency guarantees.
          </p>
          <p className={styles.policyUseCase}>
            Use case: Ultra-low-latency workloads, real-time systems
          </p>
        </div>
      </div>

      {/* Policy Decision Tree Visualization */}
      <h4 className={styles.sectionSubtitle}>Policy Selection Guide</h4>
      <p className={styles.paragraph}>
        Use this interactive decision tree to determine the best Topology Manager
        policy for your workload:
      </p>
      <div className={styles.visualizationContainer}>
        <PolicyDecisionTree />
      </div>

      {/* Topology Hints */}
      <h3 id="topology-manager-hints" className={styles.sectionSubtitle}>Topology Hints</h3>

      <p className={styles.paragraph}>
        Topology hints are the mechanism by which resource managers communicate their
        NUMA preferences to the Topology Manager. Each manager provides hints indicating
        which NUMA nodes can satisfy a resource request.
      </p>

      <div className={styles.card}>
        <h4 className={styles.cardTitle}>Hint Gathering Process</h4>
        <ol className={styles.list}>
          <li>
            <span className={styles.strong}>Pod admission request</span> arrives at kubelet
          </li>
          <li>
            Topology Manager queries each resource manager for <span className={styles.strong}>topology hints</span>
          </li>
          <li>
            CPU Manager returns hints based on available CPUs per NUMA node
          </li>
          <li>
            Memory Manager returns hints based on available memory per NUMA node
          </li>
          <li>
            Device Manager returns hints based on device NUMA affinity
          </li>
          <li>
            Topology Manager <span className={styles.strong}>merges hints</span> to find common NUMA nodes
          </li>
          <li>
            Based on policy, pod is <span className={styles.strong}>admitted or rejected</span>
          </li>
        </ol>
      </div>

      {/* Topology Hint Protocol Visualization */}
      <div className={styles.visualizationContainer}>
        <TopologyHintProtocol autoPlay={false} speed={1} />
      </div>

      <Warning title="Hint Merging Can Fail">
        <p>
          If resource managers return hints with no common NUMA nodes (e.g., CPU available
          on node 0, GPU only on node 1), the merge fails. With <code>restricted</code> or
          <code>single-numa-node</code> policies, the pod will be rejected. Plan your
          hardware topology carefully!
        </p>
      </Warning>

      {/* Scope */}
      <h4 className={styles.sectionSubtitle}>Topology Manager Scope</h4>

      <p className={styles.paragraph}>
        The <code>topologyManagerScope</code> setting determines the granularity of
        topology alignment:
      </p>

      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>Scope</th>
            <th>Alignment Unit</th>
            <th>Use Case</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>container</code></td>
            <td>Each container aligned independently</td>
            <td>Pods with containers having different resource needs</td>
          </tr>
          <tr>
            <td><code>pod</code></td>
            <td>All containers in pod aligned together</td>
            <td>Pods where containers share data or communicate frequently</td>
          </tr>
        </tbody>
      </table>

      <Tip title="Choosing the Right Scope">
        <p>
          Use <code>pod</code> scope when containers within a pod communicate via shared
          memory or need to access the same data. Use <code>container</code> scope when
          containers are independent and have different resource profiles.
        </p>
      </Tip>

      {/* Configuration */}
      <h4 className={styles.sectionSubtitle}>Configuration</h4>

      <p className={styles.paragraph}>
        Here's a complete kubelet configuration for strict NUMA alignment with all
        resource managers working together:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={KUBELET_CONFIG_TOPOLOGY}
          language="yaml"
          title="kubelet-config.yaml"
          highlightLines={[4, 5, 6, 7]}
        />
      </div>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <KubeletFlagCard flagName="--topology-manager-policy" />
        <KubeletFlagCard flagName="--topology-manager-scope" />
      </div>

      {/* Pod Example */}
      <h4 className={styles.sectionSubtitle}>Pod Specification</h4>

      <p className={styles.paragraph}>
        For Topology Manager to align resources, pods must have Guaranteed QoS and
        request topology-aware resources (CPUs, memory, devices):
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_NUMA_ALIGNED}
          language="yaml"
          title="numa-aligned-pod.yaml"
          highlightLines={[10, 11, 12]}
        />
      </div>

      {/* Verification */}
      <h4 className={styles.sectionSubtitle}>Verification</h4>

      <p className={styles.paragraph}>
        After deploying a pod, verify that resources are NUMA-aligned:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={VERIFY_TOPOLOGY}
          language="bash"
          title="Verification Commands"
        />
      </div>

      {/* Policy Comparison */}
      <h4 className={styles.sectionSubtitle}>Policy Comparison</h4>

      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>Aspect</th>
            <th>none</th>
            <th>best-effort</th>
            <th>restricted</th>
            <th>single-numa-node</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Hint Collection</td>
            <td>No</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Alignment Guarantee</td>
            <td>None</td>
            <td>Best effort</td>
            <td>For topology-aware resources</td>
            <td>All resources on one node</td>
          </tr>
          <tr>
            <td>Pod Rejection</td>
            <td>Never</td>
            <td>Never</td>
            <td>If alignment fails</td>
            <td>If single-node impossible</td>
          </tr>
          <tr>
            <td>Resource Utilization</td>
            <td>Highest</td>
            <td>High</td>
            <td>Medium</td>
            <td>Lowest</td>
          </tr>
          <tr>
            <td>Latency Predictability</td>
            <td>Low</td>
            <td>Variable</td>
            <td>Good</td>
            <td>Best</td>
          </tr>
        </tbody>
      </table>

      {/* Advanced Options */}
      <h4 className={styles.sectionSubtitle}>Advanced Policy Options</h4>

      <p className={styles.paragraph}>
        Kubernetes 1.32+ introduces additional Topology Manager policy options:
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-4800" />
        <FeatureGateBadge gateName="TopologyManagerPolicyOptions" version="1.35" />
      </div>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>prefer-closest-numa-nodes</h5>
          <p className={styles.cardContent}>
            When resources span multiple NUMA nodes, prefer nodes that are
            topologically closer (lower interconnect latency). Useful for
            workloads that can't fit on a single node but still benefit
            from locality.
          </p>
        </div>

        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>max-allowable-numa-nodes</h5>
          <p className={styles.cardContent}>
            Limit the maximum number of NUMA nodes a pod can span. Provides
            a middle ground between single-numa-node (too strict) and
            best-effort (too loose).
          </p>
        </div>
      </div>

      <Info title="Combining with CPU Manager">
        <p>
          Topology Manager works best when combined with CPU Manager's <code>static</code>
          policy. While Topology Manager ensures NUMA alignment, CPU Manager provides
          exclusive CPU allocation. Together, they eliminate both cross-NUMA memory
          access and CPU contention.
        </p>
      </Info>
    </section>
  )
}

export default TopologyManager
