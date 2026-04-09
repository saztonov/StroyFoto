import { useIsDesktop } from '@/shared/hooks/useBreakpoint'
import { DesktopLayout } from '@/app/layouts/DesktopLayout'
import { MobileLayout } from '@/app/layouts/MobileLayout'

export function AppShell() {
  const isDesktop = useIsDesktop()
  return isDesktop ? <DesktopLayout /> : <MobileLayout />
}
