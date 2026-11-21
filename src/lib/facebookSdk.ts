/**
 * Loads Facebook's official JavaScript SDK once. The SDK renders the real
 * Facebook video player (<div class="fb-video">) straight from Facebook;
 * we never fetch, download or re-upload the video file.
 */
type FbSdk = {
  XFBML: { parse: (el?: Element) => void };
  init: (opts: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FbSdk> | null = null;

export function loadFacebookSdk(): Promise<FbSdk> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.FB) return Promise.resolve(window.FB);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ xfbml: false, version: "v19.0" });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Facebook SDK failed to load"));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}
