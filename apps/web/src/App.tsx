import { useState } from "react";
import { QueryInput } from "./components/QueryInput";
import { IntentConfirmation } from "./components/IntentConfirmation";
import { IntentError } from "./components/IntentError";
import { ResultRenderer } from "./components/ResultRenderer";

// TODO: implement App
// - useState for confirmation, result, loading, error
// - handleQuery(text) → POST /query/parse → on success set confirmation, on IntentError show error component
// - handleConfirm() → POST /query/execute with confirmed plan → set result
// - handleRefine() → clear confirmation, return user to input with text pre-populated
// - render QueryInput, IntentConfirmation (when confirmation set), ResultRenderer (when result set)

export default function App() {
  return (
    <div>
      <h1>dredge</h1>
      {/* TODO: render pipeline components */}
    </div>
  );
}
