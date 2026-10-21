import { z } from "zod";

const CREATOR_ID = "960090714950225970";
const profileSchema = z.object({
  success: z.literal(true),
  data: z.object({
    discord_user: z.object({
      id: z.literal(CREATOR_ID),
      avatar: z.string().regex(/^(?:a_)?[a-f0-9]{32}$/),
    }),
  }),
});

export async function GET() {
  try {
    const response = await fetch(`https://api.lanyard.rest/v1/users/${CREATOR_ID}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Avatar unavailable");

    const profile = profileSchema.parse(await response.json());
    const avatar = profile.data.discord_user.avatar;

    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://cdn.discordapp.com/avatars/${CREATOR_ID}/${avatar}.webp?size=64`,
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
