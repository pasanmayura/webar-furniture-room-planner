import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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

const footprints = {
  chair: { width: 0.6, depth: 0.65 },
  table: { width: 1.2, depth: 0.7 },
  bed: { width: 2.0, depth: 1.6 },
};

let selectedProduct = "chair";

const statusMessage = document.getElementById("statusMessage");
const startWrap = document.getElementById("startWrap");
const startArBtn = document.getElementById("startArBtn");
const backLink = document.getElementById("backLink");
const furnitureControls = document.getElementById("furnitureControls");
const arHint = document.getElementById("arHint");
const canvas = document.getElementById("arScene");
const rotateButton = document.getElementById("btnRotate");
const removeButton = document.getElementById("btnRemove");

const furnitureButtons = {
  chair: document.getElementById("btnChair"),
  table: document.getElementById("btnTable"),
  bed: document.getElementById("btnBed"),
};

let renderer, scene, camera;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let currentSession = null;

const placedFurniture = [];
const interactionState = {
  selectedId: null,
  dragging: false,
  dragOffset: new THREE.Vector3(),
};

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

  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", onCanvasPointerUp);
  canvas.style.touchAction = "none";

  window.addEventListener("resize", onWindowResize);

  setupFurnitureControls();
  loadAllModels();
  setInteractionButtonsState();

  if (!("xr" in navigator)) {
    setStatus("WebXR is not available on this device or browser");
    startArBtn.disabled = true;
    return;
  }

  startArBtn.addEventListener("click", onStartArClicked);
  rotateButton.addEventListener("click", rotateSelectedFurniture);
  removeButton.addEventListener("click", removeSelectedFurniture);
}

function createReticle() {
  const geometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0x4f6f52 });
  const ring = new THREE.Mesh(geometry, material);
  ring.matrixAutoUpdate = false;
  return ring;
}

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

function setInteractionButtonsState() {
  const hasSelection = Boolean(getSelectedFurniture());
  rotateButton.disabled = !hasSelection;
  removeButton.disabled = !hasSelection;
}

function getSelectedFurniture() {
  return placedFurniture.find((item) => item.id === interactionState.selectedId) || null;
}

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

function onSelect() {
  if (!reticle.visible) {
    return;
  }

  const template = furnitureTemplates[selectedProduct];

  if (!template) {
    setStatus("Furniture model still loading — try again shortly");
    return;
  }

  const placementPosition = reticle.position.clone();
  placementPosition.y = 0;

  if (!canPlaceFurnitureAt(selectedProduct, placementPosition)) {
    setStatus("Not enough space or this spot is blocked");
    showHint("Try a more open area or another spot");
    return;
  }

  const item = createPlacedFurniture(selectedProduct, placementPosition, 0);
  selectFurniture(item);

  const label = selectedProduct.charAt(0).toUpperCase() + selectedProduct.slice(1);
  setStatus(`${label} placed`);
}

function createPlacedFurniture(product, position, rotationY = 0) {
  const template = furnitureTemplates[product];
  const instance = template.clone(true);
  instance.position.copy(position);
  instance.rotation.set(0, rotationY, 0);
  instance.position.y = 0;

  const item = {
    id: crypto.randomUUID(),
    product,
    object: instance,
    rotationY,
    bounds: null,
  };

  instance.userData.furnitureItem = item;
  instance.traverse((child) => {
    child.userData.furnitureItem = item;
    if (child.isMesh && child.material) {
      child.material.needsUpdate = true;
    }
  });

  scene.add(instance);
  placedFurniture.push(item);
  updateFurnitureBounds(item);
  return item;
}

function updateFurnitureBounds(item) {
  const required = footprints[item.product];
  const position = item.object.position;
  item.bounds = {
    minX: position.x - required.width / 2,
    maxX: position.x + required.width / 2,
    minZ: position.z - required.depth / 2,
    maxZ: position.z + required.depth / 2,
  };
}

