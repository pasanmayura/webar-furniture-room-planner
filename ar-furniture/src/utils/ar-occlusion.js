import * as THREE from 'three';

// Store patched materials so we don't patch them multiple times
const patchedMaterials = new WeakSet();

const depthVertexShaderChunk = `
#ifdef USE_DEPTH_SENSING
  varying vec4 vScreenPos;
#endif
`;

const depthVertexShaderInit = `
#ifdef USE_DEPTH_SENSING
  vScreenPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#endif
`;

const depthFragmentShaderChunk = `
#ifdef USE_DEPTH_SENSING
  varying vec4 vScreenPos;
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  
  // Calculate linear depth from perspective depth
  float getLinearDepth(float z, float near, float far) {
    return (2.0 * near) / (far + near - z * (far - near));
  }
#endif
`;

const depthFragmentShaderInit = `
#ifdef USE_DEPTH_SENSING
  // Calculate screen coordinates
  vec2 screenUv = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
  
  // WebXR Depth texture returns depth in meters
  float realDepthMeters = texture2D(tDepth, screenUv).r;
  
  // Convert our fragment depth to linear depth (meters)
  float virtualDepthNDC = gl_FragCoord.z * 2.0 - 1.0;
  float virtualDepthMeters = getLinearDepth(virtualDepthNDC, cameraNear, cameraFar) * cameraFar;
  
  // Margin to prevent Z-fighting at contact points
  float occlusionMargin = 0.05; 
  
  if (realDepthMeters > 0.0 && virtualDepthMeters > realDepthMeters + occlusionMargin) {
      discard;
  }
#endif
`;

export function applyOcclusionMaterial(material) {
  if (patchedMaterials.has(material)) return;
  patchedMaterials.add(material);
  
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tDepth = { value: null };
    shader.uniforms.cameraNear = { value: 0.01 };
    shader.uniforms.cameraFar = { value: 20.0 };
    
    // Prefix vertex
    shader.vertexShader = '#define USE_DEPTH_SENSING\n' + depthVertexShaderChunk + shader.vertexShader;
    
    // Inject vertex calculation
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n` + depthVertexShaderInit
    );
    
    // Prefix fragment
    shader.fragmentShader = '#define USE_DEPTH_SENSING\n' + depthFragmentShaderChunk + shader.fragmentShader;
    
    // Inject fragment test early
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `void main() {\n` + depthFragmentShaderInit
    );
    
    material.userData.shader = shader;
  };
}

export function updateOcclusionUniforms(scene, renderer, camera) {
  if (!renderer.xr.isPresenting) return;
  
  // Three.js renderer.xr.getDepthTexture() returns the depth WebGLTexture
  const depthTexture = renderer.xr.getDepthTexture ? renderer.xr.getDepthTexture() : null;
  if (!depthTexture) return;
  
  scene.traverse((child) => {
    if (child.isMesh && child.material) {
      // Handle array of materials
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(mat => {
        if (mat.userData.shader) {
          mat.userData.shader.uniforms.tDepth.value = depthTexture;
          mat.userData.shader.uniforms.cameraNear.value = camera.near;
          mat.userData.shader.uniforms.cameraFar.value = camera.far;
        }
      });
    }
  });
}
