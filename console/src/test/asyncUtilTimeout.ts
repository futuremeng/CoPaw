import { configure } from "@testing-library/dom";

// Same order of magnitude as testTimeout in vitest.config.ts: the library's
// 1000ms default gives up long before a heavy page test's own budget is spent,
// which is how load-dependent reds reached unrelated assertions.
// Fork-owned setup file (src/test/setup.ts is upstream-owned) registered in
// vitest.config.ts setupFiles.
configure({ asyncUtilTimeout: 8000 });
