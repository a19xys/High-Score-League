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

const WEBP_MIME_TYPE = "image/webp";

export type NativeWebpResult =
  | { status: "supported"; blob: Blob }
  | { status: "unsupported" }
  | { status: "error" };

export type WebpCapabilityCache = {
  nativeSupported: boolean | null;
};

type WebpEncoderDependencies = {
  capability: WebpCapabilityCache;
  fallbackEncode: (imageData: ImageData, quality: number) => Promise<Blob>;
  nativeEncode: (quality: number) => Promise<Blob | null>;
  quality: number;
  readImageData: () => ImageData;
};

type CompressionDimensions = { width: number; height: number };

type CompressionLoopOptions = {
  createEncoder: (
    dimensions: CompressionDimensions,
  ) => Promise<(quality: number) => Promise<Blob>> | ((quality: number) => Promise<Blob>);
  initialDimensions: CompressionDimensions;
  initialQuality: number;
  minQuality: number;
  targetBytes: number;
};

const sessionWebpCapability: WebpCapabilityCache = {
  nativeSupported: null,
};

let jsquashEncoderPromise:
  | Promise<typeof import("@jsquash/webp")["encode"]>
  | null = null;

function isValidWebpBlob(blob: Blob | null): blob is Blob {
  return Boolean(blob && blob.size > 0 && blob.type === WEBP_MIME_TYPE);
}

export async function tryNativeWebpEncode(
  encode: () => Promise<Blob | null>,
): Promise<NativeWebpResult> {
  try {
    const blob = await encode();

    return isValidWebpBlob(blob)
      ? { status: "supported", blob }
      : { status: "unsupported" };
  } catch {
    return { status: "error" };
  }
}

function nativeCanvasEncode(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve, reject) => {
    try {
      canvas.toBlob(resolve, WEBP_MIME_TYPE, quality);
    } catch (error) {
      reject(error);
    }
  });
}

async function jsquashWebpEncode(imageData: ImageData, quality: number) {
  jsquashEncoderPromise ??= import("@jsquash/webp").then(
    (module) => module.encode,
  );
  const encode = await jsquashEncoderPromise;
  const buffer = await encode(imageData, {
    alpha_quality: 100,
    exact: 1,
    quality: Math.round(quality * 100),
  });

  return new Blob([buffer], { type: WEBP_MIME_TYPE });
}

export async function encodeWebpWithFallback({
  capability,
  fallbackEncode,
  nativeEncode,
  quality,
  readImageData,
}: WebpEncoderDependencies): Promise<Blob> {
  if (capability.nativeSupported !== false) {
    const nativeResult = await tryNativeWebpEncode(() => nativeEncode(quality));

    if (nativeResult.status === "supported") {
      capability.nativeSupported = true;
      return nativeResult.blob;
    }

    capability.nativeSupported = false;
  }

  try {
    const blob = await fallbackEncode(readImageData(), quality);

    if (!isValidWebpBlob(blob)) {
      throw new Error("invalid-webp-output");
    }

    return blob;
  } catch {
    throw new Error(
      "No se ha podido convertir la imagen a WebP en este navegador.",
    );
  }
}

function createCanvasWebpEncoder(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
) {
  let imageData: ImageData | null = null;

  return async (quality: number) =>
    encodeWebpWithFallback({
      capability: sessionWebpCapability,
      nativeEncode: () => nativeCanvasEncode(canvas, quality),
      fallbackEncode: (data) => jsquashWebpEncode(data, quality),
      quality,
      readImageData: () => {
        imageData ??= context.getImageData(0, 0, canvas.width, canvas.height);
        return imageData;
      },
    });
}

export async function runWebpCompressionLoop({
  createEncoder,
  initialDimensions,
  initialQuality,
  minQuality,
  targetBytes,
}: CompressionLoopOptions) {
  let dimensions = initialDimensions;
  let smallest: Blob | null = null;
  let outputWidth = dimensions.width;
  let outputHeight = dimensions.height;

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    const encode = await createEncoder(dimensions);

    for (let qualityAttempt = 0; qualityAttempt < 5; qualityAttempt += 1) {
      const quality = Math.max(
        minQuality,
        initialQuality - qualityAttempt * 0.08,
      );
      const blob = await encode(quality);

      if (!smallest || blob.size < smallest.size) {
        smallest = blob;
        outputWidth = dimensions.width;
        outputHeight = dimensions.height;
      }
      if (blob.size <= targetBytes) {
        return { blob, width: dimensions.width, height: dimensions.height };
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

  return { blob: smallest, width: outputWidth, height: outputHeight };
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
    const dimensions = calculateResizeDimensions(
      decoded.width,
      decoded.height,
      preset.maxWidth,
      preset.maxHeight,
    );
    const processed = await runWebpCompressionLoop({
      initialDimensions: dimensions,
      initialQuality: preset.initialQuality,
      minQuality: preset.minQuality,
      targetBytes: preset.targetBytes,
      createEncoder: ({ width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) throw new Error("No se ha podido preparar la imagen.");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.clearRect(0, 0, width, height);
        context.drawImage(decoded.source, 0, 0, width, height);
        return createCanvasWebpEncoder(canvas, context);
      },
    });

    return {
      blob: processed.blob,
      width: processed.width,
      height: processed.height,
      originalBytes: file.size,
      outputBytes: processed.blob.size,
      preset: presetKey,
    };
  } finally {
    decoded.close?.();
  }
}
