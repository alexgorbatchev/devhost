import type { Root } from "hast";

export type HastTreeTransformer = (tree: Root) => void;
