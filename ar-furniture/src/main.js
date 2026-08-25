// =========================================================
// main.js
// Step 1: UI-only interactions. No AR / 3D logic yet.
// Every handler below just logs to the console as a
// placeholder for functionality that will be added later
// (routing to a product page, launching AR.js / Three.js, etc.)
// =========================================================

// ---------- Hero section buttons ----------

const browseFurnitureBtn = document.getElementById("browseFurnitureBtn");
const startArBtn = document.getElementById("startArBtn");

// "Browse Furniture" scrolls down to the catalogue section
browseFurnitureBtn.addEventListener("click", () => {
  console.log("Browse Furniture clicked");
  document.getElementById("catalogue").scrollIntoView({ behavior: "smooth" });
});

// "Start AR" scrolls down to the AR mode section
startArBtn.addEventListener("click", () => {
  console.log("Start AR clicked");
  document.getElementById("ar-modes").scrollIntoView({ behavior: "smooth" });
});

// ---------- Furniture catalogue buttons ----------

// "View Product" buttons — one per product card
const viewProductButtons = document.querySelectorAll(".view-product-btn");
viewProductButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const productName = button.dataset.product;
    console.log(`${productName} selected`);
    console.log(`View Product details for: ${productName}`);
  });
});

// "View in AR" buttons — one per product card
const viewArButtons = document.querySelectorAll(".view-ar-btn");
viewArButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const productName = button.dataset.product;
    console.log(`View in AR requested for: ${productName}`);
    // TODO: launch product-specific AR preview once AR is implemented
  });
});

// ---------- AR mode section buttons ----------

const markerArBtn = document.getElementById("markerArBtn");
const markerlessArBtn = document.getElementById("markerlessArBtn");

markerArBtn.addEventListener("click", () => {
  console.log("Marker AR selected");
  // TODO: initialize marker-based AR session (AR.js) here
});

markerlessArBtn.addEventListener("click", () => {
  console.log("Markerless AR selected");
  // TODO: initialize markerless / surface-detection AR session here
});