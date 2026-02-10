// Mock schema data for demonstration
// In production, this would be loaded from DuckDB parquet or /data/k8s/schemas/{version}.json

import type { SchemaProperty } from '../types'
import { loadSchemasFromDB } from './schemaLoader'
import { loadFieldHistoryFromDB, loadKindHistoryFromDB, getKindHistoryFromCache, ensureKindHistoryLoaded as ensureKindHistoryLoadedDB } from './historyLoader'

// Cache for loaded schemas (now includes description)
const schemaCache: Map<string, Record<string, { properties: SchemaProperty[], description: string }>> = new Map()

// Cache for field history
let fieldHistoryCache: Record<string, Array<{path: string, introducedIn: string, deprecatedIn?: string, removedIn?: string}>> | null = null

// Cache for kind history
let kindHistoryCache: Record<string, {introducedIn?: string, removedIn?: string}> | null = null

// Check if we should use DuckDB (embedded parquet data available or DuckDB initialized)
function shouldUseDuckDB(): boolean {
  return typeof window !== 'undefined' && ('__PARQUET_DATA__' in window || true) // Always try DuckDB first
}

// Load field history
async function loadFieldHistory() {
  if (fieldHistoryCache) return fieldHistoryCache
  
  // Try DuckDB first
  if (shouldUseDuckDB()) {
    try {
      fieldHistoryCache = await loadFieldHistoryFromDB()
      return fieldHistoryCache
    } catch (err) {
      console.warn('DuckDB field history failed, trying JSON:', err)
    }
  }
  
  // Fallback to JSON
  try {
    const response = await fetch('/data/k8s/field-history.json')
    if (!response.ok) {
      console.warn('Failed to load field history')
      return {}
    }
    fieldHistoryCache = await response.json()
    return fieldHistoryCache
  } catch (err) {
    console.warn('Error loading field history:', err)
    return {}
  }
}

// Load kind history
async function loadKindHistory() {
  if (kindHistoryCache) return kindHistoryCache
  
  // Try DuckDB first
  if (shouldUseDuckDB()) {
    try {
      kindHistoryCache = await loadKindHistoryFromDB()
      return kindHistoryCache
    } catch (err) {
      console.warn('DuckDB kind history failed, trying JSON:', err)
    }
  }
  
  // Fallback to JSON
  try {
    const response = await fetch('/data/k8s/kind-history.json')
    if (!response.ok) {
      console.warn('Failed to load kind history')
      return {}
    }
    kindHistoryCache = await response.json()
    return kindHistoryCache
  } catch (err) {
    console.warn('Error loading kind history:', err)
    return {}
  }
}

// Get kind history (sync, returns null if not loaded)
export function getKindHistory(group: string, kind: string): {introducedIn?: string, removedIn?: string} | null {
  // Try DuckDB cache first
  const dbHistory = getKindHistoryFromCache(group, kind)
  if (dbHistory) return dbHistory
  
  // Fall back to local cache
  if (!kindHistoryCache) return null
  return kindHistoryCache[`${group}/${kind}`] || null
}

// Ensure kind history is loaded
export async function ensureKindHistoryLoaded(): Promise<void> {
  if (shouldUseDuckDB()) {
    await ensureKindHistoryLoadedDB()
  } else {
    await loadKindHistory()
  }
}

// Enrich schema properties with version history
function enrichWithHistory(
  properties: SchemaProperty[],
  historyMap: Map<string, {introducedIn: string, deprecatedIn?: string, removedIn?: string}>
): SchemaProperty[] {
  return properties.map((prop) => {
    const history = historyMap.get(prop.path)
    
    const enriched: SchemaProperty = {
      ...prop,
    }
    
    if (history) {
      enriched.introducedIn = history.introducedIn
      enriched.deprecatedIn = history.deprecatedIn
      enriched.removedIn = history.removedIn
    }
    
    // Recurse into nested properties
    if (prop.properties) {
      enriched.properties = enrichWithHistory(prop.properties, historyMap)
    }
    
    if (prop.items) {
      enriched.items = enrichWithHistory([prop.items], historyMap)[0]
    }
    
    return enriched
  })
}

