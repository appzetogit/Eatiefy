import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';

const MAX_AUTO_RETRIES = 2;
const SILENCE_COMMIT_MS = 2000;

const MIC_PERMISSION_HANDLER_NAMES = [
    'requestMicrophonePermission',
    'checkMicrophonePermission',
    'requestMicPermission',
    'requestPermission',
];

const WEBVIEW_MIC_DENIED_MESSAGE =
    'Microphone access denied. Enable microphone for this app in phone settings, then try again.';

const isIOSDevice = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

const isNativeWebView = () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent || '';
    return Boolean(
        window.flutter_inappwebview ||
        window.ReactNativeWebView ||
        /\bwv\b/i.test(ua) ||
        /Android.*Version\/[\d.]+/i.test(ua),
    );
};

const queryMicrophonePermissionState = async () => {
    if (!navigator.permissions?.query) {
        return null;
    }

    try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        return status?.state || null;
    } catch {
        return null;
    }
};

const requestNativeMicrophonePermission = async () => {
    if (!window.flutter_inappwebview?.callHandler) {
        return null;
    }

    const payload = { permission: 'microphone', type: 'microphone' };

    for (const handlerName of MIC_PERMISSION_HANDLER_NAMES) {
        try {
            const result = await window.flutter_inappwebview.callHandler(handlerName, payload);
            if (result === true || result?.granted === true || result?.success === true) {
                return true;
            }
            if (result === false || result?.granted === false || result?.success === false) {
                return false;
            }
        } catch {
            // Try the next handler name.
        }
    }

    return null;
};

const ensureMicrophonePermission = async () => {
    const permissionState = await queryMicrophonePermissionState();
    if (permissionState === 'granted') {
        return true;
    }

    if (permissionState === 'denied' && !isNativeWebView()) {
        return false;
    }

    const nativePermission = await requestNativeMicrophonePermission();
    if (nativePermission === true) {
        return true;
    }
    if (nativePermission === false && !isNativeWebView()) {
        return false;
    }

    if (isNativeWebView()) {
        return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        return true;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
    } catch {
        // Best-effort only — let SpeechRecognition surface real errors.
    }

    return true;
};

