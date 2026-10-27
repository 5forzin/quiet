import { z } from "zod";

const id = z.string().min(1).max(200);
const point = {
  id,
  x: z.number().finite().min(0).max(16384),
  y: z.number().finite().min(0).max(16384),
  duration: z.number().int().min(0).max(1500).optional(),
};
export const pointerSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), ...point }).strict(),
  z
    .object({
      action: z.literal("click"),
      ...point,
      button: z.enum(["left", "right"]).optional(),
    })
    .strict(),
  z.object({ action: z.literal("view"), id }).strict(),
]);

// Runs in an isolated browser world. The overlay never receives pointer input.
export function pointerOverlay(action, args) {
  let pointer = globalThis.__quietPointer;
  if (!pointer?.host.isConnected) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;pointer-events:none!important;z-index:2147483647!important;";
    const root = host.attachShadow({ mode: "closed" });
    const arrow = new DOMParser().parseFromString(
      args.icon,
      "image/svg+xml",
    ).documentElement;
    arrow.style.cssText =
      "position:absolute;left:-3px;top:-3px;width:26px;height:26px;pointer-events:none;filter:drop-shadow(0 1px 2px #0009);";
    const label = document.createElement("span");
    label.textContent = "Agent";
    label.style.cssText =
      "position:absolute;left:23px;top:24px;font:10px/1.4 system-ui,sans-serif;color:white;background:#282828;border:1px solid #888;border-radius:4px;padding:1px 5px;pointer-events:none;";
    root.append(arrow, label);
    document.documentElement.append(host);
    pointer = globalThis.__quietPointer = { host, arrow };
  }
  pointer.host.style.setProperty(
    "transform",
    `translate(${args.x}px,${args.y}px)`,
    "important",
  );
  pointer.arrow.style.opacity = action === "press" ? "0.55" : "1";
  return { x: args.x, y: args.y };
}
