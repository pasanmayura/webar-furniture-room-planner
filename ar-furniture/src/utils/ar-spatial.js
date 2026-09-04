import * as THREE from "three";

export function applySelectedColor(model, selectedColor) {
  if (!selectedColor || !/^#[0-9a-f]{6}$/i.test(selectedColor)) {
    return;
  }

  model.traverse((node) => {
    if (!node.isMesh || !node.material) {
      return;
    }

    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];

    materials.forEach((material) => {
      if (material.color) {
        material.color.set(selectedColor);
      }
    });
  });
}

export function createFurnitureBoundingBox(position, size, threeInstance = THREE) {
  const halfWidth = size.width / 2;
  const halfDepth = size.depth / 2;

  return new threeInstance.Box3(
    new threeInstance.Vector3(position.x - halfWidth, position.y - 0.05, position.z - halfDepth),
    new threeInstance.Vector3(position.x + halfWidth, position.y + 0.3, position.z + halfDepth)
  );
}

export function checkVirtualFurnitureCollisionExcept(position, placedFurniture, size, ignoredItem = null) {
  const proposedBox = createFurnitureBoundingBox(position, size);

  return placedFurniture.some((item) => {
    if (item === ignoredItem) {
      return false;
    }
    return proposedBox.intersectsBox(item.boundingBox);
  });
}

export function getFootprintOffsets(size) {
  const halfWidth = size.width * 0.45;
  const halfDepth = size.depth * 0.45;

  return [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: -halfWidth, z: halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: 0, z: 0 }
  ];
}

export function isPointInsidePlane(frame, plane, worldPoint, localReferenceSpace) {
  const pose = frame.getPose(plane.planeSpace, localReferenceSpace);
  if (!pose || !plane.polygon || plane.polygon.length < 3) {
    return false;
  }

  const planeMatrix = new THREE.Matrix4().fromArray(pose.transform.matrix).invert();
  const planePoint = worldPoint.clone().applyMatrix4(planeMatrix);
  let inside = false;

  for (let index = 0, previous = plane.polygon.length - 1; index < plane.polygon.length; previous = index++) {
    const currentPoint = plane.polygon[index];
    const previousPoint = plane.polygon[previous];
    const intersects =
      (currentPoint.z > planePoint.z) !== (previousPoint.z > planePoint.z) &&
      planePoint.x <
        ((previousPoint.x - currentPoint.x) * (planePoint.z - currentPoint.z)) /
          (previousPoint.z - currentPoint.z) +
        currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function checkDetectedPlaneSpace(frame, center, size, localReferenceSpace) {
  if (!frame.detectedPlanes || !localReferenceSpace) {
    return null;
  }

  const halfWidth = size.width / 2;
  const halfDepth = size.depth / 2;
  const footprintPoints = [
    new THREE.Vector3(center.x - halfWidth, center.y, center.z - halfDepth),
    new THREE.Vector3(center.x + halfWidth, center.y, center.z - halfDepth),
    new THREE.Vector3(center.x - halfWidth, center.y, center.z + halfDepth),
    new THREE.Vector3(center.x + halfWidth, center.y, center.z + halfDepth)
  ];

  for (const plane of frame.detectedPlanes) {
    if (plane.orientation !== "horizontal") {
      continue;
    }

    const planePose = frame.getPose(plane.planeSpace, localReferenceSpace);
    if (!planePose || Math.abs(planePose.transform.position.y - center.y) > 0.12) {
      continue;
    }

    if (footprintPoints.every((point) => isPointInsidePlane(frame, plane, point, localReferenceSpace))) {
      return true;
    }
  }

  return false;
}

export function checkAvailableFloorSpace(frame, center, size, footprintHitTestSources, localReferenceSpace) {
  const detectedPlaneResult = checkDetectedPlaneSpace(frame, center, size, localReferenceSpace);
  if (detectedPlaneResult !== null) {
    return detectedPlaneResult;
  }

  if (footprintHitTestSources.length !== 5) {
    return false;
  }

  const footprintResults = footprintHitTestSources.map((source) => frame.getHitTestResults(source).length > 0);
  const centerIsValid = footprintResults[4];
  const validCorners = footprintResults.slice(0, 4).filter(Boolean).length;

  return centerIsValid && validCorners === 4;
}

export function findPlacedFurniture(intersectionObject, placedFurniture) {
  let currentObject = intersectionObject;
  while (currentObject) {
    const item = placedFurniture.find((placedItem) => placedItem.object3D === currentObject);
    if (item) {
      return item;
    }
    currentObject = currentObject.parent;
  }
  return null;
}

export function selectPlacedFurniture(controller, placedFurniture, raycaster, rayDirection, scene) {
  scene.updateMatrixWorld(true);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.copy(rayDirection).transformDirection(controller.matrixWorld);

  const intersections = raycaster.intersectObjects(
    placedFurniture.map((item) => item.object3D),
    true
  );

  return intersections.length > 0 ? findPlacedFurniture(intersections[0].object, placedFurniture) : null;
}
