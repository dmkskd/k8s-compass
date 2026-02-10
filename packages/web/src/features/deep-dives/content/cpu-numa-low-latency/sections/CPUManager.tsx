/**
 * CPU Manager Section - CPU/NUMA Deep Dive
 *
 * Covers CPU Manager policies (none, static) with configuration examples
 * and best practices for low-latency workloads.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/CPUManager
 */

import { KepStatusBadge } from '../../../components/KepStatusBadge'
import { FeatureGateBadge } from '../../../components/FeatureGateCard'
import { KubeletFlagCard } from '../../../components/KubeletFlagCard'
import { CodeBlock } from '../../../components/CodeBlock'
import { Info, Warning, Tip } from '../../../components/InfoCallout'
import { CPUPolicyPlacement } from '../visualizations/CPUPolicyPlacement'
import { SMTAlignmentDemo } from '../visualizations/SMTAlignmentDemo'
import { InPlaceResizeFlow } from '../visualizations/InPlaceResizeFlow'
import styles from '../styles.module.css'

// =============================================================================
// Code Examples
// =============================================================================

const KUBELET_CONFIG_STATIC = `# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cpuManagerPolicy: static
cpuManagerReconcilePeriod: 5s
reservedSystemCPUs: "0-1"
kubeReserved:
  cpu: "500m"
  memory: "1Gi"
systemReserved:
  cpu: "500m"
  memory: "1Gi"`

const POD_GUARANTEED_QOS = `apiVersion: v1
kind: Pod
metadata:
  name: latency-critical-app
spec:
  containers:
  - name: app
    image: my-app:latest
    resources:
      requests:
        cpu: "4"           # Must be integer
        memory: "8Gi"
      limits:
        cpu: "4"           # Must equal requests
        memory: "8Gi"      # Must equal requests`

const POD_BURSTABLE_QOS = `apiVersion: v1
kind: Pod
metadata:
  name: burstable-app
spec:
  containers:
  - name: app
    image: my-app:latest
    resources:
      requests:
        cpu: "500m"        # Fractional CPU
        memory: "1Gi"
      limits:
        cpu: "2"           # Different from requests
        memory: "2Gi"`

const VERIFY_CPU_ALLOCATION = `# Check CPU Manager state
cat /var/lib/kubelet/cpu_manager_state

# Example output:
# {"policyName":"static","defaultCpuSet":"0-1","entries":{"pod-uid":{"container-name":"4-7"}},"checksum":...}

# Verify pod's CPU affinity
kubectl exec latency-critical-app -- taskset -p 1
# Output: pid 1's current affinity mask: f0 (cores 4-7)`

// =============================================================================
// Component
// =============================================================================

