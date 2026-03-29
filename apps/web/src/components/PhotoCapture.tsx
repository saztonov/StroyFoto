import { useRef, useMemo } from "react";

export interface ProcessedPhoto {
  clientId: string;
  blob: Blob;
  thumbnail: Blob;
  mimeType: string;
  fileName: string;
  size: number;
  hash: string;
}

interface PhotoCaptureProps {
  photos: ProcessedPhoto[];
  onAdd: (files: File[]) => void;
  onRemove: (clientId: string) => void;
  isProcessing?: boolean;
  disabled?: boolean;
}

export function PhotoCapture({ photos, onAdd, onRemove, isProcessing, disabled }: PhotoCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () =>
      photos.map((p) => ({
        clientId: p.clientId,
        url: URL.createObjectURL(p.thumbnail),
      })),
    [photos],
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onAdd(Array.from(files));
    e.target.value = "";
  }

  const btnDisabled = isProcessing || disabled;

  return (
    <div className="space-y-3">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={btnDisabled}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 py-4 text-sm text-gray-600 dark:text-gray-300 transition hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 active:bg-blue-100 disabled:opacity-50"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
          </svg>
          {isProcessing ? "Обработка..." : "Камера"}
        </button>

        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          disabled={btnDisabled}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 py-4 text-sm text-gray-600 dark:text-gray-300 transition hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 active:bg-blue-100 disabled:opacity-50"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Zm16.5-13.5h.008v.008h-.008V7.5Zm0 0a1.125 1.125 0 1 0-2.25 0 1.125 1.125 0 0 0 2.25 0Z" />
          </svg>
          {isProcessing ? "Обработка..." : "Из библиотеки"}
        </button>
      </div>

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map(({ clientId, url }) => (
            <div key={clientId} className="group relative aspect-square">
              <img
                src={url}
                alt="Фото"
                className="h-full w-full rounded-lg object-cover"
                onLoad={() => URL.revokeObjectURL(url)}
              />
              <button
                type="button"
                onClick={() => onRemove(clientId)}
                className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow-md transition hover:bg-red-600"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {isProcessing && (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500">Сжатие и создание превью...</p>
      )}
    </div>
  );
}