// Load schemas for a version
export async function loadSchemasForVersion(version: string): Promise<Record<string, { properties: SchemaProperty[], description: string }>> {
  if (schemaCache.has(version)) {
    return schemaCache.get(version)!
  }
  
  // Use DuckDB if parquet data is embedded (single-file build)
  if (shouldUseDuckDB()) {
    try {
      // Load schemas and field history in parallel
      const [schemasWithGroup, fieldHistory] = await Promise.all([
        loadSchemasFromDB(version),
        loadFieldHistory()
      ])
      
      const schemas: Record<string, { properties: SchemaProperty[], description: string }> = {}
      
      // Enrich schemas with field history
      for (const [kind, schemaData] of Object.entries(schemasWithGroup)) {
        const group = schemaData.group
        const kindHistory = fieldHistory?.[`${group}/${kind}`] || []
        
        let properties = schemaData.properties
        if (kindHistory.length > 0) {
          const historyMap = new Map<string, {introducedIn: string, deprecatedIn?: string, removedIn?: string}>()
          for (const entry of kindHistory) {
            historyMap.set(entry.path, entry)
          }
          properties = enrichWithHistory(properties, historyMap)
        }
        
        schemas[kind] = {
          properties,
          description: schemaData.description,
        }
      }
      
      schemaCache.set(version, schemas)
      return schemas
    } catch (err) {
      console.warn('DuckDB schema load failed, falling back to JSON:', err)
    }
  }
  
  try {
    // Load schemas and field history in parallel
    const [schemaResponse, fieldHistory] = await Promise.all([
      fetch(`/data/k8s/schemas/${version}.json`),
      loadFieldHistory()
    ])
    
    if (!schemaResponse.ok) {
      console.warn(`Failed to load schemas for ${version}`)
      return {}
    }
    
    const data = await schemaResponse.json()
    const schemas: Record<string, { properties: SchemaProperty[], description: string }> = {}
    
    // Convert from {group/kind: schema} to {kind: {properties, description}}
    for (const [key, schema] of Object.entries(data.schemas || {})) {
      const kind = key.split('/').pop()!
      const group = key.split('/')[0]
      const schemaData = schema as { properties: SchemaProperty[], description?: string }
      let properties = schemaData.properties || []
      const description = schemaData.description || ''
      
      // Enrich with field history if available
      const kindHistory = fieldHistory?.[`${group}/${kind}`] || []
      if (kindHistory.length > 0) {
        const historyMap = new Map<string, {introducedIn: string, deprecatedIn?: string, removedIn?: string}>()
        for (const entry of kindHistory) {
          historyMap.set(entry.path, entry)
        }
        properties = enrichWithHistory(properties, historyMap)
      }
      
      schemas[kind] = { properties, description }
    }
    
    schemaCache.set(version, schemas)
    return schemas
  } catch (err) {
    console.error('Error loading schemas:', err)
    return {}
  }
}

// Synchronous getter for properties (returns empty if not loaded)
export function getSchemaForKind(kind: string, version: string = '1.35'): SchemaProperty[] {
  const schemas = schemaCache.get(version)
  return schemas?.[kind]?.properties || []
}

// Synchronous getter for description
export function getKindDescription(kind: string, version: string = '1.35'): string {
  const schemas = schemaCache.get(version)
  return schemas?.[kind]?.description || ''
}

