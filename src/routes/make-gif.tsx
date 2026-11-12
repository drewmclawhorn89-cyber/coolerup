import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { MakeGif } from "@/components/MakeGif";

export const Route = createFileRoute("/make-gif")({
  head: () => ({
    meta: [
      { title: "Make a GIF — Coolerup" },
      {
        name: "description",
        content:
          "Turn your own videos into 3-second GIFs with text, stickers, speed and square crop — then use them in comments, LIVE chat and DMs.",
      },
      { property: "og:title", content: "Make a GIF — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MakeGifPage,
});

function MakeGifPage() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-24 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          aria-label="Back"
          className="rounded-full p-2 hover:bg-secondary"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-extrabold">Make a GIF</h1>
          <p className="text-xs text-muted-foreground">
            Your own videos · 0.5–3s · max 5 MB · made for comments, LIVE and DMs
          </p>
        </div>
      </div>
      <div className="flex max-h-[calc(100dvh-9rem)] flex-col rounded-2xl border bg-card">
        <MakeGif onClose={() => navigate({ to: "/" })} className="border-t-0" expand />
      </div>
    </main>
  );
}
