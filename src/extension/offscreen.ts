const MAX_SCREENSHOT_BYTES = 900_000;

function dataUrlSize(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).length;
}

async function resizeScreenshot(originalDataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load screenshot image'));
    img.src = originalDataUrl;
  });

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  let maxWidth = 1920;
  const qualities = [80, 65, 50, 35, 25];

  for (const quality of qualities) {
    const scale = Math.min(1, maxWidth / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality / 100);
    const size = dataUrlSize(dataUrl);
    console.log(`[offscreen] resized ${img.width}x${img.height} -> ${canvas.width}x${canvas.height} jpeg q=${quality} size=${size} bytes`);
    if (size <= MAX_SCREENSHOT_BYTES) {
      return dataUrl;
    }
    maxWidth = Math.round(maxWidth * 0.7);
  }

  // Last resort: small thumbnail at low quality.
  const scale = Math.min(1, 800 / img.width);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.2);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'resize_screenshot') {
    resizeScreenshot(msg.dataUrl)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err: Error) => sendResponse({ error: err.message }));
    return true;
  }
});
