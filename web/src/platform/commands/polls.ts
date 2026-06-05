import { hubFetch } from "../http";
import type { Poll } from "@shared/types";

export async function createPoll(
  channelId: string,
  question: string,
  options: string[],
  endsAt?: number,
): Promise<Poll> {
  const res = await hubFetch(`/channels/${channelId}/polls`, {
    method: "POST",
    body: JSON.stringify({ question, options, ends_at: endsAt ?? null }),
  });
  return res.json() as Promise<Poll>;
}

export async function getPolls(channelId: string): Promise<Poll[]> {
  const res = await hubFetch(`/channels/${channelId}/polls`);
  return res.json() as Promise<Poll[]>;
}

export async function votePoll(pollId: string, optionId: string): Promise<Poll> {
  const res = await hubFetch(`/polls/${pollId}/vote`, {
    method: "POST",
    body: JSON.stringify({ option_id: optionId }),
  });
  return res.json() as Promise<Poll>;
}

export async function deletePoll(pollId: string): Promise<void> {
  await hubFetch(`/polls/${pollId}`, { method: "DELETE" });
}
