import { z } from "zod";
import { AUTH_FORM_LIMITS } from "../auth.constants";

const emailSchema = z
  .string()
  .trim()
  .max(AUTH_FORM_LIMITS.EMAIL_MAX_LENGTH)
  .email("Enter a valid email address.");

const passwordSchema = z
  .string()
  .min(AUTH_FORM_LIMITS.PASSWORD_MIN_LENGTH, "Use at least 12 characters.")
  .max(AUTH_FORM_LIMITS.PASSWORD_MAX_LENGTH);

export const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(AUTH_FORM_LIMITS.PASSWORD_MAX_LENGTH),
});

export const registerFormSchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name is required.").max(200),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
