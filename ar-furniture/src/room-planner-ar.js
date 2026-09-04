import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FURNITURE_OPTIONS, getFurnitureSize } from "./utils/furniture-data.js";
import { resumeAudioContext } from "./utils/ar-audio.js";
import { createFurnitureShadow, updateFurnitureShadow } from "./utils/ar-shadows.js";
import {
  createFurnitureBoundingBox,
  checkVirtualFurnitureCollisionExcept,
  getFootprintOffsets,
  checkAvailableFloorSpace,
  selectPlacedFurniture
} from "./utils/ar-spatial.js";

const statusEl = document.getElementById("status");
const startButton = document.getElementById("start-ar");
const exitButton = document.getElementById("exit-ar");
const removeButton = document.getElementById("remove-selected");
const selectionBar = document.getElementById("selection-bar");
const selectionButtons = [...document.querySelectorAll(".tool-btn")];

let scene;
let camera;
let renderer;
let controller;
let reticle;
let placementGuide;
let xrLightProbe = null;
let primaryLight = null;
let ambientProbe = null;
let fallbackHemisphereLight = null;
let lastLightEstimateTime = 0;

let hitTestSource = null;
let hitTestSourceRequested = false;
let activeSession = null;
let localReferenceSpace = null;
let footprintHitTestSources = [];
let footprintHitTestSourcePromise = null;
let footprintCenter = null;

let canPlaceFurniture = false;
const furnitureTemplates = {};
const placedFurniture = [];
let selectedFurniture = null;
let isDraggingFurniture = false;
let dragStartPosition = null;
let dragStartRotation = null;
let dragStartControllerYaw = 0;
let lastPlacementValidationTime = 0;

const furnitureRaycaster = new THREE.Raycaster();
const furnitureRay = new THREE.Vector3(0, 0, -1);

let activeFurnitureType = "chair";
let suppressSelectAction = false;

const OVERLAY_CONTROL_SELECTOR = "#remove-selected, #exit-ar, #selection-bar, #start-ar";

init();

function init() {
  createScene();
  createLights();
  createReticle();
  createController();
  setupSelectionControls();
  loadFurnitureModels();
  setupEvents();
}

function createScene() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    powerPreference: "high-performance",
    precision: "mediump"
  });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  document.body.appendChild(renderer.domElement);
}

function createLights() {
  ambientProbe = new THREE.LightProbe();
  ambientProbe.intensity = 0;
  scene.add(ambientProbe);

  fallbackHemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.8);
  scene.add(fallbackHemisphereLight);

  primaryLight = new THREE.DirectionalLight(0xffffff, 1.8);
  primaryLight.position.set(1.5, 3.5, 2);
  primaryLight.castShadow = true;
  primaryLight.shadow.mapSize.set(512, 512);
  primaryLight.shadow.camera.near = 0.1;
  primaryLight.shadow.camera.far = 8;
  primaryLight.shadow.camera.left = -2.5;
  primaryLight.shadow.camera.right = 2.5;
  primaryLight.shadow.camera.top = 2.5;
  primaryLight.shadow.camera.bottom = -2.5;
  primaryLight.shadow.bias = -0.001;
  primaryLight.shadow.normalBias = 0.02;

  scene.add(primaryLight);
}

function createReticle() {
  const geometry = new THREE.RingGeometry(0.08, 0.1, 32);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  reticle = new THREE.Mesh(geometry, material);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  updatePlacementGuide();
}

function updatePlacementGuide() {
  if (placementGuide) {
    scene.remove(placementGuide);
  }

  const { width, depth } = getFurnitureSize(activeFurnitureType);
  const guideGeometry = new THREE.BufferGeometry();
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  const vertices = new Float32Array([
    -halfWidth, 0.01, -halfDepth, halfWidth, 0.01, -halfDepth,
    halfWidth, 0.01, -halfDepth, halfWidth, 0.01, halfDepth,
    halfWidth, 0.01, halfDepth, -halfWidth, 0.01, halfDepth,
    -halfWidth, 0.01, halfDepth, -halfWidth, 0.01, -halfDepth
  ]);

  guideGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

  placementGuide = new THREE.LineSegments(
    guideGeometry,
    new THREE.LineBasicMaterial({ color: 0xff0000 })
  );

  placementGuide.matrixAutoUpdate = false;
  placementGuide.visible = false;
  scene.add(placementGuide);
}

