-- Password-reset HTTP commands are not part of the approved Module 2 route surface.
-- Remove the unused persistence table instead of shipping an incomplete feature.
DROP TABLE "password_reset_tokens";
