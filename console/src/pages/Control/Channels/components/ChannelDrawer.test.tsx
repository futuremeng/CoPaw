import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "antd";
import { describe, expect, it, vi } from "vitest";
import { ChannelDrawer } from "./ChannelDrawer";

vi.mock("@agentscope-ai/design", async () => {
  const antd = await import("antd");
  return {
    ...antd,
    default: antd,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-CN" },
  }),
}));

vi.mock("../../../../hooks/useAppMessage", () => ({
  useAppMessage: () => ({
    message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  }),
}));

vi.mock("../../../../stores/agentStore", () => ({
  useAgentStore: () => ({
    selectedAgent: "default",
    agents: [{ id: "default", workspace_dir: "/tmp/workspace" }],
  }),
}));

vi.mock("../../../../utils/openExternalLink", () => ({
  openExternalLink: vi.fn(),
}));

vi.mock("./QrcodeAuthBlock", () => ({
  QrcodeAuthBlock: () => null,
}));

function DrawerUnderTest(props: {
  initialValues: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [form] = Form.useForm<Record<string, unknown>>();

  return (
    <ChannelDrawer
      open
      activeKey="dingtalk"
      activeLabel="DingTalk"
      form={form}
      saving={false}
      initialValues={props.initialValues}
      isBuiltin
      onClose={vi.fn()}
      onSubmit={props.onSubmit}
    />
  );
}

describe("ChannelDrawer dingtalk validation", () => {
  it("allows saving disabled dingtalk without client credentials", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <DrawerUnderTest
        initialValues={{
          enabled: false,
          client_id: "",
          client_secret: "",
          message_type: "markdown",
          cron_message_type: "markdown",
        }}
        onSubmit={onSubmit}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          client_id: "",
          client_secret: "",
        }),
      );
    });
  });

  it("still requires credentials when dingtalk is enabled", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <DrawerUnderTest
        initialValues={{
          enabled: true,
          client_id: "",
          client_secret: "",
          message_type: "markdown",
          cron_message_type: "markdown",
        }}
        onSubmit={onSubmit}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });

    expect(screen.getByText("Please enter Client ID")).toBeInTheDocument();
    expect(screen.getByText("Please enter Client Secret")).toBeInTheDocument();
  });
});
