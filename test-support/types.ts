export interface IContrastTarget {
  property?: "color" | "borderTopColor" | "textDecorationColor";
  pseudoElement?: "::placeholder";
  useParentBackground?: boolean;
}
