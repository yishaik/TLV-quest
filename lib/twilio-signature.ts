import { validateRequest } from "twilio";

export const verifyTwilioRequestSignature = ({
  authToken,
  signature,
  url,
  params
}: {
  authToken: string | undefined;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean => {
  if (!authToken || !signature) return false;
  return validateRequest(authToken, signature, url, params);
};
