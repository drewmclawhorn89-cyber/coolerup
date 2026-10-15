import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Menu, User, Shield, Bell, Moon, Trash2, LogOut, HelpCircle, Database } from "lucide-react"

export function SettingsMenu() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="p-2">
          <Menu className="w-7 h-7" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h- rounded-t- bg-white dark:bg-zinc-900 overflow-y-auto">
        <div className="w-12 h-1.5 bg-zinc-300 rounded-full mx-auto mb-6" />
        <h2 className="text-xl font-bold mb-6">Settings and privacy</h2>

        <div className="space-y-6">
          <div>
            <p className="text-xs text-zinc-500 uppercase font-semibold mb-2">Account</p>
            <div className="divide-y">
              <button className="w-full flex items-center justify-between py-4">
                <span className="flex items-center gap-3"><User size={20}/> Manage account</span><span className="text-zinc-400">›</span>
              </button>
              <button className="w-full flex items-center justify-between py-4">
                <span className="flex items-center gap-3"><Shield size={20}/> Privacy</span><span className="text-zinc-400">›</span>
              </button>
              <button className="w-full flex items-center justify-between py-4">
                <span className="flex items-center gap-3"><Database size={20}/> Data Saver</span><span className="text-zinc-400">›</span>
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-500 uppercase font-semibold mb-2">Content & Display</p>
            <div className="divide-y">
              <button className="w-full flex items-center justify-between py-4">
                <span className="flex items-center gap-3"><Bell size={20}/> Push notifications</span><span className="text-zinc-400">›</span>
              </button>
              <button className="w-full flex items-center justify-between py-4">
                <span className="flex items-center gap-3"><Moon size={20}/> Dark mode</span><span className="text-zinc-400">›</span>
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-500 uppercase font-semibold mb-2">Support</p>
            <div className="divide-y">
              <button className="w-full flex items-center justify-between py-4">
                <span className="flex items-center gap-3"><HelpCircle size={20}/> Report a problem</span><span className="text-zinc-400">›</span>
              </button>
            </div>
          </div>

          <div className="pt-4">
            <button className="w-full flex items-center gap-3 py-4 text-red-500 font-semibold">
              <LogOut size={20}/> Log out
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
