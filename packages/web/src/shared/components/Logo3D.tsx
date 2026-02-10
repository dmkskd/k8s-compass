import { useRef, useEffect } from 'react'
import styles from './Logo3D.module.css'

export function Logo3D() {
  const logoRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef(0)
  const frameRef = useRef<number>()

  useEffect(() => {
    const animate = () => {
      rotationRef.current -= 0.5 // Anti-clockwise
      if (logoRef.current) {
        logoRef.current.style.transform = `rotate(${rotationRef.current}deg)`
      }
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return (
    <div className={styles.container}>
      <div ref={logoRef} className={styles.logo}>
        <svg viewBox="0 0 722 702" width="36" height="36">
          <g transform="translate(361, 351)">
            <path
              fill="#326ce5"
              d="M-359.5,0c0,-193.3 156.7,-350 350,-350c193.3,0 350,156.7 350,350c0,193.3 -156.7,350 -350,350c-193.3,0 -350,-156.7 -350,-350"
              transform="scale(1.03)"
            />
            <path
              fill="#fff"
              d="M-9.5,-262.5l-45.8,141.3l-148.5,-17.5l97.8,113.5l-97.8,113.5l148.5,-17.5l45.8,141.3l45.8,-141.3l148.5,17.5l-97.8,-113.5l97.8,-113.5l-148.5,17.5z"
            />
            <circle fill="#326ce5" cx="-9.5" cy="0" r="65"/>
          </g>
        </svg>
      </div>
    </div>
  )
}
