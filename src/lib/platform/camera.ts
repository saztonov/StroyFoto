/**
 * Тонкая абстракция камеры/галереи. Сейчас web-реализация поверх <input type="file">,
 * но точка расширения готова под нативный shell (Capacitor Camera plugin), где
 * вместо input будет вызов нативного API. Логика PhotoPicker не меняется.
 */
export interface CameraAdapter {
  /** Открыть камеру и снять одно фото. */
  takePhoto(): Promise<File[]>
  /** Выбрать одно или несколько фото из галереи. */
  pickFromGallery(): Promise<File[]>
}

function pickViaInput(opts: { capture?: 'environment' | 'user'; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (opts.capture) input.capture = opts.capture
    if (opts.multiple) input.multiple = true
    input.style.display = 'none'
    const cleanup = () => {
      document.body.removeChild(input)
      window.removeEventListener('focus', onFocus)
    }
    const onChange = () => {
      const files = input.files ? Array.from(input.files) : []
      cleanup()
      resolve(files)
    }
    // Если пользователь отменил — браузер не стрельнёт change. Ловим focus возврат.
    const onFocus = () => setTimeout(() => {
      if (!input.files || input.files.length === 0) {
        cleanup()
        resolve([])
      }
    }, 300)
    input.addEventListener('change', onChange, { once: true })
    window.addEventListener('focus', onFocus, { once: true })
    document.body.appendChild(input)
    input.click()
  })
}

export const webCamera: CameraAdapter = {
  takePhoto: () => pickViaInput({ capture: 'environment' }),
  pickFromGallery: () => pickViaInput({ multiple: true }),
}
