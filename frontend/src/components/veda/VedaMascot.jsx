// src/components/veda/VedaMascot.jsx
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * Interactive Veda Mascot
 * - Layers user's custom body (public/veda-bot-body.png) and glowing eyes (public/veda-bot-eyes.png)
 * - 100% transparent container (no square box, no extra background)
 * - Eyes follow the user's cursor across the screen with responsive spring physics
 * - Blinks naturally (and on chat open) and breathes gently in chat mode
 * - Automatic SVG fallback in #00A896 Light Sea Green if PNGs are not found
 */
export const VedaMascot = ({
  isOpen = false,
  size = 76,
  interactive = true,
  className = '',
  breathingScale = 1.03, // Balanced, natural breathing expansion (~3.0%)
  floatDistance = 2.0,   // Gentle float bob (~2.0px)
  onClick,
}) => {
  const containerRef = useRef(null);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const [hasCustomImage, setHasCustomImage] = useState(false);

  // Probe whether custom PNG assets exist
  useEffect(() => {
    const testImg = new Image();
    testImg.onload = () => setHasCustomImage(true);
    testImg.onerror = () => setHasCustomImage(false);
    testImg.src = '/veda-bot-body.png';
  }, []);

  // Smooth mouse tracking for eyes
  useEffect(() => {
    if (!interactive) return;

    let rafId;
    const handleMouseMove = (e) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const mascotCenterX = rect.left + rect.width * 0.434; // align with eye center
        const mascotCenterY = rect.top + rect.height * 0.702;

        const dx = e.clientX - mascotCenterX;
        const dy = e.clientY - mascotCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance === 0) {
          setEyeOffset({ x: 0, y: 0 });
          return;
        }

        const angle = Math.atan2(dy, dx);
        const maxRadius = Math.min(distance / 450, 1);

        // Dynamically scale offset according to mascot size
        // For size 76: ~6.2px horizontal, ~4.2px vertical
        const maxOffsetX = Math.max(4.0, (size / 76) * 6.2);
        const maxOffsetY = Math.max(2.8, (size / 76) * 4.2);

        setEyeOffset({
          x: Math.cos(angle) * maxOffsetX * maxRadius,
          y: Math.sin(angle) * maxOffsetY * maxRadius,
        });
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, [interactive, size]);

  // Greeting blink immediately when chat window opens
  useEffect(() => {
    if (isOpen) {
      const greetingTimer = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => setIsBlinking(false), 140);
      }, 350);
      return () => clearTimeout(greetingTimer);
    }
  }, [isOpen]);

  // Natural blinking loop
  useEffect(() => {
    let timeoutId;
    let isCancelled = false;

    const triggerBlink = () => {
      if (isCancelled) return;
      setIsBlinking(true);

      setTimeout(() => {
        if (isCancelled) return;
        setIsBlinking(false);

        // 25% chance of double blink
        const doubleBlink = Math.random() < 0.25;
        if (doubleBlink) {
          setTimeout(() => {
            if (isCancelled) return;
            setIsBlinking(true);
            setTimeout(() => {
              if (isCancelled) return;
              setIsBlinking(false);
              scheduleNextBlink();
            }, 100);
          }, 130);
        } else {
          scheduleNextBlink();
        }
      }, 120);
    };

    const scheduleNextBlink = () => {
      if (isCancelled) return;
      // Chat mode: frequent lively blinks every 2.4 - 3.8s
      // Idle mode: periodic blinks every 3.5 - 6.0s
      const minDelay = isOpen ? 2400 : 3500;
      const extraDelay = isOpen ? 1400 : 2500;
      const delay = minDelay + Math.random() * extraDelay;
      timeoutId = setTimeout(triggerBlink, delay);
    };

    scheduleNextBlink();

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isOpen]);

  // Vector SVG Paths (Fallback)
  const hoodPath =
    'M 43.0 23.0 C 41.8 23.2, 41.0 23.5, 40.0 24.0 C 39.0 24.5, 38.8 24.3, 37.0 26.0 C 35.2 27.7, 31.0 31.8, 29.0 34.0 C 27.0 36.2, 27.0 36.2, 25.0 39.0 C 23.0 41.8, 18.8 48.0, 17.0 51.0 C 15.2 54.0, 14.7 55.5, 14.0 57.0 C 13.3 58.5, 13.2 58.8, 13.0 60.0 C 12.8 61.2, 12.8 63.0, 13.0 64.0 C 13.2 65.0, 13.2 65.0, 14.0 66.0 C 14.8 67.0, 17.0 69.2, 18.0 70.0 C 19.0 70.8, 19.3 70.7, 20.0 71.0 C 20.7 71.3, 21.0 71.7, 22.0 72.0 C 23.0 72.3, 24.7 72.7, 26.0 73.0 C 27.3 73.3, 26.0 73.8, 30.0 74.0 C 34.0 74.2, 45.7 74.2, 50.0 74.0 C 54.3 73.8, 54.5 73.3, 56.0 73.0 C 57.5 72.7, 57.5 72.7, 59.0 72.0 C 60.5 71.3, 63.7 69.8, 65.0 69.0 C 66.3 68.2, 66.5 67.7, 67.0 67.0 C 67.5 66.3, 67.8 66.2, 68.0 65.0 C 68.2 63.8, 68.2 61.3, 68.0 60.0 C 67.8 58.7, 67.8 58.8, 67.0 57.0 C 66.2 55.2, 64.2 51.2, 63.0 49.0 C 61.8 46.8, 61.0 45.5, 60.0 44.0 C 59.0 42.5, 58.0 41.2, 57.0 40.0 C 56.0 38.8, 54.2 37.7, 54.0 37.0 C 53.8 36.3, 55.3 35.8, 56.0 36.0 C 56.7 36.2, 57.2 37.5, 58.0 38.0 C 58.8 38.5, 60.2 39.0, 61.0 39.0 C 61.8 39.0, 62.0 39.0, 63.0 38.0 C 64.0 37.0, 66.0 34.0, 67.0 33.0 C 68.0 32.0, 68.2 31.7, 69.0 32.0 C 69.8 32.3, 71.2 34.7, 72.0 35.0 C 72.8 35.3, 74.2 34.7, 74.0 34.0 C 73.8 33.3, 71.5 31.8, 71.0 31.0 C 70.5 30.2, 71.2 29.7, 71.0 29.0 C 70.8 28.3, 70.5 27.3, 70.0 27.0 C 69.5 26.7, 69.2 26.2, 68.0 27.0 C 66.8 27.8, 64.3 31.2, 63.0 32.0 C 61.7 32.8, 61.0 32.3, 60.0 32.0 C 59.0 31.7, 58.0 30.8, 57.0 30.0 C 56.0 29.2, 55.0 27.8, 54.0 27.0 C 53.0 26.2, 51.8 25.5, 51.0 25.0 C 50.2 24.5, 49.7 24.3, 49.0 24.0 C 48.3 23.7, 48.0 23.2, 47.0 23.0 C 46.0 22.8, 44.2 22.8, 43.0 23.0 Z';

  const facePath =
    'M 37.0 41.0 C 38.7 40.8, 43.3 40.8, 45.0 41.0 C 46.7 41.2, 46.3 41.7, 47.0 42.0 C 47.7 42.3, 47.5 41.7, 49.0 43.0 C 50.5 44.3, 54.5 48.3, 56.0 50.0 C 57.5 51.7, 57.5 52.2, 58.0 53.0 C 58.5 53.8, 58.7 54.3, 59.0 55.0 C 59.3 55.7, 59.7 56.0, 60.0 57.0 C 60.3 58.0, 60.8 59.8, 61.0 61.0 C 61.2 62.2, 61.2 63.2, 61.0 64.0 C 60.8 64.8, 60.7 65.2, 60.0 66.0 C 59.3 66.8, 58.0 68.2, 57.0 69.0 C 56.0 69.8, 54.8 70.5, 54.0 71.0 C 53.2 71.5, 53.0 71.7, 52.0 72.0 C 51.0 72.3, 51.0 72.8, 48.0 73.0 C 45.0 73.2, 37.0 73.2, 34.0 73.0 C 31.0 72.8, 31.2 72.3, 30.0 72.0 C 28.8 71.7, 27.8 71.3, 27.0 71.0 C 26.2 70.7, 26.0 70.8, 25.0 70.0 C 24.0 69.2, 21.8 67.0, 21.0 66.0 C 20.2 65.0, 20.2 65.3, 20.0 64.0 C 19.8 62.7, 19.5 60.0, 20.0 58.0 C 20.5 56.0, 21.3 54.2, 23.0 52.0 C 24.7 49.8, 28.3 46.5, 30.0 45.0 C 31.7 43.5, 32.2 43.5, 33.0 43.0 C 33.8 42.5, 34.3 42.3, 35.0 42.0 C 35.7 41.7, 35.3 41.2, 37.0 41.0 Z';

  // Height proportional to original artwork aspect ratio (1631w : 1310h)
  const calculatedHeight = Math.round(size * (1310 / 1631));

  return (
    <motion.div
      ref={containerRef}
      onClick={onClick}
      className={`relative inline-flex items-center justify-center select-none bg-transparent ${className}`}
      style={{
        width: size,
        height: calculatedHeight,
        transformOrigin: '50% 85%',
      }}
      // Balanced natural breathing animation
      animate={
        isOpen
          ? {
              scale: [1, breathingScale * 1.008, 1],
              y: [0, -(floatDistance + 0.6), 0],
            }
          : {
              scale: [1, breathingScale, 1],
              y: [0, -floatDistance, 0],
            }
      }
      transition={{
        duration: isOpen ? 2.8 : 3.0,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
    >
      {hasCustomImage ? (
        /* Layered rendering of User's Artwork */
        <div className="relative w-full h-full flex items-center justify-center overflow-visible">
          {/* Layer 1: Body (Hood + dark face cavity, transparent background) */}
          <img
            src="/veda-bot-body.png"
            alt="Veda Body"
            className="w-full h-full object-contain pointer-events-none drop-shadow-lg"
            draggable={false}
          />

          {/* Layer 2: User's exact glowing eyes (Moves with cursor & blinks) */}
          <motion.img
            src="/veda-bot-eyes.png"
            alt="Veda Eyes"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            draggable={false}
            style={{
              transformOrigin: '43.4% 70.2%', // Precise center of user's eye sockets
            }}
            animate={{
              x: eyeOffset.x,
              y: eyeOffset.y,
              scaleY: isBlinking ? 0.02 : 1,
            }}
            transition={{
              x: { type: 'spring', stiffness: 220, damping: 20, mass: 0.5 },
              y: { type: 'spring', stiffness: 220, damping: 20, mass: 0.5 },
              scaleY: { duration: isBlinking ? 0.07 : 0.12, ease: 'easeInOut' },
            }}
          />
        </div>
      ) : (
        /* Vector SVG Fallback with Light Sea Green (#00A896) */
        <svg
          viewBox="0 0 90 90"
          width={size}
          height={calculatedHeight}
          className="w-full h-full overflow-visible drop-shadow-md"
        >
          <defs>
            <linearGradient id="vedaSeaGreenGrad" x1="15%" y1="0%" x2="85%" y2="100%">
              <stop offset="0%" stopColor="#15D1BC" />
              <stop offset="45%" stopColor="#00A896" />
              <stop offset="100%" stopColor="#026E62" />
            </linearGradient>

            <radialGradient id="vedaFaceGrad" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#081518" />
              <stop offset="100%" stopColor="#02090B" />
            </radialGradient>

            <filter id="vedaEyeGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.8" floodColor="#34F5DF" floodOpacity="0.85" />
            </filter>
          </defs>

          {/* Outer Outline */}
          <path
            d={hoodPath}
            fill="none"
            stroke="#03201D"
            strokeWidth="4.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Hood */}
          <path d={hoodPath} fill="url(#vedaSeaGreenGrad)" />

          {/* Face Cavity */}
          <path
            d={facePath}
            fill="url(#vedaFaceGrad)"
            stroke="#03201D"
            strokeWidth="1.2"
          />

          {/* SVG Eyes */}
          <motion.g
            style={{ transformOrigin: '41px 58px' }}
            animate={{
              x: eyeOffset.x,
              y: eyeOffset.y,
              scaleY: isBlinking ? 0.02 : 1,
            }}
            transition={{
              x: { type: 'spring', stiffness: 220, damping: 20, mass: 0.5 },
              y: { type: 'spring', stiffness: 220, damping: 20, mass: 0.5 },
              scaleY: { duration: isBlinking ? 0.07 : 0.12, ease: 'easeInOut' },
            }}
            filter="url(#vedaEyeGlow)"
          >
            <ellipse cx="33.5" cy="58" rx="3.5" ry="6.2" fill="#FFFFFF" />
            <ellipse cx="48.5" cy="58" rx="3.5" ry="6.2" fill="#FFFFFF" />
          </motion.g>
        </svg>
      )}
    </motion.div>
  );
};
