import { createClient } from "@rangka/sdk";

let actingUserId = "u_agent";

export function setActingUser(userId: string): void {
  actingUserId = userId;
}

export function getActingUser(): string {
  return actingUserId;
}

/** Every app in this console shares one SDK client. Nothing else reaches the API. */
export const platform = createClient(() => actingUserId);
