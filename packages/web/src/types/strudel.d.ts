// Type declarations for @strudel/web
declare module '@strudel/web' {
  export function initStrudel(): Promise<void>;
  export function hush(): void;
  
  // Pattern functions
  export function note(pattern: string): Pattern;
  export function s(pattern: string): Pattern;
  export function stack(...patterns: Pattern[]): Pattern;
  export function silence(): Pattern;
  export function signal(fn: () => number): Signal;
  
  // Signal type - continuous value that can be used as pattern
  interface Signal extends Pattern {
    mul(value: number): Signal;
    add(value: number): Signal;
    range(min: number, max: number): Signal;
  }
  
  // Pattern type
  interface Pattern {
    play(): void;
    stop(): void;
    gain(value: number | Signal): Pattern;
    lpf(value: number | Signal): Pattern;
    lpq(value: number | Signal): Pattern;
    pan(value: string | number): Pattern;
    decay(value: number): Pattern;
    sustain(value: number): Pattern;
    cpm(value: number | Signal): Pattern;
    mask(value: number | Signal): Pattern;
    s(value: string): Pattern;
    mul(value: number): Pattern;
  }
}
