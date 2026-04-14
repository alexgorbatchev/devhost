import type { ReactNode, JSX } from "react";

interface IStoryContainerProps {
  children: ReactNode;
  align?: "left" | "right" | "center";
}

export function StoryContainer({ children, align = "center" }: IStoryContainerProps): JSX.Element {
  let justifyContent = "center";
  if (align === "left") {
    justifyContent = "flex-start";
  } else if (align === "right") {
    justifyContent = "flex-end";
  }

  return (
    <div
      data-testid="StoryContainer"
      style={{
        border: "1px dashed rgba(150, 150, 150, 0.4)",
        borderRadius: "4px",
        display: "flex",
        justifyContent,
        minHeight: "100px",
        padding: "50px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "4px",
          left: "8px",
          fontSize: "10px",
          color: "rgba(150, 150, 150, 0.6)",
          fontFamily: "monospace",
        }}
      >
        StoryContainer ({align})
      </div>
      {children}
    </div>
  );
}
