import { z } from "zod";

export const createInvitationSchema = z.object({
  email: z
    .string()
    .email("A valid email address is required")
    .transform((val) => val.toLowerCase().trim()),
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Role must be either 'admin' or 'member'" }),
  }),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Role must be either 'admin' or 'member'" }),
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().uuid("newOwnerUserId must be a valid UUID"),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
