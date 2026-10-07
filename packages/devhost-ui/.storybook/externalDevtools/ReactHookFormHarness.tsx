import { DevTool } from "@hookform/devtools";
import type { JSX } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { ExternalDevtoolsToolbar } from "./ExternalDevtoolsToolbar";

interface IReactHookFormHarnessProps {
  globals: Partial<Record<string, unknown>>;
  hasSecondForm?: boolean;
}

export function ReactHookFormHarness({ globals, hasSecondForm = false }: IReactHookFormHarnessProps): JSX.Element {
  const profile = useForm({ mode: "onChange", defaultValues: { email: "first@example.test" } });
  const account = useForm({ mode: "onChange", defaultValues: { username: "second-user" } });
  const [isEnabled, setIsEnabled] = useState(true);
  const [isToolbarMounted, setIsToolbarMounted] = useState(true);
  const [isInspectorMounted, setIsInspectorMounted] = useState(true);
  const [inspectorGeneration, setInspectorGeneration] = useState(0);

  return (
    <div data-testid="ReactHookFormHarness">
      <button type="button" onClick={() => setIsEnabled((value) => !value)}>
        Toggle aggregation
      </button>
      <button type="button" onClick={() => setIsToolbarMounted((value) => !value)}>
        Toggle toolbar mount
      </button>
      <button type="button" onClick={() => setIsInspectorMounted((value) => !value)}>
        Toggle profile inspector
      </button>
      <button type="button" onClick={() => setInspectorGeneration((value) => value + 1)}>
        Remount profile inspector
      </button>
      <form aria-label="Profile form">
        <label>
          Email
          <input {...profile.register("email", { required: "Email required" })} />
        </label>
      </form>
      <div data-testid="ReactHookFormHarness--profile-inspector">
        {isInspectorMounted ? (
          <DevTool
            key={inspectorGeneration}
            id="profile"
            control={profile.control}
            placement={hasSecondForm ? "top-left" : "top-right"}
          />
        ) : null}
      </div>
      {hasSecondForm ? (
        <>
          <form aria-label="Account form">
            <label>
              Username
              <input {...account.register("username", { required: "Username required" })} />
            </label>
          </form>
          <div data-testid="ReactHookFormHarness--account-inspector">
            <DevTool id="account" control={account.control} placement="top-right" />
          </div>
        </>
      ) : null}
      {isToolbarMounted ? <ExternalDevtoolsToolbar globals={globals} isEnabled={isEnabled} stackName="forms" /> : null}
    </div>
  );
}
