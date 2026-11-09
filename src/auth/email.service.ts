import { logger } from "../common/logger";

export interface EmailService {
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
  sendInvitationEmail(email: string, token: string, orgName: string): Promise<void>;
}

export class ConsoleEmailService implements EmailService {
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    logger.info(
      { email, resetToken: token },
      `[EmailService] Password reset link sent to ${email}`
    );
  }

  async sendInvitationEmail(email: string, token: string, orgName: string): Promise<void> {
    logger.info(
      { email, inviteToken: token, orgName },
      `[EmailService] Invitation sent to ${email} for org ${orgName}`
    );
  }
}

export const emailService: EmailService = new ConsoleEmailService();
