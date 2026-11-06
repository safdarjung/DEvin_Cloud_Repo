"use client";

import { useEffect, useRef } from "react";

/** Decorative rotating point-sphere. Loaded lazily, skipped for reduced motion; the parent renders a static fallback. */
export default function BrandOrb() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let stop = () => {};
    let cancelled = false;

    void import("three").then((THREE) => {
      if (cancelled) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
      camera.position.z = 3.2;

      const geo = new THREE.IcosahedronGeometry(1, 4);
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x7fd6d0, size: 0.018, transparent: true, opacity: 0.8 }));
      const lines = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 2)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 }),
      );
      scene.add(points, lines);

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = el;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      let raf = 0;
      let running = true;
      const tick = () => {
        if (!running) return;
        points.rotation.y += 0.0025;
        lines.rotation.y += 0.0025;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      const onVis = () => {
        running = !document.hidden;
        if (running) tick();
      };
      document.addEventListener("visibilitychange", onVis);
      tick();

      stop = () => {
        running = false;
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVis);
        ro.disconnect();
        geo.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return <div ref={ref} aria-hidden className="absolute inset-0" />;
}
