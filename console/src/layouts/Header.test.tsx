import { fireEvent, screen, waitFor } from "@testing-library/react";
import Header from "./Header";
import { UPDATE_MD } from "./constants";
import { renderWithProviders } from "../test/common_setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh" },
  }),
}));

vi.mock("../api", () => {
  const rootApi = {
    getVersion: () => Promise.resolve({ version: "1.1.11b1" }),
  };
  return { default: rootApi, api: rootApi };
});

vi.mock("../components/LanguageSwitcher/index", () => ({
  default: () => null,
}));
vi.mock("../components/ThemeToggleButton", () => ({ default: () => null }));
vi.mock("../components/CodingModeToggle", () => ({ default: () => null }));

// antd's Dropdown calls findDOMNode() under jsdom; the resources menu is not
// what these tests are about.
vi.mock("antd", async (importOriginal) => {
  const antd = await importOriginal<Record<string, unknown>>();
  return {
    ...antd,
    Dropdown: ({ children }: any) => children,
  };
});

// The global design stub has no Modal; the update guide is rendered in one.
vi.mock("@agentscope-ai/design", async () => {
  const react = await import("react");
  const { createPortal } = await import("react-dom");
  const buttonLike = ({ children, onClick, icon, ...props }: any) =>
    react.createElement("button", { onClick, ...props }, icon, children);
  const modal = ({ open, children }: any) =>
    open
      ? createPortal(
          react.createElement(
            "div",
            { "data-testid": "update-modal" },
            children,
          ),
          document.body,
        )
      : null;
  const passThrough = ({ children }: any) => children;
  return {
    Button: buttonLike,
    IconButton: buttonLike,
    Dropdown: passThrough,
    Modal: modal,
    Input: (props: any) => react.createElement("input", props),
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("network is disabled in these tests"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderHeaderWithVersionBadge() {
  renderWithProviders(<Header />);
  const badge = await screen.findByText("v1.1.11b1");
  fireEvent.click(badge);
  return screen.findByTestId("update-modal");
}

describe("CoPaw update guide", () => {
  it("does not contact a release registry while mounting", async () => {
    renderWithProviders(<Header />);
    await screen.findByText("v1.1.11b1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the update guide from the version badge with no newer version known", async () => {
    renderWithProviders(<Header />);
    const badge = await screen.findByText("v1.1.11b1");
    fireEvent.click(badge);
    expect(await screen.findByTestId("update-modal")).toBeInTheDocument();
  });

  it("renders the locally shipped guide without fetching it", async () => {
    const modal = await renderHeaderWithVersionBadge();
    await waitFor(() => expect(modal.textContent).toContain("CoPaw如何更新"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names only CoPaw release channels in every shipped language", () => {
    const languages = Object.keys(UPDATE_MD);
    expect(languages.length).toBeGreaterThan(0);
    for (const lang of languages) {
      const copy = UPDATE_MD[lang];
      expect(copy).toContain("github.com/futuremeng/CoPaw");
      expect(copy).not.toContain("qwenpaw update");
      expect(copy).not.toContain("agentscope/qwenpaw");
      expect(copy).not.toContain("cd QwenPaw");
    }
  });
});
