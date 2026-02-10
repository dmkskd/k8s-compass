export { useAudio } from './useAudio';
export type { AudioState, AudioControls } from './useAudio';
export type { AudioParams, StrudelAPI, Pattern, CompositionFactory } from './types';
export { AUDIO_ENABLED } from './config';
export {
  audioParams,
  initAudio,
  play,
  stop,
  toggle,
  isAudioEnabled,
  isAudioInitialized,
  isAudioPlaying,
  setFilter,
  setTempo,
  setMasterGain,
  toggleInstrument,
  setInstruments,
} from './strudelEngine';