function setPlacementFeedback(isValid, message) {
  const color = isValid ? 0x00ff00 : 0xff0000;
  reticle.material.color.set(color);
  if (placementGuide) {
    placementGuide.material.color.set(color);
  }
  if (statusEl.textContent !== message) {
    statusEl.textContent = message;
  }
}

function updatePlacementGuideTransform() {
  if (!placementGuide) return;
  placementGuide.matrix.copy(reticle.matrix);
  placementGuide.visible = reticle.visible;
}

function setupSelectionControls() {
  selectionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFurnitureType = button.dataset.kind;
      selectionButtons.forEach((btn) => btn.classList.toggle("active", btn === button));
      updatePlacementGuide();
      lastPlacementValidationTime = 0;
      statusEl.textContent = `${FURNITURE_OPTIONS[activeFurnitureType].name} selected`;
    });
  });
}

function loadFurnitureModels() {
  const loader = new GLTFLoader();

  Object.entries(FURNITURE_OPTIONS).forEach(([key, option]) => {
    loader.load(
      option.model,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        model.scale.set(0.5, 0.5, 0.5);
        furnitureTemplates[key] = model;
        statusEl.textContent = `${option.name} ready`;
      },
      undefined,
      (error) => {
        console.error(`Failed to load ${key}`, error);
      }
    );
  });
}

function setupEvents() {
  startButton.addEventListener("click", startAR);
  exitButton.addEventListener("click", exitAR);
  removeButton.addEventListener("click", removeSelectedFurniture);
  document.addEventListener("pointerdown", handleOverlayPointerDown, true);
  window.addEventListener("resize", onWindowResize);
}

function handleOverlayPointerDown(event) {
  if (!event.target.closest(OVERLAY_CONTROL_SELECTOR)) {
    return;
  }

  suppressSelectAction = true;
  window.setTimeout(() => {
    suppressSelectAction = false;
  }, 300);
}

async function startAR() {
  if (!navigator.xr) {
    statusEl.textContent = "WebXR is not supported on this device.";
    return;
  }

  resumeAudioContext();

  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    if (!supported) {
      statusEl.textContent = "Markerless AR is not supported on this device.";
      return;
    }

    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "plane-detection", "light-estimation"],
      domOverlay: { root: document.body }
    });

    activeSession = session;
    renderer.xr.setReferenceSpaceType("local");
    localReferenceSpace = await session.requestReferenceSpace("local");
    await renderer.xr.setSession(session);

    if ("requestLightProbe" in session) {
      session.requestLightProbe().then((probe) => {
        xrLightProbe = probe;
      }).catch(() => {});
    }

    startButton.style.display = "none";
    exitButton.style.display = "block";
    selectionBar.style.display = "flex";
    statusEl.textContent = "Move your phone slowly to find a surface";

    renderer.shadowMap.needsUpdate = true;
    renderer.setAnimationLoop(render);

    session.addEventListener("end", () => {
      renderer.setAnimationLoop(null);

      xrLightProbe = null;
      hitTestSource = null;
      hitTestSourceRequested = false;
      footprintHitTestSources.forEach((source) => source.cancel());
      footprintHitTestSources = [];
      footprintHitTestSourcePromise = null;
      footprintCenter = null;
      localReferenceSpace = null;
      activeSession = null;
      canPlaceFurniture = false;
      isDraggingFurniture = false;
      selectedFurniture = null;
      reticle.visible = false;
      if (placementGuide) {
        placementGuide.visible = false;
      }

      while (placedFurniture.length > 0) {
        const item = placedFurniture.pop();
        if (item && item.object3D) {
          scene.remove(item.object3D);
        }
        if (item && item.shadow) {
          scene.remove(item.shadow);
        }
      }

      startButton.style.display = "block";
      exitButton.style.display = "none";
      selectionBar.style.display = "none";
      removeButton.style.display = "none";
      statusEl.textContent = "Press Start AR";
    });
  } catch (error) {
    console.error("AR session error:", error);
    statusEl.textContent = "Could not start AR session.";
  }
}

function exitAR() {
  if (activeSession) {
    activeSession.end();
  }
}

async function createFootprintHitTestSources(center, size) {
  if (!localReferenceSpace || footprintHitTestSourcePromise) {
    return;
  }

  footprintCenter = center.clone();
  footprintHitTestSourcePromise = Promise.all(
    getFootprintOffsets(size).map((offset) => {
      const offsetSpace = localReferenceSpace.getOffsetReferenceSpace(
        new XRRigidTransform({
          x: center.x + offset.x,
          y: center.y + 0.05,
          z: center.z + offset.z
        })
      );

      return renderer.xr.getSession().requestHitTestSource({
        space: offsetSpace,
        offsetRay: new XRRay({ direction: { x: 0, y: -1, z: 0 } })
      });
    })
  )
    .then((sources) => {
      footprintHitTestSources = sources;
      footprintHitTestSourcePromise = null;
    })
    .catch(() => {
      footprintHitTestSources = [];
      footprintHitTestSourcePromise = null;
    });
}

