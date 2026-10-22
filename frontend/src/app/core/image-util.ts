/**
 * Reads a File and converts it to a base64 Data URL,
 * downscaling large images to maxDim to keep payloads lightweight.
 * Supports a progress callback (0 - 100%) for UI loading progress indicators.
 */
export function readFileAsDataUrl(
  file: File,
  maxDim = 800,
  quality = 0.85,
  onProgress?: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('Vui lòng chọn file hình ảnh (PNG, JPG, JPEG, WEBP)'));
    }

    onProgress?.(15);

    const reader = new FileReader();

    reader.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(65, Math.round((evt.loaded / evt.total) * 60) + 10);
        onProgress?.(pct);
      }
    };

    reader.onerror = () => reject(new Error('Không thể đọc file hình ảnh'));

    reader.onload = () => {
      onProgress?.(70);
      const dataUrl = reader.result as string;
      const img = new Image();

      img.onerror = () => {
        onProgress?.(100);
        resolve(dataUrl);
      };

      img.onload = () => {
        onProgress?.(85);
        let width = img.width;
        let height = img.height;

        if (width <= maxDim && height <= maxDim) {
          setTimeout(() => {
            onProgress?.(100);
            setTimeout(() => resolve(dataUrl), 100);
          }, 120);
          return;
        }

        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          onProgress?.(100);
          return resolve(dataUrl);
        }

        ctx.drawImage(img, 0, 0, width, height);
        const result = canvas.toDataURL('image/jpeg', quality);

        setTimeout(() => {
          onProgress?.(100);
          setTimeout(() => resolve(result), 100);
        }, 150);
      };

      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}
