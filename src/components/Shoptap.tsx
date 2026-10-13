export function ShopTab() {
  const items = [
    { id: 1, name: "Vintage Cargo Pants", price: "$45", img: "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=400" },
    { id: 2, name: "Boxy Hoodie", price: "$60", img: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400" },
    { id: 3, name: "Y2K Shades", price: "$25", img: "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=400" },
    { id: 4, name: "Jordan 4 Retro", price: "$210", img: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400" },
  ];

  return (
    <div className="p-4 grid grid-cols-2 gap-4">
      {items.map(item => (
        <div key={item.id} className="rounded-xl overflow-hidden bg-zinc-900 border">
          <img src={item.img} className="w-full h-48 object-cover" />
          <div className="p-3">
            <p className="text-sm font-medium">{item.name}</p>
            <p className="text-xs text-zinc-400">{item.price}</p>
            <button className="mt-2 w-full py-2 rounded-full bg-white text-black text-xs font-bold">Buy</button>
          </div>
        </div>
      ))}
    </div>
  )
}
