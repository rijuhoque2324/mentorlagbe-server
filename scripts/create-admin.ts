/**
 * Secure admin provisioning. Public sign-up can never create an admin; this
 * script is the only supported way. Run it from a trusted shell:
 *
 *   ADMIN_EMAIL=admin@yourdomain.com ADMIN_PASSWORD='a-strong-password' npm run create-admin
 *
 * If the email already belongs to a user, that user is promoted to admin.
 * If ADMIN_PASSWORD is omitted for a new account, a random password is
 * generated and printed once.
 */
import { users } from "../src/db/collections.js";
import { argValue, bootstrap, ensureUser, generatePassword } from "./lib.js";

async function main() {
  const email = (argValue("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = argValue("name") ?? process.env.ADMIN_NAME ?? "MentorLagbe Admin";
  const providedPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Set ADMIN_EMAIL (or pass --email=...) to a valid email address");
  }

  if (providedPassword && providedPassword.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  }

  const { auth, close } = await bootstrap();

  try {
    const password = providedPassword ?? generatePassword();
    const { id, created } = await ensureUser(auth, { name, email, password, role: "admin" });

    if (!created) {
      await users().updateOne({ _id: id }, { $set: { role: "admin", updatedAt: new Date() } });
      console.log(`Promoted existing user ${email} to admin.`);
    } else {
      console.log(`Created admin ${email}.`);
      if (!providedPassword) {
        console.log(`Generated password (shown once, store it securely): ${password}`);
      }
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
