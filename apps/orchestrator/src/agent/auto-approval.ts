const GOVERNMENT_DOMAINS = [
  "gov.uk",
  "data.gov.uk",
  "environment.data.gov.uk",
  "api.ons.gov.uk",
  "api.tfl.gov.uk",
  "data.police.uk",
  "opendata.bristol.gov.uk",
  // FSA (Food Standards Agency) open data — official UK government body
  "fsaopendata.blob.core.windows.net",
];

const AUTO_APPROVAL_CONFIDENCE_THRESHOLD = 0.9;

interface AutoApprovalInput {
  confidence: number;
  providerType: string;
  apiUrl: string;
}

function isGovernmentDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return GOVERNMENT_DOMAINS.some((domain) => hostname.endsWith(domain));
  } catch {
    return false;
  }
}

export function shouldAutoApprove(input: AutoApprovalInput): boolean {
  return (
    input.confidence >= AUTO_APPROVAL_CONFIDENCE_THRESHOLD &&
    input.providerType === "rest" &&
    isGovernmentDomain(input.apiUrl)
  );
}

export function autoApprovalReason(input: AutoApprovalInput): string {
  if (input.confidence < AUTO_APPROVAL_CONFIDENCE_THRESHOLD) {
    return `Confidence ${input.confidence} does not exceed threshold ${AUTO_APPROVAL_CONFIDENCE_THRESHOLD}`;
  }
  if (input.providerType !== "rest") {
    return `Provider type "${input.providerType}" requires manual review`;
  }
  if (!isGovernmentDomain(input.apiUrl)) {
    return `Domain is not in the known-safe government domain list`;
  }
  return `Auto-approved: high-confidence REST API from known government domain`;
}
