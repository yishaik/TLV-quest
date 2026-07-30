const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const readPublic = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const required = (name: string): string => {
  const value = read(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const isProduction = process.env.VERCEL_ENV === "production";

const publicValue = ({
  name,
  value,
  localFallback = ""
}: {
  name: string;
  value: string | undefined;
  localFallback?: string;
}) => {
  const resolved = readPublic(value);
  if (resolved) return resolved;
  if (isProduction) {
    throw new Error(`Missing required production environment variable: ${name}`);
  }
  return localFallback;
};

const booleanValue = (name: string, fallback: boolean) => {
  const value = read(name);
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false"`);
};

export const publicEnv = {
  appUrl: publicValue({
    name: "NEXT_PUBLIC_APP_URL",
    value: process.env.NEXT_PUBLIC_APP_URL,
    localFallback: "http://localhost:3000"
  }),
  supabaseUrl: publicValue({
    name: "NEXT_PUBLIC_SUPABASE_URL",
    value: process.env.NEXT_PUBLIC_SUPABASE_URL,
    localFallback: "http://127.0.0.1:54321"
  }),
  supabasePublishableKey: publicValue({
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    value: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  }),
  twilioSandboxNumber:
    readPublic(process.env.NEXT_PUBLIC_TWILIO_SANDBOX_NUMBER) ?? "14155238886",
  twilioSandboxJoinCode:
    readPublic(process.env.NEXT_PUBLIC_TWILIO_SANDBOX_JOIN_CODE) ?? ""
};

export const getServerEnv = () => {
  const validateTwilioSignatures = booleanValue(
    "TWILIO_VALIDATE_SIGNATURES",
    true
  );
  if (isProduction && !validateTwilioSignatures) {
    throw new Error(
      "TWILIO_VALIDATE_SIGNATURES cannot be disabled in production"
    );
  }

  return {
    supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
    piiEncryptionKey: required("PII_ENCRYPTION_KEY"),
    tokenPepper: required("TOKEN_PEPPER"),
    twilioAccountSid: read("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: read("TWILIO_AUTH_TOKEN"),
    twilioWhatsappFrom:
      read("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886",
    validateTwilioSignatures,
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
    enableExternalMessages: booleanValue("ENABLE_EXTERNAL_MESSAGES", false),
    testPhoneAllowlist: new Set(
      (read("TEST_PHONE_ALLOWLIST") ?? "")
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean)
    )
  };
};
