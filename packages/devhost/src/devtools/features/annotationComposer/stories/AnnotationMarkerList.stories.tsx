import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { AnnotationMarkerList } from "../AnnotationMarkerList";

const meta: Meta<typeof AnnotationMarkerList> = {
  title: "@alexgorbatchev/devhost/devtools/features/annotationComposer/AnnotationMarkerList",
  component: AnnotationMarkerList,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <AnnotationMarkerList {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    items: [
      {
        label: 'button "Save changes"',
        markerNumber: 1,
      },
      {
        label: 'input "Email address"',
        markerNumber: 2,
      },
    ],
    testId: "AnnotationMarkerList",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const markerList = canvas.getByTestId("AnnotationMarkerList");
    const markerItems = within(markerList).getAllByRole("listitem");

    await expect(markerList).toBeInTheDocument();
    await expect(markerItems).toHaveLength(2);
    await expect(markerItems[0]).toHaveTextContent('#1 button "Save changes"');
    await expect(markerItems[1]).toHaveTextContent('#2 input "Email address"');
  },
};

export { Default as AnnotationMarkerList };
