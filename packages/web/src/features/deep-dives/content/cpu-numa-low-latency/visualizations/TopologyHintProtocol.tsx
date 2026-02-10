/**
 * TopologyHintProtocol Visualization
 *
 * Sequence diagram showing how the Topology Manager gathers hints from
 * CPU Manager, Memory Manager, and Device Manager during pod admission.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/visualizations/TopologyHintProtocol
 */

import { SequenceDiagram } from '../../../components/SequenceDiagram'
import type { SequenceMessage } from '../../../index'

// =============================================================================
// Data
// =============================================================================

/**
 * Participants in the topology hint protocol
 */
const PARTICIPANTS = [
  'kubelet',
  'Topology Manager',
  'CPU Manager',
  'Memory Manager',
  'Device Manager',
]

/**
 * Messages showing the hint gathering protocol
 */
const MESSAGES: SequenceMessage[] = [
  {
    id: 'admit-pod',
    from: 'kubelet',
    to: 'Topology Manager',
    label: 'Admit(pod)',
    description:
      'kubelet calls Topology Manager to admit a new pod. The Topology Manager coordinates resource allocation.',
  },
  {
    id: 'get-cpu-hints',
    from: 'Topology Manager',
    to: 'CPU Manager',
    label: 'GetTopologyHints()',
    description:
      'Topology Manager requests CPU topology hints. CPU Manager returns preferred NUMA nodes based on available CPUs.',
  },
  {
    id: 'cpu-hints-response',
    from: 'CPU Manager',
    to: 'Topology Manager',
    label: 'hints: [NUMA 0, NUMA 1]',
    description:
      'CPU Manager returns hints indicating which NUMA nodes have sufficient CPUs for the pod request.',
  },
  {
    id: 'get-memory-hints',
    from: 'Topology Manager',
    to: 'Memory Manager',
    label: 'GetTopologyHints()',
    description:
      'Topology Manager requests memory topology hints. Memory Manager returns preferred NUMA nodes based on available memory and hugepages.',
  },
  {
    id: 'memory-hints-response',
    from: 'Memory Manager',
    to: 'Topology Manager',
    label: 'hints: [NUMA 0]',
    description:
      'Memory Manager returns hints indicating which NUMA nodes have sufficient memory and hugepages.',
  },
  {
    id: 'get-device-hints',
    from: 'Topology Manager',
    to: 'Device Manager',
    label: 'GetTopologyHints()',
    description:
      'Topology Manager requests device topology hints. Device Manager queries device plugins for NUMA affinity.',
  },
  {
    id: 'device-hints-response',
    from: 'Device Manager',
    to: 'Topology Manager',
    label: 'hints: [NUMA 0]',
    description:
      'Device Manager returns hints indicating which NUMA nodes have the requested devices (GPUs, FPGAs, etc.).',
  },
  {
    id: 'merge-hints',
    from: 'Topology Manager',
    to: 'Topology Manager',
    label: 'Merge hints (policy)',
    description:
      'Topology Manager merges all hints according to the configured policy (best-effort, restricted, single-numa-node).',
  },
  {
    id: 'allocate-cpu',
    from: 'Topology Manager',
    to: 'CPU Manager',
    label: 'Allocate(NUMA 0)',
    description:
      'Topology Manager instructs CPU Manager to allocate CPUs from the selected NUMA node.',
  },
  {
    id: 'allocate-memory',
    from: 'Topology Manager',
    to: 'Memory Manager',
    label: 'Allocate(NUMA 0)',
    description:
      'Topology Manager instructs Memory Manager to allocate memory from the selected NUMA node.',
  },
  {
    id: 'allocate-device',
    from: 'Topology Manager',
    to: 'Device Manager',
    label: 'Allocate(NUMA 0)',
    description:
      'Topology Manager instructs Device Manager to allocate devices from the selected NUMA node.',
  },
  {
    id: 'admit-success',
    from: 'Topology Manager',
    to: 'kubelet',
    label: 'Admit: Success',
    description:
      'Topology Manager returns success to kubelet. All resources are aligned to NUMA node 0.',
  },
]

// =============================================================================
// Component
// =============================================================================

interface TopologyHintProtocolProps {
  /** Auto-play animation on mount */
  autoPlay?: boolean
  /** Animation speed multiplier */
  speed?: number
}

/**
 * TopologyHintProtocol visualization component.
 * Shows the sequence of interactions during pod admission with topology awareness.
 */
export function TopologyHintProtocol({ autoPlay = false, speed = 1 }: TopologyHintProtocolProps) {
  return (
    <SequenceDiagram
      participants={PARTICIPANTS}
      messages={MESSAGES}
      autoPlay={autoPlay}
      speed={speed}
      title="Topology Hint Protocol"
      description="How Topology Manager coordinates resource allocation across CPU, Memory, and Device Managers during pod admission."
    />
  )
}

export default TopologyHintProtocol
