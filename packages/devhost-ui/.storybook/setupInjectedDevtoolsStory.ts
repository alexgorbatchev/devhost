import type { StoryContext } from "@storybook/react";
import type { UnmountDevtools } from "../src/devtools/renderDevtools";
import { InjectedDevtoolsStory } from "./InjectedDevtoolsStory";

export function setupInjectedDevtoolsStory(context: StoryContext): UnmountDevtools {
  const devtools = new InjectedDevtoolsStory();
  context.loaded.injectedDevtools = devtools;
  // Storybook owns the independent root; React effect cleanup would unmount it during another root's commit.
  return devtools.unmount;
}

export function readInjectedDevtoolsStory(context: StoryContext): InjectedDevtoolsStory {
  const devtools: unknown = context.loaded.injectedDevtools;
  if (!(devtools instanceof InjectedDevtoolsStory)) {
    throw new Error("The story did not set up its injected devtools root.");
  }
  return devtools;
}
