import { CaptureSourceCardSurface } from "../CaptureSourceCardSurface";

type Meta<TComponent> = {
  component: TComponent;
  title: string;
};

type StoryObj<TMeta> = {
  args: TMeta extends { component: (props: infer TProps) => unknown } ? TProps : never;
  play?: () => Promise<void>;
};

const captureSourceLocation = {
  columnNumber: 1,
  componentName: "CaptureSourceCardSurface",
  fileName: "/src/components/CaptureSourceCardSurface.tsx",
  lineNumber: 1,
};

const meta: Meta<typeof CaptureSourceCardSurface> = {
  component: CaptureSourceCardSurface,
  title: "@alexgorbatchev/devhost-docs/components/CaptureSourceCardSurface",
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    source: captureSourceLocation,
  },
  play: async (): Promise<void> => {},
};

export { Default as CaptureSourceCardSurface };
