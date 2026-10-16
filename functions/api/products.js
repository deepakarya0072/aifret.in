export async function onRequestGet(context) {
  try {
    const { env } = context;
    if (!env || !env.DB) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const { results } = await env.DB.prepare("SELECT * FROM products").all();
    return new Response(JSON.stringify(results || []), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}