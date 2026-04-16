import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const patches = [
  {
    relativePath: "node_modules/@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Chat/hooks/useChatMessageHandler.js",
    replacements: [
      {
        from: 'import ReactDOM from "react-dom";\n',
        to: "",
      },
      {
        from: "    ReactDOM.flushSync(function () {\n      updateMessage(currentQARef.current.request);\n    });\n",
        to: "    updateMessage(currentQARef.current.request);\n",
      },
      {
        from: "    ReactDOM.flushSync(function () {\n      updateMessage(currentQARef.current.request);\n    });\n",
        to: "    updateMessage(currentQARef.current.request);\n",
      },
      {
        from: "    ReactDOM.flushSync(function () {\n      removeMessage({\n        id: id\n      });\n    });\n",
        to: "    removeMessage({\n      id: id\n    });\n",
      },
    ],
  },
  {
    relativePath: "node_modules/@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Chat/hooks/useChatController.js",
    replacements: [
      {
        from: 'import ReactDOM from "react-dom";\n',
        to: "",
      },
      {
        from: "    ReactDOM.flushSync(function () {\n      messageHandler.updateMessage(currentQARef.current.response);\n    });\n",
        to: "    messageHandler.updateMessage(currentQARef.current.response);\n",
      },
    ],
  },
  {
    relativePath: "node_modules/@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Context/ChatAnywhereSessionsContext.js",
    replacements: [
      {
        from: "          ReactDOM.flushSync(function () {\n            setMessages([]);\n          });\n",
        to: "          setMessages([]);\n",
      },
    ],
  },
  {
    relativePath: "node_modules/@agentscope-ai/chat/lib/ChatAnywhere/hooks/useSessionList.js",
    replacements: [
      {
        from: "import ReactDOM from 'react-dom';\n",
        to: "",
      },
      {
        from: "    ReactDOM.flushSync(function () {\n      setSessionList(function (sessionList) {\n        var newSessionList = [].concat(_toConsumableArray(sessionList), [newSession]);\n        return newSessionList;\n      });\n      setCurrentSessionKey(newKey);\n    });\n",
        to: "    setSessionList(function (sessionList) {\n      var newSessionList = [].concat(_toConsumableArray(sessionList), [newSession]);\n      return newSessionList;\n    });\n    setCurrentSessionKey(newKey);\n",
      },
    ],
  },
  {
    relativePath: "node_modules/@agentscope-ai/chat/lib/Bubble/hooks/usePaginationItemsData.js",
    replacements: [
      {
        from: 'import { flushSync } from "react-dom";\n',
        to: "",
      },
      {
        from: "          flushSync(function () {\n            setPage(function (prev) {\n              return prev + 1;\n            });\n          });\n",
        to: "          setPage(function (prev) {\n            return prev + 1;\n          });\n",
      },
    ],
  },
  {
    relativePath: "node_modules/@agentscope-ai/chat/lib/Markdown/core/components/Link.js",
    replacements: [
      {
        from: 'var _excluded = ["href"];\n',
        to: 'var _excluded = ["href"], _excluded2 = ["streamStatus", "domNode"], _excluded3 = ["href", "streamStatus", "domNode"];\n',
      },
      {
        from: "export default function Link(props) {\n  if (props['data-footnote-ref'] === '') return /*#__PURE__*/_jsx(Sup, _objectSpread({}, props));\n  if (props.children === '↩' && props['data-footnote-backref'] === '') return null;\n  return /*#__PURE__*/_jsx(\"a\", _objectSpread({}, props));\n}\n",
        to: "export default function Link(props) {\n  var streamStatus = props.streamStatus,\n    domNode = props.domNode,\n    rest = _objectWithoutProperties(props, _excluded2);\n  if (rest['data-footnote-ref'] === '') return /*#__PURE__*/_jsx(Sup, _objectSpread({}, rest));\n  if (rest.children === '↩' && rest['data-footnote-backref'] === '') return null;\n  return /*#__PURE__*/_jsx(\"a\", _objectSpread({}, rest));\n}\n",
      },
      {
        from: "  var href = props.href,\n    rest = _objectWithoutProperties(props, _excluded);\n",
        to: "  var href = props.href,\n    streamStatus = props.streamStatus,\n    domNode = props.domNode,\n    rest = _objectWithoutProperties(props, _excluded3);\n",
      },
    ],
  },
];

let changedCount = 0;
let touchedCount = 0;

for (const patch of patches) {
  const filePath = path.join(projectRoot, patch.relativePath);
  if (!fs.existsSync(filePath)) {
    continue;
  }

  touchedCount += 1;
  let content = fs.readFileSync(filePath, "utf8");
  let fileChanged = false;

  for (const replacement of patch.replacements) {
    if (!content.includes(replacement.from)) {
      continue;
    }
    content = content.replace(replacement.from, replacement.to);
    fileChanged = true;
  }

  if (fileChanged) {
    fs.writeFileSync(filePath, content, "utf8");
    changedCount += 1;
  }
}

if (touchedCount === 0) {
  console.log("[patch-chat-flushsync] skipped: @agentscope-ai/chat not found");
} else if (changedCount === 0) {
  console.log("[patch-chat-flushsync] already applied");
} else {
  console.log(`[patch-chat-flushsync] patched ${changedCount}/${touchedCount} files`);
}
