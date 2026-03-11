// TODO: implement IntentError
// - show understood fields as green chips — "Got: burglary, January 2024"
// - show missing fields as amber chips — "Missing: location"
// - show message as plain text explanation
// - show "Try again" link that returns focus to the input

interface Props {
  error: any; // TODO: type as IntentError from @dredge/schemas
  onRetry: () => void;
}

export function IntentError({ error, onRetry }: Props) {
  return <div>TODO: IntentError</div>;
}
