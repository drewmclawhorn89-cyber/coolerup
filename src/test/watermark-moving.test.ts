import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WATERMARK_CORNER_HOLD_ZERO_SECONDS,
  WATERMARK_CORNER_SEQUENCE,
  WATERMARK_FADE_SECONDS,
  WATERMARK_MOVE_INTERVAL_SECONDS,
  buildMovingWatermarkFilterGraph,
  watermarkCornerAtTime,
  watermarkOpacityAtTime,
  watermarkPlacementAtTime,
} from "@/lib/watermark";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("moving watermark corner rotation", () => {
  it("moves every 3 seconds in exact order: top-left -> top-right -> bottom-right -> bottom-left -> repeat", () => {
    expect(WATERMARK_MOVE_INTERVAL_SECONDS).toBe(3);
    expect(WATERMARK_CORNER_SEQUENCE).toEqual([
      "top-left",
      "top-right",
      "bottom-right",
      "bottom-left",
    ]);

    expect(watermarkCornerAtTime(0)).toBe("top-left");
    expect(watermarkCornerAtTime(2.99)).toBe("top-left");

    expect(watermarkCornerAtTime(3)).toBe("top-right");
    expect(watermarkCornerAtTime(5.99)).toBe("top-right");

    expect(watermarkCornerAtTime(6)).toBe("bottom-right");
    expect(watermarkCornerAtTime(8.99)).toBe("bottom-right");

    expect(watermarkCornerAtTime(9)).toBe("bottom-left");
    expect(watermarkCornerAtTime(11.99)).toBe("bottom-left");

    // Repeats after 12 seconds
    expect(watermarkCornerAtTime(12)).toBe("top-left");
    expect(watermarkCornerAtTime(15)).toBe("top-right");
    expect(watermarkCornerAtTime(18)).toBe("bottom-right");
    expect(watermarkCornerAtTime(21)).toBe("bottom-left");
    expect(watermarkCornerAtTime(24)).toBe("top-left");
  });

  it("handles invalid or negative timestamps safely", () => {
    expect(watermarkCornerAtTime(-1)).toBe("top-left");
    expect(watermarkCornerAtTime(Number.NaN)).toBe("top-left");
    expect(watermarkCornerAtTime(Number.POSITIVE_INFINITY)).toBe("top-left");
  });
});

describe("moving watermark smooth fade", () => {
  it("starts visible at t=0 and fades smoothly out and in around every 3s move", () => {
    expect(watermarkOpacityAtTime(0)).toBe(1);
    expect(watermarkOpacityAtTime(1.5)).toBe(1);

    const fadeOutStart =
      WATERMARK_MOVE_INTERVAL_SECONDS -
      WATERMARK_CORNER_HOLD_ZERO_SECONDS -
      WATERMARK_FADE_SECONDS;
    const fadeOutEnd = WATERMARK_MOVE_INTERVAL_SECONDS - WATERMARK_CORNER_HOLD_ZERO_SECONDS;
    const midFadeOut = (fadeOutStart + fadeOutEnd) / 2;

    expect(watermarkOpacityAtTime(fadeOutStart)).toBeCloseTo(1, 5);
    expect(watermarkOpacityAtTime(midFadeOut)).toBeCloseTo(0.5, 5);
    expect(watermarkOpacityAtTime(fadeOutEnd)).toBeCloseTo(0, 5);

    // At the exact corner transition seams, opacity is 0 so there is no abrupt pop.
    for (const seam of [3, 6, 9, 12, 15]) {
      expect(watermarkOpacityAtTime(seam)).toBe(0);

      const midFadeIn =
        seam + WATERMARK_CORNER_HOLD_ZERO_SECONDS + WATERMARK_FADE_SECONDS / 2;
      const fullVisible =
        seam + WATERMARK_CORNER_HOLD_ZERO_SECONDS + WATERMARK_FADE_SECONDS + 0.05;

      expect(watermarkOpacityAtTime(midFadeIn)).toBeCloseTo(0.5, 5);
      expect(watermarkOpacityAtTime(fullVisible)).toBe(1);
    }
  });
});

describe("moving watermark corner bounds (never covers middle)", () => {
  const frames = [
    { name: "portrait 720x1280", frameWidth: 720, frameHeight: 1280, markWidth: 180, markHeight: 54, margin: 25 },
    { name: "landscape 1920x1080", frameWidth: 1920, frameHeight: 1080, markWidth: 240, markHeight: 72, margin: 38 },
  ];

  for (const frame of frames) {
    it(`stays strictly inside corners and off the center on ${frame.name}`, () => {
      const centerX = frame.frameWidth / 2;
      const centerY = frame.frameHeight / 2;

      for (const timeSeconds of [1, 4, 7, 10]) {
        const p = watermarkPlacementAtTime({
          timeSeconds,
          frameWidth: frame.frameWidth,
          frameHeight: frame.frameHeight,
          markWidth: frame.markWidth,
          markHeight: frame.markHeight,
          margin: frame.margin,
        });

        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + frame.markWidth).toBeLessThanOrEqual(frame.frameWidth);
        expect(p.y + frame.markHeight).toBeLessThanOrEqual(frame.frameHeight);
        expect(p.opacity).toBe(1);

        // Must never overlap the center point of the frame.
        const coversCenterX = p.x <= centerX && centerX <= p.x + frame.markWidth;
        const coversCenterY = p.y <= centerY && centerY <= p.y + frame.markHeight;
        expect(coversCenterX && coversCenterY).toBe(false);
      }

      const tl = watermarkPlacementAtTime({ timeSeconds: 1, ...frame });
      const tr = watermarkPlacementAtTime({ timeSeconds: 4, ...frame });
      const br = watermarkPlacementAtTime({ timeSeconds: 7, ...frame });
      const bl = watermarkPlacementAtTime({ timeSeconds: 10, ...frame });

      expect(tl.corner).toBe("top-left");
      expect(tr.corner).toBe("top-right");
      expect(br.corner).toBe("bottom-right");
      expect(bl.corner).toBe("bottom-left");

      expect(tl.x).toBe(frame.margin);
      expect(tl.y).toBe(frame.margin);
      expect(tr.x).toBe(frame.frameWidth - frame.markWidth - frame.margin);
      expect(tr.y).toBe(frame.margin);
      expect(br.x).toBe(frame.frameWidth - frame.markWidth - frame.margin);
      expect(br.y).toBe(frame.frameHeight - frame.markHeight - frame.margin);
      expect(bl.x).toBe(frame.margin);
      expect(bl.y).toBe(frame.frameHeight - frame.markHeight - frame.margin);
    });
  }
});

describe("ffmpeg and recorder encoders both use the moving watermark", () => {
  const source = read("src/lib/watermark.ts");

  it("builds a moving + fading ffmpeg filtergraph bounded by shortest=1", () => {
    const graph = buildMovingWatermarkFilterGraph(25);
    expect(graph).toContain("format=rgba");
    expect(graph).toContain("geq=");
    expect(graph).toContain("overlay=x=");
    expect(graph).toContain("shortest=1");
    expect(graph).toContain("[wmout]");
  });

  it("wires both watermarkVideoWithFfmpeg and watermarkVideoWithRecorder to the moving placement", () => {
    expect(source).toContain('"-loop",\n      "1"');
    expect(source).toContain("buildMovingWatermarkFilterGraph(margin)");
    expect(source).toContain("watermarkPlacementAtTime({");
    expect(source).toContain("ctx.globalAlpha = opacity");
  });
});
