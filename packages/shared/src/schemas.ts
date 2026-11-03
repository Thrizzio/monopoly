import { z } from "zod";

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, "Nickname is required")
  .max(20, "Nickname must be at most 20 characters");

export const roomCodeSchema = z.string().trim().min(6).max(8);

export const chatMessageSchema = z.string().trim().min(1).max(500);

export type Nickname = z.infer<typeof nicknameSchema>;