function intersects(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

function getAvailableSurfaceBounds() {
  if (reticle && reticle.userData.surfaceBounds) {
    return reticle.userData.surfaceBounds;
  }

  return {
    minX: -1.25,
    maxX: 1.25,
    minZ: -1.25,
    maxZ: 1.25,
    width: 2.5,
    depth: 2.5,
  };
}

function hasEnoughSpace(product) {
  const required = footprints[product];
  const available = getAvailableSurfaceBounds();

  if (!required || !available) {
    return true;
  }

  return available.width >= required.width && available.depth >= required.depth;
}

function canPlaceFurnitureAt(product, position, ignoreId = null) {
  const required = footprints[product];
  const surface = getAvailableSurfaceBounds();

  if (!hasEnoughSpace(product)) {
    return false;
  }

  const candidateBounds = {
    minX: position.x - required.width / 2,
    maxX: position.x + required.width / 2,
    minZ: position.z - required.depth / 2,
    maxZ: position.z + required.depth / 2,
  };

  const fitsOnSurface =
    candidateBounds.minX >= surface.minX &&
    candidateBounds.maxX <= surface.maxX &&
    candidateBounds.minZ >= surface.minZ &&
    candidateBounds.maxZ <= surface.maxZ;

  if (!fitsOnSurface) {
    return false;
  }

  for (const item of placedFurniture) {
    if (item.id === ignoreId) continue;
    if (intersects(candidateBounds, item.bounds)) {
      return false;
    }
  }

  return true;
}

function onCanvasPointerDown(event) {
  if (!currentSession || !reticle.visible) return;

  const hit = getPlacedFurnitureHit(event);
  if (hit) {
    const item = hit.object.userData.furnitureItem || hit.object.parent?.userData.furnitureItem;
    if (!item) return;

    selectFurniture(item);
    const planePoint = getPointerWorldPointOnFloor(event);
    if (planePoint) {
      interactionState.dragging = true;
      interactionState.dragOffset.copy(planePoint).sub(item.object.position);
    }
    return;
  }

  deselectFurniture();
}

function onCanvasPointerMove(event) {
  if (!interactionState.dragging) return;

  const selected = getSelectedFurniture();
  if (!selected) return;

  const planePoint = getPointerWorldPointOnFloor(event);
  if (!planePoint) return;

  const proposedPosition = planePoint.clone().sub(interactionState.dragOffset);
  proposedPosition.y = 0;

  if (!canPlaceFurnitureAt(selected.product, proposedPosition, selected.id)) {
    showHint("This position overlaps another piece");
    return;
  }

  selected.object.position.copy(proposedPosition);
  updateFurnitureBounds(selected);
}

function onCanvasPointerUp() {
  interactionState.dragging = false;
  interactionState.dragOffset.set(0, 0, 0);
}

function getPlacedFurnitureHit(event) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);

  let nearestHit = null;
  let nearestDistance = Infinity;

  for (const item of placedFurniture) {
    const hits = raycaster.intersectObject(item.object, true);
    if (hits.length > 0 && hits[0].distance < nearestDistance) {
      nearestHit = hits[0];
      nearestDistance = hits[0].distance;
    }
  }

  return nearestHit;
}

function getPointerWorldPointOnFloor(event) {
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, point);
}

function selectFurniture(item) {
  if (!item) return;

  interactionState.selectedId = item.id;
  item.object.traverse((child) => {
    if (child.material) {
      const materialList = Array.isArray(child.material) ? child.material : [child.material];
      materialList.forEach((material) => {
        if (!material.emissive) {
          material.emissive = new THREE.Color(0x111111);
        }
        material.emissiveIntensity = 0.5;
      });
    }
  });

  setInteractionButtonsState();
}

function deselectFurniture() {
  const selected = getSelectedFurniture();
  if (!selected) return;

  selected.object.traverse((child) => {
    if (child.material) {
      const materialList = Array.isArray(child.material) ? child.material : [child.material];
      materialList.forEach((material) => {
        if (material.emissive) {
          material.emissiveIntensity = 0;
        }
      });
    }
  });

  interactionState.selectedId = null;
  setInteractionButtonsState();
}

function removeSelectedFurniture() {
  const selected = getSelectedFurniture();
  if (!selected) {
    showHint("Select a furniture to remove");
    return;
  }

  scene.remove(selected.object);
  const index = placedFurniture.findIndex((item) => item.id === selected.id);
  if (index >= 0) {
    placedFurniture.splice(index, 1);
  }

  interactionState.selectedId = null;
  setInteractionButtonsState();
  setStatus("Furniture removed");
}

function rotateSelectedFurniture() {
  const selected = getSelectedFurniture();
  if (!selected) {
    showHint("Select a furniture to rotate");
    return;
  }

  const originalRotation = selected.object.rotation.y;
  const nextRotation = originalRotation + Math.PI / 2;
  selected.object.rotation.y = nextRotation;

  if (!canPlaceFurnitureAt(selected.product, selected.object.position.clone(), selected.id)) {
    selected.object.rotation.y = originalRotation;
    showHint("Rotation would overlap another piece");
    return;
  }

  selected.rotationY = nextRotation;
  updateFurnitureBounds(selected);
  setStatus("Furniture rotated");
}

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
        reticle.userData.surfaceSize = estimateSurfaceSize(hit);
        reticle.userData.surfaceBounds = estimateSurfaceBounds(hit);

        const placementIsValid = hasEnoughSpace(selectedProduct);
        reticle.material.color.set(placementIsValid ? 0x4f6f52 : 0xff5f5f);

        if (statusMessage.textContent === "Move your phone slowly to find a surface") {
          setStatus("Surface found - tap to place");
        }
      } else {
        reticle.visible = false;
        if (statusMessage.textContent === "Surface found - tap to place") {
          setStatus("Move your phone slowly to find a surface");
        }
      }
    }
  }

  renderer.render(scene, camera);
}

function estimateSurfaceBounds(hit) {
  try {
    if (hit.getPlane) {
      const plane = hit.getPlane();
      if (plane && plane.polygon && plane.polygon.length >= 3) {
        const xs = plane.polygon.map((point) => point.x);
        const zs = plane.polygon.map((point) => point.z);
        return {
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minZ: Math.min(...zs),
          maxZ: Math.max(...zs),
          width: Math.max(...xs) - Math.min(...xs),
          depth: Math.max(...zs) - Math.min(...zs),
        };
      }
    }
  } catch (error) {
    // Plane data not available — fall through to default.
  }

  return {
    minX: -1.25,
    maxX: 1.25,
    minZ: -1.25,
    maxZ: 1.25,
    width: 2.5,
    depth: 2.5,
  };
}

function estimateSurfaceSize(hit) {
  const bounds = estimateSurfaceBounds(hit);
  return { width: bounds.width, depth: bounds.depth };
}

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