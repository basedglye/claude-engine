// Pure types for the diegetic HOTELSOFT screen framework. Zero DOM, zero
// Three.js, zero floats — everything here crosses the sim boundary as
// integers or plain data (see docs/PHASE-H1.md "The screen contract").

/** All screen coordinates are integer pixels on the app's fixed logical
 *  surface (SCREEN_W x SCREEN_H). No floats cross the sim boundary. */
export const SCREEN_W = 640;
export const SCREEN_H = 480;
/** Embedded bitmap font metrics — glyphs are 8x8; layout math is integer. */
export const GLYPH_W = 8;
export const GLYPH_H = 8;

/** Input delivered to reduce() by the sim's screenSystem. Already validated:
 *  the submitting actor holds terminal focus and is in range. */
export type ScreenInput =
  | { kind: "key"; code: string }
  | { kind: "click"; px: number; py: number }
  | { kind: "open" }
  | { kind: "tickPulse" };

/** A rectangle in surface pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Retained paint tree — data, not code. The host interprets it; the sim
 *  never sees it. Every node is JSON-plain. Colors are palette indices into
 *  the 16-colour HOTELSOFT palette (the host owns the RGB values; the sim
 *  knows only indices). */
export type PaintNode =
  | { kind: "panel"; rect: Rect; fill: number; border?: number }
  | { kind: "text"; x: number; y: number; text: string; color: number; bg?: number }
  | { kind: "button"; rect: Rect; label: string; color: number; pressed?: boolean }
  | { kind: "table"; rect: Rect; cols: number[]; rows: string[][]; selRow?: number; color: number }
  | { kind: "hline"; x: number; y: number; w: number; color: number }
  /** 1-px checkerboard strip — the readability probe's calibration target.
   *  Painted by the shell chrome on every app. */
  | { kind: "calib"; rect: Rect };
