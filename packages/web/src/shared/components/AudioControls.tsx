/**
 * Audio Controls Component
 * 
 * Minimal UI for Strudel audio - play/stop, filter, instruments
 */
import { useAudio, AUDIO_ENABLED } from '../audio';
import styles from './AudioControls.module.css';

export function AudioControls() {
  const { state, controls } = useAudio();

  // Don't render anything if audio is disabled
  if (!AUDIO_ENABLED) {
    return null;
  }

  return (
    <div className={styles.container}>
      {/* Play/Stop button */}
      <button
        className={`${styles.playButton} ${state.playing ? styles.playing : ''}`}
        onClick={controls.toggle}
        title={state.playing ? 'Stop audio' : 'Play audio'}
      >
        {state.playing ? '⏹' : '▶'}
      </button>

      {/* Only show controls when playing */}
      {state.playing && (
        <div className={styles.controls}>
          {/* Filter slider */}
          <div className={styles.slider}>
            <label>Filter</label>
            <input
              type="range"
              min="100"
              max="8000"
              value={state.params.lpfCutoff}
              onChange={(e) => controls.setFilter(Number(e.target.value))}
            />
          </div>

          {/* Tempo slider */}
          <div className={styles.slider}>
            <label>Tempo</label>
            <input
              type="range"
              min="80"
              max="120"
              value={state.params.tempo}
              onChange={(e) => controls.setTempo(Number(e.target.value))}
            />
          </div>

          {/* Instrument toggles */}
          <div className={styles.instruments}>
            {(['kick', 'snare', 'hihat', 'bass'] as const).map((inst) => (
              <button
                key={inst}
                className={`${styles.instButton} ${state.params[inst] ? styles.active : ''}`}
                onClick={() => controls.toggleInstrument(inst)}
                title={`Toggle ${inst}`}
              >
                {inst[0].toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
