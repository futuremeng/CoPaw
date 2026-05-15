import { describe, expect, it } from "vitest";
import { shouldTriggerWhisperShortcut } from "./shortcutGuard";

describe("shouldTriggerWhisperShortcut", () => {
  it("returns true for ctrl/cmd + shift + m when enabled in anywhere chat", () => {
    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: true,
        whisperEnabled: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: "m",
      }),
    ).toBe(true);

    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: true,
        whisperEnabled: true,
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        key: "M",
      }),
    ).toBe(true);
  });

  it("returns false when outside anywhere chat", () => {
    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: false,
        whisperEnabled: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: "m",
      }),
    ).toBe(false);
  });

  it("returns false when shortcut modifiers do not match", () => {
    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: true,
        whisperEnabled: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        key: "m",
      }),
    ).toBe(false);

    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: true,
        whisperEnabled: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        key: "m",
      }),
    ).toBe(false);

    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: true,
        whisperEnabled: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: "k",
      }),
    ).toBe(false);
  });

  it("returns false when whisper is disabled", () => {
    expect(
      shouldTriggerWhisperShortcut({
        isWithinAnywhere: true,
        whisperEnabled: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: "m",
      }),
    ).toBe(false);
  });
});
