import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Menu, User, Shield, Bell, Moon, LogOut } from "lucide-react"
import { supabase } from "@/integrations/supabase/client"

export function SettingsMenu() {
  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = "/"
  }

  const toggleDark = () => {
    document.documentElement.classList.toggle("dark")
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="p-2">
          <Menu className="h-7 w-7" />
        </button>
      </SheetTrigger>

      <SheetContent side="bottom" className="bg-white text-black rounded-t- h-">
        <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-6" />
        <h2 className="text-center font-bold text-lg mb-6">Settings and privacy</h2>

        <button onClick={() => window.location.href = "/edit-profile"} className="w-full flex items-center gap-3 p-4 text-left active:bg-gray-100">
          <User className="h-5 w-5" /> Manage account
        </button>

        <button onClick={() => alert("Privacy coming soon")} className="w-full flex items-center gap-3 p-4 text-left active:bg-gray-100">
          <Shield className="h-5 w-5" /> Privacy
        </button>

        <button onClick={toggleDark} className="w-full flex items-center gap-3 p-4 text-left active:bg-gray-100">
          <Moon className="h-5 w-5" /> Dark mode
        </button>

        <button onClick={() => alert("Notifications - enable in browser")} className="w-full flex items-center gap-3 p-4 text-left active:bg-gray-100">
          <Bell className="h-5 w-5" /> Push notifications
        </button>

        <button onClick={handleLogout} className="w-full flex items-center gap-3 p-4 text-red-500 font-bold mt-8">
          <LogOut className="h-5 w-5" /> Log out
        </button>
      </SheetContent>
    </Sheet>
  )
}
