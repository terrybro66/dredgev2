// TODO: implement QueryInput
// - controlled input, pre-populated when user refines a previous query
// - submit on enter or button click
// - disable while loading
// - loading label: "Interpreting..." during parse, "Fetching data..." during execute

interface Props {
  onSubmit: (text: string) => void;
  initialValue?: string;
  loading?: boolean;
  loadingLabel?: string;
}

export function QueryInput({
  onSubmit,
  initialValue = "",
  loading = false,
  loadingLabel = "Loading...",
}: Props) {
  return <div>TODO: QueryInput</div>;
}
