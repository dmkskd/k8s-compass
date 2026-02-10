/**
 * PolicyDecisionTree Visualization
 *
 * Interactive decision flowchart to help users select the appropriate
 * Topology Manager policy based on their workload requirements.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/visualizations/PolicyDecisionTree
 */

import { DecisionFlowchart } from '../../../components/DecisionFlowchart'
import type { FlowchartNode } from '../../../index'

// =============================================================================
// Data
// =============================================================================

/**
 * Decision tree nodes for Topology Manager policy selection
 */
const POLICY_NODES: FlowchartNode[] = [
  // Root question
  {
    id: 'q-latency',
    type: 'question',
    text: 'Is low latency critical for your workload?',
    description: 'Consider if your application requires predictable, sub-millisecond response times.',
    children: [
      { label: 'Yes', nodeId: 'q-numa-aware' },
      { label: 'No', nodeId: 'rec-none' },
    ],
  },

  // Second level - NUMA awareness
  {
    id: 'q-numa-aware',
    type: 'question',
    text: 'Does your app benefit from NUMA locality?',
    description: 'Applications with large memory footprints or high memory bandwidth benefit most.',
    children: [
      { label: 'Yes', nodeId: 'q-strict' },
      { label: 'No', nodeId: 'rec-none' },
    ],
  },

  // Third level - Strictness
  {
    id: 'q-strict',
    type: 'question',
    text: 'Must all resources be on the same NUMA node?',
    description: 'Strict alignment provides best performance but may reduce scheduling flexibility.',
    children: [
      { label: 'Yes', nodeId: 'q-single-numa' },
      { label: 'No', nodeId: 'rec-best-effort' },
    ],
  },

  // Fourth level - Single NUMA requirement
  {
    id: 'q-single-numa',
    type: 'question',
    text: 'Can your pod fit on a single NUMA node?',
    description: 'Check if CPU, memory, and device requirements fit within one NUMA node capacity.',
    children: [
      { label: 'Yes', nodeId: 'rec-single-numa' },
      { label: 'No', nodeId: 'rec-restricted' },
    ],
  },

  // Recommendations
  {
    id: 'rec-none',
    type: 'recommendation',
    text: 'Use "none" policy',
    description: 'Default policy with no topology alignment. Best for general workloads.',
    recommendation: {
      kubeletFlags: {
        'topology-manager-policy': 'none',
      },
      keps: ['KEP-693'],
      featureGates: ['TopologyManager'],
      podSpec: `# No special requirements
apiVersion: v1
kind: Pod
metadata:
  name: general-workload
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "2"
        memory: "4Gi"`,
    },
  },

  {
    id: 'rec-best-effort',
    type: 'recommendation',
    text: 'Use "best-effort" policy',
    description: 'Attempts NUMA alignment but allows scheduling even without perfect alignment.',
    recommendation: {
      kubeletFlags: {
        'topology-manager-policy': 'best-effort',
        'cpu-manager-policy': 'static',
      },
      keps: ['KEP-693', 'KEP-3570'],
      featureGates: ['TopologyManager', 'CPUManager'],
      podSpec: `# Guaranteed QoS for topology hints
apiVersion: v1
kind: Pod
metadata:
  name: best-effort-topology
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "4"
        memory: "8Gi"
      limits:
        cpu: "4"
        memory: "8Gi"`,
    },
  },

  {
    id: 'rec-restricted',
    type: 'recommendation',
    text: 'Use "restricted" policy',
    description: 'Requires NUMA alignment but allows spanning multiple nodes if needed.',
    recommendation: {
      kubeletFlags: {
        'topology-manager-policy': 'restricted',
        'cpu-manager-policy': 'static',
        'memory-manager-policy': 'Static',
      },
      keps: ['KEP-693', 'KEP-3570', 'KEP-1769'],
      featureGates: ['TopologyManager', 'CPUManager', 'MemoryManager'],
      podSpec: `# Guaranteed QoS with strict alignment
apiVersion: v1
kind: Pod
metadata:
  name: restricted-topology
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "8"
        memory: "16Gi"
        hugepages-2Mi: "1Gi"
      limits:
        cpu: "8"
        memory: "16Gi"
        hugepages-2Mi: "1Gi"`,
    },
  },

  {
    id: 'rec-single-numa',
    type: 'recommendation',
    text: 'Use "single-numa-node" policy',
    description: 'Strictest policy - all resources must come from exactly one NUMA node.',
    recommendation: {
      kubeletFlags: {
        'topology-manager-policy': 'single-numa-node',
        'cpu-manager-policy': 'static',
        'memory-manager-policy': 'Static',
      },
      keps: ['KEP-693', 'KEP-3570', 'KEP-1769', 'KEP-2625'],
      featureGates: ['TopologyManager', 'CPUManager', 'MemoryManager'],
      podSpec: `# Maximum NUMA locality
apiVersion: v1
kind: Pod
metadata:
  name: single-numa-workload
spec:
  containers:
  - name: latency-critical
    resources:
      requests:
        cpu: "4"
        memory: "8Gi"
        hugepages-1Gi: "4Gi"
        nvidia.com/gpu: "1"
      limits:
        cpu: "4"
        memory: "8Gi"
        hugepages-1Gi: "4Gi"
        nvidia.com/gpu: "1"`,
    },
  },
]

// =============================================================================
// Component
// =============================================================================

interface PolicyDecisionTreeProps {
  /** Callback when a recommendation is selected */
  onComplete?: (recommendation: FlowchartNode['recommendation']) => void
}

/**
 * PolicyDecisionTree visualization component.
 * Guides users through selecting the appropriate Topology Manager policy.
 */
export function PolicyDecisionTree({ onComplete }: PolicyDecisionTreeProps) {
  return (
    <DecisionFlowchart
      nodes={POLICY_NODES}
      rootNodeId="q-latency"
      onComplete={onComplete}
      title="Topology Manager Policy Selection"
      description="Answer the questions to find the best Topology Manager policy for your workload."
    />
  )
}

export default PolicyDecisionTree
