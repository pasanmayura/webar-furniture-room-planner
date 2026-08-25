import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let chairPreview = null;

export function loadChairPreview() {
  const canvas = document.getElementById("chairPreviewCanvas");
  const container = document.getElementById("detailsImage");

  if (!canvas || !container) {
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f2);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 2.2));

  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const animationFrame = () => {
    if (!chairPreview) {
      return;
    }
    renderer.render(scene, camera);
    chairPreview.animationFrame = requestAnimationFrame(animationFrame);
  };

  chairPreview = { renderer, resize, animationFrame: 0 };
  window.addEventListener("resize", resize);
  resize();

  new GLTFLoader().load(
    "/models/chair.glb",
    (gltf) => {
      if (!chairPreview) {
        return;
      }

      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 0.001);

      model.position.sub(center);
      model.scale.setScalar(1.5 / maxDimension);
      scene.add(model);

      const fittedBounds = new THREE.Box3().setFromObject(model);
      const fittedSphere = fittedBounds.getBoundingSphere(new THREE.Sphere());
      const viewingAngle = THREE.MathUtils.degToRad(camera.fov / 2);
      const viewingDistance = (fittedSphere.radius / Math.sin(viewingAngle)) * 1.2;
      const viewingDirection = new THREE.Vector3(1, 0.65, 1).normalize();

      camera.position.copy(fittedSphere.center).add(viewingDirection.multiplyScalar(viewingDistance));
      camera.near = Math.max(viewingDistance / 100, 0.01);
      camera.far = viewingDistance * 100;
      camera.lookAt(fittedSphere.center);
      camera.updateProjectionMatrix();
      animationFrame();
    },
    undefined,
    (error) => {
      console.error("Unable to load chair model:", error);
    }
  );
}

export function destroyChairPreview() {
  if (!chairPreview) {
    return;
  }

  window.removeEventListener("resize", chairPreview.resize);
  cancelAnimationFrame(chairPreview.animationFrame);
  chairPreview.renderer.dispose();
  chairPreview = null;
}
