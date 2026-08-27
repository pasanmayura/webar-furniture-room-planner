import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------------------------------------------------------
// Config
// ---------------------------------------------------------

// Reusable model templates — cloned into the scene on each placement
// so the same loaded geometry/material can be placed multiple times.
const furnitureTemplates = {
  chair: null,
  table: null,
  bed: null,
};

const modelPaths = {
  chair: "/models/chair.glb",
  table: "/models/table.glb",
  bed: "/models/bed.glb",
};

// Rough real-world footprint (metres) used for the "enough space" check
// against the size of the detected hit-test surface.
const footprints = {
  chair: { width: 0.6, depth: 0.65 },
  table: { width: 1.2, depth: 0.7 },
  bed: { width: 2.0, depth: 1.6 },
};

let selectedProduct = "chair";

// ---------------------------------------------------------
// DOM references
// ---------------------------------------------------------
const statusMessage = document.getElementById("statusMessage");
const startWrap = document.getElementById("startWrap");
const startArBtn = document.getElementById("startArBtn");
const backLink = document.getElementById("backLink");
const furnitureControls = document.getElementById("furnitureControls");
const arHint = document.getElementById("arHint");
const canvas = document.getElementById("arScene");

const furnitureButtons = {
  chair: document.getElementById("btnChair"),
  table: document.getElementById("btnTable"),
  bed: document.getElementById("btnBed"),
};

// ---------------------------------------------------------
// Three.js / WebXR state
// ---------------------------------------------------------
let renderer, scene, camera;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let currentSession = null;

const placedFurniture = [];
let hintTimeoutId = null;

init();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  const light = new THREE.HemisphereLight(0xffffff, 0x555555, 1.2);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  const directional = new THREE.DirectionalLight(0xffffff, 0.6);
  directional.position.set(1, 2, 1);
  scene.add(directional);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  reticle = createReticle();
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener("resize", onWindowResize);

  setupFurnitureControls();
  loadAllModels();

  if (!("xr" in navigator)) {
    setStatus("WebXR is not available on this device or browser");
    startArBtn.disabled = true;
    return;
  }

  startArBtn.addEventListener("click", onStartArClicked);
}

// ---------------------------------------------------------
// Reticle (surface indicator)
// ---------------------------------------------------------
function createReticle() {
  const geometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0x4f6f52 });
  const ring = new THREE.Mesh(geometry, material);
  ring.matrixAutoUpdate = false;
  return ring;
}

// ---------------------------------------------------------
// Loading the three reusable model templates
// ---------------------------------------------------------
function loadAllModels() {
  const loader = new GLTFLoader();
  const productKeys = Object.keys(modelPaths);

  productKeys.forEach((key) => {
    loader.load(
      modelPaths[key],
      (gltf) => {
        const model = gltf.scene;
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        furnitureTemplates[key] = model;
      },
      undefined,
      (error) => {
        console.error(`Failed to load model for "${key}":`, error);
      }
    );
  });
}

// ---------------------------------------------------------
// Furniture selection UI
// ---------------------------------------------------------
function setupFurnitureControls() {
  Object.keys(furnitureButtons).forEach((key) => {
    furnitureButtons[key].addEventListener("click", () => {
      selectProduct(key);
    });
  });
}

function selectProduct(key) {
  selectedProduct = key;

  Object.keys(furnitureButtons).forEach((btnKey) => {
    furnitureButtons[btnKey].classList.toggle("selected", btnKey === key);
  });

  const label = key.charAt(0).toUpperCase() + key.slice(1);
  setStatus(`${label} selected`);
}

// ---------------------------------------------------------
// Starting the AR session (markerless, hit-test based)
// ---------------------------------------------------------
function onStartArClicked() {
  if (currentSession) return;

  navigator.xr
    .isSessionSupported("immersive-ar")
    .then((supported) => {
      if (!supported) {
        setStatus("Markerless AR is not supported on this device");
        return;
      }

      navigator.xr
        .requestSession("immersive-ar", {
          requiredFeatures: ["hit-test"],
          optionalFeatures: ["dom-overlay"],
          domOverlay: { root: document.body },
        })
        .then(onSessionStarted)
        .catch((error) => {
          console.error("Failed to start AR session:", error);
          setStatus("Could not start AR — check camera permissions");
        });
    });
}

