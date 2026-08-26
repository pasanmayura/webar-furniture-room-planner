import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const info = document.getElementById('info');
const startButton = document.getElementById('start-ar');
const exitButton = document.getElementById('exit-ar');
const productId = new URLSearchParams(window.location.search).get('product');
const furnitureOptions = {
  chair: { name: 'chair', model: '/models/chair.glb', width: 0.6, depth: 0.65 },
  table: { name: 'table', model: '/models/table.glb', width: 1.2, depth: 0.7 },
  bed: { name: 'bed', model: '/models/bed.glb', width: 2, depth: 1.6 }
};
const furniture = furnitureOptions[productId] || furnitureOptions.chair;

let controller;
let reticle;
let placementGuide;
let furnitureTemplate = null;
let activeSession = null;
let localReferenceSpace = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let footprintHitTestSources = [];
let footprintHitTestSourcePromise = null;
let footprintCenter = null;
let canPlaceFurniture = false;
let selectedFurniture = null;
let isDraggingFurniture = false;
let dragStartPosition = null;
let dragStartRotation = null;
let dragStartControllerYaw = 0;
const footprintResults = [false, false, false, false, false];
const placedFurniture = [];
const furnitureRaycaster = new THREE.Raycaster();
const furnitureRay = new THREE.Vector3(0, 0, -1);

function createScene() {
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
  directionalLight.position.set(1, 3, 2);
  scene.add(directionalLight);
}

function createPlacementGuide() {
  const halfWidth = furniture.width / 2;
  const halfDepth = furniture.depth / 2;
  const vertices = new Float32Array([
    -halfWidth, 0.01, -halfDepth, halfWidth, 0.01, -halfDepth,
    halfWidth, 0.01, -halfDepth, halfWidth, 0.01, halfDepth,
    halfWidth, 0.01, halfDepth, -halfWidth, 0.01, halfDepth,
    -halfWidth, 0.01, halfDepth, -halfWidth, 0.01, -halfDepth
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  placementGuide = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xff0000 }));
  placementGuide.matrixAutoUpdate = false;
  placementGuide.visible = false;
  scene.add(placementGuide);
}

function createReticle() {
  const geometry = new THREE.RingGeometry(0.08, 0.1, 32);
  geometry.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  createPlacementGuide();
}

function setPlacementFeedback(isValid, message) {
  reticle.material.color.set(isValid ? 0x00ff00 : 0xff0000);
  placementGuide.material.color.set(isValid ? 0x00ff00 : 0xff0000);
  info.textContent = message;
}

function updatePlacementGuide() {
  placementGuide.matrix.copy(reticle.matrix);
  placementGuide.visible = reticle.visible;
}

function createFurnitureBoundingBox(position) {
  return new THREE.Box3(
    new THREE.Vector3(position.x - furniture.width / 2, position.y - 0.05, position.z - furniture.depth / 2),
    new THREE.Vector3(position.x + furniture.width / 2, position.y + 0.3, position.z + furniture.depth / 2)
  );
}

function updateFurnitureBoundingBox(item) {
  item.boundingBox = createFurnitureBoundingBox(item.object3D.position);
}

function hasFurnitureCollision(position, ignoredItem = null) {
  const proposedBox = createFurnitureBoundingBox(position);
  return placedFurniture.some((item) => item !== ignoredItem && proposedBox.intersectsBox(item.boundingBox));
}

function validatePlacement(position, hasEnoughFloor, ignoredItem = null) {
  const overlaps = hasFurnitureCollision(position, ignoredItem);
  canPlaceFurniture = hasEnoughFloor && !overlaps;
  setPlacementFeedback(
    canPlaceFurniture,
    overlaps ? 'Furniture overlaps an existing item' : canPlaceFurniture ? 'Enough space - tap to place' : 'Not enough space for this furniture'
  );
}

function findPlacedFurniture(object) {
  while (object) {
    const item = placedFurniture.find((placedItem) => placedItem.object3D === object);
    if (item) return item;
    object = object.parent;
  }
  return null;
}

function selectPlacedFurniture() {
  scene.updateMatrixWorld(true);
  furnitureRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  furnitureRaycaster.ray.direction.copy(furnitureRay).transformDirection(controller.matrixWorld);
  const intersections = furnitureRaycaster.intersectObjects(placedFurniture.map((item) => item.object3D), true);
  return intersections.length ? findPlacedFurniture(intersections[0].object) : null;
}

