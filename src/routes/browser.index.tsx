import { createFileRoute } from "@tanstack/react-router";
import { CoolerupBrowser } from "@/components/CoolerupBrowser";

export const Route = createFileRoute("/browser/")({
  validateSearch: (search: Record<string, unknown>) => {
    const out: { q?: string; url?: string } = {};
    if (typeof search["q"] === "string" && search["q"].trim()) out.q = search["q"];
    if (typeof search["url"] === "string" && search["url"]) out.url = search["url"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Coolerup Browser — Coolerup" },
      {
        name: "description",
        content: "Search the web inside Coolerup with the Coolerup Browser.",
      },
    ],
  }),
  component: CoolerupBrowser,
});
