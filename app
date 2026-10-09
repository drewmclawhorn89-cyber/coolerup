import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({ component: Admin });

function Admin() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    supabase.from("app_settings").select("*").eq("id", 1).single().then(({ data }) => setDown(data?.is_maintenance));
  }, []);

  const toggle = async () => {
    await supabase.from("app_settings").update({ is_maintenance:!down }).eq("id", 1);
    setDown(!down);
    alert(down? "App is now LIVE" : "App is now SHUT DOWN");
  };

  return (
    <div className="p-10">
      <h1 className="text-2xl mb-6">Admin - {down? "🔴 SHUT DOWN" : "🟢 LIVE"}</h1>
      <Button variant={down? "default" : "destructive"} onClick={toggle} className="w-full h-20 text-xl">
        {down? "Turn App ON" : "Shut Down Servers"}
      </Button>
    </div>
  );
} import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

function RootComponent() {
  const [isDown, setIsDown] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const myUsername = (user?.user_metadata as any)?.username || user?.email?.split("@")[0] || "";
      const isAdmin = myUsername === "drewmclawhorn" || myUsername === "@drewmclawhorn" || myUsername === "drewmclawhorn2";

      const { data: settings } = await supabase.from("app_settings").select("*").eq("id", 1).single();

      if (settings?.is_maintenance &&!isAdmin) {
        setIsDown(true);
        setMessage(settings.maintenance_message);
        // optional redirect
        if (window.location.pathname!== "/maintenance") {
          window.location.href = "/maintenance";
        }
      }
    };
    check();
  }, []);

  //... rest of your root component
}
