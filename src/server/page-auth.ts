import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentOwner } from "./auth";

/** For owner pages (server components): redirect to /login unless an allow-listed owner is signed in. */
export async function requireOwnerPage(): Promise<string> {
  const owner = await currentOwner(await cookies());
  if (!owner) redirect("/login");
  return owner;
}
