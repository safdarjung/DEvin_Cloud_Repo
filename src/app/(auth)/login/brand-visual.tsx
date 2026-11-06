"use client";

import dynamic from "next/dynamic";

const BrandOrb = dynamic(() => import("./brand-orb"), { ssr: false });

/** Client wrapper: next/dynamic ssr:false is not allowed in Server Components. */
export function BrandVisual() {
  return <BrandOrb />;
}
