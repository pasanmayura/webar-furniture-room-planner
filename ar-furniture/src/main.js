import { destroyChairPreview, loadChairPreview } from "./assets/chair-preview.js";
import { destroyTablePreview, loadTablePreview } from "./assets/table-preview.js";
import { destroyBedPreview, loadBedPreview } from "./assets/bed-preview.js";

const products = [
  {
    id: "chair",
    name: "Modern Lounge Chair",
    icon: "🪑",
    description: "Comfortable modern chair suitable for living rooms.",
    price: "LKR 25,000",
    dimensions: "60 cm × 65 cm × 85 cm",
    colors: [
      { name: "Brown", hex: "#8a5a3b" },
      { name: "Black", hex: "#2b2b2b" },
      { name: "White", hex: "#f4f4f2" },
    ],
  },
  {
    id: "table",
    name: "Modern Dining Table",
    icon: "🛋️",
    description: "Simple wooden dining table for modern interiors.",
    price: "LKR 45,000",
    dimensions: "120 cm × 70 cm × 75 cm",
    colors: [
      { name: "Brown", hex: "#8a5a3b" },
      { name: "Black", hex: "#2b2b2b" },
      { name: "White", hex: "#f4f4f2" },
    ],
  },
  {
    id: "bed",
    name: "Modern Double Bed",
    icon: "🛏️",
    description: "Minimal double bed designed for modern bedrooms.",
    price: "LKR 85,000",
    dimensions: "200 cm × 160 cm × 90 cm",
    colors: [
      { name: "Brown", hex: "#8a5a3b" },
      { name: "Black", hex: "#2b2b2b" },
      { name: "White", hex: "#f4f4f2" },
    ],
  },
];

let selectedProduct = null;

// ---------------------------------------------------------
// Element references
// ---------------------------------------------------------
const catalogueSection = document.getElementById("catalogue");
const catalogueView = document.getElementById("catalogueView");
const catalogueGrid = document.getElementById("catalogueGrid");
const productDetailsView = document.getElementById("productDetailsView");
const browseFurnitureBtn = document.getElementById("browseFurnitureBtn");

function renderCatalogue() {
  const cardsHtml = products
    .map(
      (product) => `
      <article class="product-card">
        <div class="product-image" aria-hidden="true">
          <span class="placeholder-icon">${product.icon}</span>
        </div>
        <div class="product-body">
          <h3 class="product-name">${product.name}</h3>
          <p class="product-desc">${product.description}</p>
          <dl class="product-meta">
            <div>
              <dt>Price</dt>
              <dd>${product.price}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>${product.dimensions}</dd>
            </div>
          </dl>
          <button type="button" class="btn btn-outline btn-block view-product-btn" data-id="${product.id}">
            View Product
          </button>
        </div>
      </article>
    `
    )
    .join("");

  catalogueGrid.innerHTML = cardsHtml;

  const viewProductButtons = document.querySelectorAll(".view-product-btn");
  viewProductButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.id;
      showProductDetails(productId);
    });
  });
}
function showProductDetails(productId) {
  selectedProduct = products.find((product) => product.id === productId);

  if (!selectedProduct) {
    console.log("Product not found:", productId);
    return;
  }

  console.log(`${selectedProduct.name} selected`);
  destroyChairPreview();
  destroyTablePreview();
  destroyBedPreview();
  const colorsHtml = selectedProduct.colors
    .map(
      (color) => `
      <li class="color-swatch">
        <span class="color-dot" style="background-color: ${color.hex};"></span>
        ${color.name}
      </li>
    `
    )
    .join("");

  productDetailsView.innerHTML = `
    <div class="details-image" id="detailsImage" aria-label="3D preview of ${selectedProduct.name}">
      ${selectedProduct.id === "chair" ? "<canvas id=\"chairPreviewCanvas\"></canvas>" : selectedProduct.id === "table" ? "<canvas id=\"tablePreviewCanvas\"></canvas>" : selectedProduct.id === "bed" ? "<canvas id=\"bedPreviewCanvas\"></canvas>" : `<span class="placeholder-icon" aria-hidden="true">${selectedProduct.icon}</span>`}
    </div>

    <div class="details-body">
      <h2 class="details-name">${selectedProduct.name}</h2>
      <p class="details-desc">${selectedProduct.description}</p>

      <dl class="details-meta">
        <div>
          <dt>Price</dt>
          <dd>${selectedProduct.price}</dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd>${selectedProduct.dimensions}</dd>
        </div>
      </dl>

      <div class="color-options">
        <span class="color-options-label">Available Colors</span>
        <ul class="color-swatches">
          ${colorsHtml}
        </ul>
      </div>

      <div class="ar-actions">
        <button type="button" class="btn btn-accent" id="previewMarkerBtn">
          Preview with Marker
        </button>
        <button type="button" class="btn btn-primary" id="viewInRoomBtn">
          View in My Room
        </button>
      </div>

      <div class="back-action">
        <button type="button" class="btn btn-outline" id="backToFurnitureBtn">
          Back to Furniture
        </button>
      </div>
    </div>
  `;

  document.getElementById("previewMarkerBtn").addEventListener("click", () => {
    const markerPageUrl = new URL("/marker-ar.html", window.location.origin);
    markerPageUrl.searchParams.set("product", selectedProduct.id);
    window.location.href = markerPageUrl;
  });

  document.getElementById("viewInRoomBtn").addEventListener("click", () => {
    const markerlessPageUrl = new URL("/markerless-ar.html", window.location.origin);
    markerlessPageUrl.searchParams.set("product", selectedProduct.id);
    window.location.href = markerlessPageUrl;
  });

  document.getElementById("backToFurnitureBtn").addEventListener("click", () => {
    showCatalogue();
  });

  catalogueView.classList.add("hidden");
  productDetailsView.classList.remove("hidden");

  if (selectedProduct.id === "chair") {
    loadChairPreview();
  } else if (selectedProduct.id === "table") {
    loadTablePreview();
  } else if (selectedProduct.id === "bed") {
    loadBedPreview();
  }

  catalogueSection.scrollIntoView({ behavior: "smooth" });
}

function showCatalogue() {
  destroyChairPreview();
  destroyTablePreview();
  destroyBedPreview();
  productDetailsView.classList.add("hidden");
  productDetailsView.innerHTML = "";
  catalogueView.classList.remove("hidden");
  catalogueSection.scrollIntoView({ behavior: "smooth" });
}

browseFurnitureBtn.addEventListener("click", () => {
  console.log("Browse Furniture clicked");
  catalogueSection.scrollIntoView({ behavior: "smooth" });
});

renderCatalogue();