import type { ComponentType, JSX } from "react";

import { DevhostMockShell } from "../../devhostMock/DevhostMockShell";

interface IDevhostMockDecoratorProps {
  Story: ComponentType;
}

export function withDevhostMock(Story: ComponentType): JSX.Element {
  return <DevhostMockDecorator Story={Story} />;
}

function DevhostMockDecorator({ Story }: IDevhostMockDecoratorProps): JSX.Element {
  return (
    <DevhostMockShell scenarioId="annotation">
      <>
        <Story />
      </>
    </DevhostMockShell>
  );
}
