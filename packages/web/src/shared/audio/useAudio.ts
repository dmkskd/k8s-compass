/**
 * React hook for Strudel audio control
 */
import { useState, useCallback, useEffect } from 'react';
import {
  initAudio,
  play,
  stop,
  toggle,
  isAudioInitialized,
  isAudioPlaying,
  audioParams,
  setFilter,
  setTempo,
  setMasterGain,
  toggleInstrument,
} from './strudelEngine';

export interface AudioState {
  initialized: boolean;
  playing: boolean;
  params: typeof audioParams;
}

export interface AudioControls {
  init: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  setFilter: (cutoff: number, resonance?: number) => void;
  setTempo: (bpm: number) => void;
  setMasterGain: (gain: number) => void;
  toggleInstrument: (name: 'kick' | 'snare' | 'hihat' | 'bass', enabled?: boolean) => void;
}

/**
 * Hook to control Strudel audio
 * 
 * @example
 * const { state, controls } = useAudio();
 * 
 * // Toggle play/stop
 * <button onClick={controls.toggle}>
 *   {state.playing ? '⏹' : '▶'}
 * </button>
 * 
 * // Filter controlled by mouse
 * onMouseMove={(e) => controls.setFilter(e.clientX / window.innerWidth * 4000)}
 */
export function useAudio(): { state: AudioState; controls: AudioControls } {
  const [initialized, setInitialized] = useState(isAudioInitialized());
  const [playing, setPlaying] = useState(isAudioPlaying());
  const [params, setParams] = useState({ ...audioParams });

  // Sync state periodically (audioParams is mutable)
  useEffect(() => {
    const interval = setInterval(() => {
      setInitialized(isAudioInitialized());
      setPlaying(isAudioPlaying());
      setParams({ ...audioParams });
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const handleInit = useCallback(async () => {
    await initAudio();
    setInitialized(true);
  }, []);

  const handlePlay = useCallback(async () => {
    await play();
    setPlaying(true);
  }, []);

  const handleStop = useCallback(() => {
    stop();
    setPlaying(false);
  }, []);

  const handleToggle = useCallback(async () => {
    await toggle();
    setPlaying(isAudioPlaying());
  }, []);

  const handleSetFilter = useCallback((cutoff: number, resonance?: number) => {
    setFilter(cutoff, resonance);
    setParams({ ...audioParams });
  }, []);

  const handleSetTempo = useCallback((bpm: number) => {
    setTempo(bpm);
    setParams({ ...audioParams });
  }, []);

  const handleSetMasterGain = useCallback((gain: number) => {
    setMasterGain(gain);
    setParams({ ...audioParams });
  }, []);

  const handleToggleInstrument = useCallback((name: 'kick' | 'snare' | 'hihat' | 'bass', enabled?: boolean) => {
    toggleInstrument(name, enabled);
    setParams({ ...audioParams });
  }, []);

  return {
    state: { initialized, playing, params },
    controls: {
      init: handleInit,
      play: handlePlay,
      stop: handleStop,
      toggle: handleToggle,
      setFilter: handleSetFilter,
      setTempo: handleSetTempo,
      setMasterGain: handleSetMasterGain,
      toggleInstrument: handleToggleInstrument,
    },
  };
}
