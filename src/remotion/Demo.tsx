import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Img,
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
  intro: boolean;
  outro: boolean;
  /** "bare" は macapp 録画向け: 偽ブラウザバー無し、角丸+シャドウのみ。省略時 "browser" */
  windowStyle?: "browser" | "bare";
  /** 録画の実寸px。指定するとウィンドウ幅をアスペクト比に合わせて縮め、縦長録画の見切れを防ぐ */
  videoWidth?: number;
  videoHeight?: number;
};

const fontFamily = "ui-sans-serif, -apple-system, sans-serif";

const MAX_WINDOW_WIDTH = 1520;
// バー込みのウィンドウ全体高さの上限。従来の固定幅 1520 で 1440x900 録画 + ブラウザバーを
// 表示したときの実績値（44 + 1520/1.6 = 994。drift ズーム 1.035 込みでも 1080 に収まる）
const MAX_WINDOW_HEIGHT = 994;
const BROWSER_BAR_HEIGHT = 44;

// 録画のアスペクト比が分かるときは、ウィンドウ全体（バー含む）が高さ上限に収まる幅へ縮める。
// 寸法未指定（旧 props・プレビュー）は従来どおり幅 1520 固定
export const computeWindowWidth = (options: {
  videoWidth?: number;
  videoHeight?: number;
  windowStyle: "browser" | "bare";
}): number => {
  const { videoWidth, videoHeight, windowStyle } = options;
  if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) {
    return MAX_WINDOW_WIDTH;
  }
  const barH = windowStyle === "browser" ? BROWSER_BAR_HEIGHT : 0;
  const fitted = Math.round((MAX_WINDOW_HEIGHT - barH) * (videoWidth / videoHeight));
  return Math.min(MAX_WINDOW_WIDTH, fitted);
};

export const Wordmark: React.FC<{ brand: Brand; size?: number }> = ({ brand, size = 96 }) => {
  if (brand.name === undefined) {
    // brand.ts のバリデーションにより name 省略時は logo が必須
    return (
      <Img
        src={staticFile(brand.logo as string)}
        style={{ height: size, width: "auto", display: "block" }}
      />
    );
  }
  const name = brand.name;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      {brand.logo ? (
        <Img
          src={staticFile(brand.logo)}
          style={{ height: size * 0.9, width: "auto", display: "block" }}
        />
      ) : (
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
          {name.charAt(0)}
        </div>
      )}
      <div
        style={{
          color: brand.text,
          fontSize: size,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontFamily,
        }}
      >
        {name}
      </div>
    </div>
  );
};

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
  fadeOut: boolean;
  windowStyle: "browser" | "bare";
  videoWidth?: number;
  videoHeight?: number;
}> = ({ brand, srcName, durationFrames, fadeOut, windowStyle, videoWidth, videoHeight }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  // 全編でわずかに寄る。クリック連動ズームの代わりの最小限の動き
  const drift = interpolate(frame, [0, durationFrames], [1, 1.035]);
  // outro カードへの転換演出のため、outro が無いときは末尾フェードアウトを省略する
  const opacity = fadeOut
    ? interpolate(frame, [durationFrames - 12, durationFrames], [1, 0], {
        extrapolateLeft: "clamp",
      })
    : 1;

  const winW = computeWindowWidth({ videoWidth, videoHeight, windowStyle });
  const barH = BROWSER_BAR_HEIGHT;

  return (
    <AbsoluteFill style={{ ...centered, opacity }}>
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
        {windowStyle === "browser" && (
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
        )}
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

export const Demo: React.FC<DemoProps> = ({
  srcName,
  durationSec,
  brand,
  intro,
  outro,
  windowStyle = "browser",
  videoWidth,
  videoHeight,
}) => {
  const frames = videoFrames(durationSec);
  const introFrames = intro ? INTRO_FRAMES : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: brand.bg }}>
      {intro && (
        <Sequence durationInFrames={INTRO_FRAMES}>
          <Intro brand={brand} />
        </Sequence>
      )}
      <Sequence from={introFrames} durationInFrames={frames}>
        <WindowFrame
          brand={brand}
          srcName={srcName}
          durationFrames={frames}
          fadeOut={outro}
          windowStyle={windowStyle}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
        />
      </Sequence>
      {outro && (
        <Sequence from={introFrames + frames} durationInFrames={OUTRO_FRAMES}>
          <Outro brand={brand} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
