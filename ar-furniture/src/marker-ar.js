import { getFurnitureOption } from "./utils/furniture-data.js";
import { playMarkerDetectedSound } from "./utils/ar-audio.js";
import { createSoftShadowTexture } from "./utils/ar-shadows.js";
import { applySelectedColor } from "./utils/ar-spatial.js";

const params = new URLSearchParams(window.location.search);
const productId = params.get("product");
const selectedColor = params.get("color");
const furniture = getFurnitureOption(productId);

const scene = document.getElementById("marker-scene");
const model = document.getElementById("furniture-model");
const target = document.getElementById("furniture-target");
const status = document.getElementById("marker-status");

let interactionCanvas = document.querySelector("canvas.a-canvas");
let threeShadow = null;
let modelReady = false;
let userIsRotating = false;
let previousPointerX = 0;
let previousPointerY = 0;
let rotationControlsAttached = false;

const MODEL_FIT_SIZE = 0.3;

function downloadSelectedTarget() {
  if (!furniture.targetImage) {
    return;
  }

  const downloadLink = document.createElement("a");
  downloadLink.href = furniture.targetImage;
  downloadLink.download = `${furniture.id}-target.png`;
  downloadLink.hidden = true;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
}

function rotateModelAutomatically() {
  if (modelReady && !userIsRotating && model.object3D.visible) {
    model.object3D.rotation.y += 0.01;
  }
  requestAnimationFrame(rotateModelAutomatically);
}

function startUserRotation(event) {
  if (!modelReady) return;
  userIsRotating = true;
  previousPointerX = event.clientX;
  previousPointerY = event.clientY;
  interactionCanvas?.setPointerCapture(event.pointerId);
}

function continueUserRotation(event) {
  if (!userIsRotating) return;

  const horizontalChange = event.clientX - previousPointerX;
  const verticalChange = event.clientY - previousPointerY;

  model.object3D.rotation.y += horizontalChange * 0.01;
  model.object3D.rotation.x = Math.max(
    -0.35,
    Math.min(0.35, model.object3D.rotation.x + verticalChange * 0.005)
  );

  previousPointerX = event.clientX;
  previousPointerY = event.clientY;
}

function stopUserRotation(event) {
  userIsRotating = false;
  if (
    event?.pointerId !== undefined &&
    interactionCanvas?.hasPointerCapture(event.pointerId)
  ) {
    interactionCanvas.releasePointerCapture(event.pointerId);
  }
}

function attachRotationControls() {
  if (!interactionCanvas) {
    interactionCanvas = scene.canvas || scene.querySelector("canvas.a-canvas");
  }

  if (!interactionCanvas || rotationControlsAttached) {
    return;
  }

  interactionCanvas.addEventListener("pointerdown", startUserRotation);
  interactionCanvas.addEventListener("pointermove", continueUserRotation);
  interactionCanvas.addEventListener("pointerup", stopUserRotation);
  interactionCanvas.addEventListener("pointercancel", stopUserRotation);

  rotationControlsAttached = true;
}

function setupThreeLighting(threeModel, three) {
  threeModel.updateMatrixWorld(true);

  const renderer = scene.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = three.PCFSoftShadowMap;

  const keyLight = new three.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(1, 3, 2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.01;
  keyLight.shadow.camera.far = 8;
  keyLight.shadow.camera.left = -2;
  keyLight.shadow.camera.right = 2;
  keyLight.shadow.camera.top = 2;
  keyLight.shadow.camera.bottom = -2;

  scene.object3D.add(keyLight);

  const fillLight = new three.HemisphereLight(0xffffff, 0x444444, 1.4);
  scene.object3D.add(fillLight);

  threeModel.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  threeModel.updateMatrixWorld(true);

  const bounds = new three.Box3().setFromObject(threeModel);
  const size = bounds.getSize(new three.Vector3());
  const shadowSize = Math.max(size.x, size.z, 0.18) * 1.5;

  const shadowMaterial = new three.MeshBasicMaterial({
    map: createSoftShadowTexture(three),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });

  const shadowGeometry = new three.PlaneGeometry(shadowSize, shadowSize);
  threeShadow = new three.Mesh(shadowGeometry, shadowMaterial);
  threeShadow.rotation.x = -Math.PI / 2;
  threeShadow.position.set(0, 0.002, 0);
  threeShadow.renderOrder = 1;

  target.object3D.add(threeShadow);
}

document.title = `${furniture.name} - Marker AR`;

scene.setAttribute(
  "mindar-image",
  `imageTargetSrc: ${furniture.marker}; autoStart: true; uiScanning: yes; uiLoading: yes;`
);
model.setAttribute("gltf-model", furniture.model);

model.addEventListener("model-loaded", (event) => {
  const threeModel = event.detail.model;

  if (!threeModel) {
    status.textContent = `Unable to load the ${furniture.name.toLowerCase()} model.`;
    return;
  }

  const three = window.AFRAME ? window.AFRAME.THREE : THREE;

  threeModel.updateMatrixWorld(true);
  applySelectedColor(threeModel, selectedColor);

  const bounds = new three.Box3().setFromObject(threeModel);
  const size = bounds.getSize(new three.Vector3());
  const center = bounds.getCenter(new three.Vector3());

  const boundsAreValid =
    isFinite(size.x) &&
    isFinite(size.y) &&
    isFinite(size.z) &&
    !(size.x === 0 && size.y === 0 && size.z === 0);

  if (boundsAreValid) {
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
    threeModel.position.sub(center);
    threeModel.scale.setScalar(MODEL_FIT_SIZE / maxDimension);
    model.setAttribute("position", "0 0 0");
  } else {
    model.setAttribute("scale", "1 1 1");
  }

  threeModel.updateMatrixWorld(true);
  setupThreeLighting(threeModel, three);
  model.setAttribute("visible", "true");
  modelReady = true;

  status.textContent = `${furniture.name} ready. Point your camera at the marker.`;
});

model.addEventListener("model-error", () => {
  status.textContent = `Unable to load the ${furniture.name.toLowerCase()} model.`;
});

target.addEventListener("targetFound", () => {
  status.textContent = `${furniture.name} detected.`;
  playMarkerDetectedSound();
});

target.addEventListener("targetLost", () => {
  status.textContent = "Point your camera at the furniture marker.";
});

attachRotationControls();

scene.addEventListener(
  "loaded",
  () => {
    attachRotationControls();
    downloadSelectedTarget();
  },
  { once: true }
);

rotateModelAutomatically();
