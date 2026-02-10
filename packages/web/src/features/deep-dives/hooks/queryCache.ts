/**
 * Query Cache
 *
 * Simple caching layer for DuckDB queries to prevent redundant database calls.
 * Uses a Map-based cache with configurable TTL.
 *
 * @module features/deep-dives/hooks/queryCache
 */

// =============================================================================
// Types
// =============================================================================

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

interface CacheOptions {
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl?: number
  /** Maximum number of entries (default: 100) */
  maxEntries?: number
}

// =============================================================================
// Cache Implementation
// =============================================================================

const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MAX_ENTRIES = 100

class QueryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map()
  private ttl: number
  private maxEntries: number

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /**
   * Generate a cache key from query parameters
   */
  private generateKey(prefix: string, params: unknown[]): string {
    return `${prefix}:${JSON.stringify(params)}`
  }

  /**
   * Get a cached value if it exists and hasn't expired
   */
  get<T>(prefix: string, params: unknown[]): T | null {
    const key = this.generateKey(prefix, params)
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * Set a cached value
   */
  set<T>(prefix: string, params: unknown[], data: T): void {
    const key = this.generateKey(prefix, params)
    const now = Date.now()

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest()
    }

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.ttl,
    })
  }

  /**
   * Check if a key exists and is valid
   */
  has(prefix: string, params: unknown[]): boolean {
    return this.get(prefix, params) !== null
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(prefix: string, params: unknown[]): void {
    const key = this.generateKey(prefix, params)
    this.cache.delete(key)
  }

  /**
   * Invalidate all entries with a given prefix
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${prefix}:`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxEntries: number; ttl: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttl: this.ttl,
    }
  }

  /**
   * Evict the oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTimestamp = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

// Global cache instance for deep dive queries
export const deepDiveQueryCache = new QueryCache({
  ttl: 5 * 60 * 1000, // 5 minutes
  maxEntries: 100,
})

// =============================================================================
// Cache Prefixes
// =============================================================================

export const CACHE_PREFIXES = {
  KEP_STATUS: 'kep-status',
  FEATURE_GATE: 'feature-gate',
  FEATURE_GATES: 'feature-gates',
  KUBELET_FLAGS: 'kubelet-flags',
  COMPONENT_FLAGS: 'component-flags',
} as const

// =============================================================================
// Cached Query Helpers
// =============================================================================

/**
 * Get or set a cached value
 * If the value exists in cache, return it
 * Otherwise, execute the fetcher and cache the result
 */
export async function getCachedOrFetch<T>(
  prefix: string,
  params: unknown[],
  fetcher: () => Promise<T>
): Promise<T> {
  // Check cache first
  const cached = deepDiveQueryCache.get<T>(prefix, params)
  if (cached !== null) {
    return cached
  }

  // Fetch and cache
  const data = await fetcher()
  deepDiveQueryCache.set(prefix, params, data)
  return data
}

export default QueryCache
