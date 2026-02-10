/**
 * QoSFlowchart Visualization
 *
 * Interactive decision flowchart showing how Kubernetes determines
 * the QoS class for a pod based on resource requests and limits.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/visualizations/QoSFlowchart
 */

import { DecisionFlowchart } from '../../../components/DecisionFlowchart'
import type { FlowchartNode } from '../../../index'

// =============================================================================
// Data
// =============================================================================

/**
 * Decision tree nodes for QoS class determination
 */
const QOS_NODES: FlowchartNode[] = [
  // Root question
  {
    id: 'q-limits-set',
    type: 'question',
    text: 'Are CPU and memory limits set for all containers?',
    description: 'Check if every container in the pod has both cpu and memory limits defined.',
    children: [
      { label: 'Yes', nodeId: 'q-requests-equal' },
      { label: 'No', nodeId: 'q-any-requests' },
    ],
  },

  // Guaranteed path
  {
    id: 'q-requests-equal',
    type: 'question',
    text: 'Do requests equal limits for all resources?',
    description: 'For Guaranteed QoS, requests must equal limits (or be omitted, defaulting to limits).',
    children: [
      { label: 'Yes', nodeId: 'rec-guaranteed' },
      { label: 'No', nodeId: 'rec-burstable' },
    ],
  },

  // BestEffort vs Burstable path
  {
    id: 'q-any-requests',
    type: 'question',
    text: 'Are any requests or limits set?',
    description: 'Check if any container has any resource requests or limits defined.',
    children: [
      { label: 'Yes', nodeId: 'rec-burstable' },
      { label: 'No', nodeId: 'rec-besteffort' },
    ],
  },

  // Recommendations
  {
    id: 'rec-guaranteed',
    type: 'recommendation',
    text: 'QoS Class: Guaranteed',
    description: 'Highest priority. Required for CPU Manager static policy and topology hints.',
    recommendation: {
      kubeletFlags: {
        'cpu-manager-policy': 'static',
        'topology-manager-policy': 'single-numa-node',
      },
      keps: ['KEP-3570', 'KEP-693'],
      featureGates: ['CPUManager', 'TopologyManager'],
      podSpec: `# Guaranteed QoS - requests == limits
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "4"           # Must equal limit
        memory: "8Gi"      # Must equal limit
      limits:
        cpu: "4"           # Must equal request
        memory: "8Gi"      # Must equal request`,
    },
  },

  {
    id: 'rec-burstable',
    type: 'recommendation',
    text: 'QoS Class: Burstable',
    description: 'Medium priority. Can burst above requests up to limits. No exclusive CPUs.',
    recommendation: {
      kubeletFlags: {},
      keps: [],
      featureGates: [],
      podSpec: `# Burstable QoS - requests < limits
apiVersion: v1
kind: Pod
metadata:
  name: burstable-pod
spec:
  containers:
  - name: app
    resources:
      requests:
        cpu: "1"           # Can be less than limit
        memory: "2Gi"
      limits:
        cpu: "4"           # Higher than request
        memory: "8Gi"`,
    },
  },

  {
    id: 'rec-besteffort',
    type: 'recommendation',
    text: 'QoS Class: BestEffort',
    description: 'Lowest priority. First to be evicted under memory pressure. No resource guarantees.',
    recommendation: {
      kubeletFlags: {},
      keps: [],
      featureGates: [],
      podSpec: `# BestEffort QoS - no requests or limits
apiVersion: v1
kind: Pod
metadata:
  name: besteffort-pod
spec:
  containers:
  - name: app
    # No resources section = BestEffort
    image: my-app:latest`,
    },
  },
]

// =============================================================================
// Component
// =============================================================================

interface QoSFlowchartProps {
  /** Callback when a recommendation is selected */
  onComplete?: (recommendation: FlowchartNode['recommendation']) => void
}

/**
 * QoSFlowchart visualization component.
 * Shows how Kubernetes determines QoS class based on resource specifications.
 */
export function QoSFlowchart({ onComplete }: QoSFlowchartProps) {
  return (
    <DecisionFlowchart
      nodes={QOS_NODES}
      rootNodeId="q-limits-set"
      onComplete={onComplete}
      title="QoS Class Determination"
      description="How Kubernetes determines the Quality of Service class for your pod."
    />
  )
}

export default QoSFlowchart
