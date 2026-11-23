"use client";

import { useState } from "react";
import { btn } from "./ui";

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${btn.ghost} !py-2`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy your link:", text);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
