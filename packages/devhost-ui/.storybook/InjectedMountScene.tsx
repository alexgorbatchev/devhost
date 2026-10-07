import { useEffect, useState, type JSX } from "react";
import type { InjectedDevtoolsStory } from "./InjectedDevtoolsStory";

interface IInjectedMountSceneProps {
  devtools: InjectedDevtoolsStory;
  hasControls?: boolean;
}

export function InjectedMountScene({ devtools, hasControls = true }: IInjectedMountSceneProps): JSX.Element {
  const [isMounted, setIsMounted] = useState(true);
  useEffect(() => {
    // Mount after the control-plane decorator is ready; Storybook's lifecycle hook owns root cleanup.
    devtools.mount();
  }, [devtools]);
  const toggleDevtools = (): void => {
    if (isMounted) devtools.unmount();
    else devtools.mount();
    setIsMounted(!isMounted);
  };

  if (!hasControls) return <></>;

  return (
    <>
      <p>Host page text</p>
      <button type="button" onClick={toggleDevtools}>
        {isMounted ? "Unmount devtools" : "Mount devtools"}
      </button>
    </>
  );
}
