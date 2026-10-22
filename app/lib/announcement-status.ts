import type { AnnouncementRow } from "./server";

type OutageAnnouncement = Pick<AnnouncementRow, "published" | "kind" | "affectedServices" | "title" | "description">;

export function getAnnouncedOutages(announcements: OutageAnnouncement[]): Map<string, string> {
  const messages = new Map<string, string[]>();
  for (const announcement of announcements) {
    if (!announcement.published || announcement.kind !== "outage") continue;
    const message = `Algemene storing: ${announcement.title}\n${announcement.description}`;
    for (const service of announcement.affectedServices) {
      const reasons = messages.get(service.id) ?? [];
      reasons.push(message);
      messages.set(service.id, reasons);
    }
  }
  return new Map([...messages].map(([id, reasons]) => [id, reasons.join("\n\n")]));
}
