// ── URLs ──────────────────────────────────────────────────────────────────
// Both repository URLs come from the release-channel fact source
// (src/copaw/release_channel.json -> console/src/generated/releaseChannel.ts).
// The documentation-site helpers below still point at the upstream site on
// purpose: it is upstream's content asset, and CoPaw has no equivalent yet
// (design section 9.3).

import {
  RELEASE_CHANNEL,
  githubUrl,
  releasesUrl,
} from "../generated/releaseChannel";

export { githubUrl as GITHUB_URL, releasesUrl };

// The PyPI release feed is queried from our own distribution name, never from
// upstream's package: `pypi` is still listed in RELEASE_CHANNEL.pending, so this
// URL 404s until phase 2 publishes it, and the update badge stays off.
export const PYPI_URL = `https://pypi.org/pypi/${RELEASE_CHANNEL.pypi_project}/json`;

// ── Timing ────────────────────────────────────────────────────────────────

export const ONE_HOUR_MS = 60 * 60 * 1000;

// ── URL helpers ───────────────────────────────────────────────────────────

export const getWebsiteLang = (lang: string): string =>
  lang.startsWith("zh") ? "zh" : "en";

export const getDocsUrl = (lang: string): string =>
  `https://qwenpaw.agentscope.io/docs/intro?lang=${getWebsiteLang(lang)}`;

export const getFaqUrl = (lang: string): string =>
  `https://qwenpaw.agentscope.io/docs/faq?lang=${getWebsiteLang(lang)}`;

export const getReleaseNotesUrl = (lang: string): string =>
  `https://qwenpaw.agentscope.io/release-notes?lang=${getWebsiteLang(lang)}`;

export const getFeatureDemosUrl = (lang: string): string =>
  `https://qwenpaw.agentscope.io/docs/functiondemo?lang=${getWebsiteLang(
    lang,
  )}`;

// ── Version helpers ────────────────────────────────────────────────────────

// Filter out pre-release versions; post-releases are treated as stable.
// PEP 440 pre-release suffixes: aN / bN / rcN (or cN) / devN.
export const isStableVersion = (v: string): boolean =>
  !/(\d)(a|alpha|b|beta|rc|c|dev)\d*/i.test(v);

// Compare two PEP 440 version strings. Returns >0 if a>b, <0 if a<b, 0 if equal.
// .postN releases sort after their base version (e.g. 1.0.0.post1 > 1.0.0).
// Pre-release versions (aN, bN, rcN) sort before their base version.
export const compareVersions = (a: string, b: string): number => {
  const normalise = (v: string): number[] => {
    // Handle .postN suffix
    const postMatch = v.match(/\.post(\d+)$/i);
    const postNum = postMatch ? Number(postMatch[1]) : 0;
    const baseVersion = v.replace(/\.post\d+$/i, "");

    // Handle pre-release suffix (e.g., 1.0.1b1 -> base=1.0.1, preType=b, preNum=1)
    const preMatch = baseVersion.match(/^(.+?)(a|alpha|b|beta|rc|c)(\d*)$/i);
    let coreVersion = baseVersion;
    let preType = 0; // 0 = stable, -3 = alpha, -2 = beta, -1 = rc
    let preNum = 0;
    if (preMatch) {
      coreVersion = preMatch[1];
      const preLabel = preMatch[2].toLowerCase();
      preType =
        preLabel === "a" || preLabel === "alpha"
          ? -3
          : preLabel === "b" || preLabel === "beta"
          ? -2
          : -1; // rc or c
      preNum = preMatch[3] ? Number(preMatch[3]) : 0;
    }

    const parts = coreVersion.split(/[.\-]/).map((seg) => Number(seg) || 0);
    // Append: preType (0 for stable, negative for pre-release), preNum, postNum
    return [...parts, preType, preNum, postNum];
  };

  const aN = normalise(a);
  const bN = normalise(b);
  const len = Math.max(aN.length, bN.length);
  for (let i = 0; i < len; i++) {
    const diff = (aN[i] ?? 0) - (bN[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// ── Update markdown ───────────────────────────────────────────────────────
// CoPaw is published only on GitHub Releases today: the PyPI distribution and
// the Docker image are upstream channels, so naming them here would tell a
// CoPaw user to replace their CoPaw install with the upstream product.
export const UPDATE_MD: Record<string, string> = {
  zh: `### CoPaw如何更新

CoPaw 目前只通过 GitHub Releases 发布，PyPI 包与 Docker 镜像渠道还没有开通，因此不要执行上游的 pip 或 Docker 升级命令，那会装上 QwenPaw 而不是 CoPaw。

1. 打开 CoPaw 发布页查看最新版本并下载安装包：

\`\`\`
${releasesUrl}
\`\`\`

2. 如果你是从源码安装的，进入项目目录拉取最新代码，重新构建前端并重装：

\`\`\`
cd CoPaw
git pull origin main
cd console && npm ci && npm run build
cd .. && mkdir -p src/qwenpaw/console
cp -R console/dist/. src/qwenpaw/console/
pip install -e .
\`\`\`

3. 升级完成后重启服务：

\`\`\`
copaw app
\`\`\``,

  ru: `### Как обновить CoPaw

CoPaw публикуется только на странице GitHub Releases: каналы PyPI и Docker ещё не открыты, поэтому не выполняйте команды обновления из документации QwenPaw — они установят QwenPaw вместо CoPaw.

1. Откройте страницу релизов CoPaw и скачайте последнюю версию:

\`\`\`
${releasesUrl}
\`\`\`

2. Если CoPaw установлен из исходников, получите последние изменения, пересоберите интерфейс и переустановите:

\`\`\`
cd CoPaw
git pull origin main
cd console && npm ci && npm run build
cd .. && mkdir -p src/qwenpaw/console
cp -R console/dist/. src/qwenpaw/console/
pip install -e .
\`\`\`

3. После обновления перезапустите сервис:

\`\`\`
copaw app
\`\`\``,

  en: `### How to update CoPaw

CoPaw is released only through GitHub Releases for now; the PyPI package and the Docker image channels are not open yet, so do not run the upstream pip or Docker upgrade commands — they would install QwenPaw instead of CoPaw.

1. Open the CoPaw releases page and download the latest build:

\`\`\`
${releasesUrl}
\`\`\`

2. If you installed CoPaw from source, pull the latest code, rebuild the console and reinstall:

\`\`\`
cd CoPaw
git pull origin main
cd console && npm ci && npm run build
cd .. && mkdir -p src/qwenpaw/console
cp -R console/dist/. src/qwenpaw/console/
pip install -e .
\`\`\`

3. After upgrading, restart the service:

\`\`\`
copaw app
\`\`\``,
};
