import { useQuery } from "@tanstack/react-query";
import { API_URL, api, getAuthToken } from "@/lib/api";

export interface MapLocation {
  id: string;
  type: "deal" | "prospect" | "company";
  name: string;
  phone?: string;
  city?: string;
  state?: string;
  lat: number;
  lng: number;
  value?: number;
  owner_id?: string;
  owner_name?: string;
  created_at?: string;
  company_name?: string;
  address?: string;
  cnpj?: string;
  cnae?: string;
  porte?: string;
}

// Brazilian state capitals coordinates
const STATE_CAPITALS: Record<string, { lat: number; lng: number }> = {
  AC: { lat: -9.9753, lng: -67.8243 },
  AL: { lat: -9.6499, lng: -35.7089 },
  AM: { lat: -3.1190, lng: -60.0217 },
  AP: { lat: 0.0356, lng: -51.0705 },
  BA: { lat: -12.9714, lng: -38.5014 },
  CE: { lat: -3.7172, lng: -38.5433 },
  DF: { lat: -15.8267, lng: -47.9218 },
  ES: { lat: -20.3155, lng: -40.3128 },
  GO: { lat: -16.6864, lng: -49.2643 },
  MA: { lat: -2.5387, lng: -44.2826 },
  MG: { lat: -19.9167, lng: -43.9345 },
  MS: { lat: -20.4697, lng: -54.6201 },
  MT: { lat: -15.5989, lng: -56.0949 },
  PA: { lat: -1.4558, lng: -48.4902 },
  PB: { lat: -7.1195, lng: -34.8450 },
  PE: { lat: -8.0476, lng: -34.8770 },
  PI: { lat: -5.0892, lng: -42.8019 },
  PR: { lat: -25.4195, lng: -49.2646 },
  RJ: { lat: -22.9068, lng: -43.1729 },
  RN: { lat: -5.7945, lng: -35.2110 },
  RO: { lat: -8.7612, lng: -63.9039 },
  RR: { lat: 2.8235, lng: -60.6758 },
  RS: { lat: -30.0346, lng: -51.2177 },
  SC: { lat: -27.5954, lng: -48.5480 },
  SE: { lat: -10.9472, lng: -37.0731 },
  SP: { lat: -23.5505, lng: -46.6333 },
  TO: { lat: -10.1689, lng: -48.3317 },
};

// Common city coordinates (expandable)
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  "são paulo": { lat: -23.5505, lng: -46.6333 },
  "rio de janeiro": { lat: -22.9068, lng: -43.1729 },
  "belo horizonte": { lat: -19.9167, lng: -43.9345 },
  "brasília": { lat: -15.8267, lng: -47.9218 },
  "salvador": { lat: -12.9714, lng: -38.5014 },
  "fortaleza": { lat: -3.7172, lng: -38.5433 },
  "curitiba": { lat: -25.4195, lng: -49.2646 },
  "recife": { lat: -8.0476, lng: -34.8770 },
  "porto alegre": { lat: -30.0346, lng: -51.2177 },
  "manaus": { lat: -3.1190, lng: -60.0217 },
  "belém": { lat: -1.4558, lng: -48.4902 },
  "goiânia": { lat: -16.6864, lng: -49.2643 },
  "guarulhos": { lat: -23.4543, lng: -46.5337 },
  "campinas": { lat: -22.9099, lng: -47.0626 },
  "florianópolis": { lat: -27.5954, lng: -48.5480 },
  "natal": { lat: -5.7945, lng: -35.2110 },
  "joão pessoa": { lat: -7.1195, lng: -34.8450 },
  "vitória": { lat: -20.3155, lng: -40.3128 },
  "cuiabá": { lat: -15.5989, lng: -56.0949 },
  "campo grande": { lat: -20.4697, lng: -54.6201 },
};

export function getCoordinates(city?: string, state?: string): { lat: number; lng: number } | null {
  // Try city first
  if (city) {
    const cityLower = city.toLowerCase().trim();
    if (CITY_COORDS[cityLower]) {
      // Add small random offset to avoid exact overlap
      const offset = () => (Math.random() - 0.5) * 0.05;
      return {
        lat: CITY_COORDS[cityLower].lat + offset(),
        lng: CITY_COORDS[cityLower].lng + offset(),
      };
    }
  }

  // Fallback to state capital
  if (state) {
    const stateUpper = state.toUpperCase().trim();
    if (STATE_CAPITALS[stateUpper]) {
      const offset = () => (Math.random() - 0.5) * 0.1;
      return {
        lat: STATE_CAPITALS[stateUpper].lat + offset(),
        lng: STATE_CAPITALS[stateUpper].lng + offset(),
      };
    }
  }

  return null;
}

export interface MapFilters {
  owner_id?: string;
  date_type?: "created" | "activity";
  date_from?: string;
  date_to?: string;
}

async function fetchMapData(filters: MapFilters): Promise<MapLocation[]> {
  const params = new URLSearchParams();
  if (filters.owner_id) params.set("owner_id", filters.owner_id);
  if (filters.date_type) params.set("date_type", filters.date_type);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/crm/map-data${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch map data");
  return res.json();
}

export function useMapData(filters: MapFilters = {}) {
  return useQuery({
    queryKey: ["crm-map-data", filters],
    queryFn: () => fetchMapData(filters),
  });
}

export interface MapUser {
  id: string;
  name: string;
}

async function fetchMapUsers(): Promise<MapUser[]> {
  try {
    const viaMap = await api<any[]>('/api/crm/map-users');
    if (Array.isArray(viaMap) && viaMap.length) {
      return viaMap
        .map((m: any) => ({ id: m.id || m.user_id, name: m.name || m.email || m.full_name }))
        .filter((m: any) => m.id);
    }
  } catch (e) {
    console.error('[use-map-data] map-users failed:', e);
  }
  try {
    const orgs = await api<any[]>('/api/organizations');
    const orgId = orgs?.[0]?.id || sessionStorage.getItem('user_org_id') || localStorage.getItem('user_org_id');
    if (orgId) {
      const members = await api<any[]>(`/api/organizations/${orgId}/members`);
      if (Array.isArray(members) && members.length) {
        return members
          .map((m: any) => ({ id: m.user_id || m.id, name: m.name || m.email || m.full_name }))
          .filter((m: any) => m.id);
      }
    }
  } catch (e) {
    console.error('[use-map-data] org-members failed:', e);
  }
  return [];
}

export function useMapUsers() {
  return useQuery({
    queryKey: ["crm-map-users"],
    queryFn: fetchMapUsers,
  });
}
