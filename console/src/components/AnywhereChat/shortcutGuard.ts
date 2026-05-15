export interface ShortcutTriggerInput {
  isWithinAnywhere: boolean;
  whisperEnabled: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
}

export function shouldTriggerWhisperShortcut(input: ShortcutTriggerInput): boolean {
  if (!input.isWithinAnywhere) {
    return false;
  }
  if (!input.whisperEnabled) {
    return false;
  }
  if (!input.shiftKey) {
    return false;
  }
  if (!(input.ctrlKey || input.metaKey)) {
    return false;
  }

  return input.key.toLowerCase() === "m";
}
