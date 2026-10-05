import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    VITE_API_BASE_URL: JSON.stringify(""),
    TOKEN: JSON.stringify(""),
    MOBILE: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types.js": path.resolve(
        __dirname,
        "src/test/chat-runtime-types-mock.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // The suite is parallel-load-sensitive: heavy page tests intermittently pass
    // the 5000ms default (4 recorded flakes).  The CI gate runs this file.
    testTimeout: 20000,
    deps: {
      inline: [/@agentscope-ai\/(?!icons|chat|design)/],
    },
    alias: {
      "@agentscope-ai/chat": path.resolve(__dirname, "src/test/chat-mock.ts"),
      "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types.js": path.resolve(
        __dirname,
        "src/test/chat-runtime-types-mock.ts",
      ),
      "@agentscope-ai/design": path.resolve(
        __dirname,
        "src/test/design-mock.ts",
      ),
      "@agentscope-ai/icons": path.resolve(
        __dirname,
        "src/test/icons-mock.ts",
      ),
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/testConnectionMessage.test.ts",
      "**/pages/Chat/ChatPage.test.tsx",
    ],
  },
});
