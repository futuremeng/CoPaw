import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

function LateMount() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  return shown ? <p>settled</p> : null;
}

describe("async wait budget", () => {
  it("keeps waitFor alive longer than the library's 1000ms default", async () => {
    render(<LateMount />);
    await waitFor(() => {
      expect(screen.queryByText("settled")).not.toBeNull();
    });
  });
});
