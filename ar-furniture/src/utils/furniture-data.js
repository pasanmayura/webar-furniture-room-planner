export const FURNITURE_OPTIONS = {
  chair: {
    id: "chair",
    name: "Modern Lounge Chair",
    model: "/models/chair.glb",
    marker: "/markers/chair-target.mind",
    width: 0.60,
    depth: 0.65
  },
  table: {
    id: "table",
    name: "Modern Dining Table",
    model: "/models/table.glb",
    marker: "/markers/table-target.mind",
    width: 1.20,
    depth: 0.70
  },
  bed: {
    id: "bed",
    name: "Modern Double Bed",
    model: "/models/bed.glb",
    marker: "/markers/bed-target.mind",
    width: 2.00,
    depth: 1.60
  }
};

export const FURNITURE_SIZES = {
  chair: { width: 0.60, depth: 0.65 },
  table: { width: 1.20, depth: 0.70 },
  bed: { width: 2.00, depth: 1.60 }
};

export function getFurnitureOption(productId) {
  return FURNITURE_OPTIONS[productId] || FURNITURE_OPTIONS.chair;
}

export function getFurnitureSize(productId) {
  return FURNITURE_SIZES[productId] || FURNITURE_SIZES.chair;
}
