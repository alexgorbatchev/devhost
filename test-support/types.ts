export interface IContrastTarget {
  property?: "backgroundColor" | "color" | "borderTopColor" | "textDecorationColor";
  pseudoElement?: "::placeholder";
  useParentBackground?: boolean;
}
