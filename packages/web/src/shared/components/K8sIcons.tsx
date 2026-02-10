/**
 * Kubernetes Component Icons
 * Simple colored shapes for legend display
 * For larger displays, use the actual K8s community SVGs from /icons/k8s/
 */
import React from 'react'

interface IconProps {
  size?: number
  className?: string
  color?: string
}

// Simple hexagon shape (K8s logo style)
const Hexagon: React.FC<IconProps & { fillColor: string }> = ({ 
  size = 24, 
  className, 
  fillColor 
}) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <path
      d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5L12 2Z"
      fill={fillColor}
      stroke="rgba(255,255,255,0.3)"
      strokeWidth="1"
    />
  </svg>
)

// Simple rectangle for nodes
const NodeShape: React.FC<IconProps & { fillColor: string }> = ({ 
  size = 24, 
  className, 
  fillColor 
}) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <rect 
      x="3" 
      y="5" 
      width="18" 
      height="14" 
      rx="3" 
      fill={fillColor}
      stroke="rgba(255,255,255,0.3)"
      strokeWidth="1"
    />
  </svg>
)

// API Server icon - blue hexagon
export const ApiServerIcon: React.FC<IconProps> = ({ size = 24, className, color = '#326ce5' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// etcd icon - green hexagon
export const EtcdIcon: React.FC<IconProps> = ({ size = 24, className, color = '#419eda' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// Controller Manager icon - orange hexagon
export const ControllerManagerIcon: React.FC<IconProps> = ({ size = 24, className, color = '#326ce5' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// Scheduler icon - pink hexagon
export const SchedulerIcon: React.FC<IconProps> = ({ size = 24, className, color = '#326ce5' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// Cloud Controller Manager icon - cloud shape
export const CloudControllerManagerIcon: React.FC<IconProps> = ({ size = 24, className, color = '#0ea5e9' }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <path
      d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"
      fill={color}
      stroke="rgba(255,255,255,0.3)"
      strokeWidth="0.5"
    />
  </svg>
)

// Kubelet icon - cyan hexagon
export const KubeletIcon: React.FC<IconProps> = ({ size = 24, className, color = '#326ce5' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// Kube-proxy icon - purple hexagon
export const KubeProxyIcon: React.FC<IconProps> = ({ size = 24, className, color = '#326ce5' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// Node icon (worker node) - rectangle
export const NodeIcon: React.FC<IconProps> = ({ size = 24, className, color = '#326ce5' }) => (
  <NodeShape size={size} className={className} fillColor={color} />
)

// CoreDNS icon - blue hexagon
export const CoreDNSIcon: React.FC<IconProps> = ({ size = 24, className, color = '#3b82f6' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// CNI icon - green hexagon
export const CNIIcon: React.FC<IconProps> = ({ size = 24, className, color = '#10b981' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// containerd icon - gray hexagon
export const ContainerdIcon: React.FC<IconProps> = ({ size = 24, className, color = '#575757' }) => (
  <Hexagon size={size} className={className} fillColor={color} />
)

// kubectl icon - terminal shape
export const KubectlIcon: React.FC<IconProps> = ({ size = 24, className, color = '#22c55e' }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <rect 
      x="2" 
      y="4" 
      width="20" 
      height="16" 
      rx="2" 
      fill="#1e293b"
      stroke={color}
      strokeWidth="1.5"
    />
    <text x="6" y="14" fill={color} fontSize="8" fontFamily="monospace">&gt;_</text>
  </svg>
)

// Map component IDs to icons
export const COMPONENT_ICONS: Record<string, React.FC<IconProps>> = {
  'kube-apiserver': ApiServerIcon,
  'etcd': EtcdIcon,
  'kube-controller-manager': ControllerManagerIcon,
  'cloud-controller-manager': CloudControllerManagerIcon,
  'kube-scheduler': SchedulerIcon,
  'kubelet': KubeletIcon,
  'kube-proxy': KubeProxyIcon,
  'coredns': CoreDNSIcon,
  'cni': CNIIcon,
  'containerd': ContainerdIcon,
  'kubectl': KubectlIcon,
  // Aliases
  'api-server': ApiServerIcon,
  'controller-manager': ControllerManagerIcon,
  'scheduler': SchedulerIcon,
  'node': NodeIcon,
  'node-1': NodeIcon,
  'node-2': NodeIcon,
  'node-3': NodeIcon,
}

// Get icon for a component
export function getComponentIcon(componentId: string): React.FC<IconProps> | null {
  return COMPONENT_ICONS[componentId] || null
}
