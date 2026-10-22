import { createContext } from "react";

/**
 * Re-enters the enclosing AnnotationTopLayer in the browser's top layer, keeping its order relative to the devtools
 * root. Null outside an annotation layer.
 */
export const AnnotationTopLayerContext = createContext<VoidFunction | null>(null);
