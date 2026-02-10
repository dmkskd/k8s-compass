/**
 * InPlaceResizeFlow - Interactive visualization of in-place pod resize decision flow
 *
 * Shows how in-place vertical scaling (KEP-1287) interacts with CPU Manager policies.
 * Demonstrates why Guaranteed pods with static CPU policy cannot be resized in-place.
 *
 * @module features/deep-dives/content/cpu-numa-low-latency/visualizations
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './InPlaceResizeFlow.module.css'

// =============================================================================
// Types
// =============================================================================

interface ResizeScenario {
  id: string
  name: string
  description: string
  podConfig: {
    qosClass: 'Guaranteed' | 'Burstable' | 'BestEffort'
    cpuRequest: string
    cpuLimit: string
    memoryRequest: string
    memoryLimit: string
  }
  nodeConfig: {
    cpuManagerPolicy: 'none' | 'static'
    memoryManagerPolicy: 'None' | 'Static'
  }
  resizeRequest: {
    newCpuRequest: string
    newCpuLimit: string
  }
}

interface DecisionNode {
  id: string
  question: string
  yesPath: string | 'ALLOWED' | 'INFEASIBLE' | 'DEFERRED'
  noPath: string | 'ALLOWED' | 'INFEASIBLE' | 'DEFERRED'
  explanation?: string
}

type FlowResult = 'ALLOWED' | 'INFEASIBLE' | 'DEFERRED' | null

// =============================================================================
// Constants
// =============================================================================

const SCENARIOS: ResizeScenario[] = [
  {
    id: 'burstable-none',
    name: 'Burstable Pod + None Policy',
    description: 'Standard pod on default CPU Manager',
    podConfig: {
      qosClass: 'Burstable',
      cpuRequest: '500m',
      cpuLimit: '2',
      memoryRequest: '512Mi',
      memoryLimit: '1Gi',
    },
    nodeConfig: {
      cpuManagerPolicy: 'none',
      memoryManagerPolicy: 'None',
    },
    resizeRequest: {
      newCpuRequest: '1',
      newCpuLimit: '4',
    },
  },
  {
    id: 'guaranteed-none',
    name: 'Guaranteed Pod + None Policy',
    description: 'Guaranteed QoS but no static policy',
    podConfig: {
      qosClass: 'Guaranteed',
      cpuRequest: '2',
      cpuLimit: '2',
      memoryRequest: '4Gi',
      memoryLimit: '4Gi',
    },
    nodeConfig: {
      cpuManagerPolicy: 'none',
      memoryManagerPolicy: 'None',
    },
    resizeRequest: {
      newCpuRequest: '4',
      newCpuLimit: '4',
    },
  },
  {
    id: 'guaranteed-static',
    name: 'Guaranteed Pod + Static Policy',
    description: 'Exclusive CPUs - resize blocked!',
    podConfig: {
      qosClass: 'Guaranteed',
      cpuRequest: '4',
      cpuLimit: '4',
      memoryRequest: '8Gi',
      memoryLimit: '8Gi',
    },
    nodeConfig: {
      cpuManagerPolicy: 'static',
      memoryManagerPolicy: 'None',
    },
    resizeRequest: {
      newCpuRequest: '6',
      newCpuLimit: '6',
    },
  },
  {
    id: 'guaranteed-static-memory',
    name: 'Guaranteed + Static CPU & Memory',
    description: 'Both static policies - resize blocked!',
    podConfig: {
      qosClass: 'Guaranteed',
      cpuRequest: '4',
      cpuLimit: '4',
      memoryRequest: '8Gi',
      memoryLimit: '8Gi',
    },
    nodeConfig: {
      cpuManagerPolicy: 'static',
      memoryManagerPolicy: 'Static',
    },
    resizeRequest: {
      newCpuRequest: '6',
      newCpuLimit: '6',
    },
  },
  {
    id: 'burstable-static',
    name: 'Burstable Pod + Static Policy',
    description: 'Burstable uses shared pool, resize OK',
    podConfig: {
      qosClass: 'Burstable',
      cpuRequest: '500m',
      cpuLimit: '2',
      memoryRequest: '1Gi',
      memoryLimit: '2Gi',
    },
    nodeConfig: {
      cpuManagerPolicy: 'static',
      memoryManagerPolicy: 'None',
    },
    resizeRequest: {
      newCpuRequest: '1',
      newCpuLimit: '4',
    },
  },
]

const DECISION_TREE: DecisionNode[] = [
  {
    id: 'start',
    question: 'Is the pod a static pod?',
    yesPath: 'INFEASIBLE',
    noPath: 'check-swap',
    explanation: 'Static pods cannot be resized in-place',
  },
  {
    id: 'check-swap',
    question: 'Does the container have swap enabled?',
    yesPath: 'INFEASIBLE',
    noPath: 'check-qos',
    explanation: 'Swap resize not yet supported',
  },
  {
    id: 'check-qos',
    question: 'Is the pod Guaranteed QoS with integer CPU?',
    yesPath: 'check-cpu-policy',
    noPath: 'check-resources',
    explanation: 'Only Guaranteed pods with integer CPUs get exclusive cores',
  },
  {
    id: 'check-cpu-policy',
    question: 'Is CPU Manager static policy enabled?',
    yesPath: 'INFEASIBLE',
    noPath: 'check-memory-policy',
    explanation: 'Exclusive CPUs cannot be resized in-place (yet)',
  },
  {
    id: 'check-memory-policy',
    question: 'Is Memory Manager static policy enabled?',
    yesPath: 'INFEASIBLE',
    noPath: 'check-resources',
    explanation: 'NUMA-pinned memory cannot be resized in-place (yet)',
  },
  {
    id: 'check-resources',
    question: 'Does the node have enough resources?',
    yesPath: 'ALLOWED',
    noPath: 'check-fit',
    explanation: 'Check if requested resources fit on node',
  },
  {
    id: 'check-fit',
    question: 'Could resources fit if other pods scale down?',
    yesPath: 'DEFERRED',
    noPath: 'INFEASIBLE',
    explanation: 'Deferred resizes are retried periodically',
  },
]

// =============================================================================
// Helper Functions
// =============================================================================

function evaluateScenario(scenario: ResizeScenario): { path: string[]; result: FlowResult } {
  const path: string[] = ['start']
  let currentNode = 'start'
  
  while (true) {
    const node = DECISION_TREE.find(n => n.id === currentNode)
    if (!node) break
    
    let answer: boolean
    
    switch (node.id) {
      case 'start':
        answer = false // Not a static pod
        break
      case 'check-swap':
        answer = false // No swap
        break
      case 'check-qos':
        answer = scenario.podConfig.qosClass === 'Guaranteed' && 
                 !scenario.podConfig.cpuRequest.includes('m')
        break
      case 'check-cpu-policy':
        answer = scenario.nodeConfig.cpuManagerPolicy === 'static'
        break
      case 'check-memory-policy':
        answer = scenario.nodeConfig.memoryManagerPolicy === 'Static'
        break
      case 'check-resources':
        answer = true // Assume resources available for demo
        break
      case 'check-fit':
        answer = true
        break
      default:
        answer = false
    }
    
    const nextPath = answer ? node.yesPath : node.noPath
    
    if (nextPath === 'ALLOWED' || nextPath === 'INFEASIBLE' || nextPath === 'DEFERRED') {
      return { path, result: nextPath }
    }
    
    path.push(nextPath)
    currentNode = nextPath
  }
  
  return { path, result: null }
}

// =============================================================================
// Components
// =============================================================================

function ScenarioCard({
  scenario,
  isSelected,
  onClick,
}: {
  scenario: ResizeScenario
  isSelected: boolean
  onClick: () => void
}) {
  const { result } = evaluateScenario(scenario)
  
  return (
    <motion.button
      className={`${styles.scenarioCard} ${isSelected ? styles.selected : ''}`}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className={styles.scenarioHeader}>
        <span className={styles.scenarioName}>{scenario.name}</span>
        <span className={`${styles.resultBadge} ${styles[result?.toLowerCase() || '']}`}>
          {result}
        </span>
      </div>
      <p className={styles.scenarioDescription}>{scenario.description}</p>
      <div className={styles.scenarioConfig}>
        <span className={styles.configItem}>
          <span className={styles.configLabel}>QoS:</span>
          <span className={`${styles.configValue} ${styles[scenario.podConfig.qosClass.toLowerCase()]}`}>
            {scenario.podConfig.qosClass}
          </span>
        </span>
        <span className={styles.configItem}>
          <span className={styles.configLabel}>CPU Policy:</span>
          <span className={styles.configValue}>{scenario.nodeConfig.cpuManagerPolicy}</span>
        </span>
      </div>
    </motion.button>
  )
}

function DecisionNodeBox({
  node,
  isActive,
  answer,
  isInPath,
}: {
  node: DecisionNode
  isActive: boolean
  answer: boolean | null
  isInPath: boolean
}) {
  return (
    <motion.div
      className={`${styles.decisionNode} ${isActive ? styles.active : ''} ${isInPath ? styles.inPath : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className={styles.nodeQuestion}>{node.question}</div>
      {node.explanation && (
        <div className={styles.nodeExplanation}>{node.explanation}</div>
      )}
      {answer !== null && (
        <div className={`${styles.nodeAnswer} ${answer ? styles.yes : styles.no}`}>
          {answer ? 'YES' : 'NO'}
        </div>
      )}
    </motion.div>
  )
}

function ResultBox({ result }: { result: FlowResult }) {
  if (!result) return null
  
  const info = {
    ALLOWED: {
      title: 'Resize Allowed ✓',
      description: 'The resize will be actuated. Resources will be updated in-place without restarting the container.',
      color: '#10b981',
    },
    INFEASIBLE: {
      title: 'Resize Infeasible ✗',
      description: 'The resize cannot be performed on this node. The pod must be recreated to change resources.',
      color: '#ef4444',
    },
    DEFERRED: {
      title: 'Resize Deferred ⏳',
      description: 'The resize is feasible but resources are not currently available. Will be retried periodically.',
      color: '#f59e0b',
    },
  }
  
  const { title, description, color } = info[result]
  
  return (
    <motion.div
      className={styles.resultBox}
      style={{ borderColor: color }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.5 }}
    >
      <div className={styles.resultTitle} style={{ color }}>{title}</div>
      <div className={styles.resultDescription}>{description}</div>
    </motion.div>
  )
}

function ResourceStates() {
  return (
    <div className={styles.resourceStates}>
      <h5 className={styles.statesTitle}>Resource States Flow</h5>
      <div className={styles.statesFlow}>
        <div className={styles.stateBox}>
          <span className={styles.stateName}>Desired</span>
          <span className={styles.stateDesc}>spec.resources</span>
        </div>
        <div className={styles.stateArrow}>→</div>
        <div className={styles.stateBox}>
          <span className={styles.stateName}>Allocated</span>
          <span className={styles.stateDesc}>Kubelet admitted</span>
        </div>
        <div className={styles.stateArrow}>→</div>
        <div className={styles.stateBox}>
          <span className={styles.stateName}>Actuated</span>
          <span className={styles.stateDesc}>Sent to runtime</span>
        </div>
        <div className={styles.stateArrow}>→</div>
        <div className={styles.stateBox}>
          <span className={styles.stateName}>Actual</span>
          <span className={styles.stateDesc}>status.resources</span>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function InPlaceResizeFlow() {
  const [selectedScenario, setSelectedScenario] = useState<ResizeScenario>(SCENARIOS[0])
  const [animationStep, setAnimationStep] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  
  const evaluation = useMemo(() => evaluateScenario(selectedScenario), [selectedScenario])
  
  // Reset animation when scenario changes
  useEffect(() => {
    setAnimationStep(0)
    setIsAnimating(false)
  }, [selectedScenario])
  
  // Animate through decision tree
  const handleAnimate = useCallback(() => {
    setAnimationStep(0)
    setIsAnimating(true)
    
    let step = 0
    const interval = setInterval(() => {
      step++
      setAnimationStep(step)
      
      if (step >= evaluation.path.length) {
        clearInterval(interval)
        setTimeout(() => setIsAnimating(false), 500)
      }
    }, 800)
    
    return () => clearInterval(interval)
  }, [evaluation.path.length])
  
  // Get answer for each node based on scenario
  const getNodeAnswer = useCallback((nodeId: string): boolean | null => {
    const nodeIndex = evaluation.path.indexOf(nodeId)
    if (nodeIndex === -1 || nodeIndex >= animationStep) return null
    
    const node = DECISION_TREE.find(n => n.id === nodeId)
    if (!node) return null
    
    const nextInPath = evaluation.path[nodeIndex + 1]
    if (!nextInPath) {
      // This is the last node, check result
      return evaluation.result === node.yesPath
    }
    
    return nextInPath === node.yesPath
  }, [evaluation, animationStep])
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>In-Place Pod Resize Decision Flow</h4>
        <p className={styles.subtitle}>
          See how Kubelet decides whether to allow in-place vertical scaling (KEP-1287)
        </p>
      </div>
      
      {/* Scenario Selector */}
      <div className={styles.scenarios}>
        <h5 className={styles.sectionTitle}>Select a Scenario</h5>
        <div className={styles.scenarioGrid}>
          {SCENARIOS.map(scenario => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              isSelected={selectedScenario.id === scenario.id}
              onClick={() => setSelectedScenario(scenario)}
            />
          ))}
        </div>
      </div>
      
      {/* Selected Scenario Details */}
      <div className={styles.scenarioDetails}>
        <div className={styles.detailsGrid}>
          <div className={styles.detailsSection}>
            <h6 className={styles.detailsTitle}>Current Pod</h6>
            <div className={styles.detailsContent}>
              <div className={styles.detailRow}>
                <span>CPU:</span>
                <span>{selectedScenario.podConfig.cpuRequest} / {selectedScenario.podConfig.cpuLimit}</span>
              </div>
              <div className={styles.detailRow}>
                <span>Memory:</span>
                <span>{selectedScenario.podConfig.memoryRequest} / {selectedScenario.podConfig.memoryLimit}</span>
              </div>
              <div className={styles.detailRow}>
                <span>QoS Class:</span>
                <span className={styles[selectedScenario.podConfig.qosClass.toLowerCase()]}>
                  {selectedScenario.podConfig.qosClass}
                </span>
              </div>
            </div>
          </div>
          
          <div className={styles.detailsSection}>
            <h6 className={styles.detailsTitle}>Resize Request</h6>
            <div className={styles.detailsContent}>
              <div className={styles.detailRow}>
                <span>New CPU:</span>
                <span className={styles.highlight}>
                  {selectedScenario.resizeRequest.newCpuRequest} / {selectedScenario.resizeRequest.newCpuLimit}
                </span>
              </div>
              <div className={styles.detailRow}>
                <span>Change:</span>
                <span className={styles.increase}>
                  +{parseInt(selectedScenario.resizeRequest.newCpuRequest) - 
                    parseInt(selectedScenario.podConfig.cpuRequest.replace('m', '')) / 
                    (selectedScenario.podConfig.cpuRequest.includes('m') ? 1000 : 1)} CPUs
                </span>
              </div>
            </div>
          </div>
          
          <div className={styles.detailsSection}>
            <h6 className={styles.detailsTitle}>Node Config</h6>
            <div className={styles.detailsContent}>
              <div className={styles.detailRow}>
                <span>CPU Manager:</span>
                <span className={selectedScenario.nodeConfig.cpuManagerPolicy === 'static' ? styles.warning : ''}>
                  {selectedScenario.nodeConfig.cpuManagerPolicy}
                </span>
              </div>
              <div className={styles.detailRow}>
                <span>Memory Manager:</span>
                <span className={selectedScenario.nodeConfig.memoryManagerPolicy === 'Static' ? styles.warning : ''}>
                  {selectedScenario.nodeConfig.memoryManagerPolicy}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <button
          className={styles.animateButton}
          onClick={handleAnimate}
          disabled={isAnimating}
        >
          {isAnimating ? 'Evaluating...' : 'Run Decision Flow'}
        </button>
      </div>
      
      {/* Decision Tree Visualization */}
      <div className={styles.decisionTree}>
        <h5 className={styles.sectionTitle}>Kubelet Decision Tree</h5>
        
        <div className={styles.treeContainer}>
          {DECISION_TREE.map((node) => {
            const isInPath = evaluation.path.includes(node.id)
            const isActive = animationStep > 0 && evaluation.path[animationStep - 1] === node.id
            const answer = getNodeAnswer(node.id)
            
            return (
              <DecisionNodeBox
                key={node.id}
                node={node}
                isActive={isActive}
                answer={answer}
                isInPath={isInPath && animationStep >= evaluation.path.indexOf(node.id)}
              />
            )
          })}
        </div>
        
        {/* Result */}
        <AnimatePresence>
          {animationStep >= evaluation.path.length && evaluation.result && (
            <ResultBox result={evaluation.result} />
          )}
        </AnimatePresence>
      </div>
      
      {/* Resource States */}
      <ResourceStates />
      
      {/* Key Insight */}
      <div className={styles.insight}>
        <div className={styles.insightIcon}>i</div>
        <div className={styles.insightContent}>
          <strong>Key Insight:</strong> Guaranteed pods with exclusive CPUs (static policy) cannot be 
          resized in-place because the CPU Manager has pinned specific cores to the container. 
          Changing CPU count would require releasing and re-acquiring exclusive cores, which is 
          not yet supported. The feature gate <code>InPlacePodVerticalScalingExclusiveCPUs</code> 
          exists for development work on this capability.
        </div>
      </div>
    </div>
  )
}

export default InPlaceResizeFlow
