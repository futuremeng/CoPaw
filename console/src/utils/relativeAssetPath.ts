const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function splitPathAndSuffix(value: string): { pathPart: string; suffix: string } {
  const trimmed = value.trim();
  const hashIndex = trimmed.indexOf("#");
  const queryIndex = trimmed.indexOf("?");

  let cutoff = trimmed.length;
  if (queryIndex >= 0) cutoff = Math.min(cutoff, queryIndex);
  if (hashIndex >= 0) cutoff = Math.min(cutoff, hashIndex);

  return {
    pathPart: trimmed.slice(0, cutoff),
    suffix: trimmed.slice(cutoff),
  };
}

export function isExternalOrAnchorUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("#")) return true;
  if (trimmed.startsWith("//")) return true;
  return SCHEME_RE.test(trimmed);
}

export function resolveRelativeAssetPath(baseFilePath: string, rawRef: string): string | null {
  const trimmedRef = rawRef.trim();
  if (!trimmedRef || isExternalOrAnchorUrl(trimmedRef)) {
    return null;
  }

  const { pathPart, suffix } = splitPathAndSuffix(trimmedRef);
  if (!pathPart) {
    return null;
  }

  const baseSegments = baseFilePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => Boolean(part));

  const stack = pathPart.startsWith("/")
    ? []
    : baseSegments.slice(0, Math.max(0, baseSegments.length - 1));

  const targetSegments = pathPart
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => Boolean(part));

  for (const segment of targetSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) {
        return null;
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  if (stack.length === 0) {
    return null;
  }

  return `${stack.join("/")}${suffix}`;
}

export function rewriteMarkdownImageSources(
  markdown: string,
  resolveSrc: (src: string) => string | null,
): string {
  const markdownImageRe = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
  let output = markdown.replace(markdownImageRe, (match, alt, rawTarget, titlePart = "") => {
    const hasAngle = rawTarget.startsWith("<") && rawTarget.endsWith(">");
    const target = hasAngle ? rawTarget.slice(1, -1) : rawTarget;
    const resolved = resolveSrc(target);
    if (!resolved) return match;
    const finalTarget = hasAngle ? `<${resolved}>` : resolved;
    return `![${alt}](${finalTarget}${titlePart})`;
  });

  const htmlImageRe = /(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi;
  output = output.replace(htmlImageRe, (match, prefix, quote, src) => {
    const resolved = resolveSrc(src);
    if (!resolved) return match;
    return `${prefix}${quote}${resolved}${quote}`;
  });

  return output;
}