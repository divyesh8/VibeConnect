import { z } from "zod";

export const sessionSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_-]+$/),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]),
  mode: z.enum(["text", "voice", "video"]),
  interests: z.array(z.string().trim().min(1).max(32)).max(5).default([]),
});

export const messageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().trim().min(1).max(1000),
  clientId: z.string().uuid().optional(),
});

export const reportSchema = z.object({
  roomId: z.string().uuid(),
  reportedUserId: z.string().min(1).max(80),
  reason: z.enum(["harassment", "hate_speech", "sexual_content", "spam", "threats"]),
});

export const blockSchema = z.object({ blockedUserId: z.string().min(1).max(80) });
export const endRoomSchema = z.object({ roomId: z.string().uuid() });

export function cleanText(value: string) {
  return Array.from(value.normalize("NFKC"))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
}
