import * as THREE from "three";

export function createSoftShadowTexture(threeInstance = THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;

  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 118);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.42)");
  gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.20)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new threeInstance.CanvasTexture(canvas);
  texture.colorSpace = threeInstance.SRGBColorSpace;
  return texture;
}

export function createFurnitureShadow(position, size, scene, threeInstance = THREE) {
  const shadowGroup = new threeInstance.Group();
  const shadowCatcherSize = Math.max(size.width, size.depth, 0.2) * 2.4;
  const contactSize = Math.max(size.width, size.depth, 0.18) * 1.35;

  // 1. Dynamic Directional Shadow Receiver (ShadowMaterial)
  const shadowReceiverGeometry = new threeInstance.PlaneGeometry(shadowCatcherSize, shadowCatcherSize);
  const shadowReceiverMaterial = new threeInstance.ShadowMaterial({
    opacity: 0.42,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  const shadowReceiver = new threeInstance.Mesh(shadowReceiverGeometry, shadowReceiverMaterial);
  shadowReceiver.receiveShadow = true;
  shadowReceiver.rotation.x = -Math.PI / 2;
  shadowReceiver.position.set(0, 0.001, 0);
  shadowReceiver.renderOrder = 1;
  shadowGroup.add(shadowReceiver);

  // 2. Soft Ambient Contact Shadow
  const contactGeometry = new threeInstance.PlaneGeometry(contactSize, contactSize);
  const contactMaterial = new threeInstance.MeshBasicMaterial({
    map: createSoftShadowTexture(threeInstance),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });
  const contactMesh = new threeInstance.Mesh(contactGeometry, contactMaterial);
  contactMesh.rotation.x = -Math.PI / 2;
  contactMesh.position.set(0, 0.002, 0);
  contactMesh.renderOrder = 2;
  shadowGroup.add(contactMesh);

  shadowGroup.position.set(position.x, position.y, position.z);
  if (scene) {
    scene.add(shadowGroup);
  }
  return shadowGroup;
}

export function updateFurnitureShadow(item) {
  if (!item || !item.shadow) {
    return;
  }

  item.shadow.position.set(
    item.object3D.position.x,
    item.object3D.position.y,
    item.object3D.position.z
  );
  item.shadow.rotation.y = item.object3D.rotation.y;
}
