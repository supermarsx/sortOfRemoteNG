"use client";

import dynamic from "next/dynamic";

const DetachedClient = dynamic(() => import("./DetachedClient"), { ssr: false });

export default function DetachedPage() {
  return <DetachedClient />;
}
