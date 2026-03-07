export interface DiscoveryCategory {
  id: string;
  label: string;
  placeTypes: string[];
}

export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  {
    id: "restaurants",
    label: "Restaurants & cafes",
    placeTypes: ["restaurant", "cafe", "bakery"],
  },
  {
    id: "trades",
    label: "Trades & contractors",
    placeTypes: ["electrician", "plumber", "general_contractor"],
  },
  {
    id: "salons",
    label: "Salons & barbers",
    placeTypes: ["beauty_salon", "hair_care"],
  },
  {
    id: "auto",
    label: "Auto repair & detailing",
    placeTypes: ["car_repair", "car_wash"],
  },
  {
    id: "retail",
    label: "Retail & boutiques",
    placeTypes: ["store", "clothing_store", "home_goods_store"],
  },
  {
    id: "professional",
    label: "Professional services",
    placeTypes: ["lawyer", "accounting", "real_estate_agency"],
  },
  {
    id: "health",
    label: "Health & wellness",
    placeTypes: ["dentist", "physiotherapist", "spa"],
  },
  {
    id: "fitness",
    label: "Fitness & gyms",
    placeTypes: ["gym"],
  },
  {
    id: "pets",
    label: "Pet services",
    placeTypes: ["pet_store", "veterinary_care"],
  },
  {
    id: "cleaning",
    label: "Cleaning services",
    placeTypes: ["laundry"],
  },
];

const CATEGORY_MAP = new Map(
  DISCOVERY_CATEGORIES.map((category) => [category.id, category])
);

export function expandDiscoveryCategoryIds(ids: string[]): string[] {
  const types = new Set<string>();

  for (const id of ids) {
    const category = CATEGORY_MAP.get(id);
    const placeTypes = category ? category.placeTypes : [id];

    for (const placeType of placeTypes) {
      const normalized = placeType.trim();
      if (normalized) {
        types.add(normalized);
      }
    }
  }

  return [...types];
}
