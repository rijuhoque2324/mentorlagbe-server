/**
 * Backfills the data-design field names on existing payment records:
 * userName, userRole, planName, transactionId and paymentStatus.
 *
 *   npm run backfill-payments
 */
import { PAID_PLANS } from "../src/config/plans.js";
import { payments, users } from "../src/db/collections.js";
import { bootstrap } from "./lib.js";

async function main() {
  const { close } = await bootstrap();

  try {
    const docs = await payments().find({}).toArray();
    let updated = 0;

    for (const doc of docs) {
      const user = await users().findOne({ _id: doc.userId }, { projection: { name: 1 } });
      await payments().updateOne(
        { _id: doc._id },
        {
          $set: {
            userName: doc.userName ?? user?.name ?? doc.userEmail,
            userRole: doc.userRole ?? doc.role,
            planName: doc.planName ?? PAID_PLANS[doc.plan]?.name ?? doc.plan,
            transactionId: doc.transactionId ?? doc.stripePaymentIntentId ?? doc.stripeSessionId ?? null,
            paymentStatus: doc.status,
          },
        },
      );
      updated += 1;
    }

    console.log(`Backfilled ${updated} payment records.`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
