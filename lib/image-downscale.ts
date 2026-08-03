"use client";

/**
 * Downscales and re-encodes a picked image to JPEG in the browser.
 *
 * Three problems this solves at once, all of which showed up the first time
 * photos were taken in the field:
 *
 *  - **Size.** A modern phone photo is 4-12 MB. The bucket caps at 8 MB, so
 *    perfectly good photos were rejected before a request was even made.
 *  - **Format.** iPhones shoot HEIC by default, which the bucket does not
 *    accept. Safari can decode it, so re-encoding through a canvas turns it
 *    into a JPEG the pipeline understands.
 *  - **Time.** Uploading 8 MB over mobile data at the far end of a pier is
 *    slow enough that people assume it has hung.
 *
 * A field reference photo does not need 4000 px. 2000 px on the long edge is
 * more than Gemini needs to judge a scene and more than a human needs to
 * recognise the spot.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.85;

export type DownscaleResult = {
  file: File;
  originalBytes: number;
  bytes: number;
};

const decode = async (file: File): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(file);
  } catch {
    // Older Safari cannot createImageBitmap from every source; the object URL
    // path handles HEIC there, which is exactly the case that matters most.
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        createImageBitmap(image)
          .then((bitmap) => {
            URL.revokeObjectURL(url);
            resolve(bitmap);
          })
          .catch((error) => {
            URL.revokeObjectURL(url);
            reject(error instanceof Error ? error : new Error("decode_failed"));
          });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("לא הצלחתי לקרוא את התמונה"));
      };
      image.src = url;
    });
  }
};

export const downscaleImage = async (file: File): Promise<DownscaleResult> => {
  const bitmap = await decode(file);

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("הדפדפן לא תומך בעיבוד תמונה");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", QUALITY);
  });
  if (!blob) throw new Error("המרת התמונה נכשלה");

  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return {
    file: new File([blob], `${name}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    }),
    originalBytes: file.size,
    bytes: blob.size
  };
};
