import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, X } from 'lucide-react';
import { useVoiceSearch } from '@food/hooks/useVoiceSearch';

const VoiceSearchOverlay = ({
  isOpen,
  onClose,
  onSearchResult,
  voiceSearch: externalVoiceSearch = null,
  autoStart = true,
}) => {
  const internalVoiceSearch = useVoiceSearch((result) => {
    onSearchResult(result);
    onClose();
  });

  const voiceSearch = externalVoiceSearch || internalVoiceSearch;
  const {
    isListening,
    transcript,
    error,
    startListening,
    stopListening,
    clearError,
  } = voiceSearch;

  // NOTE: depend on a boolean, not the `externalVoiceSearch` object. The parent's
  // useVoiceSearch() returns a fresh object every render, and onstart sets state,
  // so depending on the object re-ran this effect right after recognition started
  // and its cleanup (stopListening) killed the session — the overlay stayed on
  // "Starting..." and nothing was ever searched.
  const hasExternalVoiceSearch = Boolean(externalVoiceSearch);

  useEffect(() => {
    if (!isOpen) {
      stopListening();
      return undefined;
    }

    if (autoStart && !hasExternalVoiceSearch) {
      void startListening();
    }

    return () => {
      stopListening();
    };
  }, [isOpen, autoStart, hasExternalVoiceSearch, startListening, stopListening]);

  const handleRetry = () => {
    clearError();
    void startListening();
  };

  const handleClose = () => {
    stopListening();
    onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md px-6"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            className="w-full max-w-sm bg-white dark:bg-[#242424] rounded-[2.5rem] p-10 flex flex-col items-center relative overflow-hidden shadow-2xl"
          >
            <button
              onClick={handleClose}
              className="absolute top-5 right-5 p-2 bg-red-50 dark:bg-red-950/30 rounded-full hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors z-20"
              aria-label="Close voice search"
            >
              <X className="h-5 w-5 text-red-500 dark:text-red-400" />
            </button>

            <div className="relative z-10 mb-8 mt-4">
              <motion.div
                animate={{
                  scale: [1, 1.5, 2],
                  opacity: [0.5, 0.3, 0],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full bg-red-500/20"
              />

              <div className="relative bg-red-500 h-24 w-24 rounded-full flex items-center justify-center shadow-lg shadow-red-500/40">
                <Mic className="h-10 w-10 text-white" strokeWidth={2.5} />
              </div>
            </div>

            <div className="text-center z-10 space-y-2">
              <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">
                {error
                  ? 'Try again'
                  : transcript
                    ? `"${transcript}"`
                    : isListening
                      ? 'Listening...'
                      : 'Starting...'}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 font-medium px-4">
                {error
                  ? error
                  : transcript
                    ? 'Processing search...'
                    : 'Say a dish or restaurant name'}
              </p>
            </div>

            {error ? (
              <button
                onClick={handleRetry}
                className="mt-8 z-10 rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
              >
                Try again
              </button>
            ) : (
              <div className="flex items-center gap-1.5 h-8 mt-10 z-10">
                {[1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      height: isListening ? [8, 24, 8] : 8,
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                    className="w-1.5 bg-red-500 rounded-full"
                  />
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default VoiceSearchOverlay;
