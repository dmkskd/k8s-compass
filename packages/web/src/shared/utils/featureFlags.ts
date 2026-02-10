/**
 * Feature flags for controlling which features are visible to users.
 * 
 * Usage:
 * - Add ?features=control-plane to URL to enable specific features
 * - Add ?features=all to enable all features
 * - Features not in the URL are hidden by default (unless in ENABLED_BY_DEFAULT)
 * 
 * For development, you can also set localStorage:
 *   localStorage.setItem('k8s-compass-features', 'control-plane')
 */

import type { AppSection } from '../types'

// Feature configuration with metadata
interface FeatureConfig {
  id: AppSection
  experimental?: boolean  // Shows "experimental" badge on tab
}

// All available features with their configuration
const FEATURE_CONFIG: FeatureConfig[] = [
  { id: 'home' },
  { id: 'api-explorer' },
  { id: 'control-plane', experimental: true },
  { id: 'releases' },
  { id: 'learn' },
  { id: 'analytics' },
]

// Features that are enabled by default (stable features)
const ENABLED_BY_DEFAULT: AppSection[] = [
  'home',
  'api-explorer',
  'releases',
  'learn',
  'analytics',
]

// All available features (including experimental)
const ALL_FEATURES: AppSection[] = FEATURE_CONFIG.map(f => f.id)

/**
 * Check if a feature is marked as experimental
 */
export function isExperimental(feature: AppSection): boolean {
  const config = FEATURE_CONFIG.find(f => f.id === feature)
  return config?.experimental ?? false
}

/**
 * Get enabled features from URL params or localStorage
 */
export function getEnabledFeatures(): Set<AppSection> {
  // Check URL params first
  const urlParams = new URLSearchParams(window.location.search)
  const featuresParam = urlParams.get('features')
  
  if (featuresParam) {
    if (featuresParam === 'all') {
      return new Set(ALL_FEATURES)
    }
    const features = featuresParam.split(',').filter(f => 
      ALL_FEATURES.includes(f as AppSection)
    ) as AppSection[]
    // Merge with defaults
    return new Set([...ENABLED_BY_DEFAULT, ...features])
  }
  
  // Check localStorage
  const stored = localStorage.getItem('k8s-compass-features')
  if (stored) {
    if (stored === 'all') {
      return new Set(ALL_FEATURES)
    }
    const features = stored.split(',').filter(f => 
      ALL_FEATURES.includes(f as AppSection)
    ) as AppSection[]
    return new Set([...ENABLED_BY_DEFAULT, ...features])
  }
  
  // Return defaults
  return new Set(ENABLED_BY_DEFAULT)
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: AppSection): boolean {
  return getEnabledFeatures().has(feature)
}

/**
 * Get list of enabled features for display
 */
export function getEnabledFeaturesList(): AppSection[] {
  return ALL_FEATURES.filter(f => getEnabledFeatures().has(f))
}

/**
 * Enable a feature (persists to localStorage)
 */
export function enableFeature(feature: AppSection): void {
  const current = getEnabledFeatures()
  current.add(feature)
  localStorage.setItem('k8s-compass-features', Array.from(current).join(','))
}

/**
 * Disable a feature (persists to localStorage)
 */
export function disableFeature(feature: AppSection): void {
  const current = getEnabledFeatures()
  current.delete(feature)
  localStorage.setItem('k8s-compass-features', Array.from(current).join(','))
}
