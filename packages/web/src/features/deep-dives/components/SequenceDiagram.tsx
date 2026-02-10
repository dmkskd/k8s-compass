/**
 * SequenceDiagram Component
 *
 * An animated sequence diagram showing interactions between components over time.
 * Supports play/pause/step controls, speed adjustment, and hover tooltips.
 *
 * @module features/deep-dives/components/SequenceDiagram
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { SequenceMessage } from '../index'
import styles from './SequenceDiagram.module.css'

// =============================================================================
// Types
// =============================================================================

interface SequenceDiagramProps {
  /** Array of participant names (component names) */
  participants: string[]
  /** Array of messages between participants */
  messages: SequenceMessage[]
  /** Auto-play animation on mount */
  autoPlay?: boolean
  /** Animation speed multiplier (0.5, 1, 2) */
  speed?: number
  /** Optional title for the diagram */
  title?: string
  /** Optional description */
  description?: string
  /** Callback when animation completes */
  onComplete?: () => void
  /** Callback when a message is highlighted */
  onMessageHighlight?: (messageId: string | null) => void
}

interface LayoutConfig {
  participantWidth: number
  participantHeight: number
  participantGap: number
  messageHeight: number
  headerHeight: number
  padding: number
  lifelineStartY: number
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_LAYOUT: LayoutConfig = {
  participantWidth: 140,
  participantHeight: 50,
  participantGap: 60,
  messageHeight: 60,
  headerHeight: 80,
  padding: 40,
  lifelineStartY: 100,
}

const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
]

const BASE_ANIMATION_DURATION = 1000 // ms

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the X position for a participant
 */
function getParticipantX(index: number, layout: LayoutConfig): number {
  return layout.padding + index * (layout.participantWidth + layout.participantGap)
}

/**
 * Get the center X position for a participant
 */
function getParticipantCenterX(index: number, layout: LayoutConfig): number {
  return getParticipantX(index, layout) + layout.participantWidth / 2
}

/**
 * Get the Y position for a message
 */
function getMessageY(messageIndex: number, layout: LayoutConfig): number {
  return layout.lifelineStartY + messageIndex * layout.messageHeight + layout.messageHeight / 2
}

/**
 * Calculate total diagram dimensions
 */
function calculateDimensions(
  participantCount: number,
  messageCount: number,
  layout: LayoutConfig
): { width: number; height: number } {
  const width =
    layout.padding * 2 +
    participantCount * layout.participantWidth +
    (participantCount - 1) * layout.participantGap
  const height =
    layout.lifelineStartY + messageCount * layout.messageHeight + layout.padding
  return { width: Math.max(width, 400), height: Math.max(height, 300) }
}

// =============================================================================
// Sub-Components
// =============================================================================

interface ParticipantProps {
  name: string
  x: number
  y: number
  width: number
  height: number
  isActive: boolean
}

function Participant({ name, x, y, width, height, isActive }: ParticipantProps) {
  const classes = [styles.participant, isActive && styles.participantActive]
    .filter(Boolean)
    .join(' ')

  return (
    <g className={classes}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        ry={8}
        className={styles.participantBox}
      />
      <text
        x={x + width / 2}
        y={y + height / 2}
        className={styles.participantText}
        dominantBaseline="middle"
        textAnchor="middle"
      >
        {name}
      </text>
    </g>
  )
}

interface LifelineProps {
  x: number
  startY: number
  endY: number
  isActive: boolean
}

function Lifeline({ x, startY, endY, isActive }: LifelineProps) {
  const classes = [styles.lifeline, isActive && styles.lifelineActive]
    .filter(Boolean)
    .join(' ')

  return (
    <line
      x1={x}
      y1={startY}
      x2={x}
      y2={endY}
      className={classes}
    />
  )
}

interface MessageArrowProps {
  message: SequenceMessage
  fromX: number
  toX: number
  y: number
  isHighlighted: boolean
  isPast: boolean
  isFuture: boolean
  onHover: (message: SequenceMessage | null) => void
}

