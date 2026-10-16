export async function onRequestGet(context) {
  try {
    const { env } = context;
    if (!env || !env.DB) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { results } = await env.DB.prepare("SELECT * FROM products ORDER BY rowid DESC").all();
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

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ error: true, message: "D1 Database binding 'DB' is missing in Cloudflare settings." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: true, message: "Invalid JSON payload provided." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Auto-generate slug/ID if missing
    const rawName = body.title || body.product_name || body.name || "product";
    const slug = body.id || body.slug || rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `prod-${Date.now()}`;

    const query = `
      INSERT INTO products (
        id, title, brand, category, subcategory, primary_marketplace,
        mrp, price, discount, marketplace_url, affiliate_url, image_url,
        additional_images, description, rating, review_count, stock_status,
        status, is_featured, is_best_value, store_offers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, brand=excluded.brand, category=excluded.category,
        mrp=excluded.mrp, price=excluded.price, discount=excluded.discount,
        description=excluded.description, status=excluded.status;
    `;

    await env.DB.prepare(query).bind(
      slug,
      rawName,
      body.brand || "",
      body.category || "",
      body.subcategory || "",
      body.primary_marketplace || "Amazon",
      parseFloat(body.mrp || 0),
      parseFloat(body.price || body.selling_price || 0),
      parseFloat(body.discount || body.discount_percentage || 0),
      body.marketplace_url || body.marketplace_product_url || "",
      body.affiliate_url || body.primary_affiliate_url || "",
      body.image_url || "",
      typeof body.additional_images === 'object' ? JSON.stringify(body.additional_images) : String(body.additional_images || ""),
      body.description || "",
      parseFloat(body.rating || 0),
      parseInt(body.review_count || 0, 10),
      body.stock_status || "In Stock",
      body.status || body.publication_status || "Published",
      body.is_featured ? 1 : 0,
      body.is_best_value ? 1 : 0,
      typeof body.store_offers === 'object' ? JSON.stringify(body.store_offers) : String(body.store_offers || "[]")
    ).run();

    return new Response(
      JSON.stringify({ success: true, message: "Product saved successfully!", id: slug }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: true, message: err.message || "Database execution failed.", stack: err.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}