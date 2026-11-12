/**
 * TikTok-style "record with a sound".
 *
 * The camera stream carries the microphone. A chosen sound is played through an
 * <audio> element, routed through the Web Audio API, and mixed with the mic into
 * a single audio track. That mixed track is what MediaRecorder writes to the
 * file, so the posted video already contains the song (no separate overlay
 * needed when the feed plays it back).
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Whether this browser can mix a sound into the recording. */
export function canMixSound(): boolean {
  return !!getAudioContextCtor() && typeof MediaStream !== "undefined";
}

export type RecordingMix = {
  /** Camera video tracks + the mixed (mic + sound) audio track. */
  stream: MediaStream;
  /** Disconnect the mix once the recorder stops. */
  release: () => void;
};

export type SoundTrack = {
  /** True when the sound could not be loaded (e.g. blocked by CORS). */
  readonly failed: boolean;
  /** Start the sound from the beginning (also used for live monitoring). */
  play: () => Promise<void>;
  pause: () => void;
  seekToStart: () => void;
  setMuted: (muted: boolean) => void;
  /** Build a stream that records the mic and the sound together. */
  createRecordingMix: (cameraStream: MediaStream) => RecordingMix;
  dispose: () => void;
};

/**
 * Create a looping, mixable sound track for `url`.
 *
 * Returns null when Web Audio is unavailable. The returned track keeps the
 * sound audible through the speakers while the camera preview is open, and can
 * be folded into the recording with `createRecordingMix`.
 */
export function createSoundTrack(url: string): SoundTrack | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor || !url) return null;

  const element = new Audio();
  // Needed so the browser lets Web Audio read the (cross-origin) audio data.
  element.crossOrigin = "anonymous";
  element.loop = true;
  element.preload = "auto";
  element.setAttribute("playsinline", "");
  element.src = url;

  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return null;
  }

  let source: MediaElementAudioSourceNode;
  try {
    source = context.createMediaElementSource(element);
  } catch {
    void context.close().catch(() => {});
    return null;
  }

  // Monitoring path: the user hears the sound while they record. The mic is
  // deliberately not routed here, otherwise it would feed back through the
  // speakers.
  const monitor = context.createGain();
  monitor.gain.value = 1;
  source.connect(monitor);
  monitor.connect(context.destination);

  let failed = false;
  let disposed = false;

  element.addEventListener("error", () => {
    failed = true;
  });

  const resume = () => {
    if (context.state === "suspended") void context.resume().catch(() => {});
  };

  const play = async () => {
    if (disposed) return;
    resume();
    try {
      await element.play();
    } catch {
      // Autoplay can be blocked until the next tap; the caller retries.
    }
  };

  const pause = () => {
    try {
      element.pause();
    } catch {
      /* element already torn down */
    }
  };

  const seekToStart = () => {
    try {
      element.currentTime = 0;
    } catch {
      /* metadata not loaded yet */
    }
  };

  const setMuted = (muted: boolean) => {
    monitor.gain.value = muted ? 0 : 1;
    element.muted = muted;
  };

  const createRecordingMix = (cameraStream: MediaStream): RecordingMix => {
    resume();
    const destination = context.createMediaStreamDestination();

    const micTracks = cameraStream.getAudioTracks();
    let micSource: MediaStreamAudioSourceNode | null = null;
    let micGain: GainNode | null = null;
    if (micTracks.length > 0) {
      micSource = context.createMediaStreamSource(new MediaStream(micTracks));
      micGain = context.createGain();
      micGain.gain.value = 1;
      micSource.connect(micGain);
      micGain.connect(destination);
    }

    source.connect(destination);

    const stream = new MediaStream([
      ...cameraStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        source.disconnect(destination);
      } catch {
        /* already disconnected */
      }
      try {
        micSource?.disconnect();
        micGain?.disconnect();
      } catch {
        /* already disconnected */
      }
      destination.stream.getTracks().forEach((track) => track.stop());
    };

    return { stream, release };
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pause();
    try {
      element.removeAttribute("src");
      element.load();
    } catch {
      /* ignore */
    }
    try {
      source.disconnect();
      monitor.disconnect();
    } catch {
      /* ignore */
    }
    void context.close().catch(() => {});
  };

  return {
    get failed() {
      return failed;
    },
    play,
    pause,
    seekToStart,
    setMuted,
    createRecordingMix,
    dispose,
  };
}
