/**
 * Strudel Audio Engine
 * 
 * Simple integration using @strudel/web with mutable params
 * that patterns read on each scheduler tick (~50ms).
 */

import type { AudioParams } from './types';
import { AUDIO_ENABLED } from './config';

// Mutable params - Strudel patterns read these each cycle
export const audioParams: AudioParams = {
  // Filter
  lpfCutoff: 2000,
  lpfResonance: 5,
  
  // Instruments (true = playing)
  kick: true,
  snare: true,
  hihat: true,
  bass: true,
  
  // Global
  tempo: 90,
  masterGain: 0.7,
};

// Track initialization state
let isInitialized = false;
let isPlaying = false;

// Store the strudel module
let strudel: typeof import('@strudel/web') | null = null;

/**
 * Check if audio feature is enabled
 */
export function isAudioEnabled(): boolean {
  return AUDIO_ENABLED;
}

/**
 * Initialize Strudel - must be called after user interaction (browser audio policy)
 */
export async function initAudio(): Promise<void> {
  if (!AUDIO_ENABLED) return;
  if (isInitialized) return;
  
  try {
    // Dynamic import to avoid loading until needed
    strudel = await import('@strudel/web');
    await strudel.initStrudel();
    isInitialized = true;
    console.log('[Strudel] Initialized');
  } catch (err) {
    console.error('[Strudel] Failed to initialize:', err);
    // Don't throw - gracefully degrade
  }
}

/**
 * Check if audio is initialized
 */
export function isAudioInitialized(): boolean {
  return isInitialized;
}

/**
 * Check if audio is currently playing
 */
export function isAudioPlaying(): boolean {
  return isPlaying;
}

/**
 * Start playing the pattern
 */
export async function play(): Promise<void> {
  if (!AUDIO_ENABLED) return;
  
  if (!isInitialized) {
    await initAudio();
  }
  
  if (!strudel) return;
  
  // Always stop any existing audio first (singleton pattern)
  if (isPlaying) {
    strudel.hush();
  }
  
  try {
    const { note, s, stack, signal } = strudel;
    
    // Create signals that read from audioParams
    const lpf = signal(() => audioParams.lpfCutoff);
    const tempo = signal(() => audioParams.tempo);
    
    stack(
      // Kick
      s("bd*4")
        .gain(signal(() => audioParams.kick ? 0.8 * audioParams.masterGain : 0))
        .lpf(lpf.mul(0.5)),
      
      // Snare
      s("~ sd ~ sd")
        .gain(signal(() => audioParams.snare ? 0.6 * audioParams.masterGain : 0))
        .lpf(lpf),
      
      // Hi-hat
      s("hh*8")
        .gain(signal(() => audioParams.hihat ? 0.4 * audioParams.masterGain : 0))
        .lpf(lpf),
      
      // Bass
      note("<c2 e2 g2 a2>")
        .s("sawtooth")
        .gain(signal(() => audioParams.bass ? 0.5 * audioParams.masterGain : 0))
        .lpf(lpf.mul(0.3))
        .decay(0.2)
        .sustain(0.3),
    )
    .cpm(tempo)
    .play();
    
    isPlaying = true;
    console.log('[Strudel] Playing');
  } catch (err) {
    console.error('[Strudel] Failed to play:', err);
    throw err;
  }
}

/**
 * Stop all audio
 */
export function stop(): void {
  if (!AUDIO_ENABLED) return;
  if (!isInitialized || !isPlaying || !strudel) return;
  
  try {
    strudel.hush();
    isPlaying = false;
    console.log('[Strudel] Stopped');
  } catch (err) {
    console.error('[Strudel] Failed to stop:', err);
  }
}

/**
 * Toggle play/stop
 */
export async function toggle(): Promise<void> {
  if (isPlaying) {
    stop();
  } else {
    await play();
  }
}

// --- Parameter setters (for UI binding) ---

export function setFilter(cutoff: number, resonance?: number): void {
  audioParams.lpfCutoff = Math.max(100, Math.min(8000, cutoff));
  if (resonance !== undefined) {
    audioParams.lpfResonance = Math.max(0, Math.min(30, resonance));
  }
}

export function setTempo(bpm: number): void {
  // Narrower range for smoother transitions
  audioParams.tempo = Math.max(80, Math.min(120, bpm));
}

export function setMasterGain(gain: number): void {
  audioParams.masterGain = Math.max(0, Math.min(1, gain));
}

export function toggleInstrument(name: keyof Pick<AudioParams, 'kick' | 'snare' | 'hihat' | 'bass'>, enabled?: boolean): void {
  audioParams[name] = enabled ?? !audioParams[name];
}

export function setInstruments(instruments: Partial<Pick<AudioParams, 'kick' | 'snare' | 'hihat' | 'bass'>>): void {
  Object.assign(audioParams, instruments);
}
