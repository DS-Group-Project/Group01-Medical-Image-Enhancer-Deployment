// src/context/VedaContext.jsx
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

const VedaContext = createContext(null);

export const VedaProvider = ({ children }) => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'init-1',
      sender: 'veda',
      type: 'text',
      text: "Hello! I am Veda, your clinical AI assistant. Ask me to find scans, count images, or detect abnormalities in active X-rays.",
    },
  ]);
  const [activeJobContext, setActiveJobContext] = useState(null); // { jobId, filename, imageUrl }
  const [activeMarker, setActiveMarker] = useState(null); // { cx, cy, radius, color, condition, description }

  const toggleOpen = useCallback(() => setIsOpen(prev => !prev), []);

  const addMessage = useCallback((messageObj) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), ...messageObj }]);
    if (messageObj.payload?.marker) {
      setActiveMarker({
        ...messageObj.payload.marker,
        condition: messageObj.payload.condition,
        description: messageObj.payload.description
      });
    }
  }, []);

  const handleSetActiveJobContext = useCallback((ctx) => {
    setActiveJobContext(prev => {
      if (ctx === null && prev === null) return prev;
      if (
        prev &&
        ctx &&
        prev.jobId === ctx.jobId &&
        prev.imageUrl === ctx.imageUrl &&
        prev.filename === ctx.filename
      ) {
        return prev;
      }
      if (prev?.jobId !== ctx?.jobId) {
        setActiveMarker(null);
      }
      return ctx;
    });
  }, []);

  const value = useMemo(() => ({
    isOpen,
    setIsOpen,
    toggleOpen,
    messages,
    addMessage,
    activeJobContext,
    setActiveJobContext: handleSetActiveJobContext,
    activeMarker,
    setActiveMarker,
    currentPath: location.pathname,
  }), [
    isOpen,
    toggleOpen,
    messages,
    addMessage,
    activeJobContext,
    handleSetActiveJobContext,
    activeMarker,
    location.pathname,
  ]);

  return (
    <VedaContext.Provider value={value}>
      {children}
    </VedaContext.Provider>
  );
};

export const useVeda = () => {
  const context = useContext(VedaContext);
  if (!context) {
    throw new Error('useVeda must be used within a VedaProvider');
  }
  return context;
};