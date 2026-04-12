import { useCallback, useEffect, useRef, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwaInstall() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Detect if already running as installed PWA
    const mq = window.matchMedia('(display-mode: standalone)')
    const isStandalone =
      mq.matches || (navigator as unknown as { standalone?: boolean }).standalone === true
    setIsInstalled(isStandalone)

    const onChange = (e: MediaQueryListEvent) => setIsInstalled(e.matches)
    mq.addEventListener('change', onChange)

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    const onAppInstalled = () => {
      deferredPrompt.current = null
      setCanInstall(false)
      setIsInstalled(true)
    }
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    const prompt = deferredPrompt.current
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      deferredPrompt.current = null
      setCanInstall(false)
    }
  }, [])

  return { canInstall, isInstalled, install }
}