function startFurnitureDrag() {
  selectedFurniture = selectPlacedFurniture();
  if (!selectedFurniture) return;
  isDraggingFurniture = true;
  dragStartPosition = selectedFurniture.object3D.position.clone();
  dragStartRotation = selectedFurniture.object3D.rotation.clone();
  const controllerEuler = new THREE.Euler().setFromQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  dragStartControllerYaw = controllerEuler.y;
  info.textContent = `Drag to move ${furniture.name}; rotate your finger to turn it`;
}

function finishFurnitureDrag() {
  if (!isDraggingFurniture || !selectedFurniture) return false;
  if (!canPlaceFurniture) {
    selectedFurniture.object3D.position.copy(dragStartPosition);
    selectedFurniture.object3D.rotation.copy(dragStartRotation);
    updateFurnitureBoundingBox(selectedFurniture);
    info.textContent = 'Not enough space for this furniture';
  } else {
    info.textContent = `${furniture.name} moved successfully`;
  }
  isDraggingFurniture = false;
  selectedFurniture = null;
  dragStartPosition = null;
  dragStartRotation = null;
  return true;
}

function placeNewFurniture() {
  if (!reticle.visible) return (info.textContent = 'No surface found yet');
  if (!canPlaceFurniture) return (info.textContent = 'Not enough space for this furniture');
  if (!furnitureTemplate) return (info.textContent = `${furniture.name} is still loading`);

  const placedObject = furnitureTemplate.clone(true);
  placedObject.position.setFromMatrixPosition(reticle.matrix);
  placedObject.position.y += 0.01;
  scene.add(placedObject);
  const item = { object3D: placedObject, boundingBox: createFurnitureBoundingBox(placedObject.position) };
  placedFurniture.push(item);
  updateFurnitureBoundingBox(item);
  info.textContent = `${furniture.name} placed successfully`;
}

function isPointInsidePlane(frame, plane, worldPoint) {
  const pose = frame.getPose(plane.planeSpace, localReferenceSpace);
  if (!pose || !plane.polygon || plane.polygon.length < 3) return false;
  const planePoint = worldPoint.clone().applyMatrix4(new THREE.Matrix4().fromArray(pose.transform.matrix).invert());
  let inside = false;
  for (let index = 0, previous = plane.polygon.length - 1; index < plane.polygon.length; previous = index++) {
    const current = plane.polygon[index];
    const before = plane.polygon[previous];
    if ((current.z > planePoint.z) !== (before.z > planePoint.z) && planePoint.x < ((before.x - current.x) * (planePoint.z - current.z)) / (before.z - current.z) + current.x) inside = !inside;
  }
  return inside;
}

function checkDetectedPlaneSpace(frame, center) {
  if (!frame.detectedPlanes || !localReferenceSpace) return null;
  const halfWidth = furniture.width / 2;
  const halfDepth = furniture.depth / 2;
  const points = [
    new THREE.Vector3(center.x - halfWidth, center.y, center.z - halfDepth),
    new THREE.Vector3(center.x + halfWidth, center.y, center.z - halfDepth),
    new THREE.Vector3(center.x - halfWidth, center.y, center.z + halfDepth),
    new THREE.Vector3(center.x + halfWidth, center.y, center.z + halfDepth)
  ];
  for (const plane of frame.detectedPlanes) {
    if (plane.orientation !== 'horizontal') continue;
    const pose = frame.getPose(plane.planeSpace, localReferenceSpace);
    if (!pose || Math.abs(pose.transform.position.y - center.y) > 0.12) continue;
    if (points.every((point) => isPointInsidePlane(frame, plane, point))) return true;
  }
  return false;
}

function getFootprintOffsets() {
  return [
    { x: -furniture.width * 0.45, z: -furniture.depth * 0.45 },
    { x: furniture.width * 0.45, z: -furniture.depth * 0.45 },
    { x: -furniture.width * 0.45, z: furniture.depth * 0.45 },
    { x: furniture.width * 0.45, z: furniture.depth * 0.45 },
    { x: 0, z: 0 }
  ];
}

function createFootprintHitTestSources(center) {
  if (!localReferenceSpace || footprintHitTestSourcePromise) return;
  footprintCenter = center.clone();
  footprintHitTestSourcePromise = Promise.all(getFootprintOffsets().map((offset) => {
    const offsetSpace = localReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({ x: center.x + offset.x, y: center.y + 0.05, z: center.z + offset.z }));
    return activeSession.requestHitTestSource({ space: offsetSpace, offsetRay: new XRRay({ direction: { x: 0, y: -1, z: 0 } }) });
  })).then((sources) => { footprintHitTestSources = sources; footprintHitTestSourcePromise = null; }).catch(() => { footprintHitTestSources = []; footprintHitTestSourcePromise = null; });
}

