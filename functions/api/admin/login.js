export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: true, message: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { username, password } = body;

    // Check if D1 Binding exists
    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({
          error: true,
          message: "D1 Binding 'DB' is missing in Cloudflare Pages settings."
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Query user from database
    const user = await env.DB.prepare(
      "SELECT * FROM users WHERE username = ?"
    ).bind(username).first();

    if (!user) {
      return new Response(
        JSON.stringify({ error: true, message: "User not found in database." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (user.password !== password) {
      return new Response(
        JSON.stringify({ error: true, message: "Invalid password." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: user.id, username: user.username, role: user.role }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({
        error: true,
        message: err.message || "Server Error",
        stack: err.stack
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}