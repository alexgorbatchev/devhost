export interface IContrastTarget {
  property?: "backgroundColor" | "color" | "borderTopColor" | "textDecorationColor";
  pseudoElement?: "::placeholder";
  useParentBackground?: boolean;
}
export type TestProcessSignal = NodeJS.Signals | 0;

// An animated image as a browser decodes it.
export interface IAnimation {
  width: number;
  height: number;
  // How many times the animation plays again after the first time; Infinity when it loops forever.
  repetitionCount: number;
  // Seconds, the frames' durations added up.
  duration: number;
  // Each frame's average color as red, green and blue from 0 to 255, in the order the frames play.
  colors: number[][];
}
