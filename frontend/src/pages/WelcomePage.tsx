import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';

import { useAuthSession } from '../hooks/useAuthSession';
import { CrystalCanvas } from '../components/CrystalCanvas';
import { useGsapReveal } from '../motion';

export function WelcomePage() {
  const { session } = useAuthSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  useGsapReveal(containerRef);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.welcome-hero-title', {
        y: 80,
        opacity: 0,
        duration: 1.2,
        ease: 'power3.out',
      });
      gsap.from('.welcome-hero-subtitle', {
        y: 60,
        opacity: 0,
        duration: 1.2,
        delay: 0.2,
        ease: 'power3.out',
      });
      gsap.from('.welcome-cta', {
        y: 40,
        opacity: 0,
        duration: 1,
        delay: 0.4,
        ease: 'power3.out',
        stagger: 0.1,
      });
      gsap.from('.welcome-feature', {
        y: 60,
        opacity: 0,
        duration: 0.8,
        delay: 0.6,
        ease: 'power2.out',
        stagger: 0.15,
      });
      gsap.to('.welcome-float', {
        y: -30,
        duration: 4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        stagger: 0.8,
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 30,
        y: (e.clientY / window.innerHeight - 0.5) * 30,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div ref={containerRef} className="welcome-page">
      <CrystalCanvas />
      <div className="welcome-orbs">
        <div className="welcome-float orb-1" style={{ transform: `translate(${mousePos.x}px, ${mousePos.y}px)` }} />
        <div className="welcome-float orb-2" style={{ transform: `translate(${-mousePos.x * 0.6}px, ${-mousePos.y * 0.8}px)` }} />
        <div className="welcome-float orb-3" style={{ transform: `translate(${mousePos.x * 0.4}px, ${mousePos.y * 0.5}px)` }} />
      </div>

      <nav className="welcome-nav">
        <Link to="/welcome" className="welcome-brand">
          <span className="brand-mark">O</span>
          <span>Obsidian</span>
        </Link>
        <div className="welcome-nav-actions">
          {session.status === 'authenticated' ? (
            <Link to="/home" className="welcome-nav-button primary">Go to Dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="welcome-nav-button">Sign In</Link>
              <Link to="/signup" className="welcome-nav-button primary">Get Started</Link>
            </>
          )}
        </div>
      </nav>

      <main className="welcome-main">
        <section ref={heroRef} className="welcome-hero">
          <span className="welcome-eyebrow">Review-First Project Enhancement</span>
          <h1 className="welcome-hero-title">
            Safely Analyze, Repair &amp;
            <span className="welcome-title-gradient">Enhance</span>
            Your Projects
          </h1>
          <p className="welcome-hero-subtitle">
            Obsidian works from an immutable repository snapshot, shows its evidence, and waits for your approval 
            before making any changes. Transform your codebase with confidence.
          </p>
          <div className="welcome-cta-group">
            {session.status === 'authenticated' ? (
              <Link to="/home" className="welcome-cta primary-cta">Start Enhancing</Link>
            ) : (
              <>
                <Link to="/signup" className="welcome-cta primary-cta">Get Started Free</Link>
                <Link to="/login" className="welcome-cta secondary-cta">Sign In</Link>
              </>
            )}
          </div>
        </section>

        <section ref={featuresRef} className="welcome-features">
          <div className="welcome-feature">
            <div className="feature-icon-wrapper">
              <span className="feature-icon-large">🔍</span>
            </div>
            <h3>Evidence-Based Detection</h3>
            <p>Analyzes your codebase with concrete evidence, never guesses or assumes technologies.</p>
          </div>
          <div className="welcome-feature">
            <div className="feature-icon-wrapper">
              <span className="feature-icon-large">🛡️</span>
            </div>
            <h3>Safe & Review-First</h3>
            <p>Original project stays untouched. Every change requires your explicit approval.</p>
          </div>
          <div className="welcome-feature">
            <div className="feature-icon-wrapper">
              <span className="feature-icon-large">⚡</span>
            </div>
            <h3>Intelligent Repair</h3>
            <p>Identifies issues, creates repair plans, and validates changes in isolated workspaces.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
