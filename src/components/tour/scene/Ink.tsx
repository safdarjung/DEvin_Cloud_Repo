"use client";

import { useFBO } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Ink lines from the depth buffer alone. Window-space depth is linear across any flat surface, so its Laplacian
 * is zero on a plane and jumps at silhouettes and creases; dividing by (1 - depth) makes the jump independent of
 * distance. No second scene render, no per-mesh outline hulls.
 */
const FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 px;
uniform float near;
uniform float far;
varying vec2 vUv;

float depthAt(vec2 o) { return texture2D(tDepth, vUv + o * px).x; }

void main() {
  vec4 texel = texture2D(tColor, vUv);
  vec3 col = texel.rgb;
  float c = depthAt(vec2(0.0));
  float n = depthAt(vec2(0.0, 1.0));
  float s = depthAt(vec2(0.0, -1.0));
  float e = depthAt(vec2(1.0, 0.0));
  float w = depthAt(vec2(-1.0, 0.0));
  float closest = min(c, min(min(n, s), min(e, w)));
  float lap = abs(n + s + e + w - 4.0 * c) / max(1.0 - closest, 1e-6);
  // Lines thin out with distance so far trees and grass do not turn into scribble.
  float z = near * far / (far - closest * (far - near));
  // On a surface seen edge-on the depth slope is steep and its rounding noise passes for an edge: a real edge
  // changes the slope by a good fraction of the slope itself.
  float slope = (abs(e - w) + abs(n - s)) / max(1.0 - closest, 1e-6);
  float real = smoothstep(0.06, 0.22, lap / (slope + 1e-5));
  // Alpha is the ink mask: materials made with { ink: false } write 0 there.
  float ink = smoothstep(0.0035, 0.011, lap) * real * (1.0 - smoothstep(22.0, 60.0, z)) * texel.a;

  // Lines are a dark tint of what they cross, not black: closer to a painted cel.
  col = mix(col, col * 0.24 + vec3(0.035, 0.02, 0.05), ink * 0.8);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type Quad = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
const EYE = new THREE.Camera();

function makeQuad(): Quad {
  const uniforms = { tColor: { value: null }, tDepth: { value: null }, px: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 160 } };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  return quad;
}

/** Takes over rendering: scene → float target (4x MSAA, depth texture) → one full-screen pass that draws the ink. */
export function Ink() {
  const target = useFBO({ samples: 4, depthBuffer: true, type: THREE.HalfFloatType });
  const pass = useRef<Quad | null>(null);
  useEffect(
    () => () => {
      pass.current?.geometry.dispose();
      pass.current?.material.dispose();
      pass.current = null;
    },
    [],
  );

  useFrame(({ gl, scene, camera }) => {
    const quad = (pass.current ??= makeQuad());
    const u = quad.material.uniforms;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    u.tColor.value = target.texture;
    u.tDepth.value = target.depthTexture;
    // Just over one device pixel: a fine pen line at any pixel ratio.
    u.px.value.set(1.2 / target.width, 1.2 / target.height);
    if (camera instanceof THREE.PerspectiveCamera) {
      u.near.value = camera.near;
      u.far.value = camera.far;
    }
    gl.render(quad, EYE);
  }, 1);

  return null;
}
