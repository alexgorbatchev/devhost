import type { StoryContext } from "@storybook/react";
import { useEffect, useState, type ComponentType, type JSX } from "react";

import {
  factory_appStack,
  factory_configEditorStack,
  factory_designOverviewStack,
} from "../src/devtools/components/stories/fixtures";
import { installDevhostStackMock, type IDevhostStackMock, type IDevhostStoryStack } from "./installDevhostStackMock";
import {
  installServiceRecoveryMock,
  type IServiceRecoveryMock,
  type IServiceRecoveryPage,
} from "./installServiceRecoveryMock";

type DevhostStoryStackFactory = () => IDevhostStoryStack;

interface IDevhostStackDecoratorProps {
  createStack: DevhostStoryStackFactory;
  Story: ComponentType;
}

interface IServiceRecoveryDecoratorProps {
  hasWorktreeFailure?: boolean;
  pageService?: IServiceRecoveryPage;
  Story: ComponentType;
}

const apiPageService: IServiceRecoveryPage = { serviceName: "api" };

/**
 * Runs a story against a mocked devhost control plane, selected by story `parameters`: `designOverview`,
 * `serviceRecovery`, `worktreeRecovery`, `configEditor`, or the default App stack. The story renders once the mock is installed.
 */
export function withDevhostMock(Story: ComponentType, context: StoryContext): JSX.Element {
  if (context.parameters.worktreeRecovery === true) {
    return <ServiceRecoveryDecorator Story={Story} hasWorktreeFailure />;
  }
  if (context.parameters.serviceRecovery === true) {
    return <ServiceRecoveryDecorator Story={Story} pageService={context.parameters.pageService} />;
  }
  if (context.parameters.configEditor === true) {
    return <DevhostStackDecorator Story={Story} createStack={factory_configEditorStack} />;
  }
  if (context.parameters.designOverview === true) {
    return <DevhostStackDecorator Story={Story} createStack={factory_designOverviewStack} />;
  }
  return <DevhostStackDecorator Story={Story} createStack={factory_appStack} />;
}

function DevhostStackDecorator({ createStack, Story }: IDevhostStackDecoratorProps): JSX.Element | null {
  const [mock, setMock] = useState<IDevhostStackMock | null>(null);

  useEffect(() => {
    const installedMock: IDevhostStackMock = installDevhostStackMock(createStack());

    setMock(installedMock);

    return installedMock.uninstall;
  }, [createStack]);

  return mock === null ? null : <Story />;
}

function ServiceRecoveryDecorator({
  hasWorktreeFailure = false,
  pageService = apiPageService,
  Story,
}: IServiceRecoveryDecoratorProps): JSX.Element | null {
  const [mock, setMock] = useState<IServiceRecoveryMock | null>(null);

  useEffect(() => {
    const installedMock: IServiceRecoveryMock = installServiceRecoveryMock(hasWorktreeFailure, pageService);

    setMock(installedMock);

    return installedMock.uninstall;
  }, [hasWorktreeFailure, pageService]);

  return mock === null ? null : (
    <>
      <button type="button" hidden={hasWorktreeFailure} onClick={mock.crash}>
        Crash api
      </button>
      <Story />
    </>
  );
}
