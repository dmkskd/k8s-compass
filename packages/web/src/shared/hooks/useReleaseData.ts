import { useState, useEffect } from 'react'
import type { ReleaseNotes, ReleaseIndex } from '../types'

export function useReleaseIndex() {
  const [index, setIndex] = useState<ReleaseIndex | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    fetch('/data/k8s/releases/index.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load release index')
        return res.json()
      })
      .then(data => {
        setIndex(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err)
        setLoading(false)
      })
  }, [])

  return { index, loading, error }
}

export function useReleaseNotes(version: string | undefined) {
  const [release, setRelease] = useState<ReleaseNotes | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!version) {
      setRelease(null)
      return
    }

    setLoading(true)
    setError(null)

    fetch(`/data/k8s/releases/${version}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load release ${version}`)
        return res.json()
      })
      .then(data => {
        setRelease(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err)
        setLoading(false)
      })
  }, [version])

  return { release, loading, error }
}

export function useAllReleases() {
  const { index, loading: indexLoading, error: indexError } = useReleaseIndex()
  const [releases, setReleases] = useState<ReleaseNotes[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!index) return

    setLoading(true)
    
    Promise.all(
      index.releases.map(r => 
        fetch(`/data/k8s/releases/${r.file}`)
          .then(res => res.json())
      )
    )
      .then(data => {
        setReleases(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err)
        setLoading(false)
      })
  }, [index])

  return { 
    releases, 
    loading: indexLoading || loading, 
    error: indexError || error 
  }
}
