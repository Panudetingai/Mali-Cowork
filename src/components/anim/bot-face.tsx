"use client";

type Props = {
  size?: number;
  className?: string;
};

/**
 * Bot face animation from public/anim/bot-face.html
 * Uses iframe to keep original HTML/CSS/JS 100% intact (eyes, blinking, phase loop).
 * public/anim/bot-face.html is served as /anim/bot-face.html by Vite/Tauri.
 */
export function BotFace({ size = 56, className }: Props) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: "50%",
        background: "transparent",
      }}
      aria-hidden
    >
      <iframe
        src="/anim/bot-face.html"
        title="Bot thinking"
        loading="lazy"
        scrolling="no"
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
          background: "transparent",
          overflow: "hidden",
        }}
      />
    </div>
  );
}
