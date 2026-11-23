// Vercel Serverless Function: every request is rewritten here (see vercel.json)
// and handled by the compiled Express app in dist/.
export { default } from "../dist/vercel.js";

export const config = {
  // Stripe webhooks need the untouched raw request body.
  api: { bodyParser: false },
};
