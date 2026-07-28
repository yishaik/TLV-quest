const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const required = (name: string): string => {
  const value = read(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const publicEnv = {
  appUrl: read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  supabaseUrl:
    read("NEXT_PUBLIC_SUPABASE_URL") ??
    "https://vybivdkskrkafcuedvbg.supabase.co",
  supabasePublishableKey:
    read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "",
  twilioSandboxNumber:
    read("NEXT_PUBLIC_TWILIO_SANDBOX_NUMBER") ?? "14155238886",
  twilioSandboxJoinCode:
    read("NEXT_PUBLIC_TWILIO_SANDBOX_JOIN_CODE") ?? ""
};

export const getServerEnv = () => ({
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  piiEncryptionKey: required("PII_ENCRYPTION_KEY"),
  tokenPepper: required("TOKEN_PEPPER"),
  twilioAccountSid: read("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: read("TWILIO_AUTH_TOKEN"),
  twilioWhatsappFrom:
    read("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886",
  validateTwilioSignatures:
    (read("TWILIO_VALIDATE_SIGNATURES") ?? "true") === "true",
  resendApiKey: read("RESEND_API_KEY"),
  emailFrom: read("EMAIL_FROM") ?? "TLV Quest <quest@example.com>",
  geminiApiKey: read("GEMINI_API_KEY"),
  geminiVisionModel: read("GEMINI_VISION_MODEL") ?? "gemini-2.5-flash",
  adminEmails: new Set(
    (read("ADMIN_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  ),
  enableExternalMessages:
    (read("ENABLE_EXTERNAL_MESSAGES") ?? "false") === "true",
  testPhoneAllowlist: new Set(
    (read("TEST_PHONE_ALLOWLIST") ?? "")
      .split(",")
      .map((phone) => phone.trim())
      .filter(Boolean)
  )
});

export const isProduction = process.env.VERCEL_ENV === "production";