// Pod schema (simplified but realistic)
export const podSchema: SchemaProperty[] = [
  {
    name: 'apiVersion',
    path: 'apiVersion',
    type: 'string',
    description: 'API version, e.g., "v1"',
    required: true,
  },
  {
    name: 'kind',
    path: 'kind',
    type: 'string',
    description: 'Kind is "Pod"',
    required: true,
  },
  {
    name: 'metadata',
    path: 'metadata',
    type: 'object',
    description: 'Standard object metadata',
    required: true,
    properties: [
      { name: 'name', path: 'metadata.name', type: 'string', description: 'Name of the Pod, must be unique within namespace', required: true },
      { name: 'namespace', path: 'metadata.namespace', type: 'string', description: 'Namespace the Pod belongs to', required: false },
      { name: 'labels', path: 'metadata.labels', type: 'map', description: 'Map of string keys and values for organizing and categorizing objects', required: false },
      { name: 'annotations', path: 'metadata.annotations', type: 'map', description: 'Arbitrary non-identifying metadata', required: false },
      { name: 'uid', path: 'metadata.uid', type: 'string', description: 'Unique identifier for this object', required: false },
      { name: 'resourceVersion', path: 'metadata.resourceVersion', type: 'string', description: 'Internal resource version', required: false },
      { name: 'creationTimestamp', path: 'metadata.creationTimestamp', type: 'string', description: 'Time when object was created', required: false },
    ],
  },
  {
    name: 'spec',
    path: 'spec',
    type: 'object',
    description: 'Specification of the desired behavior of the pod',
    required: true,
    properties: [
      {
        name: 'containers',
        path: 'spec.containers',
        type: 'array',
        description: 'List of containers belonging to the pod',
        required: true,
        items: {
          name: 'container',
          path: 'spec.containers[]',
          type: 'object',
          description: 'A single container',
          required: true,
          properties: [
            { name: 'name', path: 'spec.containers[].name', type: 'string', description: 'Name of the container', required: true },
            { name: 'image', path: 'spec.containers[].image', type: 'string', description: 'Container image name', required: true },
            { name: 'imagePullPolicy', path: 'spec.containers[].imagePullPolicy', type: 'string', description: 'When to pull image: Always, Never, IfNotPresent', required: false, enum: ['Always', 'Never', 'IfNotPresent'] },
            { name: 'command', path: 'spec.containers[].command', type: 'array', description: 'Entrypoint array, replaces Docker ENTRYPOINT', required: false },
            { name: 'args', path: 'spec.containers[].args', type: 'array', description: 'Arguments to the entrypoint', required: false },
            { name: 'workingDir', path: 'spec.containers[].workingDir', type: 'string', description: 'Container working directory', required: false },
            {
              name: 'ports',
              path: 'spec.containers[].ports',
              type: 'array',
              description: 'List of ports to expose from the container',
              required: false,
              items: {
                name: 'containerPort',
                path: 'spec.containers[].ports[]',
                type: 'object',
                description: 'Port configuration',
                required: false,
                properties: [
                  { name: 'containerPort', path: 'spec.containers[].ports[].containerPort', type: 'integer', description: 'Port number to expose', required: true },
                  { name: 'protocol', path: 'spec.containers[].ports[].protocol', type: 'string', description: 'Protocol for port: TCP, UDP, SCTP', required: false },
                  { name: 'name', path: 'spec.containers[].ports[].name', type: 'string', description: 'Name for the port', required: false },
                  { name: 'hostPort', path: 'spec.containers[].ports[].hostPort', type: 'integer', description: 'Port on the host', required: false },
                ],
              },
            },
            {
              name: 'env',
              path: 'spec.containers[].env',
              type: 'array',
              description: 'List of environment variables',
              required: false,
              items: {
                name: 'envVar',
                path: 'spec.containers[].env[]',
                type: 'object',
                description: 'Environment variable',
                required: false,
                properties: [
                  { name: 'name', path: 'spec.containers[].env[].name', type: 'string', description: 'Environment variable name', required: true },
                  { name: 'value', path: 'spec.containers[].env[].value', type: 'string', description: 'Direct value', required: false },
                  {
                    name: 'valueFrom',
                    path: 'spec.containers[].env[].valueFrom',
                    type: 'object',
                    description: 'Source for the value',
                    required: false,
                    properties: [
                      { name: 'configMapKeyRef', path: 'spec.containers[].env[].valueFrom.configMapKeyRef', type: 'object', description: 'Reference to a ConfigMap key', required: false },
                      { name: 'secretKeyRef', path: 'spec.containers[].env[].valueFrom.secretKeyRef', type: 'object', description: 'Reference to a Secret key', required: false },
                      { name: 'fieldRef', path: 'spec.containers[].env[].valueFrom.fieldRef', type: 'object', description: 'Reference to pod field', required: false },
                      { name: 'resourceFieldRef', path: 'spec.containers[].env[].valueFrom.resourceFieldRef', type: 'object', description: 'Reference to container resource', required: false },
                    ],
                  },
                ],
              },
            },
            {
              name: 'resources',
              path: 'spec.containers[].resources',
              type: 'object',
              description: 'Compute resource requirements',
              required: false,
              properties: [
                {
                  name: 'requests',
                  path: 'spec.containers[].resources.requests',
                  type: 'object',
                  description: 'Minimum resources required',
                  required: false,
                  properties: [
                    { name: 'cpu', path: 'spec.containers[].resources.requests.cpu', type: 'string', description: 'CPU cores, e.g., "100m" or "1"', required: false },
                    { name: 'memory', path: 'spec.containers[].resources.requests.memory', type: 'string', description: 'Memory, e.g., "128Mi" or "1Gi"', required: false },
                  ],
                },
                {
                  name: 'limits',
                  path: 'spec.containers[].resources.limits',
                  type: 'object',
                  description: 'Maximum resources allowed',
                  required: false,
                  properties: [
                    { name: 'cpu', path: 'spec.containers[].resources.limits.cpu', type: 'string', description: 'CPU limit', required: false },
                    { name: 'memory', path: 'spec.containers[].resources.limits.memory', type: 'string', description: 'Memory limit', required: false },
                  ],
                },
              ],
            },
            {
              name: 'volumeMounts',
              path: 'spec.containers[].volumeMounts',
              type: 'array',
              description: 'Volumes to mount into the container',
              required: false,
              items: {
                name: 'volumeMount',
                path: 'spec.containers[].volumeMounts[]',
                type: 'object',
                description: 'Volume mount specification',
                required: false,
                properties: [
                  { name: 'name', path: 'spec.containers[].volumeMounts[].name', type: 'string', description: 'Must match volume name', required: true },
                  { name: 'mountPath', path: 'spec.containers[].volumeMounts[].mountPath', type: 'string', description: 'Path within the container', required: true },
                  { name: 'readOnly', path: 'spec.containers[].volumeMounts[].readOnly', type: 'boolean', description: 'Mount as read-only', required: false },
                  { name: 'subPath', path: 'spec.containers[].volumeMounts[].subPath', type: 'string', description: 'Path within the volume', required: false },
                ],
              },
            },
            {
              name: 'livenessProbe',
              path: 'spec.containers[].livenessProbe',
              type: 'object',
              description: 'Periodic probe of container liveness',
              required: false,
              properties: [
                { name: 'httpGet', path: 'spec.containers[].livenessProbe.httpGet', type: 'object', description: 'HTTP GET probe', required: false },
                { name: 'tcpSocket', path: 'spec.containers[].livenessProbe.tcpSocket', type: 'object', description: 'TCP socket probe', required: false },
                { name: 'exec', path: 'spec.containers[].livenessProbe.exec', type: 'object', description: 'Exec command probe', required: false },
                { name: 'initialDelaySeconds', path: 'spec.containers[].livenessProbe.initialDelaySeconds', type: 'integer', description: 'Seconds before first probe', required: false },
                { name: 'periodSeconds', path: 'spec.containers[].livenessProbe.periodSeconds', type: 'integer', description: 'How often to probe', required: false },
                { name: 'timeoutSeconds', path: 'spec.containers[].livenessProbe.timeoutSeconds', type: 'integer', description: 'Probe timeout', required: false },
                { name: 'failureThreshold', path: 'spec.containers[].livenessProbe.failureThreshold', type: 'integer', description: 'Failures before unhealthy', required: false },
              ],
            },
            {
              name: 'readinessProbe',
              path: 'spec.containers[].readinessProbe',
              type: 'object',
              description: 'Periodic probe of container readiness',
              required: false,
            },
            {
              name: 'securityContext',
              path: 'spec.containers[].securityContext',
              type: 'object',
              description: 'Container-level security attributes',
              required: false,
              properties: [
                { name: 'runAsUser', path: 'spec.containers[].securityContext.runAsUser', type: 'integer', description: 'UID to run container as', required: false },
                { name: 'runAsGroup', path: 'spec.containers[].securityContext.runAsGroup', type: 'integer', description: 'GID to run container as', required: false },
                { name: 'runAsNonRoot', path: 'spec.containers[].securityContext.runAsNonRoot', type: 'boolean', description: 'Must run as non-root', required: false },
                { name: 'readOnlyRootFilesystem', path: 'spec.containers[].securityContext.readOnlyRootFilesystem', type: 'boolean', description: 'Mount root fs as read-only', required: false },
                { name: 'privileged', path: 'spec.containers[].securityContext.privileged', type: 'boolean', description: 'Run in privileged mode', required: false },
                { name: 'capabilities', path: 'spec.containers[].securityContext.capabilities', type: 'object', description: 'Linux capabilities to add/drop', required: false },
              ],
            },
          ],
        },
      },
      {
        name: 'initContainers',
        path: 'spec.initContainers',
        type: 'array',
        description: 'List of init containers that run before app containers',
        required: false,
      },
      {
        name: 'volumes',
        path: 'spec.volumes',
        type: 'array',
        description: 'List of volumes that can be mounted by containers',
        required: false,
        items: {
          name: 'volume',
          path: 'spec.volumes[]',
          type: 'object',
          description: 'Volume specification',
          required: false,
          properties: [
            { name: 'name', path: 'spec.volumes[].name', type: 'string', description: 'Volume name', required: true },
            { name: 'configMap', path: 'spec.volumes[].configMap', type: 'object', description: 'ConfigMap source', required: false },
            { name: 'secret', path: 'spec.volumes[].secret', type: 'object', description: 'Secret source', required: false },
            { name: 'emptyDir', path: 'spec.volumes[].emptyDir', type: 'object', description: 'Temporary empty directory', required: false },
            { name: 'persistentVolumeClaim', path: 'spec.volumes[].persistentVolumeClaim', type: 'object', description: 'PVC reference', required: false },
            { name: 'hostPath', path: 'spec.volumes[].hostPath', type: 'object', description: 'Host path mount', required: false },
          ],
        },
      },
      { name: 'restartPolicy', path: 'spec.restartPolicy', type: 'string', description: 'Restart policy: Always, OnFailure, Never', required: false, enum: ['Always', 'OnFailure', 'Never'] },
      { name: 'terminationGracePeriodSeconds', path: 'spec.terminationGracePeriodSeconds', type: 'integer', description: 'Grace period before force kill', required: false },
      { name: 'serviceAccountName', path: 'spec.serviceAccountName', type: 'string', description: 'ServiceAccount to run pod as', required: false },
      { name: 'nodeName', path: 'spec.nodeName', type: 'string', description: 'Request scheduling on specific node', required: false },
      { name: 'nodeSelector', path: 'spec.nodeSelector', type: 'map', description: 'Node label selector', required: false },
      {
        name: 'affinity',
        path: 'spec.affinity',
        type: 'object',
        description: 'Affinity scheduling constraints',
        required: false,
        properties: [
          { name: 'nodeAffinity', path: 'spec.affinity.nodeAffinity', type: 'object', description: 'Node affinity rules', required: false },
          { name: 'podAffinity', path: 'spec.affinity.podAffinity', type: 'object', description: 'Pod affinity rules', required: false },
          { name: 'podAntiAffinity', path: 'spec.affinity.podAntiAffinity', type: 'object', description: 'Pod anti-affinity rules', required: false },
        ],
      },
      {
        name: 'tolerations',
        path: 'spec.tolerations',
        type: 'array',
        description: 'Tolerations for node taints',
        required: false,
        items: {
          name: 'toleration',
          path: 'spec.tolerations[]',
          type: 'object',
          description: 'Toleration specification',
          required: false,
          properties: [
            { name: 'key', path: 'spec.tolerations[].key', type: 'string', description: 'Taint key to match', required: false },
            { name: 'operator', path: 'spec.tolerations[].operator', type: 'string', description: 'Match operator: Exists, Equal', required: false },
            { name: 'value', path: 'spec.tolerations[].value', type: 'string', description: 'Taint value to match', required: false },
            { name: 'effect', path: 'spec.tolerations[].effect', type: 'string', description: 'Taint effect: NoSchedule, PreferNoSchedule, NoExecute', required: false },
            { name: 'tolerationSeconds', path: 'spec.tolerations[].tolerationSeconds', type: 'integer', description: 'Time to tolerate NoExecute', required: false },
          ],
        },
      },
      { name: 'hostNetwork', path: 'spec.hostNetwork', type: 'boolean', description: 'Use host network namespace', required: false },
      { name: 'dnsPolicy', path: 'spec.dnsPolicy', type: 'string', description: 'DNS policy: ClusterFirst, Default, None', required: false },
      { name: 'priorityClassName', path: 'spec.priorityClassName', type: 'string', description: 'Priority class name', required: false },
      { name: 'priority', path: 'spec.priority', type: 'integer', description: 'Priority value', required: false },
      {
        name: 'securityContext',
        path: 'spec.securityContext',
        type: 'object',
        description: 'Pod-level security context',
        required: false,
        properties: [
          { name: 'runAsUser', path: 'spec.securityContext.runAsUser', type: 'integer', description: 'UID for all containers', required: false },
          { name: 'runAsGroup', path: 'spec.securityContext.runAsGroup', type: 'integer', description: 'GID for all containers', required: false },
          { name: 'fsGroup', path: 'spec.securityContext.fsGroup', type: 'integer', description: 'GID for volume ownership', required: false },
          { name: 'runAsNonRoot', path: 'spec.securityContext.runAsNonRoot', type: 'boolean', description: 'All containers must run as non-root', required: false },
          { name: 'seccompProfile', path: 'spec.securityContext.seccompProfile', type: 'object', description: 'Seccomp profile settings', required: false },
        ],
      },
      {
        name: 'topologySpreadConstraints',
        path: 'spec.topologySpreadConstraints',
        type: 'array',
        description: 'How to spread pods across topology domains',
        required: false,
        items: {
          name: 'topologySpreadConstraint',
          path: 'spec.topologySpreadConstraints[]',
          type: 'object',
          description: 'Topology spread constraint',
          required: false,
          properties: [
            { name: 'maxSkew', path: 'spec.topologySpreadConstraints[].maxSkew', type: 'integer', description: 'Max difference in spread', required: true },
            { name: 'topologyKey', path: 'spec.topologySpreadConstraints[].topologyKey', type: 'string', description: 'Node label key', required: true },
            { name: 'whenUnsatisfiable', path: 'spec.topologySpreadConstraints[].whenUnsatisfiable', type: 'string', description: 'DoNotSchedule or ScheduleAnyway', required: true },
            { name: 'labelSelector', path: 'spec.topologySpreadConstraints[].labelSelector', type: 'object', description: 'Label selector for counting', required: false },
          ],
        },
      },
    ],
  },
  {
    name: 'status',
    path: 'status',
    type: 'object',
    description: 'Most recently observed status of the pod (read-only)',
    required: false,
    properties: [
      { name: 'phase', path: 'status.phase', type: 'string', description: 'Current phase: Pending, Running, Succeeded, Failed, Unknown', required: false },
      { name: 'conditions', path: 'status.conditions', type: 'array', description: 'Current conditions', required: false },
      { name: 'hostIP', path: 'status.hostIP', type: 'string', description: 'IP address of the host', required: false },
      { name: 'podIP', path: 'status.podIP', type: 'string', description: 'IP address allocated to the pod', required: false },
      { name: 'podIPs', path: 'status.podIPs', type: 'array', description: 'IP addresses allocated to pod', required: false },
      { name: 'startTime', path: 'status.startTime', type: 'string', description: 'Time the pod was scheduled', required: false },
      { name: 'containerStatuses', path: 'status.containerStatuses', type: 'array', description: 'Container status list', required: false },
      { name: 'initContainerStatuses', path: 'status.initContainerStatuses', type: 'array', description: 'Init container status list', required: false },
    ],
  },
]

