import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, MapPin, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type MarketItem = {
  id: string;
  title: string;
  price: number;
  image: string;
  location: string;
  seller: string;
  category: string;
  description: string;
};

const CATEGORIES = ["All", "Vehicles", "Property", "Apparel", "Electronics", "Family", "Home", "Hobbies", "Free"];
const SELLERS = ["maria", "jake", "sam", "alex", "tasha"];
const CITIES = ["Austin, TX", "Denver, CO", "Miami, FL", "Seattle, WA", "Chicago, IL"];
const NAMES = [
  "Mountain Bike", "iPhone 13", "Leather Jacket", "Gaming Chair", "Toyota Corolla 2015",
  "Studio Apartment", "Baby Stroller", "Sofa Set", "Nike Sneakers", "Laptop 16GB",
  "Acoustic Guitar", "Coffee Table", "Honda Civic 2012", "Winter Coat", "Bluetooth Speaker",
  "Kids Toy Bundle", "Office Desk", "Camera Lens", "2BR Condo for Rent", "Skateboard",
];
const CATS = ["Hobbies", "Electronics", "Apparel", "Home", "Vehicles", "Property", "Family", "Home", "Apparel", "Electronics"];

const MOCK: MarketItem[] = NAMES.map((title, i) => ({
  id: `mock-${i}`,
  title,
  price: ([20, 350, 60, 90, 4200, 900, 45, 250, 55, 480][i % 10] ?? 0) + i,
  image: `https://picsum.photos/seed/market${i}/400/400`,
  location: CITIES[i % CITIES.length] ?? "",
  seller: SELLERS[i % SELLERS.length] ?? "",
  category: CATS[i % CATS.length] ?? "Home",
  description: `${title} in good condition. Pickup available, message me with any questions.`,
}));

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black outline-none";
const EMPTY = { title: "", price: "", description: "", location: "", image: "", category: "Home" };
type FormState = typeof EMPTY;
const SELL_CATS = CATEGORIES.filter((c) => c !== "All" && c !== "Free");

function Detail({ item, onBack }: { item: MarketItem; onBack: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <button onClick={onBack} aria-label="Back" className="absolute left-3 top-[max(3rem,env(safe-area-inset-top))] z-10 rounded-full bg-white/90 p-2 shadow">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <img src={item.image} alt={item.title} className="aspect-square w-full object-cover" />
      <div className="space-y-2 p-4">
        <p className="text-2xl font-bold">${item.price}</p>
        <h2 className="text-lg">{item.title}</h2>
        <p className="flex items-center gap-1 text-sm text-gray-500"><MapPin className="h-4 w-4" />{item.location}</p>
        <p className="pt-2 text-sm">{item.description}</p>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-gray-100 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-300 font-bold uppercase">{item.seller[0]}</div>
          <div>
            <p className="text-xs text-gray-500">Seller</p>
            <a href={`/u/${item.seller}`} className="font-semibold">@{item.seller}</a>
          </div>
        </div>
        <a href={`/messages?user=${encodeURIComponent(item.seller)}`} className="mt-3 block rounded-lg bg-blue-600 py-3 text-center font-bold text-white">
          Message seller
        </a>
      </div>
    </div>
  );
}

