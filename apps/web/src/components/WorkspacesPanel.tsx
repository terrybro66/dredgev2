import { useState, useEffect } from "react";
import { API } from "../api";

interface Workspace {
  id: string;
  name: string;
  ownerId: string;
}

interface WorkspacesPanelProps {
  userId: string;
  onPinQuery?: (workspaceId: string) => void;
}

export function WorkspacesPanel({ userId, onPinQuery }: WorkspacesPanelProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadWorkspaces() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/workspaces`, {
        headers: { "x-user-id": userId },
      });
      const data = await res.json();
      setWorkspaces(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspaces();
  }, [userId]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await fetch(`${API}/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
        },
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      await loadWorkspaces();
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="ws-loading">Loading workspaces...</div>;

  return (
    <div className="workspaces-panel">
      <div className="ws-header">
        <h2 className="ws-title">Workspaces</h2>
      </div>

      <div className="ws-create">
        <input
          className="ws-input"
          placeholder="Workspace name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <button
          className="ws-btn"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
        >
          {creating ? "Creating..." : "Create"}
        </button>
      </div>

      {workspaces.length === 0 ? (
        <div className="ws-empty">
          <p>No workspaces yet. Create one to save and share queries.</p>
        </div>
      ) : (
        <ul className="ws-list">
          {workspaces.map((ws) => (
            <li key={ws.id} className="ws-item">
              <span className="ws-name">{ws.name}</span>
              {onPinQuery && (
                <button
                  className="ws-pin-btn"
                  onClick={() => onPinQuery(ws.id)}
                >
                  Pin here
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