function onSessionStarted(session) {
  currentSession = session;

  renderer.xr.setReferenceSpaceType("local");
  renderer.xr.setSession(session);

  startWrap.classList.add("hidden");
  backLink.classList.add("hidden");
  furnitureControls.classList.remove("hidden");

  setStatus("Move your phone slowly to find a surface");

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  session.addEventListener("end", onSessionEnded);

  renderer.setAnimationLoop(render);
}

function onSessionEnded() {
  currentSession = null;
  hitTestSource = null;
  hitTestSourceRequested = false;
  reticle.visible = false;

  startWrap.classList.remove("hidden");
  backLink.classList.remove("hidden");
  furnitureControls.classList.add("hidden");

  renderer.setAnimationLoop(null);
  setStatus("Press Start AR");
}

// ---------------------------------------------------------
// Handling a tap ("select" event) to place furniture
// ---------------------------------------------------------
function onSelect() {
  if (!reticle.visible) {
    return;
  }

  const template = furnitureTemplates[selectedProduct];

  if (!template) {
    setStatus("Furniture model still loading — try again shortly");
    return;
  }

  if (!hasEnoughSpace(selectedProduct)) {
    setStatus("Not enough space");
    showHint("Try a more open area of the surface");
    return;
  }

  const instance = template.clone(true);
  instance.position.setFromMatrixPosition(reticle.matrix);
  instance.quaternion.setFromRotationMatrix(reticle.matrix);

  scene.add(instance);
  placedFurniture.push({ product: selectedProduct, object: instance });

  const label =
    selectedProduct.charAt(0).toUpperCase() + selectedProduct.slice(1);
  setStatus(`${label} placed`);
}

// Rough space check: compares the item's footprint against the size of
// the detected surface reported by the last hit-test result.
function hasEnoughSpace(product) {
  const required = footprints[product];
  const available = reticle.userData.surfaceSize;

  if (!required || !available) {
    return true;
  }

  return available.width >= required.width && available.depth >= required.depth;
}

// ---------------------------------------------------------
// Render loop / hit-testing
// ---------------------------------------------------------
function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session
          .requestHitTestSource({ space: viewerSpace })
          .then((source) => {
            hitTestSource = source;
          });
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);

        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);

        // Approximate available surface size from the plane, when exposed.
        reticle.userData.surfaceSize = estimateSurfaceSize(hit);

        if (statusMessage.textContent === "Move your phone slowly to find a surface") {
          setStatus("Surface found - tap to place");
        }
      } else {
        reticle.visible = false;
        if (
          statusMessage.textContent === "Surface found - tap to place"
        ) {
          setStatus("Move your phone slowly to find a surface");
        }
      }
    }
  }

  renderer.render(scene, camera);
}

// Best-effort surface size estimate. The Hit Test API does not always
// expose plane geometry, so this falls back to a generous default so
// placement isn't blocked when the browser doesn't report it.
function estimateSurfaceSize(hit) {
  try {
    if (hit.getPlane) {
      const plane = hit.getPlane();
      if (plane && plane.polygon) {
        const xs = plane.polygon.map((p) => p.x);
        const zs = plane.polygon.map((p) => p.z);
        return {
          width: Math.max(...xs) - Math.min(...xs),
          depth: Math.max(...zs) - Math.min(...zs),
        };
      }
    }
  } catch (error) {
    // Plane data not available — fall through to default.
  }

  return { width: 2.5, depth: 2.5 };
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function setStatus(message) {
  statusMessage.textContent = message;
}

function showHint(message) {
  arHint.textContent = message;
  arHint.classList.add("visible");

  if (hintTimeoutId) {
    clearTimeout(hintTimeoutId);
  }

  hintTimeoutId = setTimeout(() => {
    arHint.classList.remove("visible");
  }, 2200);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}