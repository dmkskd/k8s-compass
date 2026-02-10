import { useState, useEffect, useCallback } from 'react'
import styles from './RotatingStatCard.module.css'

export interface StatItem {
  value: number
  label: string
  sublabel?: string
  theme: 'features' | 'stable' | 'beta' | 'alpha' | 'changes' | 'bugs' | 'api' | 'urgent' | 'security' | 'deprecations' | 'other' | 'breaking'
}

interface RotatingStatCardProps {
  items: StatItem[]
  interval?: number
}

export function RotatingStatCard({ items, interval = 10000 }: RotatingStatCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [animState, setAnimState] = useState<'active' | 'exiting' | 'entering'>('active')
  const [paused, setPaused] = useState(false)

  const rotate = useCallback(() => {
    setAnimState('exiting')
    setTimeout(() => {
      setCurrentIndex(prev => (prev + 1) % items.length)
      setAnimState('entering')
      // Small delay then fade in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimState('active')
        })
      })
    }, 800)
  }, [items.length])

  useEffect(() => {
    if (paused) return
    const timer = setInterval(rotate, interval)
    return () => clearInterval(timer)
  }, [paused, interval, rotate])

  const jumpTo = (index: number) => {
    if (index === currentIndex) return
    setAnimState('exiting')
    setTimeout(() => {
      setCurrentIndex(index)
      setAnimState('entering')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimState('active')
        })
      })
    }, 800)
  }

  const currentItem = items[currentIndex]

  return (
    <div 
      className={`${styles.card} ${styles[currentItem.theme]} ${paused ? styles.paused : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={`${styles.content} ${styles[animState]}`}>
        <div className={styles.number}>{currentItem.value}</div>
        <div className={styles.label}>{currentItem.label}</div>
        {currentItem.sublabel && (
          <div className={styles.sublabel}>{currentItem.sublabel}</div>
        )}
      </div>
      
      {items.length > 1 && (
        <div className={styles.dots}>
          {items.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} ${i === currentIndex ? styles.activeDot : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                jumpTo(i)
              }}
              aria-label={`Show stat ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
