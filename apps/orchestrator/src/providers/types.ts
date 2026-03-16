export interface Provider {
  fetchRows: () => Promise<unknown[]>;
}
