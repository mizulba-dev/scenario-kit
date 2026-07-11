import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { Img, Sequence, staticFile } from "remotion";
import { describe, expect, it } from "vitest";
import type { Brand } from "../src/lib/brand";
import { INTRO_FRAMES, OUTRO_FRAMES, videoFrames } from "../src/lib/timing";
import { computeWindowWidth, Demo, type DemoProps, Wordmark } from "../src/remotion/Demo";

const brand: Brand = {
  name: "Demo",
  tagline: "tagline",
  url: "example.com",
  bg: "#1E293B",
  accent: "#6366F1",
  text: "#F8FAFC",
};

const baseProps: DemoProps = {
  srcName: "rec.mp4",
  durationSec: 5,
  brand,
  intro: true,
  outro: true,
  windowStyle: "browser",
};

// Demo/Wordmark はトップレベルで hooks を使わないため、レンダラーを介さず直接呼び出して
// 返ってくる React 要素ツリーを検証できる（実描画には Intro/WindowFrame/Outro の hooks が要る）
const sequencesOf = (el: ReactElement): ReactElement<any>[] =>
  Children.toArray((el.props as { children: ReactNode }).children).filter(
    isValidElement,
  ) as ReactElement<any>[];

describe("Demo", () => {
  const frames = videoFrames(baseProps.durationSec);

  it("renders intro, window, and outro sequences when both are enabled", () => {
    const seqs = sequencesOf(Demo(baseProps) as ReactElement);
    expect(seqs).toHaveLength(3);

    expect(seqs[0]!.type).toBe(Sequence);
    expect(seqs[0]!.props.durationInFrames).toBe(INTRO_FRAMES);

    expect(seqs[1]!.type).toBe(Sequence);
    expect(seqs[1]!.props.from).toBe(INTRO_FRAMES);
    expect(seqs[1]!.props.durationInFrames).toBe(frames);
    expect((seqs[1]!.props.children as ReactElement<any>).props.fadeOut).toBe(true);
    expect((seqs[1]!.props.children as ReactElement<any>).props.windowStyle).toBe("browser");

    expect(seqs[2]!.type).toBe(Sequence);
    expect(seqs[2]!.props.from).toBe(INTRO_FRAMES + frames);
    expect(seqs[2]!.props.durationInFrames).toBe(OUTRO_FRAMES);
  });

  it('passes windowStyle: "bare" through to the window frame for macapp recordings', () => {
    const seqs = sequencesOf(Demo({ ...baseProps, windowStyle: "bare" }) as ReactElement);
    expect((seqs[1]!.props.children as ReactElement<any>).props.windowStyle).toBe("bare");
  });

  it('defaults windowStyle to "browser" when omitted from props', () => {
    const { windowStyle: _windowStyle, ...propsWithoutWindowStyle } = baseProps;
    const seqs = sequencesOf(Demo(propsWithoutWindowStyle as DemoProps) as ReactElement);
    expect((seqs[1]!.props.children as ReactElement<any>).props.windowStyle).toBe("browser");
  });

  it("drops the intro sequence and starts the window at frame 0 when intro is false", () => {
    const seqs = sequencesOf(Demo({ ...baseProps, intro: false }) as ReactElement);
    expect(seqs).toHaveLength(2);

    expect(seqs[0]!.props.from).toBe(0);
    expect(seqs[0]!.props.durationInFrames).toBe(frames);
    expect((seqs[0]!.props.children as ReactElement<any>).props.fadeOut).toBe(true);
    expect(seqs[1]!.props.from).toBe(frames);
    expect(seqs[1]!.props.durationInFrames).toBe(OUTRO_FRAMES);
  });

  it("drops the outro sequence and disables the window fadeOut when outro is false", () => {
    const seqs = sequencesOf(Demo({ ...baseProps, outro: false }) as ReactElement);
    expect(seqs).toHaveLength(2);
    expect(seqs[1]!.props.from).toBe(INTRO_FRAMES);
    expect(seqs[1]!.props.durationInFrames).toBe(frames);
    expect((seqs[1]!.props.children as ReactElement<any>).props.fadeOut).toBe(false);
  });

  it("renders only the window, with no fadeOut, when both are false", () => {
    const seqs = sequencesOf(Demo({ ...baseProps, intro: false, outro: false }) as ReactElement);
    expect(seqs).toHaveLength(1);
    expect(seqs[0]!.props.from).toBe(0);
    expect(seqs[0]!.props.durationInFrames).toBe(frames);
    expect((seqs[0]!.props.children as ReactElement<any>).props.fadeOut).toBe(false);
  });
});

describe("computeWindowWidth", () => {
  it("keeps the legacy fixed width for the standard 1440x900 web recording", () => {
    expect(computeWindowWidth({ videoWidth: 1440, videoHeight: 900, windowStyle: "browser" })).toBe(
      1520,
    );
  });

  it("keeps the legacy fixed width when dimensions are unknown", () => {
    expect(computeWindowWidth({ windowStyle: "browser" })).toBe(1520);
    expect(computeWindowWidth({ videoWidth: 0, videoHeight: 0, windowStyle: "bare" })).toBe(1520);
  });

  it("shrinks the width so a tall recording fits the frame height", () => {
    // 1000x1000 の bare 録画: 994（高さ上限）に収まる幅へ
    expect(computeWindowWidth({ videoWidth: 1000, videoHeight: 1000, windowStyle: "bare" })).toBe(
      994,
    );
  });

  it("reserves the browser bar height when windowStyle is browser", () => {
    expect(
      computeWindowWidth({ videoWidth: 1000, videoHeight: 1000, windowStyle: "browser" }),
    ).toBe(950);
  });

  it("caps wide recordings at the legacy fixed width", () => {
    expect(computeWindowWidth({ videoWidth: 2560, videoHeight: 900, windowStyle: "bare" })).toBe(
      1520,
    );
  });
});

describe("Wordmark", () => {
  const { name: _name, ...withoutName } = brand;
  const logoOnly: Brand = { ...withoutName, logo: "logo.png" };

  it("renders the logo alone at full size when name is omitted", () => {
    const el = Wordmark({ brand: logoOnly }) as ReactElement<any>;
    expect(el.type).toBe(Img);
    expect(el.props.src).toBe(staticFile("logo.png"));
    expect(el.props.style.height).toBe(96);
  });

  it("renders the name text (and the initial icon, with no logo) when name is set", () => {
    const el = Wordmark({ brand }) as ReactElement<any>;
    expect(el.type).toBe("div");
    const children = Children.toArray(el.props.children).filter(
      isValidElement,
    ) as ReactElement<any>[];
    expect(children).toHaveLength(2);
    expect(children[0]!.props.children).toBe(brand.name!.charAt(0));
    expect(children[1]!.props.children).toBe(brand.name);
  });

  it("renders the logo next to the name (no initial icon) when both are set", () => {
    const el = Wordmark({ brand: { ...brand, logo: "logo.png" } }) as ReactElement<any>;
    const children = Children.toArray(el.props.children).filter(
      isValidElement,
    ) as ReactElement<any>[];
    expect(children).toHaveLength(2);
    expect(children[0]!.type).toBe(Img);
    expect(children[0]!.props.src).toBe(staticFile("logo.png"));
    expect(children[1]!.props.children).toBe(brand.name);
  });
});
