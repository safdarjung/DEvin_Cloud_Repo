"use client";

import { motion } from "motion/react";

// Re-mounts on every navigation: enter-only fade/rise, no exit (keeps nav instant).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {children}
    </motion.div>
  );
}
