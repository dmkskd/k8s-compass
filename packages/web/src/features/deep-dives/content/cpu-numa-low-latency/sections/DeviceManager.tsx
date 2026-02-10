/**
 * Device Manager Section - CPU/NUMA Deep Dive
 *
 * Covers Device Manager, device plugins, and NUMA-aware device allocation
 * for GPUs, FPGAs, and other accelerators.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/sections/DeviceManager
 */

import { KepStatusBadge } from '../../../components/KepStatusBadge'
import { FeatureGateBadge } from '../../../components/FeatureGateCard'
import { CodeBlock } from '../../../components/CodeBlock'
import { Info, Warning, Tip } from '../../../components/InfoCallout'
import styles from '../styles.module.css'

// =============================================================================
// Code Examples
// =============================================================================

const POD_GPU = `apiVersion: v1
kind: Pod
metadata:
  name: gpu-workload
spec:
  containers:
  - name: cuda-app
    image: nvidia/cuda:12.0-runtime
    resources:
      requests:
        cpu: "4"
        memory: "16Gi"
        nvidia.com/gpu: "1"
      limits:
        cpu: "4"
        memory: "16Gi"
        nvidia.com/gpu: "1"`

const POD_MULTI_GPU = `apiVersion: v1
kind: Pod
metadata:
  name: multi-gpu-training
spec:
  containers:
  - name: training
    image: my-ml-training:latest
    resources:
      requests:
        cpu: "16"
        memory: "64Gi"
        nvidia.com/gpu: "4"
      limits:
        cpu: "16"
        memory: "64Gi"
        nvidia.com/gpu: "4"
    env:
    - name: CUDA_VISIBLE_DEVICES
      value: "0,1,2,3"`

const DEVICE_PLUGIN_DAEMONSET = `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nvidia-device-plugin
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: nvidia-device-plugin
  template:
    metadata:
      labels:
        name: nvidia-device-plugin
    spec:
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
      containers:
      - name: nvidia-device-plugin
        image: nvcr.io/nvidia/k8s-device-plugin:v0.14.0
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
        volumeMounts:
        - name: device-plugin
          mountPath: /var/lib/kubelet/device-plugins
      volumes:
      - name: device-plugin
        hostPath:
          path: /var/lib/kubelet/device-plugins`

const VERIFY_DEVICES = `# Check available GPU resources
kubectl describe node | grep -A5 "Allocatable:"

# Verify device plugin is running
kubectl get pods -n kube-system | grep nvidia-device-plugin

# Check GPU allocation for a pod
kubectl describe pod gpu-workload | grep -A5 "Limits:"

# Verify NUMA affinity of GPU
nvidia-smi topo -m`

// =============================================================================
// Component
// =============================================================================

