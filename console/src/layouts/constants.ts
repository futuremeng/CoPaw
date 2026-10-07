// ── URLs ──────────────────────────────────────────────────────────────────

export const GITHUB_URL = "https://github.com/agentscope-ai/QwenPaw" as const;

// ── Navigation ────────────────────────────────────────────────────────────

export const DEFAULT_OPEN_KEYS = [
  "chat-group",
  "control-group",
  "agent-group",
  "settings-group",
];

export const KEY_TO_PATH: Record<string, string> = {
  chat: "/chat",
  channels: "/channels",
  sessions: "/sessions",
  inbox: "/inbox",
  "cron-jobs": "/cron-jobs",
  heartbeat: "/heartbeat",
  knowledge: "/knowledge",
  skills: "/skills",
  "skill-pool": "/skill-pool",
  market: "/market",
  tools: "/tools",
  mcp: "/mcp",
  acp: "/acp",
  workspace: "/workspace",
  projects: "/projects",
  pipelines: "/pipelines",
  agents: "/agents",
  models: "/models",
  environments: "/environments",
  "agent-config": "/agent-config",
  security: "/security",
  "token-usage": "/token-usage",
  "agent-stats": "/agent-stats",
  "voice-transcription": "/voice-transcription",
  nlp: "/nlp",
  debug: "/debug",
  backups: "/backups",
  "plugin-manager": "/plugin-manager",
};

export const KEY_TO_LABEL: Record<string, string> = {
  chat: "nav.chat",
  channels: "nav.channels",
  sessions: "nav.sessions",
  inbox: "nav.inbox",
  "cron-jobs": "nav.cronJobs",
  heartbeat: "nav.heartbeat",
  knowledge: "nav.knowledge",
  skills: "nav.skills",
  "skill-pool": "nav.skillPool",
  market: "nav.market",
  tools: "nav.tools",
  mcp: "nav.mcp",
  acp: "nav.acp",
  "agent-config": "nav.agentConfig",
  workspace: "nav.workspace",
  projects: "nav.projects",
  pipelines: "nav.pipelines",
  models: "nav.models",
  environments: "nav.environments",
  security: "nav.security",
  "token-usage": "nav.tokenUsage",
  agents: "nav.agents",
  nlp: "nav.nlp",
  debug: "nav.debug",
  backups: "nav.backups",
};

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

// ── Update markdown ───────────────────────────────────────────────────────
// CoPaw is published only on GitHub Releases today: the PyPI distribution and
// the Docker image are upstream channels, so naming them here would tell a
// CoPaw user to replace their CoPaw install with the upstream product.
export const UPDATE_MD: Record<string, string> = {
  zh: `### CoPaw如何更新

CoPaw 目前只通过 GitHub Releases 发布，PyPI 包与 Docker 镜像渠道还没有开通，因此不要执行上游的 pip 或 Docker 升级命令，那会装上 QwenPaw 而不是 CoPaw。

1. 打开 CoPaw 发布页查看最新版本并下载安装包：

\`\`\`
https://github.com/futuremeng/CoPaw/releases
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
https://github.com/futuremeng/CoPaw/releases
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
https://github.com/futuremeng/CoPaw/releases
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