function checkAvailableFloorSpace(frame, center) {
  const planeResult = checkDetectedPlaneSpace(frame, center);
  if (planeResult !== null) return planeResult;
  if (footprintHitTestSources.length !== 5) return false;
  footprintHitTestSources.forEach((source, index) => { footprintResults[index] = frame.getHitTestResults(source).length > 0; });
  return footprintResults[4] && footprintResults.slice(0, 4).every(Boolean);
}

function loadFurnitureModel() {
  new GLTFLoader().load(furniture.model, (gltf) => {
    furnitureTemplate = gltf.scene;
    startButton.disabled = false;
    info.textContent = `${furniture.name} ready - press Start AR`;
  }, (xhr) => {
    if (xhr.total) info.textContent = `Loading ${furniture.name}: ${Math.round(xhr.loaded / xhr.total * 100)}%`;
  }, () => { info.textContent = `Failed to load ${furniture.name} model`; });
}

function startAR() {
  if (!navigator.xr) return (info.textContent = 'WebXR is not supported on this device/browser.');
  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (!supported) throw new Error('Markerless AR is not supported on this device.');
    return navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'plane-detection'], domOverlay: { root: document.body } });
  }).then(async (session) => {
    activeSession = session;
    renderer.xr.setReferenceSpaceType('local');
    localReferenceSpace = await session.requestReferenceSpace('local');
    await renderer.xr.setSession(session);
    startButton.style.display = 'none';
    exitButton.style.display = 'block';
    info.textContent = 'Move your phone slowly to find a surface';
    renderer.setAnimationLoop(render);
    session.addEventListener('end', onSessionEnd);
  }).catch(() => {
    activeSession = null;
    exitButton.style.display = 'none';
    info.textContent = 'Could not start AR session.';
  });
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);
  if (hitTestSource?.cancel) hitTestSource.cancel();
  footprintHitTestSources.forEach((source) => source.cancel());
  hitTestSource = null;
  hitTestSourceRequested = false;
  footprintHitTestSources = [];
  footprintHitTestSourcePromise = null;
  footprintCenter = null;
  localReferenceSpace = null;
  activeSession = null;
  canPlaceFurniture = false;
  selectedFurniture = null;
  isDraggingFurniture = false;
  reticle.visible = false;
  placementGuide.visible = false;
  startButton.style.display = 'block';
  exitButton.style.display = 'none';
  info.textContent = 'AR session ended';
}

function exitAR() {
  if (activeSession) activeSession.end();
}

function onControllerSelectEnd() {
  if (!finishFurnitureDrag()) placeNewFurniture();
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerReferenceSpace) => {
        return session.requestHitTestSource({ space: viewerReferenceSpace });
      }).then((source) => {
        hitTestSource = source;
      }).catch(() => {
        hitTestSourceRequested = false;
      });
      hitTestSourceRequested = true;
    }

    if (!hitTestSource) {
      renderer.render(scene, camera);
      return;
    }

    const hit = frame.getHitTestResults(hitTestSource)[0];
    const pose = hit?.getPose(referenceSpace);
    if (pose) {
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
      if (!footprintCenter || footprintCenter.distanceTo(position) > 0.15) {
        footprintHitTestSources.forEach((source) => source.cancel());
        footprintHitTestSources = [];
        createFootprintHitTestSources(position);
      }
      updatePlacementGuide();
      const hasEnoughFloor = checkAvailableFloorSpace(frame, position);
      if (isDraggingFurniture && selectedFurniture) {
        selectedFurniture.object3D.position.copy(position);
        selectedFurniture.object3D.position.y += 0.01;
        const currentEuler = new THREE.Euler().setFromQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
        selectedFurniture.object3D.rotation.y = dragStartRotation.y + currentEuler.y - dragStartControllerYaw;
        updateFurnitureBoundingBox(selectedFurniture);
        validatePlacement(position, hasEnoughFloor, selectedFurniture);
      } else {
        validatePlacement(position, hasEnoughFloor);
      }
    } else {
      reticle.visible = false;
      canPlaceFurniture = false;
      placementGuide.visible = false;
      info.textContent = 'Move your phone slowly to find a surface';
    }
  }
  renderer.render(scene, camera);
}

function setupEvents() {
  controller = renderer.xr.getController(0);
  controller.addEventListener('selectstart', startFurnitureDrag);
  controller.addEventListener('selectend', onControllerSelectEnd);
  scene.add(controller);
  startButton.addEventListener('click', startAR);
  exitButton.addEventListener('click', exitAR);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function init() {
  createScene();
  createLights();
  createReticle();
  setupEvents();
  loadFurnitureModel();
}

init();
