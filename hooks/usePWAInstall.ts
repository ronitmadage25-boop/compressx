import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hasShownPrompt, setHasShownPrompt] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [isServiceHealthy, setIsServiceHealthy] = useState(true);
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);

  // Check if app is already installed and service worker status
  useEffect(() => {
    const checkInstalled = () => {
      // Check if running as PWA
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      setIsInstalled(isStandalone);
    };

    const checkServiceWorker = async () => {
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          setIsServiceWorkerReady(!!registration.active);
          console.log('[PWA] Service Worker is ready');
        } catch (error) {
          console.error('[PWA] Service Worker not ready:', error);
          setIsServiceWorkerReady(false);
        }
      }
    };

    checkInstalled();
    checkServiceWorker();

    // Listen for service worker messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SW_ACTIVATED') {
          setIsServiceWorkerReady(true);
          console.log('[PWA] Service Worker activated');
        }
      });
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleBeforeInstallPrompt = useCallback((e: Event) => {
    e.preventDefault();
    const event = e as BeforeInstallPromptEvent;
    setDeferredPrompt(event);
    console.log('[PWA] beforeinstallprompt event captured - Install available');
    
    // Log install eligibility
    console.log('[PWA] Install eligibility check:');
    console.log('- HTTPS:', location.protocol === 'https:' || location.hostname === 'localhost');
    console.log('- Service Worker Ready:', isServiceWorkerReady);
    console.log('- Manifest Valid:', !!document.querySelector('link[rel="manifest"]'));
  }, [isServiceWorkerReady]);

  const handleAppInstalled = useCallback(() => {
    console.log('[PWA] App installed successfully');
    setIsInstalled(true);
    setShowInstallPrompt(false);
    setDeferredPrompt(null);
  }, []);

  // Show install prompt after 15 seconds or on user interaction
  const triggerInstallPrompt = useCallback(() => {
    if (!hasShownPrompt && deferredPrompt && isServiceHealthy && isServiceWorkerReady) {
      setShowInstallPrompt(true);
      setHasShownPrompt(true);
      // Clear timeout if it exists
      if (timeoutId) clearTimeout(timeoutId);
      console.log('[PWA] Showing install prompt');
    } else {
      console.log('[PWA] Install prompt not shown:', {
        hasShownPrompt,
        hasDeferredPrompt: !!deferredPrompt,
        isServiceHealthy,
        isServiceWorkerReady
      });
    }
  }, [deferredPrompt, hasShownPrompt, timeoutId, isServiceHealthy, isServiceWorkerReady]);

  // Set up 15-second timer (but delay if service is unhealthy or SW not ready)
  useEffect(() => {
    if (!hasShownPrompt && deferredPrompt && isServiceWorkerReady) {
      // If service is unhealthy, delay the timer
      const delay = isServiceHealthy ? 15000 : 30000; // 30 seconds if unhealthy
      
      const id = setTimeout(() => {
        triggerInstallPrompt();
      }, delay);

      setTimeoutId(id);

      return () => clearTimeout(id);
    }
  }, [deferredPrompt, hasShownPrompt, triggerInstallPrompt, isServiceHealthy, isServiceWorkerReady]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) {
      console.log('[PWA] No deferred prompt available');
      return;
    }

    try {
      console.log('[PWA] Triggering install prompt');
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] User response: ${outcome}`);

      if (outcome === 'accepted') {
        setIsInstalled(true);
        console.log('[PWA] User accepted install');
      } else {
        console.log('[PWA] User dismissed install');
      }

      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    } catch (error) {
      console.error('[PWA] Install error:', error);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowInstallPrompt(false);
    console.log('[PWA] Install prompt dismissed by user');
  }, []);

  // Report service health status
  const reportServiceHealth = useCallback((isHealthy: boolean) => {
    setIsServiceHealthy(isHealthy);
    if (!isHealthy) {
      console.warn('[PWA] Service health degraded - delaying install prompt');
    }
  }, []);

  return {
    showInstallPrompt,
    isInstalled,
    canInstall: !!deferredPrompt && !isInstalled && isServiceWorkerReady,
    handleInstall,
    handleDismiss,
    triggerInstallPrompt,
    reportServiceHealth,
    isServiceHealthy,
    isServiceWorkerReady,
  };
}