// Deployment schema (simplified)
export const deploymentSchema: SchemaProperty[] = [
  {
    name: 'apiVersion',
    path: 'apiVersion',
    type: 'string',
    description: 'API version, e.g., "apps/v1"',
    required: true,
  },
  {
    name: 'kind',
    path: 'kind',
    type: 'string',
    description: 'Kind is "Deployment"',
    required: true,
  },
  {
    name: 'metadata',
    path: 'metadata',
    type: 'object',
    description: 'Standard object metadata',
    required: true,
    properties: [
      { name: 'name', path: 'metadata.name', type: 'string', description: 'Name of the Deployment', required: true },
      { name: 'namespace', path: 'metadata.namespace', type: 'string', description: 'Namespace', required: false },
      { name: 'labels', path: 'metadata.labels', type: 'map', description: 'Labels for organizing', required: false },
      { name: 'annotations', path: 'metadata.annotations', type: 'map', description: 'Annotations', required: false },
    ],
  },
  {
    name: 'spec',
    path: 'spec',
    type: 'object',
    description: 'Specification of the desired Deployment behavior',
    required: true,
    properties: [
      { name: 'replicas', path: 'spec.replicas', type: 'integer', description: 'Number of desired pods', required: false },
      {
        name: 'selector',
        path: 'spec.selector',
        type: 'object',
        description: 'Label selector for pods',
        required: true,
        properties: [
          { name: 'matchLabels', path: 'spec.selector.matchLabels', type: 'map', description: 'Labels to match', required: false },
          { name: 'matchExpressions', path: 'spec.selector.matchExpressions', type: 'array', description: 'Label expressions', required: false },
        ],
      },
      {
        name: 'template',
        path: 'spec.template',
        type: 'object',
        description: 'Pod template specification',
        required: true,
        properties: [
          { name: 'metadata', path: 'spec.template.metadata', type: 'object', description: 'Pod metadata', required: false },
          { name: 'spec', path: 'spec.template.spec', type: 'object', description: 'Pod spec (same as Pod.spec)', required: true },
        ],
      },
      {
        name: 'strategy',
        path: 'spec.strategy',
        type: 'object',
        description: 'Deployment update strategy',
        required: false,
        properties: [
          { name: 'type', path: 'spec.strategy.type', type: 'string', description: 'RollingUpdate or Recreate', required: false },
          {
            name: 'rollingUpdate',
            path: 'spec.strategy.rollingUpdate',
            type: 'object',
            description: 'Rolling update parameters',
            required: false,
            properties: [
              { name: 'maxUnavailable', path: 'spec.strategy.rollingUpdate.maxUnavailable', type: 'intOrString', description: 'Max pods unavailable during update', required: false },
              { name: 'maxSurge', path: 'spec.strategy.rollingUpdate.maxSurge', type: 'intOrString', description: 'Max pods over replicas during update', required: false },
            ],
          },
        ],
      },
      { name: 'minReadySeconds', path: 'spec.minReadySeconds', type: 'integer', description: 'Seconds pod must be ready', required: false },
      { name: 'revisionHistoryLimit', path: 'spec.revisionHistoryLimit', type: 'integer', description: 'Number of old ReplicaSets to keep', required: false },
      { name: 'progressDeadlineSeconds', path: 'spec.progressDeadlineSeconds', type: 'integer', description: 'Max seconds for progress', required: false },
      { name: 'paused', path: 'spec.paused', type: 'boolean', description: 'Pause the deployment', required: false },
    ],
  },
  {
    name: 'status',
    path: 'status',
    type: 'object',
    description: 'Most recently observed deployment status',
    required: false,
    properties: [
      { name: 'observedGeneration', path: 'status.observedGeneration', type: 'integer', description: 'Generation observed by controller', required: false },
      { name: 'replicas', path: 'status.replicas', type: 'integer', description: 'Total replicas', required: false },
      { name: 'readyReplicas', path: 'status.readyReplicas', type: 'integer', description: 'Ready replicas', required: false },
      { name: 'availableReplicas', path: 'status.availableReplicas', type: 'integer', description: 'Available replicas', required: false },
      { name: 'unavailableReplicas', path: 'status.unavailableReplicas', type: 'integer', description: 'Unavailable replicas', required: false },
      { name: 'updatedReplicas', path: 'status.updatedReplicas', type: 'integer', description: 'Replicas with new template', required: false },
      { name: 'conditions', path: 'status.conditions', type: 'array', description: 'Deployment conditions', required: false },
    ],
  },
]

