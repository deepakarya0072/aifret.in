export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({ authenticated: true, user: { username: "admin", role: "admin" } }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}