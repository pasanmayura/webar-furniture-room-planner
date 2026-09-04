import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getFurnitureOption, getFurnitureSize } from "./utils/furniture-data.js";
import { playPlacementReadySound, resumeAudioContext } from "./utils/ar-audio.js";
import { createFurnitureShadow, updateFurnitureShadow } from "./utils/ar-shadows.js";
import {
  applySelectedColor,
  createFurnitureBoundingBox,
  checkVirtualFurnitureCollisionExcept,
  getFootprintOffsets,
  checkAvailableFloorSpace,
  selectPlacedFurniture
} from "./utils/ar-spatial.js";

let scene;
let camera;
let renderer;
let controller;
let reticle;
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

let planeDetectionAvailable = false;
let furnitureTemplate = null;
let canPlaceFurniture = false;
const placedFurniture = [];
let placementGuide;
let selectedFurniture = null;
let isDraggingFurniture = false;
let dragStartPosition = null;
let dragStartRotation = null;
let dragStartControllerYaw = 0;
let placementWasValid = false;

const furnitureRaycaster = new THREE.Raycaster();
const furnitureRay = new THREE.Vector3(0, 0, -1);

const productId = new URLSearchParams(window.location.search).get("product");
const selectedColor = new URLSearchParams(window.location.search).get("color");
const furniture = getFurnitureOption(productId);

const info = document.getElementById("info");
const startButton = document.getElementById("start-ar");
const exitButton = document.getElementById("exit-ar");

init();

function init() {
  createScene();
  createLights();
  createReticle();
  createController();
  loadFurnitureModel();
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
  const { width, depth } = getFurnitureSize(productId);
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
  placementGuide.material.color.set(color);
  if (isValid && !placementWasValid) {
    playPlacementReadySound();
  }
  placementWasValid = isValid;
  info.textContent = message;
}

function updatePlacementGuideTransform() {
  if (!placementGuide) return;
  placementGuide.matrix.copy(reticle.matrix);
  placementGuide.matrixAutoUpdate = false;
  placementGuide.visible = reticle.visible;
}

async function createFootprintHitTestSources(center) {
  if (!localReferenceSpace || footprintHitTestSourcePromise) return;

  footprintCenter = center.clone();
  footprintHitTestSourcePromise = Promise.all(
    getFootprintOffsets(getFurnitureSize(productId)).map((offset) => {
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
    getFurnitureSize(productId)
  );
}

function validatePlacement(position, hasEnoughFloor, ignoredItem = null) {
  const overlapsExistingFurniture = checkVirtualFurnitureCollisionExcept(
    position,
    placedFurniture,
    getFurnitureSize(productId),
    ignoredItem
  );

  canPlaceFurniture = hasEnoughFloor && !overlapsExistingFurniture;

  if (overlapsExistingFurniture) {
    setPlacementFeedback(false, "Furniture overlaps an existing item");
  } else if (hasEnoughFloor) {
    setPlacementFeedback(true, "Enough space - tap to place");
  } else {
    setPlacementFeedback(false, "Not enough space for this furniture");
  }
  return canPlaceFurniture;
}

function startFurnitureDrag() {
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
  info.textContent = `Drag to move ${furniture.name}; rotate your finger to turn it`;
}

function finishFurnitureDrag() {
  if (!isDraggingFurniture || !selectedFurniture) return false;

  if (!canPlaceFurniture) {
    selectedFurniture.object3D.position.copy(dragStartPosition);
    selectedFurniture.object3D.rotation.copy(dragStartRotation);
    updateFurnitureBoundingBox(selectedFurniture);
    updateFurnitureShadow(selectedFurniture);
    info.textContent = "Not enough space for this furniture";
  } else {
    updateFurnitureShadow(selectedFurniture);
    info.textContent = `${furniture.name} moved successfully`;
  }

  renderer.shadowMap.needsUpdate = true;
  isDraggingFurniture = false;
  selectedFurniture = null;
  dragStartPosition = null;
  dragStartRotation = null;
  dragStartControllerYaw = 0;
  return true;
}

function createController() {
  controller = renderer.xr.getController(0);
  controller.addEventListener("selectstart", startFurnitureDrag);
  controller.addEventListener("selectend", () => {
    if (!finishFurnitureDrag()) {
      placeNewFurniture();
    }
  });
  scene.add(controller);
}

function loadFurnitureModel() {
  const loader = new GLTFLoader();
  loader.load(
    furniture.model,
    (gltf) => {
      furnitureTemplate = gltf.scene;
      applySelectedColor(furnitureTemplate, selectedColor);
      furnitureTemplate.scale.set(0.5, 0.5, 0.5);
      info.textContent = `${furniture.name} ready - press Start AR`;
      startButton.disabled = false;
    },
    (xhr) => {
      if (xhr.total) {
        const percent = Math.round((xhr.loaded / xhr.total) * 100);
        info.textContent = `Loading ${furniture.name}: ${percent}%`;
      }
    },
    (error) => {
      console.error(`${furniture.name} loading error:`, error);
      info.textContent = `Failed to load ${furniture.name} model`;
    }
  );
}

function setupEvents() {
  startButton.addEventListener("click", startAR);
  exitButton.addEventListener("click", exitAR);
  window.addEventListener("resize", onWindowResize);
}

async function startAR() {
  if (!navigator.xr) {
    info.textContent = "WebXR is not supported on this device/browser.";
    return;
  }

  resumeAudioContext();

  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    if (!supported) {
      info.textContent = "Markerless AR is not supported on this device.";
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
    info.textContent = "Move your phone slowly to find a surface";

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
      planeDetectionAvailable = false;
      canPlaceFurniture = false;
      placementWasValid = false;
      isDraggingFurniture = false;
      selectedFurniture = null;
      reticle.visible = false;
      placementGuide.visible = false;

      placedFurniture.forEach((item) => {
        if (item.object3D) scene.remove(item.object3D);
        if (item.shadow) scene.remove(item.shadow);
      });
      placedFurniture.length = 0;

      startButton.style.display = "block";
      exitButton.style.display = "none";
      info.textContent = "AR session ended";
    });
  } catch (error) {
    activeSession = null;
    exitButton.style.display = "none";
    console.error("AR session error:", error);
    info.textContent = "Could not start AR session.";
  }
}

