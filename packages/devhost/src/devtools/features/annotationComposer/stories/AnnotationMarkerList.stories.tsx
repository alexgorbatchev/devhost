import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { AnnotationMarkerList } from "../AnnotationMarkerList";

const meta: Meta<typeof AnnotationMarkerList> = {
  title: "@alexgorbatchev/devhost/devtools/features/annotationComposer/AnnotationMarkerList",
  component: AnnotationMarkerList,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align="left">
          <AnnotationMarkerList {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
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

export const SingleItem: Story = {
  args: {
    items: [
      {
        label: "div.container",
        markerNumber: 1,
      },
    ],
    testId: "AnnotationMarkerList",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const markerList = canvas.getByTestId("AnnotationMarkerList");
    const markerItems = within(markerList).getAllByRole("listitem");

    await expect(markerList).toBeInTheDocument();
    await expect(markerItems).toHaveLength(1);
    await expect(markerItems[0]).toHaveTextContent("#1 div.container");
  },
};

export const LongList: Story = {
  args: {
    items: Array.from({ length: 10 }, (_, i) => ({
      label: `element.item-${i + 1}`,
      markerNumber: i + 1,
    })),
    testId: "AnnotationMarkerList",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const markerList = canvas.getByTestId("AnnotationMarkerList");
    const markerItems = within(markerList).getAllByRole("listitem");

    await expect(markerList).toBeInTheDocument();
    await expect(markerItems).toHaveLength(10);
  },
};
