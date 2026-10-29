import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';

import { githubLoginUrl } from '../api';
import { useAuthSession } from '../hooks/useAuthSession';
import { CrystalCanvas } from '../components/CrystalCanvas';
import { useGsapReveal } from '../motion';

export function LoginPage() {
  const { session } = useAuthSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  useGsapReveal(containerRef);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(titleRef.current, {
        y: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
      });
      gsap.from(cardRef.current, {
        y: 80,
        opacity: 0,
        scale: 0.95,
        duration: 1.2,
        delay: 0.2,
        ease: 'power3.out',
      });
      gsap.to('.login-orb', {
        y: -20,
        x: 10,
        duration: 3,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        stagger: 0.5,
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  if (session.status === 'authenticated') {
    window.location.href = '/home';
    return null;
  }

  return (
    <div ref={containerRef} className="auth-page">
      <CrystalCanvas />
      <div className="auth-orbs">
        <div className="login-orb orb-1" style={{ transform: `translate(${mousePos.x}px, ${mousePos.y}px)` }} />
        <div className="login-orb orb-2" style={{ transform: `translate(${-mousePos.x * 0.7}px, ${-mousePos.y * 0.7}px)` }} />
        <div className="login-orb orb-3" style={{ transform: `translate(${mousePos.x * 0.5}px, ${mousePos.y * 0.3}px)` }} />
      </div>
      
      <div className="auth-container">
        <div className="auth-header">
          <Link to="/welcome" className="auth-brand">
            <span className="brand-mark">O</span>
            <span>Obsidian</span>
          </Link>
        </div>

        <div className="auth-content">
          <div className="auth-hero">
            <h1 ref={titleRef} className="auth-title">
              Welcome Back
              <span className="auth-title-gradient">to Obsidian</span>
            </h1>
            <p className="auth-subtitle">
              Sign in to analyze, repair, and enhance your projects with AI-powered insights
            </p>
          </div>

          <div ref={cardRef} className="auth-card">
            <div className="auth-card-header">
              <h2>Sign In</h2>
              <p>Access your secure workspace</p>
            </div>

            {session.configured ? (
              <a href={githubLoginUrl()} className="github-auth-button">
                <svg className="github-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Continue with GitHub
              </a>
            ) : (
              <div className="auth-error">
                <p>GitHub sign-in is not configured for this environment.</p>
              </div>
            )}

            <div className="auth-divider">
              <span>or</span>
            </div>

            <div className="auth-footer">
              <p>Don't have an account?</p>
              <Link to="/signup" className="auth-link">Sign up</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
