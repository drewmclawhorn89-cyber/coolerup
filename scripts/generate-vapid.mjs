// Usage: node scripts/generate-vapid.mjs
// Prints a VAPID key pair for Web Push (incoming call alerts).
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);

console.log(`VITE_VAPID_PUBLIC_KEY=${raw.toString("base64url")}`);
console.log(`VAPID_SERVER_PUBLIC_KEY=${raw.toString("base64url")}`);
console.log(`VAPID_SERVER_PRIVATE_KEY=${priv.d}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