export function DeviceManager() {
  return (
    <section id="device-manager" className={styles.section}>
      <h2 className={styles.sectionTitle}>Device Manager</h2>

      <p className={styles.lead}>
        The Device Manager handles allocation of hardware devices like GPUs, FPGAs, and
        network interfaces. Through the device plugin framework, it discovers devices,
        advertises them to the scheduler, and provides NUMA topology hints for
        optimal placement.
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-3327" />
        <FeatureGateBadge gateName="DevicePlugins" version="1.35" />
      </div>

      {/* Device Plugin Architecture */}
      <h3 id="device-manager-plugins" className={styles.sectionSubtitle}>Device Plugins</h3>

      <p className={styles.paragraph}>
        Device plugins are the mechanism by which hardware vendors expose their devices
        to Kubernetes. Each plugin runs as a DaemonSet and communicates with the kubelet
        via gRPC to register devices and handle allocation.
      </p>

      <div className={styles.card}>
        <h4 className={styles.cardTitle}>Device Plugin Lifecycle</h4>
        <ol className={styles.list}>
          <li>
            <span className={styles.strong}>Registration:</span> Plugin registers with
            kubelet via Unix socket at <code>/var/lib/kubelet/device-plugins/</code>
          </li>
          <li>
            <span className={styles.strong}>Discovery:</span> Plugin discovers available
            devices and reports them to kubelet
          </li>
          <li>
            <span className={styles.strong}>Advertisement:</span> Kubelet advertises
            devices as extended resources (e.g., <code>nvidia.com/gpu</code>)
          </li>
          <li>
            <span className={styles.strong}>Allocation:</span> When a pod requests a
            device, kubelet calls the plugin's <code>Allocate</code> method
          </li>
          <li>
            <span className={styles.strong}>Topology Hints:</span> Plugin provides NUMA
            affinity information for Topology Manager
          </li>
        </ol>
      </div>

      {/* Common Device Plugins */}
      <h4 className={styles.sectionSubtitle}>Common Device Plugins</h4>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>NVIDIA GPU Plugin</h4>
          <p className={styles.cardContent}>
            Exposes NVIDIA GPUs as <code>nvidia.com/gpu</code> resources. Supports
            GPU sharing (MIG, time-slicing), NUMA topology hints, and health monitoring.
          </p>
          <p className={styles.policyUseCase}>
            Use case: ML training, inference, CUDA workloads
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>AMD GPU Plugin</h4>
          <p className={styles.cardContent}>
            Exposes AMD GPUs as <code>amd.com/gpu</code> resources. Supports ROCm
            workloads and provides NUMA topology information.
          </p>
          <p className={styles.policyUseCase}>
            Use case: ROCm workloads, HPC applications
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>Intel Device Plugins</h4>
          <p className={styles.cardContent}>
            Suite of plugins for Intel hardware: GPUs (<code>gpu.intel.com/i915</code>),
            FPGAs, QAT accelerators, SGX enclaves.
          </p>
          <p className={styles.policyUseCase}>
            Use case: Video transcoding, crypto acceleration, confidential computing
          </p>
        </div>

        <div className={styles.card}>
          <h4 className={styles.cardTitle}>SR-IOV Network Plugin</h4>
          <p className={styles.cardContent}>
            Exposes SR-IOV virtual functions as network resources. Enables
            high-performance networking with hardware offload.
          </p>
          <p className={styles.policyUseCase}>
            Use case: NFV, high-frequency trading, DPDK
          </p>
        </div>
      </div>

      {/* GPU Pod Example */}
      <h4 className={styles.sectionSubtitle}>GPU Pod Specification</h4>

      <p className={styles.paragraph}>
        Request GPU resources just like CPU and memory. The device plugin handles
        the actual device assignment:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_GPU}
          language="yaml"
          title="gpu-pod.yaml"
          highlightLines={[11, 14]}
        />
      </div>

      <Info title="Guaranteed QoS for NUMA Alignment">
        <p>
          For Topology Manager to align GPU allocation with CPU and memory, the pod
          must have Guaranteed QoS (requests equal limits for all resources). Without
          this, the GPU may be on a different NUMA node than the CPU cores.
        </p>
      </Info>

      {/* Multi-GPU Example */}
      <h4 className={styles.sectionSubtitle}>Multi-GPU Workloads</h4>

      <p className={styles.paragraph}>
        For distributed training or workloads requiring multiple GPUs:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={POD_MULTI_GPU}
          language="yaml"
          title="multi-gpu-pod.yaml"
          highlightLines={[11, 14]}
        />
      </div>

      <Warning title="Multi-GPU NUMA Considerations">
        <p>
          When requesting multiple GPUs, they may span multiple NUMA nodes. With
          <code>single-numa-node</code> Topology Manager policy, the pod will be
          rejected if all GPUs can't fit on one node. Use <code>restricted</code>
          policy for multi-GPU workloads that can tolerate cross-NUMA access.
        </p>
      </Warning>

      {/* Device Plugin DaemonSet */}
      <h4 className={styles.sectionSubtitle}>Deploying Device Plugins</h4>

      <p className={styles.paragraph}>
        Device plugins are typically deployed as DaemonSets to run on every node
        with the relevant hardware:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={DEVICE_PLUGIN_DAEMONSET}
          language="yaml"
          title="nvidia-device-plugin.yaml"
          highlightLines={[22, 23, 24]}
        />
      </div>

      {/* Verification */}
      <h4 className={styles.sectionSubtitle}>Verification</h4>

      <p className={styles.paragraph}>
        Verify device discovery and allocation:
      </p>

      <div className={styles.codeExample}>
        <CodeBlock
          code={VERIFY_DEVICES}
          language="bash"
          title="Verification Commands"
        />
      </div>

      {/* NUMA Topology for Devices */}
      <h4 className={styles.sectionSubtitle}>Device NUMA Topology</h4>

      <p className={styles.paragraph}>
        Modern GPUs and accelerators are connected to specific NUMA nodes via PCIe.
        The device plugin reports this topology to enable NUMA-aligned scheduling:
      </p>

      <table className={styles.comparisonTable}>
        <thead>
          <tr>
            <th>Device Type</th>
            <th>NUMA Affinity</th>
            <th>Topology Hints</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>NVIDIA GPU</td>
            <td>PCIe slot determines NUMA node</td>
            <td>Yes (via device plugin)</td>
          </tr>
          <tr>
            <td>AMD GPU</td>
            <td>PCIe slot determines NUMA node</td>
            <td>Yes (via device plugin)</td>
          </tr>
          <tr>
            <td>Intel FPGA</td>
            <td>PCIe slot determines NUMA node</td>
            <td>Yes (via device plugin)</td>
          </tr>
          <tr>
            <td>SR-IOV VF</td>
            <td>Parent PF NUMA node</td>
            <td>Yes (via network plugin)</td>
          </tr>
        </tbody>
      </table>

      <Tip title="Check GPU NUMA Topology">
        <p>
          Use <code>nvidia-smi topo -m</code> to see the NUMA topology of your GPUs.
          This shows which NUMA node each GPU is connected to and the interconnect
          type (NVLink, PCIe) between GPUs.
        </p>
      </Tip>

      {/* DRA - Dynamic Resource Allocation */}
      <h4 className={styles.sectionSubtitle}>Dynamic Resource Allocation (DRA)</h4>

      <p className={styles.paragraph}>
        Kubernetes 1.31+ introduces Dynamic Resource Allocation as a more flexible
        alternative to device plugins for complex resource management:
      </p>

      <div className={styles.kepReferences}>
        <KepStatusBadge kepId="KEP-4381" />
        <FeatureGateBadge gateName="DynamicResourceAllocation" version="1.35" />
      </div>

      <div className={`${styles.grid} ${styles.gridTwo}`}>
        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>ResourceClaim</h5>
          <p className={styles.cardContent}>
            Pods request resources via ResourceClaims, which can specify complex
            requirements like "2 GPUs with NVLink connectivity" or "GPU with
            at least 16GB memory".
          </p>
        </div>

        <div className={styles.featureBox}>
          <h5 className={styles.featureBoxTitle}>ResourceClass</h5>
          <p className={styles.cardContent}>
            Administrators define ResourceClasses that describe available resource
            types and their allocation policies. Enables vendor-specific parameters.
          </p>
        </div>
      </div>

      <Info title="DRA vs Device Plugins">
        <p>
          DRA provides more flexibility than device plugins: structured parameters,
          late binding, resource sharing between pods, and better integration with
          scheduling. However, device plugins remain the standard for simple
          "count-based" allocation (e.g., "give me 2 GPUs").
        </p>
      </Info>
    </section>
  )
}

export default DeviceManager