export const useVoiceSearch = (onResult, onError) => {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState(null);

    const recognitionRef = useRef(null);
    const isStartingRef = useRef(false);
    const silenceTimeoutRef = useRef(null);
    const latestTranscriptRef = useRef('');
    const hasCommittedRef = useRef(false);
    const retryCountRef = useRef(0);
    const shouldKeepListeningRef = useRef(false);

    const onResultRef = useRef(onResult);
    onResultRef.current = onResult;

    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const isListeningRef = useRef(false);
    isListeningRef.current = isListening;

    const clearSilenceTimeout = () => {
        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
        }
    };

    const teardownRecognition = useCallback(() => {
        clearSilenceTimeout();

        if (!recognitionRef.current) {
            return;
        }

        try {
            recognitionRef.current.onstart = null;
            recognitionRef.current.onaudiostart = null;
            recognitionRef.current.onsoundstart = null;
            recognitionRef.current.onspeechstart = null;
            recognitionRef.current.onspeechend = null;
            recognitionRef.current.onsoundend = null;
            recognitionRef.current.onaudioend = null;
            recognitionRef.current.onresult = null;
            recognitionRef.current.onerror = null;
            recognitionRef.current.onend = null;
            recognitionRef.current.stop();
        } catch {
            // Ignore stop errors.
        }

        recognitionRef.current = null;
    }, []);

    const stopListening = useCallback(() => {
        shouldKeepListeningRef.current = false;
        teardownRecognition();
        setIsListening(false);
        isStartingRef.current = false;
    }, [teardownRecognition]);

    const commitResult = useCallback(() => {
        if (hasCommittedRef.current) {
            return;
        }

        const finalResult = latestTranscriptRef.current.trim();
        if (!finalResult) {
            return;
        }

        hasCommittedRef.current = true;
        shouldKeepListeningRef.current = false;
        onResultRef.current?.(finalResult);
        stopListening();
    }, [stopListening]);

    const scheduleSilenceCommit = useCallback(() => {
        clearSilenceTimeout();
        silenceTimeoutRef.current = setTimeout(() => {
            if (latestTranscriptRef.current.trim()) {
                commitResult();
            }
        }, SILENCE_COMMIT_MS);
    }, [commitResult]);

    const createRecognition = useCallback(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-IN';
        recognition.continuous = !(isIOSDevice() || isNativeWebView());
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            setIsListening(true);
            setError(null);
            isStartingRef.current = false;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const transcriptText = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcriptText;
                } else {
                    interimTranscript += transcriptText;
                }
            }

            const currentText = (finalTranscript || interimTranscript).trim();
            if (!currentText) {
                return;
            }

            latestTranscriptRef.current = currentText;
            setTranscript(currentText);
            setError(null);

            if (finalTranscript.trim()) {
                commitResult();
                return;
            }

            scheduleSilenceCommit();
        };

        recognition.onerror = (event) => {
            const errorType = event.error;
            console.error('Speech recognition error:', errorType);

            if (errorType === 'aborted') {
                return;
            }

            if (errorType === 'not-allowed') {
                const message = isNativeWebView()
                    ? WEBVIEW_MIC_DENIED_MESSAGE
                    : 'Microphone access denied.';
                setError(message);
                toast.error(message, { duration: 3000 });
                onErrorRef.current?.(errorType);
                stopListening();
                return;
            }

            if (errorType === 'network') {
                const message = 'Network error during voice search.';
                setError(message);
                toast.error(message, { duration: 3000 });
                onErrorRef.current?.(errorType);
                stopListening();
                return;
            }

            if (errorType === 'no-speech') {
                if (
                    shouldKeepListeningRef.current &&
                    !hasCommittedRef.current &&
                    retryCountRef.current < MAX_AUTO_RETRIES
                ) {
                    retryCountRef.current += 1;
                    return;
                }

                if (!hasCommittedRef.current && !latestTranscriptRef.current.trim()) {
                    setError('No speech detected. Tap try again and speak clearly.');
                }
            }
        };

        recognition.onend = () => {
            if (hasCommittedRef.current || !shouldKeepListeningRef.current) {
                setIsListening(false);
                isStartingRef.current = false;
                recognitionRef.current = null;
                return;
            }

            if (latestTranscriptRef.current.trim()) {
                commitResult();
                return;
            }

            if (retryCountRef.current < MAX_AUTO_RETRIES) {
                retryCountRef.current += 1;
                recognitionRef.current = null;
                isStartingRef.current = false;
                setIsListening(false);

                window.setTimeout(() => {
                    if (!shouldKeepListeningRef.current || hasCommittedRef.current) {
                        return;
                    }

                    try {
                        const nextRecognition = createRecognition();
                        if (!nextRecognition) {
                            throw new Error('Speech recognition unavailable');
                        }

                        isStartingRef.current = true;
                        recognitionRef.current = nextRecognition;
                        nextRecognition.start();
                    } catch (restartError) {
                        console.error('Speech recognition restart failed:', restartError);
                        setError('Could not keep listening. Please try again.');
                        stopListening();
                    }
                }, 250);
                return;
            }

            setError('No speech detected. Tap try again and speak clearly.');
            setIsListening(false);
            isStartingRef.current = false;
            recognitionRef.current = null;
        };

        return recognition;
    }, [commitResult, scheduleSilenceCommit, stopListening]);

    const startListening = useCallback(async () => {
        if (isListeningRef.current || isStartingRef.current) {
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            const message = 'Voice search is not supported in this browser.';
            setError(message);
            toast.error(message);
            onErrorRef.current?.('unsupported');
            return;
        }

        // Claim the "starting" slot BEFORE the async permission check. Mic buttons
        // fire both touchstart and click, so a second call used to slip past the
        // guard during the await and spawn two competing recognizers.
        isStartingRef.current = true;

        const hasPermission = await ensureMicrophonePermission();
        if (!hasPermission) {
            isStartingRef.current = false;
            const message = isNativeWebView()
                ? WEBVIEW_MIC_DENIED_MESSAGE
                : 'Microphone access denied.';
            setError(message);
            toast.error(message, { duration: 3000 });
            onErrorRef.current?.('not-allowed');
            return;
        }

        try {
            isStartingRef.current = true;
            shouldKeepListeningRef.current = true;
            hasCommittedRef.current = false;
            retryCountRef.current = 0;
            latestTranscriptRef.current = '';
            setTranscript('');
            setError(null);

            teardownRecognition();

            const recognition = createRecognition();
            if (!recognition) {
                throw new Error('Speech recognition unavailable');
            }

            recognitionRef.current = recognition;
            recognition.start();
        } catch (startError) {
            isStartingRef.current = false;
            shouldKeepListeningRef.current = false;
            console.error('Speech recognition initialization failed:', startError);
            const message = 'Could not start voice search. Please try again.';
            setError(message);
            toast.error(message, { duration: 3000 });
        }
    }, [createRecognition, teardownRecognition]);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        isListening,
        transcript,
        error,
        startListening,
        stopListening,
        clearError,
    };
};