function SellForm({ onClose, onPost }: { onClose: () => void; onPost: (f: FormState, file: File | null) => Promise<boolean> }) {
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const pickImage = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return void toast.error("Choose an image file.");
    setFile(f);
    const r = new FileReader();
    r.onload = () => setForm((s) => ({ ...s, image: String(r.result) }));
    r.readAsDataURL(f);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-[430px] space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-black">
        <h3 className="text-lg font-bold">Create listing</h3>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-400 text-gray-500">
          {form.image ? <img src={form.image} alt="Preview" className="h-full w-full object-cover" /> : <span className="flex items-center gap-2"><ImagePlus className="h-5 w-5" />Add photo</span>}
        </button>
        <input className={inputCls} placeholder="Title" value={form.title} onChange={set("title")} />
        <input className={inputCls} placeholder="Price" inputMode="decimal" value={form.price} onChange={set("price")} />
        <select className={inputCls} value={form.category} onChange={set("category")}>
          {SELL_CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className={inputCls} placeholder="Location" value={form.location} onChange={set("location")} />
        <textarea className={inputCls} rows={3} placeholder="Description" value={form.description} onChange={set("description")} />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg bg-gray-100 py-3 font-bold">Cancel</button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onPost(form, file);
              setBusy(false);
              if (ok) onClose();
            }}
            className="flex-1 rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-60"
          >
            {busy ? "Posting..." : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Marketplace() {
  const auth = useAuth();
  const [items, setItems] = useState<MarketItem[]>(MOCK);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [open, setOpen] = useState<MarketItem | null>(null);
  const [selling, setSelling] = useState(false);

  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (cat === "All" || i.category === cat || (cat === "Free" && i.price === 0)) &&
          i.title.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [items, q, cat],
  );

  useEffect(() => {
    let live = true;
    void (supabase as any)
      .from("marketplace_items")
      .select("id, title, price, image_url, location, category, description, seller_username, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }: { data: any[] | null; error: unknown }) => {
        if (!live || error || !data?.length) return;
        const real: MarketItem[] = data.map((r) => ({
          id: r.id,
          title: r.title,
          price: Number(r.price),
          image: r.image_url || `https://picsum.photos/seed/${r.id}/400/400`,
          location: r.location || "Nearby",
          seller: r.seller_username,
          category: r.category || "Home",
          description: r.description || "No description.",
        }));
        setItems([...real, ...MOCK]);
      });
    return () => {
      live = false;
    };
  }, []);

  const post = async (f: FormState, file: File | null) => {
    if (!auth.user || !auth.handle) {
      toast.error("Sign in to sell.");
      return false;
    }
    const price = Number(f.price);
    if (!f.title.trim() || f.price.trim() === "" || !Number.isFinite(price) || price < 0) {
      toast.error("Add a title and valid price.");
      return false;
    }
    let imageUrl: string | null = null;
    if (file) {
      const path = `${auth.user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const up = await supabase.storage.from("marketplace").upload(path, file, { contentType: file.type });
      if (up.error) {
        toast.error("Couldn't upload the photo.");
        return false;
      }
      imageUrl = supabase.storage.from("marketplace").getPublicUrl(path).data.publicUrl;
    }
    const { data, error } = await (supabase as any)
      .from("marketplace_items")
      .insert({
        user_id: auth.user.id,
        seller_username: auth.handle,
        title: f.title.trim(),
        price,
        image_url: imageUrl,
        location: f.location.trim() || null,
        category: f.category,
        description: f.description.trim() || null,
      })
      .select("id")
      .single();
    if (error) {
      toast.error("Couldn't post your listing.");
      return false;
    }
    setItems((s) => [
      {
        id: data.id,
        title: f.title.trim(),
        price,
        image: imageUrl || f.image || `https://picsum.photos/seed/${data.id}/400/400`,
        location: f.location.trim() || "Nearby",
        seller: auth.handle!,
        category: f.category,
        description: f.description.trim() || "No description.",
      },
      ...s,
    ]);
    toast.success("Listing posted!");
    return true;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-white text-black">
      {open ? (
        <Detail item={open} onBack={() => setOpen(null)} />
      ) : (
        <>
          <div className="shrink-0 px-3 pb-2 pt-[calc(3rem+env(safe-area-inset-top))]">
            <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3">
              <Search className="h-4 w-4 text-gray-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Marketplace" className="w-full bg-transparent py-2 text-sm outline-none" />
            </div>
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCat(c)} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium ${cat === c ? "bg-blue-600 text-white" : "bg-gray-100"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-32">
            {shown.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No listings found.</p>}
            <div className="grid grid-cols-2 gap-2">
              {shown.map((i) => (
                <button key={i.id} onClick={() => setOpen(i)} className="min-w-0 text-left">
                  <img src={i.image} alt={i.title} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
                  <p className="mt-1 font-bold">${i.price}</p>
                  <p className="truncate text-[13px]">{i.title}</p>
                  <p className="truncate text-[11px] text-gray-500">{i.location}</p>
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setSelling(true)} aria-label="Sell an item" className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-lg ring-1 ring-gray-300">
            <Plus className="h-7 w-7" />
          </button>
        </>
      )}
      {selling && <SellForm onClose={() => setSelling(false)} onPost={post} />}
    </div>
  );
}

