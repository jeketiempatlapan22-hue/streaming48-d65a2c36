import { APP_URL } from "@/lib/appConfig";

type TokenLike = {
  code: string;
  status?: string | null;
  effective_link_kind?: string | null;
  is_replay_show?: boolean | null;
  is_archived?: boolean | null;
  archived_to_replay?: boolean | null;
};

export const shouldUseReplayTokenLink = (token: TokenLike) =>
  token.effective_link_kind === "replay" ||
  token.is_replay_show === true ||
  token.is_archived === true ||
  token.archived_to_replay === true ||
  token.status === "archived";

export const buildTokenWatchPath = (token: TokenLike) => {
  const code = encodeURIComponent(token.code);
  return shouldUseReplayTokenLink(token) ? `/replay-play?token=${code}` : `/live?t=${code}`;
};

export const buildTokenWatchUrl = (token: TokenLike, origin = APP_URL) =>
  `${origin.replace(/\/$/, "")}${buildTokenWatchPath(token)}`;