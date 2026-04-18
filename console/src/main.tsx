import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./i18n";
import { installHostExternals } from "./plugins/hostExternals";

// Expose host dependencies (React, antd, etc.) on window
// so that plugin UI modules can use them without bundling their own copies.
installHostExternals();

if (typeof window !== "undefined") {
  const originalError = console.error;
  const originalWarn = console.warn;

  const shouldIgnoreConsoleNoise = (msg: string) => {
    return (
      msg.includes(":first-child") ||
      msg.includes("pseudo class") ||
      msg.includes("Warning: [antd: Tooltip] `overlayClassName` is deprecated") ||
      msg.includes("Warning: findDOMNode is deprecated and will be removed in the next major release") ||
      msg.includes(
        "Warning: forwardRef render functions accept exactly two parameters",
      ) ||
      msg.includes(
        'Warning: Each child in a list should have a unique "key" prop.',
      )
    );
  };

  console.error = function (...args: unknown[]) {
    const msg = args[0]?.toString() || "";
    if (shouldIgnoreConsoleNoise(msg)) {
      return;
    }
    originalError.apply(console, args as []);
  };

  console.warn = function (...args: unknown[]) {
    const msg = args[0]?.toString() || "";
    if (
      shouldIgnoreConsoleNoise(msg) ||
      msg.includes("potentially unsafe")
    ) {
      return;
    }
    originalWarn.apply(console, args as []);
  };
}

createRoot(document.getElementById("root")!).render(<App />);
