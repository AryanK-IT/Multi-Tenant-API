import { z } from "zod";
import { AUTH_CONSTANTS } from "../config/constants";

export const signupSchema = z
  .object({
    email: z
      .string()
      .email("A valid email address is required")
      .transform((val) => val.toLowerCase().trim()),
    password: z
      .string()
      .min(
        AUTH_CONSTANTS.PASSWORD_MIN_LENGTH,
        `Password must be at least ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} characters`
      ),
    orgName: z
      .string()
      .min(1, "Organization name is required")
      .max(100, "Organization name cannot exceed 100 characters")
      .trim()
      .optional(),
    invitationToken: z.string().min(1, "invitationToken cannot be empty").optional(),
  })
  .refine((data) => Boolean(data.orgName || data.invitationToken), {
    message: "Either orgName or invitationToken is required",
    path: ["orgName"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const loginSchema = z.object({
  email: z
    .string()
    .email("A valid email address is required")
    .transform((val) => val.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
  orgId: z.string().uuid("orgId must be a valid UUID").optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email("A valid email address is required")
    .transform((val) => val.toLowerCase().trim()),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z
    .string()
    .min(
      AUTH_CONSTANTS.PASSWORD_MIN_LENGTH,
      `Password must be at least ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} characters`
    ),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
