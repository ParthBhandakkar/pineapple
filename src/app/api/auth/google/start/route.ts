import { redirect } from "next/navigation";

function googleConfig(request: Request) {
  const url = new URL(request.url);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${url.origin}/api/auth/google/callback`;
  return { clientId, redirectUri };
}

export async function GET(request: Request) {
  const { clientId, redirectUri } = googleConfig(request);

  if (!clientId) {
    redirect("/?auth_error=google_not_configured");
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("prompt", "select_account");

  redirect(authUrl.toString());
}