export function CPUManager() {
  return (
    <section id="cpu-manager" className={styles.section}>
      <h2 className={styles.sectionTitle}>CPU Manager</h2>

      <p className={styles.lead}>
        The CPU Manager is a kubelet component that manages CPU affinity for containers.
        When configured with the <code>static</code> policy, it allocates exclusive CPU
        cores to Guaranteed QoS pods, ensuring no other workloads can use those cores.
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-3570" />
        <FeatureGateBadge gateName="CPUManager" version="1.35" />
      </div>

      {/* None Policy */}
      <h3 id="cpu-manager-none" className={styles.sectionSubtitle}>None Policy (Default)</h3>

      <p className={styles.paragraph}>
        The <code>none</code> policy is the default CPU Manager policy. With this policy,
        the kubelet does not perform any CPU affinity management—containers can run on
        any available CPU core, and the Linux scheduler decides where to place them.
      </p>

      <div className={styles.policyCard}>
        <div className={styles.policyCardHeader}>
          <span className={styles.policyName}>none</span>
          <span className={`${styles.policyBadge} ${styles.policyBadgeDefault}`}>Default</span>
        </div>
        <p className={styles.policyDescription}>
          No CPU affinity management. Containers share all available CPUs and the kernel
          scheduler decides placement. Good for general workloads where throughput matters
          more than latency.
        </p>
        <p className={styles.policyUseCase}>
          Use case: Web servers, batch jobs, development environments
        </p>
      </div>

      <Info title="When None Policy is Appropriate">
        <p>
          The <code>none</code> policy is suitable for most workloads. The Linux CFS
          (Completely Fair Scheduler) does an excellent job of maximizing CPU utilization
          across all cores. Only switch to <code>static</code> if you have specific
          latency requirements that aren't being met.
        </p>
      </Info>

      {/* Static Policy */}
      <h3 id="cpu-manager-static" className={styles.sectionSubtitle}>Static Policy</h3>

      <p className={styles.paragraph}>
        The <code>static</code> policy enables exclusive CPU allocation for Guaranteed QoS
        pods that request integer CPU values. When a pod meets these criteria, the CPU
        Manager assigns specific CPU cores that no other container can use.
      </p>

      <div className={styles.policyCard}>
        <div className={styles.policyCardHeader}>
          <span className={styles.policyName}>static</span>
          <span className={`${styles.policyBadge} ${styles.policyBadgeRecommended}`}>
            Recommended for Low-Latency
          </span>
        </div>
        <p className={styles.policyDescription}>
          Exclusive CPU allocation for Guaranteed QoS pods with integer CPU requests.
          Eliminates CPU contention and provides predictable performance for
          latency-sensitive workloads.
        </p>
        <p className={styles.policyUseCase}>
          Use case: Real-time systems, trading platforms, game servers, AI inference
        </p>
      </div>

      <h4 className={styles.sectionSubtitle}>Requirements for Static Policy</h4>

      <p className={styles.paragraph}>
        For a pod to receive exclusive CPUs under the static policy, it must meet
        <strong> all</strong> of these requirements:
      </p>

      <ul className={styles.list}>
        <li>
          <span className={styles.strong}>Guaranteed QoS class:</span> Both CPU and memory
          requests must equal limits for all containers in the pod
        </li>
        <li>
          <span className={styles.strong}>Integer CPU requests:</span> CPU requests must be
          whole numbers (e.g., <code>"2"</code>, <code>"4"</code>), not fractional
          (e.g., <code>"500m"</code>, <code>"1.5"</code>)
        </li>
        <li>
          <span className={styles.strong}>Available exclusive CPUs:</span> The node must have
          enough CPUs in the exclusive pool (not reserved for system use)
        </li>
      </ul>

      <Warning title="Fractional CPUs">
        <p>
          Pods with fractional CPU requests (like <code>500m</code> or <code>1.5</code>)
          will <strong>not</strong> receive exclusive CPUs, even if they have Guaranteed
          QoS. They will share the "shared pool" of CPUs with other non-exclusive workloads.
        </p>
      </Warning>

      {/* Configuration */}
      <h4 className={styles.sectionSubtitle}>Kubelet Configuration</h4>

      <p className={styles.paragraph}>
        To enable the static CPU Manager policy, configure the kubelet with the following
        settings. This is typically done via the kubelet configuration file:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={KUBELET_CONFIG_STATIC}
          language="yaml"
          title="kubelet-config.yaml"
          highlightLines={[4, 6]}
        />
      </div>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <KubeletFlagCard flagName="--cpu-manager-policy" />
        <KubeletFlagCard flagName="--reserved-cpus" />
      </div>

      <Tip title="Reserved CPUs">
        <p>
          Always reserve at least 2 CPUs for system processes. The kubelet, container
          runtime, and OS services need CPU time. Without reserved CPUs, system processes
          compete with your workloads, causing latency spikes.
        </p>
      </Tip>

      {/* Pod Examples */}
      <h4 className={styles.sectionSubtitle}>Pod Specification Examples</h4>

      <p className={styles.paragraph}>
        Here's an example of a pod that will receive exclusive CPUs under the static policy:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_GUARANTEED_QOS}
          language="yaml"
          title="guaranteed-qos-pod.yaml"
          highlightLines={[10, 11, 13, 14]}
        />
      </div>

      <p className={styles.paragraph}>
        In contrast, this pod will <strong>not</strong> receive exclusive CPUs because it
        has Burstable QoS (requests ≠ limits):
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_BURSTABLE_QOS}
          language="yaml"
          title="burstable-qos-pod.yaml"
        />
      </div>

      {/* Verification */}
      <h4 className={styles.sectionSubtitle}>Verifying CPU Allocation</h4>

      <p className={styles.paragraph}>
        After deploying a Guaranteed QoS pod, you can verify that it received exclusive
        CPUs by checking the CPU Manager state file and the container's CPU affinity:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={VERIFY_CPU_ALLOCATION}
          language="bash"
          title="Verification Commands"
        />
      </div>

      {/* Comparison Table */}
      <h4 className={styles.sectionSubtitle}>Policy Comparison</h4>

      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>Aspect</th>
            <th>None Policy</th>
            <th>Static Policy</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>CPU Affinity</td>
            <td>No affinity, kernel decides</td>
            <td>Exclusive cores for Guaranteed pods</td>
          </tr>
          <tr>
            <td>Latency</td>
            <td>Variable, depends on system load</td>
            <td>Predictable, minimal jitter</td>
          </tr>
          <tr>
            <td>CPU Utilization</td>
            <td>Higher overall utilization</td>
            <td>Lower (exclusive cores may be idle)</td>
          </tr>
          <tr>
            <td>Configuration</td>
            <td>Default, no changes needed</td>
            <td>Requires kubelet configuration</td>
          </tr>
          <tr>
            <td>Pod Requirements</td>
            <td>Any QoS class</td>
            <td>Guaranteed QoS + integer CPUs</td>
          </tr>
          <tr>
            <td>Best For</td>
            <td>General workloads, batch jobs</td>
            <td>Low-latency, real-time workloads</td>
          </tr>
        </tbody>
      </table>

      {/* Advanced Options */}
      <h4 className={styles.sectionSubtitle}>Advanced Policy Options</h4>

      <p className={styles.paragraph}>
        Kubernetes 1.31+ introduces additional CPU Manager policy options through the
        <code>CPUManagerPolicyOptions</code> feature gate:
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-4540" />
        <KepStatusBadge kepId="KEP-4800" />
        <FeatureGateBadge gateName="CPUManagerPolicyOptions" version="1.35" />
      </div>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>full-pcpus-only</h5>
          <p className={styles.cardContent}>
            Only allocate full physical CPU cores (both hyperthreads). Prevents
            noisy-neighbor effects from hyperthreading. Recommended for
            latency-critical workloads.
          </p>
        </div>

        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>distribute-cpus-across-numa</h5>
          <p className={styles.cardContent}>
            Spread CPU allocation across NUMA nodes for better memory bandwidth.
            Useful for memory-intensive workloads that benefit from aggregate
            bandwidth over locality.
          </p>
        </div>

        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>align-by-socket</h5>
          <p className={styles.cardContent}>
            Align CPU allocation to socket boundaries. Ensures all CPUs come from
            the same physical socket, maximizing cache efficiency.
          </p>
        </div>

        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>strict-cpu-reservation</h5>
          <p className={styles.cardContent}>
            Strictly enforce reserved CPU boundaries. Prevents burstable and
            best-effort pods from using reserved CPUs, protecting system services.
          </p>
        </div>

        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>prefer-align-cpus-by-uncorecache</h5>
          <p className={styles.cardContent}>
            Align CPU allocation to L3/LLC cache boundaries. On processors with split
            uncore caches (multiple L3 domains per socket), this minimizes cross-cache
            latency. Particularly beneficial for Intel Xeon and AMD EPYC processors.
          </p>
        </div>
      </div>

      {/* Interactive Policy Placement Demo */}
      <h4 className={styles.sectionSubtitle}>Interactive: Policy Placement Demo</h4>

      <p className={styles.paragraph}>
        See how different CPU Manager policy options affect pod placement on a 
        2-socket, 2-NUMA node system with SMT (hyperthreading) enabled:
      </p>

      <CPUPolicyPlacement />

      {/* SMT Alignment Demo */}
      <h4 className={styles.sectionSubtitle}>Interactive: SMT Alignment</h4>

      <p className={styles.paragraph}>
        The <code>full-pcpus-only</code> option ensures that pods receive complete 
        physical cores, preventing noisy-neighbor effects from hyperthreading. 
        Try different CPU requests to see how SMT alignment works:
      </p>

      <SMTAlignmentDemo />

      {/* In-Place Resize and CPU Manager */}
      <h4 className={styles.sectionSubtitle}>In-Place Resize Limitations</h4>

      <p className={styles.paragraph}>
        In-place pod vertical scaling (KEP-1287) allows changing CPU and memory 
        resources without restarting containers. However, this feature has important 
        limitations when combined with CPU Manager's static policy:
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-1287" />
        <FeatureGateBadge gateName="InPlacePodVerticalScaling" version="1.35" />
      </div>

      <Warning title="Static Policy Blocks In-Place Resize">
        <p>
          Guaranteed pods with exclusive CPUs (static policy) <strong>cannot</strong> be 
          resized in-place. The CPU Manager has pinned specific cores to the container, 
          and changing CPU count would require releasing and re-acquiring exclusive cores.
          The resize will be marked as <code>Infeasible</code>.
        </p>
      </Warning>

      <InPlaceResizeFlow />

      <Info title="Combining with Topology Manager">
        <p>
          CPU Manager works best when combined with Topology Manager. While CPU Manager
          handles CPU affinity, Topology Manager ensures that memory and devices are
          also allocated from the same NUMA node. See the Topology Manager section for
          details on coordinated resource allocation.
        </p>
      </Info>
    </section>
  )
}

export default CPUManager
