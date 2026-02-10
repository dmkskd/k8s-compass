/**
 * Audio types for Strudel integration
 */

export interface AudioParams {
  // Filter
  lpfCutoff: number;
  lpfResonance: number;
  
  // Instruments
  kick: boolean;
  snare: boolean;
  hihat: boolean;
  bass: boolean;
  
  // Global
  tempo: number;
  masterGain: number;
}

export interface Pattern {
  play(): void;
  stop(): void;
  gain(value: number | (() => number)): Pattern;
  lpf(value: number | (() => number)): Pattern;
  lpq(value: number | (() => number)): Pattern;
  pan(value: string | number): Pattern;
  decay(value: number): Pattern;
  sustain(value: number): Pattern;
  cpm(value: number | (() => number)): Pattern;
  mask(value: number | (() => number)): Pattern;
  s(value: string): Pattern;
}

export interface StrudelAPI {
  initStrudel(): Promise<void>;
  hush(): void;
  note(pattern: string): Pattern;
  s(pattern: string): Pattern;
  stack(...patterns: Pattern[]): Pattern;
}

export type CompositionFactory = (api: StrudelAPI, params: AudioParams) => Pattern;
