import { runPublisher } from "../src/publish-approved.js";

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.authorization || "";
  if (!expected || authorization !== `Bearer ${expected}`) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const summary = await runPublisher();
    return response.status(200).json({ ok: true, ...summary });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}
