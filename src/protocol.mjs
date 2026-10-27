import { z } from 'zod';

const id = z.string().min(1).max(200);
const ref = z.string().min(1).max(200);
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('open'), url: z.url().max(4000) }).strict(),
  z.object({ action: z.literal('navigate'), id, url: z.url().max(4000) }).strict(),
  z.object({ action: z.literal('read'), id, limit: z.number().int().min(1).max(200).optional(), maxText: z.number().int().min(0).max(12000).optional() }).strict(),
  z.object({ action: z.literal('click'), id, ref }).strict(),
  z.object({ action: z.literal('fill'), id, ref, text: z.string().max(12000) }).strict(),
  z.object({ action: z.literal('select'), id, ref, value: z.string().max(1000) }).strict(),
  z.object({ action: z.literal('wait'), id, text: z.string().min(1).max(1000), timeout: z.number().int().min(100).max(10000).optional() }).strict(),
  z.object({ action: z.literal('close'), id }).strict()
]);
