import { useEffect, useState } from 'react';

function measure() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return { width, height, compact: width < 1050 || height < 650, short: height <= 500 };
}

export function useViewport() {
  const [viewport, setViewport] = useState(measure);
  useEffect(() => {
    const resize = () => setViewport(measure());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return viewport;
}
