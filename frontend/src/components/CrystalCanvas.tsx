import { useEffect, useRef, useState } from 'react';
import type { IcosahedronGeometry, MeshStandardMaterial, WebGLRenderer } from 'three';

export function CrystalCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let disposed = false;
    let generation = 0;
    let timer = 0;
    let frame = 0;
    let renderer: WebGLRenderer | null = null;
    let geometry: IcosahedronGeometry | null = null;
    let material: MeshStandardMaterial | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const release = () => {
      generation += 1;
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      resizeObserver?.disconnect();
      resizeObserver = null;
      geometry?.dispose();
      material?.dispose();
      if (renderer) {
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      geometry = null;
      material = null;
      renderer = null;
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      release();
      if (!disposed) setActive(false);
    };

    const update = () => {
      release();
      if (disposed) return;
      setActive(false);
      if (document.hidden || media?.matches || typeof WebGL2RenderingContext === 'undefined') return;
      const token = generation;
      // Defer the genuine Three chunk until the visible, motion-enabled shell
      // has painted. CSS provides the static visual before or without WebGL.
      timer = window.setTimeout(() => {
        void import('three').then((THREE) => {
          if (disposed || generation !== token || document.hidden || media?.matches) return;
          try {
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
            camera.position.z = 4.8;
            renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
            renderer.domElement.setAttribute('aria-hidden', 'true');
            renderer.domElement.addEventListener('webglcontextlost', contextLost);
            host.appendChild(renderer.domElement);
            geometry = new THREE.IcosahedronGeometry(1.35, 1);
            material = new THREE.MeshStandardMaterial({ color: 0x9575ff, emissive: 0x241347, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.2, flatShading: true, transparent: true, opacity: 0.86 });
            const mesh = new THREE.Mesh(geometry, material);
            const light = new THREE.PointLight(0xe4d7ff, 4.2, 9);
            light.position.set(2, 2, 3);
            scene.add(mesh, new THREE.AmbientLight(0x8d79ff, 1.4), light);
            const resize = () => {
              const width = Math.max(host.clientWidth, 1);
              const height = Math.max(host.clientHeight, 1);
              camera.aspect = width / height;
              camera.updateProjectionMatrix();
              renderer?.setSize(width, height, false);
            };
            resize();
            if (typeof ResizeObserver === 'function') {
              resizeObserver = new ResizeObserver(resize);
              resizeObserver.observe(host);
            }
            let lastFrame = 0;
            const animate = (timestamp: number) => {
              if (disposed || generation !== token || document.hidden || !renderer) return;
              frame = window.requestAnimationFrame(animate);
              if (timestamp - lastFrame < 1000 / 24) return;
              const elapsed = Math.min(timestamp - lastFrame, 100) / 1000;
              lastFrame = timestamp;
              mesh.rotation.y += elapsed * 0.067;
              mesh.rotation.x += elapsed * 0.029;
              renderer.render(scene, camera);
            };
            frame = window.requestAnimationFrame(animate);
            setActive(true);
          } catch {
            release();
            if (!disposed) setActive(false);
          }
        }).catch(() => {
          if (!disposed && generation === token) { release(); setActive(false); }
        });
      }, 100);
    };
    update();
    document.addEventListener('visibilitychange', update);
    media?.addEventListener('change', update);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', update);
      media?.removeEventListener('change', update);
      release();
    };
  }, []);

  return <div ref={canvasRef} className={active ? 'crystal-canvas' : 'crystal-canvas crystal-canvas-fallback'} aria-hidden="true" />;
}
