import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Brand } from "../lib/brand";
import { INTRO_FRAMES, OUTRO_FRAMES, videoFrames } from "../lib/timing";

export type DemoProps = {
  srcName: string;
  durationSec: number;
  brand: Brand;
};

const fontFamily = "ui-sans-serif, -apple-system, sans-serif";

const Wordmark: React.FC<{ brand: Brand; size?: number }> = ({ brand, size = 96 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
    <div
      style={{
        width: size * 0.9,
        height: size * 0.9,
        borderRadius: size * 0.22,
        background: brand.accent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.52,
        fontWeight: 800,
        fontFamily,
      }}
    >
      {brand.name.charAt(0)}
    </div>
    <div
      style={{
        color: brand.text,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        fontFamily,
      }}
    >
      {brand.name}
    </div>
  </div>
);

const centered: CSSProperties = {
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
};

const Intro: React.FC<{ brand: Brand }> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [INTRO_FRAMES - 12, INTRO_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        ...centered,
        gap: 28,
        opacity: fadeOut,
        transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      <Wordmark brand={brand} />
      <div style={{ color: brand.text, opacity: 0.75, fontSize: 34, fontFamily }}>
        {brand.tagline}
      </div>
    </AbsoluteFill>
  );
};

const WindowFrame: React.FC<{
  brand: Brand;
  srcName: string;
  durationFrames: number;
}> = ({ brand, srcName, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  // 全編でわずかに寄る。クリック連動ズームの代わりの最小限の動き
  const drift = interpolate(frame, [0, durationFrames], [1, 1.035]);
  const fadeOut = interpolate(frame, [durationFrames - 12, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
  });

  const winW = 1520;
  const barH = 44;

  return (
    <AbsoluteFill style={{ ...centered, opacity: fadeOut }}>
      <div
        style={{
          transform: `scale(${(0.96 + 0.04 * enter) * drift})`,
          width: winW,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
          background: "#fff",
        }}
      >
        <div
          style={{
            height: barH,
            background: "#ECEDF0",
            display: "flex",
            alignItems: "center",
            paddingLeft: 20,
            gap: 10,
          }}
        >
          {["#FF5F57", "#FEBC2E", "#28C840"].map((color) => (
            <div
              key={color}
              style={{ width: 14, height: 14, borderRadius: 7, background: color }}
            />
          ))}
          <div
            style={{
              flex: 1,
              textAlign: "center",
              marginRight: 92,
              color: "#6B7280",
              fontSize: 17,
              fontFamily,
            }}
          >
            {brand.url}
          </div>
        </div>
        <OffthreadVideo src={staticFile(srcName)} style={{ width: winW, display: "block" }} muted />
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ brand: Brand }> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ ...centered, gap: 30, opacity: enter }}>
      <Wordmark brand={brand} />
      <div style={{ color: brand.text, opacity: 0.85, fontSize: 38, fontFamily }}>{brand.url}</div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC<DemoProps> = ({ srcName, durationSec, brand }) => {
  const frames = videoFrames(durationSec);
  return (
    <AbsoluteFill style={{ backgroundColor: brand.bg }}>
      <Sequence durationInFrames={INTRO_FRAMES}>
        <Intro brand={brand} />
      </Sequence>
      <Sequence from={INTRO_FRAMES} durationInFrames={frames}>
        <WindowFrame brand={brand} srcName={srcName} durationFrames={frames} />
      </Sequence>
      <Sequence from={INTRO_FRAMES + frames} durationInFrames={OUTRO_FRAMES}>
        <Outro brand={brand} />
      </Sequence>
    </AbsoluteFill>
  );
};
