"use client";

import { useState } from "react";
import Image from "next/image";

export function CreatorCredit() {
  const [avatarFailed, setAvatarFailed] = useState(false);

  return (
    <a
      className="creator-credit"
      href="https://discord.com/users/960090714950225970"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="by Gilles — open Discord-profiel"
    >
      {!avatarFailed && (
        <Image
          className="creator-avatar"
          src="/api/creator-avatar"
          alt=""
          width={22}
          height={22}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
        />
      )}
      <span className="creator-credit-copy">by <strong>Gilles</strong></span>
    </a>
  );
}
