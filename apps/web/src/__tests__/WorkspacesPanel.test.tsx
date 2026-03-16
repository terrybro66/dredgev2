import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspacesPanel", () => {
  it("shows empty state when no workspaces exist", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { WorkspacesPanel } = await import("../components/WorkspacesPanel");
    render(<WorkspacesPanel userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText(/no workspaces/i)).toBeInTheDocument();
    });
  });

  it("lists workspaces returned from the API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: "ws-1", name: "Crime Analysis Q1", ownerId: "user-1" },
        { id: "ws-2", name: "Weather Trends", ownerId: "user-1" },
      ],
    });

    const { WorkspacesPanel } = await import("../components/WorkspacesPanel");
    render(<WorkspacesPanel userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText("Crime Analysis Q1")).toBeInTheDocument();
      expect(screen.getByText("Weather Trends")).toBeInTheDocument();
    });
  });

  it("creates a new workspace when form is submitted", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ws-3",
          name: "New Workspace",
          ownerId: "user-1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "ws-3", name: "New Workspace", ownerId: "user-1" },
        ],
      });

    const { WorkspacesPanel } = await import("../components/WorkspacesPanel");
    render(<WorkspacesPanel userId="user-1" />);

    await waitFor(() => screen.getByPlaceholderText(/workspace name/i));

    fireEvent.change(screen.getByPlaceholderText(/workspace name/i), {
      target: { value: "New Workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/workspaces"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
