import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH, hasControlCharacters, trimDisplayName } from "@/lib/display-name";

export const displayNameSchema = z.string()
  .transform(trimDisplayName)
  .refine((value) => Array.from(value).length >= 1, "Enter at least one visible character.")
  .refine((value) => Array.from(value).length <= DISPLAY_NAME_MAX_LENGTH, `Keep your display name to ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`)
  .refine((value) => !hasControlCharacters(value), "Control characters are not allowed.");

export const sessionSchema = z.object({
  username: displayNameSchema,
  gender: z.enum(["male", "female", "other"]),
  botToken: z.string().max(2048).optional(),
});

export const profilePreferenceSchema = z.object({}).strict();

export const messageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().trim().min(1).max(1000),
  clientId: z.string().uuid().optional(),
});

export const reportSchema = z.object({
  roomId: z.string().uuid(),
  reportedUserId: z.string().uuid(),
  reason: z.enum(["harassment", "hate_speech", "sexual_content", "spam", "threats", "underage_concern", "other"]),
});

export const blockSchema = z.object({ blockedUserId: z.string().uuid() });
export const endRoomSchema = z.object({
  roomId: z.string().uuid(),
  reason: z.enum(["ended", "skipped", "peer_left", "connection_failed"]).optional(),
});
export const proposalSchema = z.object({ proposalId: z.string().uuid() });
export const heartbeatSchema = z.object({ state: z.enum(["searching", "connected"]).optional() });

export function cleanText(value: string) {
  return Array.from(value.normalize("NFKC"))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
}
