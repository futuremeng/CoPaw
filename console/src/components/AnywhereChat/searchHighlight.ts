export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

export function splitHighlightSegments(text: string, query: string): HighlightSegment[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [{ text, highlighted: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const segments: HighlightSegment[] = [];
  let start = 0;

  while (start < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, start);
    if (matchIndex < 0) {
      segments.push({ text: text.slice(start), highlighted: false });
      break;
    }

    if (matchIndex > start) {
      segments.push({
        text: text.slice(start, matchIndex),
        highlighted: false,
      });
    }

    segments.push({
      text: text.slice(matchIndex, matchIndex + trimmedQuery.length),
      highlighted: true,
    });

    start = matchIndex + trimmedQuery.length;
  }

  return segments;
}