function updateFurnitureBoundingBox(item) {
  item.boundingBox = createFurnitureBoundingBox(
    item.object3D.position,
    getFurnitureSize(item.type)
  );
}

function validatePlacement(position, hasEnoughFloor, ignoredItem = null, type = activeFurnitureType) {
  const size = getFurnitureSize(type);
  const overlapsExistingFurniture = checkVirtualFurnitureCollisionExcept(
    position,
    placedFurniture,
    size,
    ignoredItem
  );

  canPlaceFurniture = hasEnoughFloor && !overlapsExistingFurniture;

  if (overlapsExistingFurniture) {
    setPlacementFeedback(false, "Not enough space");
  } else if (hasEnoughFloor) {
    setPlacementFeedback(true, "Surface found - tap to place");
  } else {
    setPlacementFeedback(false, "Not enough space");
  }

  return canPlaceFurniture;
}

function createController() {
  controller = renderer.xr.getController(0);
  controller.addEventListener("selectstart", handleSelectStart);
  controller.addEventListener("selectend", handleSelectEnd);
  scene.add(controller);
}

function handleSelectStart() {
  if (suppressSelectAction) {
    return;
  }

  selectedFurniture = selectPlacedFurniture(
    controller,
    placedFurniture,
    furnitureRaycaster,
    furnitureRay,
    scene
  );
  if (!selectedFurniture) return;

  isDraggingFurniture = true;
  dragStartPosition = selectedFurniture.object3D.position.clone();
  dragStartRotation = selectedFurniture.object3D.rotation.clone();

  const controllerEuler = new THREE.Euler().setFromQuaternion(
    controller.getWorldQuaternion(new THREE.Quaternion()),
    "YXZ"
  );
  dragStartControllerYaw = controllerEuler.y;

  removeButton.style.display = "block";
  statusEl.textContent = `${FURNITURE_OPTIONS[selectedFurniture.type].name} selected`;
}

function handleSelectEnd() {
  if (suppressSelectAction) {
    suppressSelectAction = false;
    return;
  }

  if (isDraggingFurniture && selectedFurniture) {
    finishFurnitureDrag();
    return;
  }

  placeSelectedFurniture();
}

function finishFurnitureDrag() {
  if (!isDraggingFurniture || !selectedFurniture) {
    return false;
  }

  if (!canPlaceFurniture) {
    selectedFurniture.object3D.position.copy(dragStartPosition);
    selectedFurniture.object3D.rotation.copy(dragStartRotation);
    updateFurnitureBoundingBox(selectedFurniture);
    updateFurnitureShadow(selectedFurniture);
    statusEl.textContent = "Not enough space";
  } else {
    updateFurnitureShadow(selectedFurniture);
    statusEl.textContent = `${FURNITURE_OPTIONS[selectedFurniture.type].name} placed`;
  }

  renderer.shadowMap.needsUpdate = true;
  isDraggingFurniture = false;
  selectedFurniture = null;
  dragStartPosition = null;
  dragStartRotation = null;
  dragStartControllerYaw = 0;

  return true;
}

function placeSelectedFurniture() {
  if (!reticle.visible) {
    statusEl.textContent = "Move your phone slowly to find a surface";
    return;
  }

  if (!canPlaceFurniture) {
    statusEl.textContent = "Not enough space";
    return;
  }

  const template = furnitureTemplates[activeFurnitureType];
  if (!template) {
    statusEl.textContent = "Furniture model is still loading";
    return;
  }

  const placedObject = template.clone(true);
  placedObject.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  const size = getFurnitureSize(activeFurnitureType);

  const position = new THREE.Vector3();
  position.setFromMatrixPosition(reticle.matrix);
  placedObject.position.copy(position);
  placedObject.position.y += 0.01;
  placedObject.scale.set(0.5, 0.5, 0.5);

  scene.add(placedObject);

  const shadow = createFurnitureShadow(placedObject.position, size, scene);

  const placedItem = {
    type: activeFurnitureType,
    object3D: placedObject,
    shadow,
    width: size.width,
    depth: size.depth,
    boundingBox: createFurnitureBoundingBox(placedObject.position, size)
  };

  placedFurniture.push(placedItem);
  updateFurnitureBoundingBox(placedItem);

  selectedFurniture = placedItem;
  removeButton.style.display = "block";
  statusEl.textContent = `${FURNITURE_OPTIONS[activeFurnitureType].name} placed`;
  renderer.shadowMap.needsUpdate = true;
}

