import { webCamera, type CameraAdapter } from './camera'

/**
 * Единая точка доступа к платформенным возможностям. Под нативным shell
 * (например, Capacitor) здесь будет switch на нативные адаптеры — но снаружи
 * UI всегда дёргает `platform.camera.*` и не знает о деталях.
 */
export interface Platform {
  camera: CameraAdapter
}

export const platform: Platform = {
  camera: webCamera,
}

export type { CameraAdapter }
