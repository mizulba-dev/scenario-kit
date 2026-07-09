import { Composition, type CalculateMetadataFunction } from "remotion";
import { Demo, type DemoProps } from "./Demo";
import { FPS, totalFrames } from "../lib/timing";

const calculateMetadata: CalculateMetadataFunction<DemoProps> = ({ props }) => ({
  durationInFrames: totalFrames(props.durationSec),
});

export const Root: React.FC = () => (
  <Composition
    id="demo"
    component={Demo}
    width={1920}
    height={1080}
    fps={FPS}
    defaultProps={
      {
        srcName: "rec.mp4",
        durationSec: 10,
        brand: {
          name: "Demo",
          tagline: "tagline",
          url: "example.com",
          bg: "#1E293B",
          accent: "#6366F1",
          text: "#F8FAFC",
        },
      } satisfies DemoProps
    }
    calculateMetadata={calculateMetadata}
  />
);