function exitAR() {
  if (activeSession) {
    activeSession.end();
  }
}

function placeNewFurniture() {
  if (!reticle.visible) {
    info.textContent = "No surface found yet";
    return;
  }
  if (!canPlaceFurniture) {
    info.textContent = "Not enough space for this furniture";
    return;
  }
  if (!furnitureTemplate) {
    info.textContent = `${furniture.name} is still loading`;
    return;
  }

  const placedObject = furnitureTemplate.clone(true);
  placedObject.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  const position = new THREE.Vector3();
  position.setFromMatrixPosition(reticle.matrix);
  placedObject.position.copy(position);
  placedObject.position.y += 0.01;
  placedObject.scale.set(0.5, 0.5, 0.5);

  scene.add(placedObject);

  const size = getFurnitureSize(productId);
  const shadow = createFurnitureShadow(placedObject.position, size, scene);

  const placedItem = {
    type: furniture.name,
    object3D: placedObject,
    width: size.width,
    depth: size.depth,
    shadow,
    boundingBox: createFurnitureBoundingBox(placedObject.position, size)
  };
  placedFurniture.push(placedItem);
  updateFurnitureBoundingBox(placedItem);

  renderer.shadowMap.needsUpdate = true;
  info.textContent = `${furniture.name} placed successfully`;
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

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

    if (hitTestSourceRequested === false) {
      session
        .requestReferenceSpace("viewer")
        .then((viewerReferenceSpace) => {
          session
            .requestHitTestSource({ space: viewerReferenceSpace })
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

        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);

          const placementPosition = new THREE.Vector3();
          placementPosition.setFromMatrixPosition(reticle.matrix);
          if (
            !footprintCenter ||
            footprintCenter.distanceTo(placementPosition) > 0.15
          ) {
            footprintHitTestSources.forEach((source) => source.cancel());
            footprintHitTestSources = [];
            createFootprintHitTestSources(placementPosition);
          }
          updatePlacementGuideTransform();
          const hasEnoughFloor = checkAvailableFloorSpace(
            frame,
            placementPosition,
            getFurnitureSize(productId),
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
            updateFurnitureShadow(selectedFurniture);
            updateFurnitureBoundingBox(selectedFurniture);
            renderer.shadowMap.needsUpdate = true;
            validatePlacement(placementPosition, hasEnoughFloor, selectedFurniture);
          } else {
            validatePlacement(placementPosition, hasEnoughFloor);
          }
        }
      } else {
        reticle.visible = false;
        canPlaceFurniture = false;
        placementWasValid = false;
        if (placementGuide) {
          placementGuide.visible = false;
        }
        info.textContent = "Move your phone slowly to find a surface";
      }
    }
  }

  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
