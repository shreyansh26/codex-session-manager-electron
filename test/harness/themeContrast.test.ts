import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS_PATH = resolve(
  process.cwd(),
  "src/renderer/src/styles/globals.css"
);

describe("light theme contrast tokens", () => {
  it("keeps readable contrast for key light-mode text and surfaces", async () => {
    const css = await readFile(GLOBALS_PATH, "utf8");
    const lightBlock = extractLightThemeBlock(css);

    const bgInk = extractHexVariable(lightBlock, "--bg-ink");
    const textMain = extractHexVariable(lightBlock, "--text-main");
    const textMuted = extractHexVariable(lightBlock, "--text-muted");
    const panelStrong = extractHexVariable(lightBlock, "--surface-panel-strong");
    const panelSoft = extractHexVariable(lightBlock, "--surface-panel-soft");

    expect(contrastRatio(textMain, bgInk)).toBeGreaterThan(10);
    expect(contrastRatio(textMain, panelStrong)).toBeGreaterThan(11);
    expect(contrastRatio(textMuted, panelSoft)).toBeGreaterThan(5.5);
  });
});

const extractLightThemeBlock = (css: string): string => {
  const match = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
  if (!match) {
    throw new Error("Could not find the light theme block in globals.css");
  }
  return match[1];
};

const extractHexVariable = (block: string, variableName: string): string => {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escapedName}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) {
    throw new Error(`Could not find a 6-digit hex value for ${variableName}`);
  }
  return match[1];
};

const contrastRatio = (foreground: string, background: string): number => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
};
