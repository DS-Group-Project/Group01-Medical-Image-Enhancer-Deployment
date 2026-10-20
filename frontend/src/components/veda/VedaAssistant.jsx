// src/components/veda/VedaAssistant.jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  X,
  Send,
  Bot,
  Sparkles,
  Loader2,
  Maximize2,
  Minimize2,
  GripHorizontal,
  RotateCcw
} from 'lucide-react';
import { useVeda } from '../../context/VedaContext';
import { vedaService } from '../../services/vedaService';
import { VedaFileResultsCard } from './VedaFileResultsCard';
import { VedaAbnormalityCard } from './VedaAbnormalityCard';
import { VedaMascot } from './VedaMascot';

export const VedaAssistant = () => {
  const {
    isOpen,
    toggleOpen,
    messages,
    addMessage,
    activeJobContext,
    currentPath
  } = useVeda();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Default position generator - placed on the left side with high visibility
  const getDefaultPosition = useCallback((expanded = false) => {
    if (typeof window === 'undefined') return { x: 24, y: 96 };
    const width = expanded
      ? Math.min(1040, window.innerWidth - 48)
      : Math.min(640, window.innerWidth - 48);
    const maxHeight = window.innerHeight - 120;
    const height = expanded
      ? Math.min(window.innerHeight * 0.88, maxHeight)
      : Math.min(720, maxHeight);

    // Left side: 24px from left screen edge
    const defaultX = 24;
    // Just below navbar (navbar height is 80px)
    const defaultY = Math.max(90, Math.min(96, window.innerHeight - height - 20));

    return { x: defaultX, y: defaultY };
  }, []);

  // Position state (pixels from top-left of viewport)
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 24, y: 96 };
    const width = Math.min(640, window.innerWidth - 48);
    const maxHeight = window.innerHeight - 120;
    const height = Math.min(720, maxHeight);
    return {
      x: 24,
      y: Math.max(90, Math.min(96, window.innerHeight - height - 20)),
    };
  });

  const chatRef = useRef(null);
  const dragData = useRef({
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Keep window inside viewport bounds on window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((curr) => {
        const chatRect = chatRef.current?.getBoundingClientRect();
        const width = chatRect ? chatRect.width : 640;
        const height = chatRect ? chatRect.height : 720;
        const maxX = Math.max(12, window.innerWidth - width - 12);
        const maxY = Math.max(12, window.innerHeight - height - 12);
        return {
          x: Math.max(12, Math.min(maxX, curr.x)),
          y: Math.max(12, Math.min(maxY, curr.y)),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Reset position back to the default left-side location
  const resetPosition = useCallback(() => {
    setPosition(getDefaultPosition(isExpanded));
  }, [getDefaultPosition, isExpanded]);

  // Toggle expand and keep position clamped inside viewport
  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      setTimeout(() => {
        setPosition((curr) => {
          const chatRect = chatRef.current?.getBoundingClientRect();
          const width = chatRect ? chatRect.width : (next ? 1040 : 640);
          const height = chatRect ? chatRect.height : (next ? window.innerHeight * 0.88 : 720);
          const maxX = Math.max(12, window.innerWidth - width - 12);
          const maxY = Math.max(12, window.innerHeight - height - 12);
          return {
            x: Math.max(12, Math.min(maxX, curr.x)),
            y: Math.max(12, Math.min(maxY, curr.y)),
          };
        });
      }, 40);
      return next;
    });
  }, []);

  // Drag Handlers
  const handlePointerDown = (e) => {
    // Prevent dragging when clicking interactive buttons/inputs
    if (e.target.closest('button, input, textarea, a, select')) return;

    const chatRect = chatRef.current?.getBoundingClientRect();
    if (!chatRect) return;

    setIsDragging(true);
    dragData.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      // Fallback if not supported
    }
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;

    const dx = e.clientX - dragData.current.startX;
    const dy = e.clientY - dragData.current.startY;

    const chatRect = chatRef.current?.getBoundingClientRect();
    const width = chatRect ? chatRect.width : 640;
    const height = chatRect ? chatRect.height : 720;

    // Viewport boundaries clamping
    const minX = 12;
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const minY = 12;
    const maxY = Math.max(12, window.innerHeight - height - 12);

    setPosition({
      x: Math.max(minX, Math.min(maxX, dragData.current.origX + dx)),
      y: Math.max(minY, Math.min(maxY, dragData.current.origY + dy)),
    });
  };

  const handlePointerUp = (e) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // Ignore
      }
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');

    addMessage({
      sender: 'user',
      type: 'text',
      text: userText,
    });

    try {
      setLoading(true);

      // Collect recent conversation history (last 6 turns)
      const chatHistory = messages
        .filter(m => m.id !== 'init-1')
        .slice(-6)
        .map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text || ''
        }));

      const res = await vedaService.sendMessage(
        userText,
        {
          jobId: activeJobContext?.jobId,
          currentRoute: currentPath,
        },
        chatHistory
      );

      addMessage({
        sender: 'veda',
        type: res.type || 'text',
        text: res.reply || 'Analysis completed.',
        payload: res.payload,
        imageUrl: activeJobContext?.imageUrl,
      });
    } catch (err) {
      console.error('Veda chat error:', err);
      addMessage({
        sender: 'veda',
        type: 'text',
        text: "I am having trouble connecting right now. Please try asking your question again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatText = (text) => {
    if (!text || typeof text !== 'string') return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold text-teal-300">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <>
      {/* Draggable Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={chatRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
            className={`fixed z-50 bg-slate-900 border border-slate-700/90 shadow-2xl rounded-2xl flex flex-col overflow-hidden ${
              isDragging
                ? 'select-none ring-2 ring-teal-500/50 shadow-teal-500/20'
                : 'transition-[width,height] duration-200'
            } ${
              isExpanded
                ? 'w-[94vw] sm:w-[840px] md:w-[940px] lg:w-[1040px] h-[88vh] max-h-[88vh]'
                : 'w-[92vw] sm:w-[540px] md:w-[620px] lg:w-[680px] h-[720px] max-h-[calc(100vh-100px)]'
            }`}
          >
            {/* Draggable Header */}
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={(e) => {
                if (!e.target.closest('button')) resetPosition();
              }}
              style={{ touchAction: 'none' }}
              className={`bg-slate-950 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between cursor-grab active:cursor-grabbing select-none transition-colors ${
                isDragging ? 'bg-slate-950/90' : 'hover:bg-slate-950/95'
              }`}
              title="Click and drag to move anywhere (Double-click to reset to left side)"
            >
              <div className="flex items-center gap-3 min-w-0 pointer-events-none">
                <div className="flex items-center justify-center flex-shrink-0 -my-1">
                  <VedaMascot size={46} isOpen={true} breathingScale={1.025} floatDistance={1.4} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">Veda</h3>
                    <span className="text-xs font-semibold bg-teal-900/60 text-teal-300 px-2 py-0.5 rounded-md border border-teal-700/50">
                      AI Assist
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 truncate">
                    {activeJobContext ? `Attached: ${activeJobContext.filename}` : 'Ready for queries'}
                  </p>
                </div>
              </div>

              {/* Central Grip Indicator */}
              <div className="hidden sm:flex items-center gap-1 text-slate-500 hover:text-slate-400 px-2 py-1 rounded pointer-events-none">
                <GripHorizontal size={18} />
              </div>

              {/* Window Controls */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={resetPosition}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Reset position to default (left side)"
                  className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type="button"
                  onClick={toggleExpand}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={isExpanded ? "Collapse to standard size" : "Expand chat window"}
                  className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button
                  type="button"
                  onClick={toggleOpen}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Close assistant"
                  className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X size={19} />
                </button>
              </div>
            </div>

            {/* Message Area */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-slate-900/60">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm sm:text-[15px] leading-relaxed ${
                      msg.sender === 'user'
                        ? 'max-w-[85%] bg-teal-600 text-white rounded-br-none shadow-md font-medium'
                        : 'max-w-[96%] w-full bg-slate-800 text-slate-100 border border-slate-700/80 rounded-bl-none shadow-md'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{formatText(msg.text)}</p>

                    {/* Rich Response: File Results */}
                    {msg.type === 'file_list_result' && (
                      <VedaFileResultsCard payload={msg.payload} onCloseWidget={toggleOpen} />
                    )}

                    {/* Rich Response: Abnormality Annotation */}
                    {msg.type === 'abnormality_result' && (
                      <VedaAbnormalityCard
                        payload={msg.payload}
                        imageUrl={msg.imageUrl || activeJobContext?.imageUrl}
                      />
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 border border-slate-700/80 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2.5 text-sm text-slate-300 shadow-md">
                    <Loader2 size={16} className="animate-spin text-teal-400" />
                    Analyzing scan & metadata...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSend} className="p-3.5 bg-slate-950 border-t border-slate-800 flex items-center gap-2.5">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  activeJobContext
                    ? "Ask about this scan (e.g., 'any fracture?')"
                    : "Ask Veda (e.g., 'show leg images')..."
                }
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/50"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="p-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-xl transition-colors shadow-sm flex items-center justify-center"
              >
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Trigger Button (Anchor at bottom-left) */}
      <div className="fixed bottom-6 left-6 z-40">
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={toggleOpen}
          className="relative p-0 bg-transparent border-0 shadow-none focus:outline-none flex items-center justify-center cursor-pointer select-none"
          title={isOpen ? "Minimize assistant" : "Ask Veda AI Assistant"}
          aria-label="Veda AI Assistant"
        >
          <VedaMascot size={76} isOpen={isOpen} breathingScale={1.03} floatDistance={2.0} />
        </motion.button>
      </div>
    </>
  );
};