// Service schema
export const serviceSchema: SchemaProperty[] = [
  { name: 'apiVersion', path: 'apiVersion', type: 'string', description: 'API version "v1"', required: true },
  { name: 'kind', path: 'kind', type: 'string', description: 'Kind is "Service"', required: true },
  {
    name: 'metadata',
    path: 'metadata',
    type: 'object',
    description: 'Standard object metadata',
    required: true,
    properties: [
      { name: 'name', path: 'metadata.name', type: 'string', description: 'Service name', required: true },
      { name: 'namespace', path: 'metadata.namespace', type: 'string', description: 'Namespace', required: false },
      { name: 'labels', path: 'metadata.labels', type: 'map', description: 'Labels', required: false },
    ],
  },
  {
    name: 'spec',
    path: 'spec',
    type: 'object',
    description: 'Service specification',
    required: true,
    properties: [
      { name: 'type', path: 'spec.type', type: 'string', description: 'ClusterIP, NodePort, LoadBalancer, ExternalName', required: false },
      { name: 'selector', path: 'spec.selector', type: 'map', description: 'Pod selector', required: false },
      {
        name: 'ports',
        path: 'spec.ports',
        type: 'array',
        description: 'List of service ports',
        required: true,
        items: {
          name: 'servicePort',
          path: 'spec.ports[]',
          type: 'object',
          description: 'Service port configuration',
          required: true,
          properties: [
            { name: 'name', path: 'spec.ports[].name', type: 'string', description: 'Port name', required: false },
            { name: 'port', path: 'spec.ports[].port', type: 'integer', description: 'Service port', required: true },
            { name: 'targetPort', path: 'spec.ports[].targetPort', type: 'intOrString', description: 'Pod port', required: false },
            { name: 'nodePort', path: 'spec.ports[].nodePort', type: 'integer', description: 'Node port for NodePort/LB', required: false },
            { name: 'protocol', path: 'spec.ports[].protocol', type: 'string', description: 'TCP, UDP, SCTP', required: false },
          ],
        },
      },
      { name: 'clusterIP', path: 'spec.clusterIP', type: 'string', description: 'Cluster IP address', required: false },
      { name: 'externalIPs', path: 'spec.externalIPs', type: 'array', description: 'External IPs', required: false },
      { name: 'loadBalancerIP', path: 'spec.loadBalancerIP', type: 'string', description: 'Requested LB IP', required: false },
      { name: 'sessionAffinity', path: 'spec.sessionAffinity', type: 'string', description: 'ClientIP or None', required: false },
    ],
  },
]

// Map of kind -> schema (fallback for mock data)
export const mockSchemas: Record<string, SchemaProperty[]> = {
  Pod: podSchema,
  Deployment: deploymentSchema,
  Service: serviceSchema,
}
