import {
  ACCEPTED_MEDIA_MIME_TYPES,
  calculateResizeDimensions,
  MAX_MEDIA_INPUT_BYTES,
  MAX_MEDIA_PIXELS,
  MEDIA_PRESETS,
  STORAGE_OBJECT_MAX_BYTES,
  type MediaPresetKey,
} from "./presets.ts";
import type { ProcessedMedia } from "./types.ts";

export function validateMediaInput(file: Pick<File, "size" | "type">) {
  if (!ACCEPTED_MEDIA_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MEDIA_MIME_TYPES)[number])) {
    return "Formato no admitido. Usa JPEG, PNG o WebP.";
  }
  if (file.size <= 0) return "El archivo está vacío.";
  if (file.size > MAX_MEDIA_INPUT_BYTES) return "La imagen original no puede superar 12 MB.";
  return null;
}

export function validateDecodedDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return "No se han podido leer las dimensiones de la imagen.";
  }
  if (width * height > MAX_MEDIA_PIXELS) return "La imagen no puede superar 25 megapíxeles.";
  return null;
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // The Image fallback produces the same user-facing validation below.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("decode"));
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch {
    throw new Error("El archivo no contiene una imagen válida.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/webp") {
        reject(new Error("Este navegador no puede convertir imágenes a WebP."));
        return;
      }
      resolve(blob);
    }, "image/webp", quality);
  });
}

export async function processImageFile(
  file: File,
  presetKey: MediaPresetKey,
): Promise<ProcessedMedia> {
  const inputError = validateMediaInput(file);
  if (inputError) throw new Error(inputError);

  const decoded = await decodeImage(file);
  try {
    const dimensionsError = validateDecodedDimensions(decoded.width, decoded.height);
    if (dimensionsError) throw new Error(dimensionsError);

    const preset = MEDIA_PRESETS[presetKey];
    let dimensions = calculateResizeDimensions(
      decoded.width,
      decoded.height,
      preset.maxWidth,
      preset.maxHeight,
    );
    let smallest: Blob | null = null;
    let outputWidth = dimensions.width;
    let outputHeight = dimensions.height;

    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("No se ha podido preparar la imagen.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

      for (let qualityAttempt = 0; qualityAttempt < 5; qualityAttempt += 1) {
        const quality = Math.max(
          preset.minQuality,
          preset.initialQuality - qualityAttempt * 0.08,
        );
        const blob = await canvasToWebp(canvas, quality);
        if (!smallest || blob.size < smallest.size) {
          smallest = blob;
          outputWidth = canvas.width;
          outputHeight = canvas.height;
        }
        if (blob.size <= preset.targetBytes) {
          return {
            blob,
            width: canvas.width,
            height: canvas.height,
            originalBytes: file.size,
            outputBytes: blob.size,
            preset: presetKey,
          };
        }
      }

      dimensions = {
        width: Math.max(1, Math.round(dimensions.width * 0.82)),
        height: Math.max(1, Math.round(dimensions.height * 0.82)),
      };
    }

    if (!smallest || smallest.size > STORAGE_OBJECT_MAX_BYTES) {
      throw new Error("No se ha podido reducir la imagen por debajo de 2 MB.");
    }

    return {
      blob: smallest,
      width: outputWidth,
      height: outputHeight,
      originalBytes: file.size,
      outputBytes: smallest.size,
      preset: presetKey,
    };
  } finally {
    decoded.close?.();
  }
}