function MessageArrow({
  message,
  fromX,
  toX,
  y,
  isHighlighted,
  isPast,
  isFuture,
  onHover,
}: MessageArrowProps) {
  const isSelfMessage = fromX === toX
  const arrowDirection = fromX < toX ? 'right' : 'left'

  const classes = [
    styles.message,
    isHighlighted && styles.messageHighlighted,
    isPast && styles.messagePast,
    isFuture && styles.messageFuture,
  ]
    .filter(Boolean)
    .join(' ')

  // Self-message (curved arrow back to same participant)
  if (isSelfMessage) {
    const loopWidth = 40
    const loopHeight = 30
    const path = `
      M ${fromX} ${y}
      C ${fromX + loopWidth} ${y}, ${fromX + loopWidth} ${y + loopHeight}, ${fromX} ${y + loopHeight}
    `

    return (
      <g
        className={classes}
        onMouseEnter={() => onHover(message)}
        onMouseLeave={() => onHover(null)}
      >
        <path
          d={path}
          className={styles.messagePath}
          fill="none"
          markerEnd={isHighlighted ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
        />
        <text
          x={fromX + loopWidth / 2 + 8}
          y={y + loopHeight / 2}
          className={styles.messageLabel}
          dominantBaseline="middle"
          textAnchor="start"
        >
          {message.label}
        </text>
      </g>
    )
  }

  // Regular message (horizontal arrow)
  const labelX = (fromX + toX) / 2
  const labelY = y - 10

  return (
    <g
      className={classes}
      onMouseEnter={() => onHover(message)}
      onMouseLeave={() => onHover(null)}
    >
      <line
        x1={fromX}
        y1={y}
        x2={toX}
        y2={y}
        className={styles.messagePath}
        markerEnd={
          arrowDirection === 'right'
            ? isHighlighted
              ? 'url(#arrowhead-active)'
              : 'url(#arrowhead)'
            : isHighlighted
              ? 'url(#arrowhead-left-active)'
              : 'url(#arrowhead-left)'
        }
      />
      <text
        x={labelX}
        y={labelY}
        className={styles.messageLabel}
        dominantBaseline="middle"
        textAnchor="middle"
      >
        {message.label}
      </text>
    </g>
  )
}

interface TooltipProps {
  message: SequenceMessage
  x: number
  y: number
}

function Tooltip({ message, x, y }: TooltipProps) {
  return (
    <div
      className={styles.tooltip}
      style={{
        left: x,
        top: y,
      }}
    >
      <div className={styles.tooltipHeader}>
        <span className={styles.tooltipFrom}>{message.from}</span>
        <span className={styles.tooltipArrow}>→</span>
        <span className={styles.tooltipTo}>{message.to}</span>
      </div>
      <div className={styles.tooltipLabel}>{message.label}</div>
      {message.description && (
        <div className={styles.tooltipDescription}>{message.description}</div>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function SequenceDiagram({
  participants,
  messages,
  autoPlay = false,
  speed = 1,
  title,
  description,
  onComplete,
  onMessageHighlight,
}: SequenceDiagramProps) {
  const [isPlaying, setIsPlaying] = useState(autoPlay)
  const [currentStep, setCurrentStep] = useState(-1)
  const [animationSpeed, setAnimationSpeed] = useState(speed)
  const [hoveredMessage, setHoveredMessage] = useState<SequenceMessage | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)

  const layout = DEFAULT_LAYOUT

  // Calculate dimensions
  const { width, height } = useMemo(
    () => calculateDimensions(participants.length, messages.length, layout),
    [participants.length, messages.length, layout]
  )

  // Build participant index map
  const participantIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    participants.forEach((p, i) => map.set(p, i))
    return map
  }, [participants])

  // Get active participants for current step
  const activeParticipants = useMemo(() => {
    if (currentStep < 0 || currentStep >= messages.length) return new Set<string>()
    const msg = messages[currentStep]
    return new Set([msg.from, msg.to])
  }, [currentStep, messages])

  // Animation effect
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        clearTimeout(animationRef.current)
        animationRef.current = null
      }
      return
    }

    const duration = BASE_ANIMATION_DURATION / animationSpeed

    const animate = () => {
      setCurrentStep((prev) => {
        const next = prev + 1
        if (next >= messages.length) {
          setIsPlaying(false)
          onComplete?.()
          return prev
        }
        return next
      })
    }

    animationRef.current = window.setTimeout(animate, duration)

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current)
      }
    }
  }, [isPlaying, currentStep, animationSpeed, messages.length, onComplete])

  // Notify parent of highlighted message
  useEffect(() => {
    if (currentStep >= 0 && currentStep < messages.length) {
      onMessageHighlight?.(messages[currentStep].id)
    } else {
      onMessageHighlight?.(null)
    }
  }, [currentStep, messages, onMessageHighlight])

  // Control handlers
  const handlePlay = useCallback(() => {
    if (currentStep >= messages.length - 1) {
      setCurrentStep(-1)
    }
    setIsPlaying(true)
  }, [currentStep, messages.length])

  const handlePause = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const handleStepForward = useCallback(() => {
    setIsPlaying(false)
    setCurrentStep((prev) => Math.min(prev + 1, messages.length - 1))
  }, [messages.length])

  const handleStepBackward = useCallback(() => {
    setIsPlaying(false)
    setCurrentStep((prev) => Math.max(prev - 1, -1))
  }, [])

  const handleReset = useCallback(() => {
    setIsPlaying(false)
    setCurrentStep(-1)
  }, [])

  const handleSpeedChange = useCallback((newSpeed: number) => {
    setAnimationSpeed(newSpeed)
  }, [])

  // Hover handler with tooltip positioning
  const handleMessageHover = useCallback(
    (message: SequenceMessage | null, event?: React.MouseEvent) => {
      setHoveredMessage(message)
      if (message && event && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setTooltipPosition({
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top + 10,
        })
      }
    },
    []
  )

  // Calculate lifeline end Y
  const lifelineEndY = layout.lifelineStartY + messages.length * layout.messageHeight + 20

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Header */}
      {(title || description) && (
        <div className={styles.header}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
      )}

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.controlsLeft}>
          <button
            className={styles.controlButton}
            onClick={handleStepBackward}
            disabled={currentStep <= -1}
            title="Step backward"
          >
            ⏮
          </button>
          {isPlaying ? (
            <button
              className={`${styles.controlButton} ${styles.controlButtonPrimary}`}
              onClick={handlePause}
              title="Pause"
            >
              ⏸
            </button>
          ) : (
            <button
              className={`${styles.controlButton} ${styles.controlButtonPrimary}`}
              onClick={handlePlay}
              title="Play"
            >
              ▶
            </button>
          )}
          <button
            className={styles.controlButton}
            onClick={handleStepForward}
            disabled={currentStep >= messages.length - 1}
            title="Step forward"
          >
            ⏭
          </button>
          <button
            className={styles.controlButton}
            onClick={handleReset}
            disabled={currentStep === -1}
            title="Reset"
          >
            ↺
          </button>
        </div>

        <div className={styles.controlsRight}>
          <span className={styles.speedLabel}>Speed:</span>
          <div className={styles.speedButtons}>
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`${styles.speedButton} ${
                  animationSpeed === option.value ? styles.speedButtonActive : ''
                }`}
                onClick={() => handleSpeedChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.stepIndicator}>
          Step {currentStep + 1} / {messages.length}
        </div>
      </div>

      {/* SVG Diagram */}
      <div className={styles.diagramWrapper}>
        <svg
          className={styles.diagram}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
        >
          {/* Defs for arrow markers */}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" className={styles.arrowhead} />
            </marker>
            <marker
              id="arrowhead-active"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" className={styles.arrowheadActive} />
            </marker>
            <marker
              id="arrowhead-left"
              markerWidth="10"
              markerHeight="7"
              refX="1"
              refY="3.5"
              orient="auto"
            >
              <polygon points="10 0, 0 3.5, 10 7" className={styles.arrowhead} />
            </marker>
            <marker
              id="arrowhead-left-active"
              markerWidth="10"
              markerHeight="7"
              refX="1"
              refY="3.5"
              orient="auto"
            >
              <polygon points="10 0, 0 3.5, 10 7" className={styles.arrowheadActive} />
            </marker>
          </defs>

          {/* Lifelines */}
          <g className={styles.lifelines}>
            {participants.map((participant, index) => {
              const x = getParticipantCenterX(index, layout)
              const isActive = activeParticipants.has(participant)
              return (
                <Lifeline
                  key={`lifeline-${participant}`}
                  x={x}
                  startY={layout.participantHeight + layout.padding}
                  endY={lifelineEndY}
                  isActive={isActive}
                />
              )
            })}
          </g>

          {/* Participants */}
          <g className={styles.participants}>
            {participants.map((participant, index) => {
              const x = getParticipantX(index, layout)
              const isActive = activeParticipants.has(participant)
              return (
                <Participant
                  key={`participant-${participant}`}
                  name={participant}
                  x={x}
                  y={layout.padding}
                  width={layout.participantWidth}
                  height={layout.participantHeight}
                  isActive={isActive}
                />
              )
            })}
          </g>

          {/* Messages */}
          <g className={styles.messages}>
            {messages.map((message, index) => {
              const fromIndex = participantIndexMap.get(message.from) ?? 0
              const toIndex = participantIndexMap.get(message.to) ?? 0
              const fromX = getParticipantCenterX(fromIndex, layout)
              const toX = getParticipantCenterX(toIndex, layout)
              const y = getMessageY(index, layout)

              const isHighlighted = index === currentStep
              const isPast = index < currentStep
              const isFuture = index > currentStep

              return (
                <MessageArrow
                  key={message.id}
                  message={message}
                  fromX={fromX}
                  toX={toX}
                  y={y}
                  isHighlighted={isHighlighted}
                  isPast={isPast}
                  isFuture={isFuture}
                  onHover={(msg) => handleMessageHover(msg)}
                />
              )
            })}
          </g>
        </svg>
      </div>

      {/* Tooltip */}
      {hoveredMessage && (
        <Tooltip
          message={hoveredMessage}
          x={tooltipPosition.x}
          y={tooltipPosition.y}
        />
      )}

      {/* Current Message Details */}
      {currentStep >= 0 && currentStep < messages.length && (
        <div className={styles.currentMessage}>
          <div className={styles.currentMessageHeader}>
            <span className={styles.currentMessageStep}>Step {currentStep + 1}</span>
            <span className={styles.currentMessageFlow}>
              {messages[currentStep].from} → {messages[currentStep].to}
            </span>
          </div>
          <div className={styles.currentMessageLabel}>{messages[currentStep].label}</div>
          {messages[currentStep].description && (
            <div className={styles.currentMessageDescription}>
              {messages[currentStep].description}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SequenceDiagram
