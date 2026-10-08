export const BANNED_WORDS = ["spam","scam","hate","slur"];
export const RULES = [
  "No hate or harassment",
  "No nudity",
  "No spam or scams",
  "Be respectful"
];

export function checkText(text: string): string | null {
  const low = text.toLowerCase();
  for (let w of BANNED_WORDS) {
    if (low.includes(w)) return w;
  }
  return null;
}

export function isBanned(userId: string): boolean {
  try {
    const bans: any = JSON.parse(localStorage.getItem("coolerup_bans") || "{}");
    return!!bans[userId];
  } catch { return false; }
}

export function banUser(userId: string, reason: string) {
  const bans: any = JSON.parse(localStorage.getItem("coolerup_bans") || "{}");
  bans[userId] = { reason, at: Date.now() };
  localStorage.setItem("coolerup_bans", JSON.stringify(bans));
  alert(`User banned for: ${reason}`);
}
