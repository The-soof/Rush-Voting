"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Estimates (serverTime - clientTime) in ms so countdowns sync across devices. */
export function useServerOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const t0 = Date.now();
      const { data } = await supabase.rpc("server_now");
      const t1 = Date.now();
      if (cancelled || !data) return;
      const server = new Date(data as string).getTime();
      setOffset(server - (t0 + t1) / 2);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return offset;
}

/** Seconds remaining until `endsAt`, ticking ~4x/sec, corrected by server offset. */
export function useRemainingSeconds(endsAt: string | null, offset: number) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (!endsAt || now === 0) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - (now + offset)) / 1000));
}
