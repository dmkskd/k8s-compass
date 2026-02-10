/**
 * CPU/NUMA Deep Dive - Main Entry Point
 *
 * CPU Affinity, NUMA Topology & Resource Management deep dive.
 * Covers CPU Manager, Topology Manager, Memory Manager, and Device Manager
 * for optimizing Kubernetes for low-latency workloads.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency
 */

import { DeepDiveLayout } from '../../DeepDiveLayout'
import type { DeepDiveSection, DeepDiveMetadata } from '../../index'

// Section components
import { Overview } from './sections/Overview'
import { CPUManager } from './sections/CPUManager'
import { TopologyManager } from './sections/TopologyManager'
import { MemoryManager } from './sections/MemoryManager'
import { DeviceManager } from './sections/DeviceManager'
import { Configuration } from './sections/Configuration'
import { BestPractices } from './sections/BestPractices'

// =============================================================================
// Section Definitions
// =============================================================================

/**
 * All sections in the CPU/NUMA deep dive.
 * Used for table of contents and navigation.
 */
export const sections: DeepDiveSection[] = [
  // Overview
  {
    id: 'overview',
    title: 'Overview',
    level: 1,
  },

  // CPU Manager
  {
    id: 'cpu-manager',
    title: 'CPU Manager',
    level: 1,
  },
  {
    id: 'cpu-manager-none',
    title: 'None Policy',
    level: 2,
  },
  {
    id: 'cpu-manager-static',
    title: 'Static Policy',
    level: 2,
  },
  {
    id: 'cpu-manager-policy-options',
    title: 'Policy Options',
    level: 2,
  },
  {
    id: 'cpu-manager-in-place-resize',
    title: 'In-Place Resize',
    level: 2,
  },

  // Topology Manager (placeholder)
  {
    id: 'topology-manager',
    title: 'Topology Manager',
    level: 1,
  },
  {
    id: 'topology-manager-policies',
    title: 'Policies',
    level: 2,
  },
  {
    id: 'topology-manager-hints',
    title: 'Topology Hints',
    level: 2,
  },

  // Memory Manager (placeholder)
  {
    id: 'memory-manager',
    title: 'Memory Manager',
    level: 1,
  },
  {
    id: 'memory-manager-hugepages',
    title: 'Hugepages',
    level: 2,
  },

  // Device Manager (placeholder)
  {
    id: 'device-manager',
    title: 'Device Manager',
    level: 1,
  },
  {
    id: 'device-manager-plugins',
    title: 'Device Plugins',
    level: 2,
  },

  // Configuration (placeholder)
  {
    id: 'configuration',
    title: 'Configuration',
    level: 1,
  },
  {
    id: 'configuration-kernel',
    title: 'Kernel Parameters',
    level: 2,
  },
  {
    id: 'configuration-pod-spec',
    title: 'Pod Specifications',
    level: 2,
  },

  // Best Practices (placeholder)
  {
    id: 'best-practices',
    title: 'Best Practices',
    level: 1,
  },
]

// =============================================================================
// Main Component
// =============================================================================

/**
 * CPU/NUMA Deep Dive main component.
 * Wraps all content in DeepDiveLayout with metadata and sections.
 */
export function CPUNUMADeepDive() {
  // Metadata is now stored in the database (content_links_deep_dives.json)
  // This is a fallback for the layout component
  const metadata: DeepDiveMetadata = {
    id: 'cpu-numa-low-latency',
    title: 'CPU Affinity, NUMA Topology & Resource Management',
    subtitle: 'Optimizing Kubernetes for Low-Latency Workloads',
    description: 'Master CPU Manager, Topology Manager, Memory Manager, and Device Manager for high-performance workloads requiring predictable latency.',
    status: 'wip',
    author: 'K8s Compass',
    publishedDate: '2025-01-15',
    estimatedReadTime: 45,
    labels: ['cpu-manager', 'topology-manager', 'numa', 'low-latency', 'guaranteed-qos', 'hugepages', 'device-plugin', 'scheduling', 'in-place-resize'],
    relatedKeps: ['KEP-3570', 'KEP-693', 'KEP-1769', 'KEP-2625', 'KEP-4540', 'KEP-2902', 'KEP-4800', 'KEP-3327', 'KEP-4176', 'KEP-1287'],
    relatedFeatureGates: ['CPUManager', 'TopologyManager', 'MemoryManager', 'CPUManagerPolicyOptions', 'TopologyManagerPolicyOptions', 'InPlacePodVerticalScaling'],
  }

  return (
    <DeepDiveLayout metadata={metadata} sections={sections}>
      <Overview />
      <CPUManager />
      <TopologyManager />
      <MemoryManager />
      <DeviceManager />
      <Configuration />
      <BestPractices />
    </DeepDiveLayout>
  )
}

export default CPUNUMADeepDive
