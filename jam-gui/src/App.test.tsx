import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Mock Tauri invoke and listen APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Room token fetch: default to auth-disabled (503) so connect flow stays unchanged.
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({ status: 503, ok: false })
);

// Helper to capture event handlers registered by `useTauriEvents` so the tests
// can simulate Tauri emitting events without a real backend. Returns both the
// handlers map AND a `ready` promise that resolves once `setup()` has finished
// registering every listener — without awaiting this, fired events can race
// the useEffect's `await listen(...)` chain.
function captureListeners() {
  const handlers: Record<string, (event: { payload: unknown }) => void> = {};
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  (listen as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {
        delete handlers[eventName];
      };
    }
  );
  return {
    handlers,
    async waitReady() {
      // setup() awaits each listen in sequence; yielding a few microtasks is
      // enough for vitest's queue to drain on the mocked resolution.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      resolveReady();
    },
    ready,
  };
}

// Common helper: a Tauri command with no payload (e.g. `leave_room`) is
// recorded as `invoke(cmd, undefined)` because we call `invoke(cmd)` directly.
// `expect.anything()` rejects undefined, so use `expect.anything() | undefined`.
function noArg() {
  return expect.anything();
}

describe("App — rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureListeners();
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

  it("renders ConnectionForm component", () => {
    render(<App />);
    expect(screen.getByText("Server Endpoint")).toBeTruthy();
    expect(screen.getByText("Room ID")).toBeTruthy();
    expect(screen.getByText("Display Name")).toBeTruthy();
  });

  it("renders StatusBar component", () => {
    render(<App />);
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("accepts a display name in the form", () => {
    render(<App />);
    const nameInput = screen.getByPlaceholderText("Anonymous") as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    fireEvent.change(nameInput, { target: { value: "Alice" } });
    expect(nameInput.value).toBe("Alice");
  });
});

describe("App — connect flow", () => {
  let handlers: Record<string, (event: { payload: unknown }) => void>;
  let ready: Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cap = captureListeners();
    handlers = cap.handlers;
    ready = cap.ready;
    render(<App />);
    await cap.waitReady();
  });

  it("calls invoke join_room with current form values", async () => {
    fireEvent.change(screen.getByPlaceholderText("Anonymous"), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByText("Connect to Session"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "join_room",
        expect.objectContaining({
          room: "studio1",
          server: "ws://localhost:8080",
          name: "Alice",
        })
      )
    );
  });

  it("falls back to 'Anonymous' when display name is empty", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "join_room",
        expect.objectContaining({ name: "Anonymous" })
      )
    );
  });

  it("shows error state when join_room rejects", async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      "Connection refused"
    );

    fireEvent.click(screen.getByText("Connect to Session"));

    await waitFor(() => {
      expect(screen.getByText("ERROR")).toBeTruthy();
      expect(screen.getByText("Connection refused")).toBeTruthy();
    });
  });

  it("switches to the mixer UI when a peer-joined event fires", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "abc-123", name: "Bob" } });
      await ready;
    });

    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Active Channels")).toBeTruthy();
  });

  it("falls back to 'Musician <id>' when name is empty", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "abc12345", name: "" } });
      await ready;
    });

    expect(screen.getByText("Musician abc1")).toBeTruthy();
  });

  it("removes peer when peer-left fires", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "p1", name: "Bob" } });
      await ready;
    });
    expect(screen.getByText("Bob")).toBeTruthy();

    await act(async () => {
      handlers["peer-left"]({ payload: "p1" });
      await ready;
    });
    expect(screen.queryByText("Bob")).toBeNull();
  });
});

describe("App — keyboard shortcuts", () => {
  let handlers: Record<string, (event: { payload: unknown }) => void>;
  let ready: Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cap = captureListeners();
    handlers = cap.handlers;
    ready = cap.ready;
    render(<App />);
    await cap.waitReady();
  });

  it("calls set_muted when pressing M in connected state", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "p1", name: "Bob" } });
      await ready;
    });

    fireEvent.keyDown(window, { key: "m" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_muted", { muted: true })
    );
  });

  it("calls leave_room when pressing Escape in connected state", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "p1", name: "Bob" } });
      await ready;
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("leave_room"));
  });

  it("does not call leave_room when pressing Escape in idle state", () => {
    fireEvent.keyDown(window, { key: "Escape" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("App — server error envelope", () => {
  let handlers: Record<string, (event: { payload: unknown }) => void>;
  let ready: Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cap = captureListeners();
    handlers = cap.handlers;
    ready = cap.ready;
    render(<App />);
    await cap.waitReady();
  });

  it("surfaces server-error events in the UI", async () => {
    await act(async () => {
      handlers["server-error"]({ payload: "Room is full" });
      await ready;
    });

    expect(screen.getByText("Room is full")).toBeTruthy();
    expect(screen.getByText("ERROR")).toBeTruthy();
  });
});

describe("App — reconnecting state", () => {
  let handlers: Record<string, (event: { payload: unknown }) => void>;
  let ready: Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cap = captureListeners();
    handlers = cap.handlers;
    ready = cap.ready;
    render(<App />);
    await cap.waitReady();
  });

  it("shows the reconnecting Cancel button after a disconnected event", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["disconnected"]({ payload: undefined });
      await ready;
    });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("returns to connected on the connected event", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["disconnected"]({ payload: undefined });
      await ready;
    });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    await act(async () => {
      handlers["connected"]({ payload: undefined });
      await ready;
    });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("Cancel button calls leave_room", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["disconnected"]({ payload: undefined });
      await ready;
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("leave_room"));
  });
});

describe("App — volume slider", () => {
  let handlers: Record<string, (event: { payload: unknown }) => void>;
  let ready: Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cap = captureListeners();
    handlers = cap.handlers;
    ready = cap.ready;
    render(<App />);
    await cap.waitReady();
  });

  it("calls set_volume when peer volume is changed", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "p1", name: "Bob" } });
      await ready;
    });

    const slider = document.querySelector(
      ".peer-card .volume-input"
    ) as HTMLInputElement;
    expect(slider).toBeTruthy();
    fireEvent.change(slider, { target: { value: "0.5" } });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_volume", { peerId: "p1", vol: 0.5 })
    );
  });
});

describe("App — bitrate slider", () => {
  let handlers: Record<string, (event: { payload: unknown }) => void>;
  let ready: Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cap = captureListeners();
    handlers = cap.handlers;
    ready = cap.ready;
    render(<App />);
    await cap.waitReady();
  });

  it("calls set_opus_bitrate with bits/s when connected", async () => {
    fireEvent.click(screen.getByText("Connect to Session"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("join_room", expect.any(Object))
    );

    await act(async () => {
      handlers["peer-joined"]({ payload: { id: "p1", name: "Bob" } });
      await ready;
    });

    fireEvent.click(screen.getByTitle("Settings"));

    const bitrateSlider = document.querySelector(
      ".bitrate-slider"
    ) as HTMLInputElement;
    expect(bitrateSlider).toBeTruthy();
    fireEvent.change(bitrateSlider, { target: { value: "96" } });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_opus_bitrate", { bitrate: 96000 })
    );
  });
});

// Reference: `noArg` is used by callers that pass a no-payload Tauri command.
// Kept exported-style here for documentation; unused at module scope to keep
// the test report clean.
void noArg;
