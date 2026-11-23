/**
 * Sets a known password on the seeded demo accounts (emails ending in
 * @mentorlagbe.test) without touching any other data or real users.
 *
 *   SEED_DEMO_PASSWORD='a-password' npm run reset-demo-passwords
 *
 * The hash is produced by Better Auth's own password hasher, so the accounts
 * sign in exactly like normally registered users.
 */
import { ObjectId } from "mongodb";

import { users } from "../src/db/collections.js";
import { bootstrap } from "./lib.js";

const DEMO_DOMAIN = /@mentorlagbe\.test$/i;

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD?.trim();
  if (!password || password.length < 8) {
    throw new Error("Set SEED_DEMO_PASSWORD (at least 8 characters)");
  }

  const { db, auth, close } = await bootstrap();

  try {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    const demoUsers = await users().find({ email: DEMO_DOMAIN }).toArray();

    for (const user of demoUsers) {
      const result = await db.collection("accounts").updateOne(
        { providerId: "credential", userId: { $in: [user._id, user._id.toHexString(), new ObjectId(user._id)] } },
        { $set: { password: hash, updatedAt: new Date() } },
      );
      console.log(`${result.matchedCount ? "updated" : "NO ACCOUNT"}  ${user.role.padEnd(7)} ${user.email}`);
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
