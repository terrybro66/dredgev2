import { useState, useEffect } from "react";

interface QueryHistoryItem {
  id: string;
  text: string;
  timestamp: Date;
  resultCount: number;
  category: string;
  location: string;
}

interface Props {
  onSelect: (query: string) => void;
  currentQuery?: string;
}

const STORAGE_KEY = "dredge-query-history";

export function QueryHistory({ onSelect, currentQuery }: Props) {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setHistory(parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp)
        })));
      } catch (e) {
        console.error("Failed to parse query history:", e);
      }
    }
  }, []);

  const addToHistory = (query: string, resultCount: number, category: string, location: string) => {
    const newItem: QueryHistoryItem = {
      id: Date.now().toString(),
      text: query,
      timestamp: new Date(),
      resultCount,
      category,
      location
    };

    const updatedHistory = [newItem, ...history.filter(h => h.text !== query)].slice(0, 20);
    setHistory(updatedHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Expose method to add to history via window or context
  useEffect(() => {
    (window as any).addQueryToHistory = addToHistory;
    return () => {
      delete (window as any).addQueryToHistory;
    };
  }, [history]);

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="query-history">
      <div className="history-header">
        <button 
          className="history-toggle"
          onClick={() => setIsOpen(!isOpen)}
        >
          🕐 Recent Queries ({history.length})
        </button>
        {isOpen && (
          <button 
            className="history-clear"
            onClick={clearHistory}
            title="Clear history"
          >
            ✕
          </button>
        )}
      </div>
      
      {isOpen && (
        <div className="history-list">
          {history.map((item) => (
            <div
              key={item.id}
              className={`history-item ${item.text === currentQuery ? 'current' : ''}`}
              onClick={() => {
                onSelect(item.text);
                setIsOpen(false);
              }}
            >
              <div className="history-query">{item.text}</div>
              <div className="history-meta">
                <span className="history-location">📍 {item.location}</span>
                <span className="history-count">{item.resultCount} results</span>
                <span className="history-time">{formatRelativeTime(item.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
