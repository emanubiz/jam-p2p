import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// Mock Tauri invoke and listen APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the logo and title", () => {
    render(<App />);
    expect(screen.getByText("JAM P2P")).toBeTruthy();
    expect(screen.getByText("Professional Audio Network")).toBeTruthy();
  });

  it("shows the connection form in idle state", () => {
    render(<App />);
    expect(screen.getByText("Connect to Session")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("shows server endpoint and room ID inputs", () => {
    render(<App />);
    expect(screen.getByDisplayValue("ws://localhost:8080")).toBeTruthy();
    expect(screen.getByDisplayValue("studio1")).toBeTruthy();
  });
});
