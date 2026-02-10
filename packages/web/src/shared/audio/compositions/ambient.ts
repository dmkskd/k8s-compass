/**
 * Ambient Composition
 * 
 * A generative ambient pattern for K8s Compass.
 * Edit this file to change the music!
 * 
 * Available params (read from audioParams):
 * - lpfCutoff: 100-8000 (filter frequency)
 * - lpfResonance: 0-30 (filter resonance)
 * - kick, snare, hihat, bass: boolean (instrument on/off)
 * - tempo: 60-180 (BPM)
 * - masterGain: 0-1 (volume)
 */

import type { AudioParams, StrudelAPI } from '../types';

/**
 * Create the ambient pattern
 * 
 * @param api - Strudel API functions (s, note, stack, etc.)
 * @param params - Mutable params object (read each scheduler tick)
 */
export function createPattern(api: StrudelAPI, params: AudioParams) {
  const { note, s, stack } = api;

  return stack(
    // Kick - steady pulse
    s("bd*4")
      .gain(() => params.kick ? 0.8 * params.masterGain : 0)
      .lpf(() => params.lpfCutoff * 0.5),

    // Snare - offbeat
    s("~ sd ~ sd")
      .gain(() => params.snare ? 0.6 * params.masterGain : 0)
      .lpf(() => params.lpfCutoff),

    // Hi-hat - faster rhythm
    s("hh*8")
      .gain(() => params.hihat ? 0.4 * params.masterGain : 0)
      .lpf(() => params.lpfCutoff)
      .pan("[0.3 0.7]*4"),

    // Bass - melodic element
    note("<c2 [e2 g2] a2 [g2 e2]>")
      .s("sawtooth")
      .gain(() => params.bass ? 0.5 * params.masterGain : 0)
      .lpf(() => params.lpfCutoff * 0.3)
      .lpq(() => params.lpfResonance)
      .decay(0.2)
      .sustain(0.3),
  )
  .cpm(() => params.tempo);
}
