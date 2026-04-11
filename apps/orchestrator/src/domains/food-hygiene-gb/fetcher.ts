/**
 * food-hygiene-gb/fetcher.ts
 *
 * Fetches food business hygiene ratings from the FSA Ratings API.
 * https://api.ratings.food.gov.uk/
 *
 * No API key required. Requires header: x-api-version: 2
 * Supports search by address/place name, returns up to pageSize establishments.
 */

const BASE_URL = "https://api.ratings.food.gov.uk/Establishments";
const PAGE_SIZE = 100;

export interface FoodEstablishment {
  name: string;
  businessType: string | null;
  rating: string | null;
  ratingDate: string | null;
  address: string | null;
  postCode: string | null;
  localAuthority: string | null;
  lat: number | null;
  lon: number | null;
}

interface FsaEstablishment {
  BusinessName?: string;
  BusinessType?: string;
  RatingValue?: string;
  RatingDate?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  AddressLine4?: string;
  PostCode?: string;
  LocalAuthorityName?: string;
  Geocode?: {
    Longitude?: number | string | null;
    Latitude?: number | string | null;
  };
}

interface FsaResponse {
  establishments?: FsaEstablishment[];
}

export async function fetchFoodEstablishments(
  location: string,
): Promise<FoodEstablishment[]> {
  const params = new URLSearchParams({
    address: location,
    pageSize: String(PAGE_SIZE),
  });

  const url = `${BASE_URL}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      "x-api-version": "2",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`FSA Ratings API returned ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as FsaResponse;
  const establishments = data.establishments ?? [];

  const withGeocode = establishments.filter(
    (e) => e.Geocode?.Latitude != null && e.Geocode?.Longitude != null
  ).length;
  console.log(JSON.stringify({
    event: "fsa_response",
    count: establishments.length,
    with_geocode: withGeocode,
  }));

  return establishments.map((e) => {
    const addressParts = [
      e.AddressLine1,
      e.AddressLine2,
      e.AddressLine3,
      e.AddressLine4,
    ].filter(Boolean);

    const lat = e.Geocode?.Latitude != null ? parseFloat(String(e.Geocode.Latitude)) : null;
    const lon = e.Geocode?.Longitude != null ? parseFloat(String(e.Geocode.Longitude)) : null;

    return {
      name: e.BusinessName ?? "Unknown",
      businessType: e.BusinessType ?? null,
      rating: e.RatingValue ?? null,
      ratingDate: e.RatingDate ?? null,
      address: addressParts.join(", ") || null,
      postCode: e.PostCode ?? null,
      localAuthority: e.LocalAuthorityName ?? null,
      lat: lat && Number.isFinite(lat) ? lat : null,
      lon: lon && Number.isFinite(lon) ? lon : null,
    };
  });
}
