/**
 * Stub for troika-three-text to prevent worker issues in single-file mode.
 * 
 * troika-three-text uses Web Workers with blob URLs which don't work when
 * running from file:// protocol. This stub provides a no-op implementation
 * so the bundle doesn't include the actual troika code.
 */

// Export empty implementations that drei's Text component expects
export class Text {
  constructor() {
    console.warn('[troika-stub] Text component is not available in single-file mode')
  }
}

export function preloadFont() {
  // no-op
}

export function dumpSDFTextures() {
  return []
}

// Default export for compatibility
export default { Text, preloadFont, dumpSDFTextures }
