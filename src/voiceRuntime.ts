export class VoiceTimeoutError extends Error {}

/** Always settle a browser operation, even when its permission dialog is ignored. */
export function withVoiceTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new VoiceTimeoutError(message)), milliseconds);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Release streams arriving after timeout, cancellation, or a newer startup. */
export async function requestVoiceMicrophone(isCurrent: () => boolean): Promise<MediaStream> {
  let expired = false;
  const request = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    if (expired || !isCurrent()) {
      stream.getTracks().forEach(track => track.stop());
      throw new DOMException("Voice startup cancelled", "AbortError");
    }
    return stream;
  });
  try {
    return await withVoiceTimeout(request, 15000, "Allow microphone access in your browser, then tap the orb to retry.");
  } finally {
    expired = true;
  }
}
