import { z } from "zod";

const CREATOR_ID = "960090714950225970";
const privateNoStore = { "Cache-Control": "private, no-store" };
const publicAvatarCache = {
  "Cache-Control": "public, max-age=300",
  "Vercel-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=900",
};
const profileSchema = z.object({
  success: z.literal(true),
  data: z.object({
    discord_user: z.object({
      id: z.literal(CREATOR_ID),
      avatar: z.string().regex(/^(?:a_)?[a-f0-9]{32}$/).nullable(),
    }),
  }),
});

export async function GET(request: Request) {
  try {
    const response = await fetch(`https://api.lanyard.rest/v1/users/${CREATOR_ID}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Avatar unavailable");

    const profile = profileSchema.parse(await response.json());
    const avatar = profile.data.discord_user.avatar;
    const avatarUrl = avatar
      ? `https://cdn.discordapp.com/avatars/${CREATOR_ID}/${avatar}.webp?size=64${avatar.startsWith("a_") ? "&animated=true" : ""}`
      : null;

    if (new URL(request.url).searchParams.get("format") === "json") {
      return Response.json({ avatarUrl }, { headers: publicAvatarCache });
    }
    if (!avatarUrl) return new Response(null, { status: 404, headers: publicAvatarCache });

    return new Response(null, {
      status: 302,
      headers: { ...publicAvatarCache, Location: avatarUrl },
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: privateNoStore,
    });
  }
}
