export type ProviderType = "rest" | "csv" | "xlsx" | "pdf";

export type RefreshPolicy = "realtime" | "daily" | "weekly" | "static";

export type ProviderSource = {
  url: string;
  providerType: ProviderType;
  refreshPolicy: RefreshPolicy;
};

export type ProviderMeta = {
  url: string;
  providerType: ProviderType;
  rowCount: number;
  fetchedAt: Date;
};

export type ProviderResult = {
  rows: Record<string, unknown>[];
  meta: ProviderMeta;
};

export class ProviderFetchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderFetchError";
  }
}

export type Provider = {
  fetchData: (source: ProviderSource) => Promise<ProviderResult>;
};