function removeSelectedFurniture() {
  if (!selectedFurniture) {
    statusEl.textContent = "No furniture selected";
    return;
  }

  isDraggingFurniture = false;
  dragStartPosition = null;
  dragStartRotation = null;
  dragStartControllerYaw = 0;

  scene.remove(selectedFurniture.object3D);
  if (selectedFurniture.shadow) {
    scene.remove(selectedFurniture.shadow);
  }
  const index = placedFurniture.indexOf(selectedFurniture);
  if (index >= 0) {
    placedFurniture.splice(index, 1);
  }

  selectedFurniture = null;
  removeButton.style.display = "none";
  statusEl.textContent = "Furniture removed";
  renderer.shadowMap.needsUpdate = true;
}

function render(timestamp, frame) {
  if (!frame || !localReferenceSpace) {
    renderer.render(scene, camera);
    return;
  }

  if (xrLightProbe && timestamp - lastLightEstimateTime > 300) {
    lastLightEstimateTime = timestamp;
    const estimate = frame.getLightEstimate(xrLightProbe);
    if (estimate) {
      ambientProbe.sh.fromArray(estimate.sphericalHarmonicsCoefficients);
      ambientProbe.intensity = 1.0;

      const intensityScalar = Math.max(
        1.0,
        Math.max(
          estimate.primaryLightIntensity.x,
          Math.max(
            estimate.primaryLightIntensity.y,
            estimate.primaryLightIntensity.z
          )
        )
      );
      primaryLight.color.setRGB(
        estimate.primaryLightIntensity.x / intensityScalar,
        estimate.primaryLightIntensity.y / intensityScalar,
        estimate.primaryLightIntensity.z / intensityScalar
      );
      primaryLight.intensity = Math.min(intensityScalar, 2.2);
      primaryLight.position.copy(estimate.primaryLightDirection).multiplyScalar(5);
      renderer.shadowMap.needsUpdate = true;
    }
  }

  if (!hitTestSourceRequested) {
    const session = renderer.xr.getSession();
    if (session) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        });
      });
    }
    hitTestSourceRequested = true;
  }

  if (hitTestSource) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);

    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(localReferenceSpace);

      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);

        const placementPosition = new THREE.Vector3();
        placementPosition.setFromMatrixPosition(reticle.matrix);

        if (
          !frame.detectedPlanes &&
          (!footprintCenter || footprintCenter.distanceTo(placementPosition) > 0.35)
        ) {
          footprintHitTestSources.forEach((source) => source.cancel());
          footprintHitTestSources = [];
          createFootprintHitTestSources(placementPosition, getFurnitureSize(activeFurnitureType));
        }

        updatePlacementGuideTransform();

        if (timestamp - lastPlacementValidationTime >= (isDraggingFurniture ? 50 : 100)) {
          lastPlacementValidationTime = timestamp;
          const hasEnoughFloor = checkAvailableFloorSpace(
            frame,
            placementPosition,
            getFurnitureSize(activeFurnitureType),
            footprintHitTestSources,
            localReferenceSpace
          );

          if (isDraggingFurniture && selectedFurniture) {
            selectedFurniture.object3D.position.copy(placementPosition);
            selectedFurniture.object3D.position.y += 0.01;

            const controllerEuler = new THREE.Euler().setFromQuaternion(
              controller.getWorldQuaternion(new THREE.Quaternion()),
              "YXZ"
            );
            const controllerRotationChange = controllerEuler.y - dragStartControllerYaw;
            selectedFurniture.object3D.rotation.y = dragStartRotation.y + controllerRotationChange;

            updateFurnitureBoundingBox(selectedFurniture);
            updateFurnitureShadow(selectedFurniture);
            renderer.shadowMap.needsUpdate = true;
            validatePlacement(placementPosition, hasEnoughFloor, selectedFurniture, selectedFurniture.type);
          } else {
            validatePlacement(placementPosition, hasEnoughFloor, null, activeFurnitureType);
          }
        }
      }
    } else {
      reticle.visible = false;
      canPlaceFurniture = false;
      if (placementGuide) {
        placementGuide.visible = false;
      }
      statusEl.textContent = "Move your phone slowly to find a surface";
    }
  }

  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
