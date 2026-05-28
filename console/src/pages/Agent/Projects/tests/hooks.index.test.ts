import { describe, expect, it } from "vitest";
import {
  useProjectAgentFacade,
  useProjectPipelineFacade,
  useProjectWorkspaceFacade,
} from "../hooks";

describe("projects hooks barrel exports", () => {
  it("exports facade hooks", () => {
    expect(typeof useProjectAgentFacade).toBe("function");
    expect(typeof useProjectPipelineFacade).toBe("function");
    expect(typeof useProjectWorkspaceFacade).toBe("function");
  });
});
