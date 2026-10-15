import { useEffect, type RefObject } from 'react';
import { gsap } from 'gsap';

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useGsapReveal(ref: RefObject<HTMLElement | null>, dependencyKey = ''): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let context: gsap.Context | null = null;
    const update = () => {
      context?.revert();
      context = null;
      if (media?.matches) return;
      context = gsap.context(() => {
        gsap.fromTo(element, { opacity: 0.65 }, { opacity: 1, duration: 0.42, ease: 'power2.out', clearProps: 'opacity' });
      }, element);
    };
    update();
    media?.addEventListener('change', update);
    return () => { media?.removeEventListener('change', update); context?.revert(); };
  }, [dependencyKey, ref]);
}
