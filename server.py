#!/usr/bin/env python3
"""
AIFRET - Backend Server & REST API
Provides a robust, zero-dependency HTTP server with SQLite database for:
- Product Management (CRUD, status, featured, best value)
- Multiple marketplace offers per product
- Dynamic search, filters (category, marketplace, price range), sorting
- Secure admin authentication & session management
- Image upload storage & validation
- Static asset serving
"""

import os
import sys
import json
import sqlite3
import base64
import hashlib
import secrets
import mimetypes
import urllib.parse
from datetime import datetime, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "aifret.db")
PORT = int(os.environ.get("PORT", 8000))
AI_VIDEO_PROVIDER = os.environ.get("AI_VIDEO_PROVIDER", "mock").strip().lower()
AI_VIDEO_API_KEY = os.environ.get("AI_VIDEO_API_KEY", "").strip()
AI_VIDEO_MODEL = os.environ.get("AI_VIDEO_MODEL", "aifret-tryon-mock").strip()
AI_VIDEO_MAX_GENERATIONS_PER_CUSTOMER = max(1, int(os.environ.get("AI_VIDEO_MAX_GENERATIONS_PER_CUSTOMER", "3").strip() or 3))


class BaseAIVideoProvider:
    name = 'base'

    def __init__(self, api_key=None, model=None):
        self.api_key = api_key or ''
        self.model = model or 'default'

    def submit_generation(self, *, customer_id, product_id, product_image, customer_photo, product_name=None):
        raise NotImplementedError

    def poll_status(self, *, job_id, provider_job_id, current_status, product_name=None):
        return {"status": current_status, "progress": 100 if current_status == 'completed' else 0, "video_url": None}


class MockAIVideoProvider(BaseAIVideoProvider):
    name = 'mock'

    def submit_generation(self, *, customer_id, product_id, product_image, customer_photo, product_name=None):
        return {
            "job_id": f"mock-tryon-{secrets.token_hex(10)}",
            "status": "processing",
            "progress": 18,
            "video_url": None,
            "provider": self.name,
            "message": "Queued for AI fashion video generation."
        }

    def poll_status(self, *, job_id, provider_job_id, current_status, product_name=None):
        if current_status == 'completed':
            return {"status": 'completed', "progress": 100, "video_url": 'https://samplelib.com/lib/preview/mp4/sample-10s.mp4'}

        progress = 18
        if job_id:
            progress = min(100, 18 + (len(job_id) % 6) * 11)
        return {"status": 'processing', "progress": progress, "video_url": None}


def get_ai_video_provider():
    if AI_VIDEO_PROVIDER == 'mock':
        return MockAIVideoProvider(api_key=AI_VIDEO_API_KEY, model=AI_VIDEO_MODEL)
    return MockAIVideoProvider(api_key=AI_VIDEO_API_KEY, model=AI_VIDEO_MODEL)

# Ensure required directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Database Management & Schema
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn

def hash_password(password: str, salt: str = None) -> tuple:
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    ).hex()
    return hashed, salt

def verify_password(password: str, hashed: str, salt: str) -> bool:
    check_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(hashed, check_hash)

def generate_customer_id(cursor):
    cursor.execute("""
        SELECT customer_id FROM customer_users
        WHERE customer_id LIKE 'AIFRET-CUS-%'
        ORDER BY CAST(SUBSTR(customer_id, 15) AS INTEGER) DESC
        LIMIT 1
    """)
    row = cursor.fetchone()
    last_number = 0
    if row and row['customer_id']:
        try:
            last_number = int(str(row['customer_id']).rsplit('-', 1)[-1])
        except (TypeError, ValueError):
            last_number = 0
    return f"AIFRET-CUS-{last_number + 1:06d}"

def init_database():
    conn = get_db()
    cursor = conn.cursor()

    # Products Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        brand TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT DEFAULT '',
        description TEXT DEFAULT '',
        image TEXT NOT NULL,
        additional_images TEXT DEFAULT '[]',
        mrp REAL NOT NULL,
        selling_price REAL NOT NULL,
        discount REAL NOT NULL,
        marketplace TEXT NOT NULL,
        product_url TEXT NOT NULL,
        rating REAL DEFAULT 0.0,
        review_count INTEGER DEFAULT 0,
        availability TEXT DEFAULT 'In Stock',
        stock_status TEXT DEFAULT 'in_stock',
        featured INTEGER DEFAULT 0,
        best_value INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # Product Offers Table (Multi-marketplace pricing)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS product_offers (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        marketplace TEXT NOT NULL,
        marketplace_slug TEXT DEFAULT '',
        store_name TEXT DEFAULT '',
        price REAL NOT NULL,
        mrp REAL DEFAULT 0.0,
        discount REAL DEFAULT 0.0,
        product_url TEXT NOT NULL,
        affiliate_url TEXT DEFAULT '',
        availability TEXT DEFAULT 'In Stock',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    """)

    # Admin Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """)

    # Admin Sessions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );
    """)

    # Customer Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_users (
        id TEXT PRIMARY KEY,
        customer_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        mobile TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # Customer Sessions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES customer_users(id) ON DELETE CASCADE
    );
    """)

    # Customer Wishlist Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_wishlist (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT DEFAULT '',
        product_image TEXT DEFAULT '',
        added_at TEXT NOT NULL,
        UNIQUE(customer_id, product_id),
        FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE
    );
    """)

    # Customer Recently Viewed Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_recently_viewed (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT DEFAULT '',
        product_image TEXT DEFAULT '',
        viewed_at TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE
    );
    """)

    # Customer AI Preview History Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_ai_previews (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        preview_id TEXT NOT NULL,
        title TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        result TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_ai_tryon_jobs (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT DEFAULT '',
        product_image TEXT DEFAULT '',
        uploaded_photo TEXT DEFAULT '',
        video_url TEXT DEFAULT '',
        provider_job_id TEXT DEFAULT '',
        provider TEXT DEFAULT 'mock',
        status TEXT DEFAULT 'queued',
        progress INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    """)

    # Indexes for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_marketplace ON products(marketplace);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_best_value ON products(best_value);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_offers_product_id ON product_offers(product_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_offers_marketplace ON product_offers(marketplace);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_users_email ON customer_users(email);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_users_mobile ON customer_users(mobile);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_wishlist_customer ON customer_wishlist(customer_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_recently_viewed_customer ON customer_recently_viewed(customer_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_ai_previews_customer ON customer_ai_previews(customer_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_ai_tryon_customer ON customer_ai_tryon_jobs(customer_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer_ai_tryon_product ON customer_ai_tryon_jobs(product_id);")

    # Default Admin Creation
    cursor.execute("SELECT COUNT(*) FROM admin_users;")
    if cursor.fetchone()[0] == 0:
        admin_user = os.environ.get("AIFRET_ADMIN_USERNAME", "").strip()
        admin_pass = os.environ.get("AIFRET_ADMIN_PASSWORD", "")
        if not admin_user or not admin_pass:
            conn.close()
            raise RuntimeError(
                "Set AIFRET_ADMIN_USERNAME and AIFRET_ADMIN_PASSWORD before first startup."
            )
        pwd_hash, salt = hash_password(admin_pass)
        cursor.execute(
            "INSERT INTO admin_users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)",
            ("admin-1", admin_user, pwd_hash, salt, datetime.now().isoformat())
        )
        print("[AIFRET DB] Created configured admin account.")

    # Seed Initial Products if table is empty
    cursor.execute("SELECT COUNT(*) FROM products;")
    if cursor.fetchone()[0] == 0:
        seed_initial_catalog(cursor)

    conn.commit()
    conn.close()

def seed_initial_catalog(cursor):
    now = datetime.now().isoformat()
    initial_products = [
        {
            "id": "noise-buds-x",
            "name": "Noise Buds X",
            "brand": "Noise",
            "category": "Earbuds",
            "subcategory": "Wireless Audio",
            "description": "Lightweight wireless earbuds with deep bass, clear calls, and 20 hours of battery life for daily use.",
            "image": "https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80",
            "additional_images": ["https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=900&q=80"],
            "mrp": 3999,
            "selling_price": 2499,
            "discount": 38,
            "marketplace": "Amazon",
            "product_url": "https://www.amazon.in/",
            "rating": 4.5,
            "review_count": 12870,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 1,
            "best_value": 1,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 2499, "mrp": 3999, "discount": 38, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 2599, "mrp": 3999, "discount": 35, "product_url": "https://www.flipkart.com/", "availability": "In Stock"},
                {"marketplace": "Croma", "price": 2699, "mrp": 3999, "discount": 32, "product_url": "https://www.croma.com/", "availability": "In Stock"},
                {"marketplace": "Meesho", "price": 2399, "mrp": 3999, "discount": 40, "product_url": "https://www.meesho.com/", "availability": "Limited Stock"}
            ]
        },
        {
            "id": "oneplus-nord-buds",
            "name": "OnePlus Nord Buds",
            "brand": "OnePlus",
            "category": "Earbuds",
            "subcategory": "Audio",
            "description": "Balanced sound, ergonomic fit, 44ms ultra-low latency, and quick flash charge.",
            "image": "https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 4999,
            "selling_price": 2999,
            "discount": 40,
            "marketplace": "Amazon",
            "product_url": "https://www.amazon.in/",
            "rating": 4.4,
            "review_count": 9820,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 1,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 2999, "mrp": 4999, "discount": 40, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 3199, "mrp": 4999, "discount": 36, "product_url": "https://www.flipkart.com/", "availability": "In Stock"},
                {"marketplace": "Meesho", "price": 2899, "mrp": 4999, "discount": 42, "product_url": "https://www.meesho.com/", "availability": "In Stock"}
            ]
        },
        {
            "id": "samsung-m14",
            "name": "Samsung Galaxy M14",
            "brand": "Samsung",
            "category": "Electronics",
            "subcategory": "Mobiles",
            "description": "Reliable 5G smartphone with 6.6-inch FHD display, 50MP triple camera, and 6000mAh battery.",
            "image": "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 16999,
            "selling_price": 11999,
            "discount": 29,
            "marketplace": "Amazon",
            "product_url": "https://www.amazon.in/",
            "rating": 4.3,
            "review_count": 15350,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 1,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 11999, "mrp": 16999, "discount": 29, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 12499, "mrp": 16999, "discount": 26, "product_url": "https://www.flipkart.com/", "availability": "In Stock"},
                {"marketplace": "Croma", "price": 12299, "mrp": 16999, "discount": 28, "product_url": "https://www.croma.com/", "availability": "In Stock"}
            ]
        },
        {
            "id": "lenovo-ideapad",
            "name": "Lenovo IdeaPad 5",
            "brand": "Lenovo",
            "category": "Laptops",
            "subcategory": "Computers",
            "description": "Slim laptop tuned for productivity, 16GB RAM, 512GB NVMe SSD, and vivid FHD screen.",
            "image": "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 68999,
            "selling_price": 46999,
            "discount": 32,
            "marketplace": "Flipkart",
            "product_url": "https://www.flipkart.com/",
            "rating": 4.6,
            "review_count": 8760,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 1,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 46999, "mrp": 68999, "discount": 32, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 47999, "mrp": 68999, "discount": 30, "product_url": "https://www.flipkart.com/", "availability": "In Stock"},
                {"marketplace": "Reliance Digital", "price": 48499, "mrp": 68999, "discount": 29, "product_url": "https://www.reliancedigital.in/", "availability": "In Stock"}
            ]
        },
        {
            "id": "urbanic-coat",
            "name": "Urbanic Everyday Coat",
            "brand": "Urbanic",
            "category": "Fashion",
            "subcategory": "Clothing",
            "description": "A polished, lightweight outer layer designed for style and all-day comfort.",
            "image": "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 3499,
            "selling_price": 1890,
            "discount": 46,
            "marketplace": "Myntra",
            "product_url": "https://www.myntra.com/",
            "rating": 4.2,
            "review_count": 6400,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 0,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Myntra", "price": 1890, "mrp": 3499, "discount": 46, "product_url": "https://www.myntra.com/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 1990, "mrp": 3499, "discount": 43, "product_url": "https://www.flipkart.com/", "availability": "In Stock"}
            ]
        },
        {
            "id": "puma-running-shoes",
            "name": "Puma Running Shoes",
            "brand": "Puma",
            "category": "Shoes",
            "subcategory": "Sportswear",
            "description": "Comfort-focused training shoes with cushioned support and durable grip.",
            "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 5999,
            "selling_price": 3499,
            "discount": 42,
            "marketplace": "Amazon",
            "product_url": "https://www.amazon.in/",
            "rating": 4.4,
            "review_count": 7420,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 1,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 3499, "mrp": 5999, "discount": 42, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 3625, "mrp": 5999, "discount": 39, "product_url": "https://www.flipkart.com/", "availability": "In Stock"},
                {"marketplace": "Myntra", "price": 3799, "mrp": 5999, "discount": 37, "product_url": "https://www.myntra.com/", "availability": "In Stock"}
            ]
        },
        {
            "id": "lakme-glow-kit",
            "name": "Lakme Glow Essentials",
            "brand": "Lakme",
            "category": "Beauty",
            "subcategory": "Skincare",
            "description": "A curated beauty routine kit with skincare essentials for everyday radiance.",
            "image": "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 2199,
            "selling_price": 1299,
            "discount": 41,
            "marketplace": "Nykaa",
            "product_url": "https://www.nykaa.com/",
            "rating": 4.3,
            "review_count": 11240,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 0,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Nykaa", "price": 1299, "mrp": 2199, "discount": 41, "product_url": "https://www.nykaa.com/", "availability": "In Stock"},
                {"marketplace": "Amazon", "price": 1399, "mrp": 2199, "discount": 36, "product_url": "https://www.amazon.in/", "availability": "In Stock"}
            ]
        },
        {
            "id": "smart-kettle",
            "name": "Smart Electric Kettle",
            "brand": "Prestige",
            "category": "Home & Kitchen",
            "subcategory": "Kitchen Appliances",
            "description": "High-speed boiling with auto shutoff, 1.5L stainless steel body, and cool-touch handle.",
            "image": "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 3599,
            "selling_price": 2199,
            "discount": 39,
            "marketplace": "Amazon",
            "product_url": "https://www.amazon.in/",
            "rating": 4.5,
            "review_count": 8900,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 0,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 2199, "mrp": 3599, "discount": 39, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 2299, "mrp": 3599, "discount": 36, "product_url": "https://www.flipkart.com/", "availability": "In Stock"}
            ]
        },
        {
            "id": "fossil-chrono",
            "name": "Fossil Chronograph",
            "brand": "Fossil",
            "category": "Watches",
            "subcategory": "Analog Watches",
            "description": "Refined chronograph watch featuring a genuine leather strap and 5ATM water resistance.",
            "image": "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=900&q=80",
            "additional_images": [],
            "mrp": 11999,
            "selling_price": 7499,
            "discount": 38,
            "marketplace": "Amazon",
            "product_url": "https://www.amazon.in/",
            "rating": 4.6,
            "review_count": 6310,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "featured": 1,
            "best_value": 0,
            "status": "active",
            "offers": [
                {"marketplace": "Amazon", "price": 7499, "mrp": 11999, "discount": 38, "product_url": "https://www.amazon.in/", "availability": "In Stock"},
                {"marketplace": "Flipkart", "price": 7799, "mrp": 11999, "discount": 35, "product_url": "https://www.flipkart.com/", "availability": "In Stock"},
                {"marketplace": "Croma", "price": 7999, "mrp": 11999, "discount": 33, "product_url": "https://www.croma.com/", "availability": "In Stock"}
            ]
        }
    ]

    for p in initial_products:
        cursor.execute("""
            INSERT INTO products (
                id, name, brand, category, subcategory, description, image, additional_images,
                mrp, selling_price, discount, marketplace, product_url, rating, review_count,
                availability, stock_status, featured, best_value, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            p["id"], p["name"], p["brand"], p["category"], p["subcategory"], p["description"],
            p["image"], json.dumps(p["additional_images"]), p["mrp"], p["selling_price"],
            p["discount"], p["marketplace"], p["product_url"], p["rating"], p["review_count"],
            p["availability"], p["stock_status"], p["featured"], p["best_value"],
            p["status"], now, now
        ))

        for offer in p.get("offers", []):
            offer_id = f"offer-{secrets.token_hex(6)}"
            cursor.execute("""
                INSERT INTO product_offers (
                    id, product_id, marketplace, marketplace_slug, store_name, price, mrp,
                    discount, product_url, affiliate_url, availability, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                offer_id, p["id"], offer["marketplace"],
                offer["marketplace"].lower().replace(" ", "-"),
                "", offer["price"], offer["mrp"], offer["discount"],
                offer["product_url"], "", offer["availability"], now
            ))

    print(f"[AIFRET DB] Seeded {len(initial_products)} products with marketplace offers.")

# ---------------------------------------------------------------------------
# HTTP Handler & REST API
# ---------------------------------------------------------------------------

class AifretRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    # Helper: Send JSON Response
    def send_json(self, data, status=200, headers=None):
        payload = json.dumps(data, default=str).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    # Helper: Send Error Response
    def send_error_json(self, message, status=400):
        self.send_json({"error": True, "message": message}, status=status)

    # Helper: Parse JSON Body
    def get_json_body(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                return {}
            raw = self.rfile.read(content_length).decode('utf-8')
            return json.loads(raw) if raw else {}
        except Exception as e:
            return None

    # Helper: Extract Session Token from Cookie or Authorization header
    def get_session_token(self, cookie_name='aifret_session'):
        auth_header = self.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            return auth_header[7:].strip()
        cookie_header = self.headers.get('Cookie', '')
        if cookie_header:
            cookies = [c.strip() for c in cookie_header.split(';')]
            for c in cookies:
                if c.startswith(f'{cookie_name}='):
                    return c.split('=', 1)[1].strip()
        return None

    # Helper: Authenticate Admin Session
    def authenticate_admin(self):
        token = self.get_session_token('aifret_session')
        if not token:
            return None
        conn = get_db()
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            SELECT s.token, u.id, u.username
            FROM admin_sessions s
            JOIN admin_users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
        """, (token, now))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"user_id": row[1], "username": row[2]}
        return None

    # Helper: Authenticate Customer Session
    def authenticate_customer(self):
        token = self.get_session_token('aifret_customer_session')
        if not token:
            return None
        conn = get_db()
        cursor = conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("""
            SELECT s.token, u.id, u.customer_id, u.full_name, u.email, u.mobile, u.status
            FROM customer_sessions s
            JOIN customer_users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
        """, (token, now))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {
                "id": row[1],
                "customerId": row[2],
                "fullName": row[3],
                "email": row[4],
                "mobile": row[5],
                "status": row[6]
            }
        return None

    # Helper: CORS Preflight
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    # -----------------------------------------------------------------------
    # GET Handlers
    # -----------------------------------------------------------------------
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        if path.startswith('/api/ai-tryon/status/'):
            job_id = path[len('/api/ai-tryon/status/'):].strip()
            if job_id:
                self.handle_ai_tryon_status(job_id)
                return

        if path == '/api/ai-tryon/generate':
            self.handle_ai_tryon_generate()
            return

        # 1. Product Listing API: /api/products
        if path == '/api/products':
            self.handle_get_products(query)
            return

        # 2. Single Product Detail API: /api/products/<id>
        if path.startswith('/api/products/'):
            product_id = path[len('/api/products/'):].strip()
            self.handle_get_product_by_id(product_id)
            return

        # 3. Marketplaces API: /api/marketplaces
        if path == '/api/marketplaces':
            self.handle_get_marketplaces()
            return

        # 4. Categories API: /api/categories
        if path == '/api/categories':
            self.handle_get_categories()
            return

        # 5. Check Admin Session: /api/admin/session
        if path == '/api/admin/session':
            admin = self.authenticate_admin()
            if admin:
                self.send_json({"authenticated": True, "user": admin})
            else:
                self.send_json({"authenticated": False}, status=401)
            return

        # 6. Customer Session Check: /session
        if path in ['/session', '/api/customer/session']:
            customer = self.authenticate_customer()
            if customer:
                self.send_json({"authenticated": True, "user": customer})
            else:
                self.send_json({"authenticated": False}, status=401)
            return

        # 7. Customer profile and account routes
        if path in ['/account/profile', '/api/customer/account/profile']:
            customer = self.authenticate_customer()
            if not customer:
                self.send_error_json("Please login to your AIFRET account to continue.", status=401)
                return
            self.send_json({"user": customer})
            return

        if path in ['/account/wishlist', '/api/customer/account/wishlist']:
            customer = self.authenticate_customer()
            if not customer:
                self.send_error_json("Please login to your AIFRET account to continue.", status=401)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM customer_wishlist WHERE customer_id = ? ORDER BY added_at DESC", (customer['customerId'],))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json({"items": rows})
            return

        if path in ['/account/recently-viewed', '/api/customer/account/recently-viewed']:
            customer = self.authenticate_customer()
            if not customer:
                self.send_error_json("Please login to your AIFRET account to continue.", status=401)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM customer_recently_viewed WHERE customer_id = ? ORDER BY viewed_at DESC LIMIT 12", (customer['customerId'],))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json({"items": rows})
            return

        if path in ['/account/ai-previews', '/api/customer/account/ai-previews']:
            customer = self.authenticate_customer()
            if not customer:
                self.send_error_json("Please login to your AIFRET account to continue.", status=401)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM customer_ai_previews WHERE customer_id = ? ORDER BY created_at DESC", (customer['customerId'],))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json({"items": rows})
            return

        # 8. Fall back to static file serving
        return super().do_GET()

    def handle_get_products(self, query):
        admin = self.authenticate_admin()
        search = query.get('search', [''])[0].strip().lower()
        category = query.get('category', [''])[0].strip()
        marketplace = query.get('marketplace', [''])[0].strip()
        min_price = query.get('min_price', [''])[0].strip()
        max_price = query.get('max_price', [''])[0].strip()
        sort = query.get('sort', ['featured'])[0].strip()
        featured = query.get('featured', [''])[0].strip()
        best_value = query.get('best_value', [''])[0].strip()
        status = query.get('status', ['active'])[0].strip()
        limit = int(query.get('limit', [100])[0])
        offset = int(query.get('offset', [0])[0])

        conn = get_db()
        cursor = conn.cursor()

        conditions = []
        params = []

        # If not admin, only show active products
        if not admin or status == 'active':
            conditions.append("p.status = 'active'")
        elif status == 'inactive':
            conditions.append("p.status = 'inactive'")
        # If admin and status == 'all', no status filter applied

        if search:
            search_param = f"%{search}%"
            conditions.append("""(
                LOWER(p.name) LIKE ? OR
                LOWER(p.brand) LIKE ? OR
                LOWER(p.category) LIKE ? OR
                LOWER(p.subcategory) LIKE ? OR
                LOWER(p.marketplace) LIKE ? OR
                EXISTS (
                    SELECT 1 FROM product_offers o
                    WHERE o.product_id = p.id AND LOWER(o.marketplace) LIKE ?
                )
            )""")
            params.extend([search_param] * 6)

        if category and category.lower() != 'all':
            conditions.append("(LOWER(p.category) = LOWER(?) OR LOWER(p.subcategory) = LOWER(?))")
            params.extend([category, category])

        if marketplace and marketplace.lower() != 'all':
            market_slug = marketplace.lower().replace(" ", "-")
            conditions.append("""(
                LOWER(p.marketplace) = LOWER(?) OR
                EXISTS (
                    SELECT 1 FROM product_offers o
                    WHERE o.product_id = p.id AND (
                        LOWER(o.marketplace) = LOWER(?) OR
                        o.marketplace_slug = ?
                    )
                )
            )""")
            params.extend([marketplace, marketplace, market_slug])

        if min_price:
            try:
                conditions.append("p.selling_price >= ?")
                params.append(float(min_price))
            except ValueError:
                pass

        if max_price:
            try:
                conditions.append("p.selling_price <= ?")
                params.append(float(max_price))
            except ValueError:
                pass

        if featured == '1':
            conditions.append("p.featured = 1")

        if best_value == '1':
            conditions.append("p.best_value = 1")

        where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""

        # Sorting
        order_clause = " ORDER BY p.featured DESC, p.created_at DESC"
        if sort == 'price-asc':
            order_clause = " ORDER BY p.selling_price ASC"
        elif sort == 'price-desc':
            order_clause = " ORDER BY p.selling_price DESC"
        elif sort == 'discount':
            order_clause = " ORDER BY p.discount DESC"
        elif sort == 'rating':
            order_clause = " ORDER BY p.rating DESC"
        elif sort == 'newest':
            order_clause = " ORDER BY p.created_at DESC"
        elif sort == 'name':
            order_clause = " ORDER BY p.name ASC"

        # Count total
        count_query = f"SELECT COUNT(*) FROM products p {where_clause}"
        cursor.execute(count_query, params)
        total_count = cursor.fetchone()[0]

        # Fetch products
        query_sql = f"""
            SELECT p.* FROM products p
            {where_clause}
            {order_clause}
            LIMIT ? OFFSET ?
        """
        cursor.execute(query_sql, params + [limit, offset])
        rows = cursor.fetchall()

        products = []
        for r in rows:
            prod = dict(r)
            try:
                prod['additional_images'] = json.loads(prod['additional_images'] or '[]')
            except Exception:
                prod['additional_images'] = []

            # Fetch offers for this product
            cursor.execute("""
                SELECT * FROM product_offers
                WHERE product_id = ?
                ORDER BY price ASC
            """, (prod['id'],))
            prod['offers'] = [dict(o) for o in cursor.fetchall()]
            prod['comparison'] = prod['offers']  # Backward compatibility alias
            products.append(prod)

        conn.close()
        self.send_json({
            "products": products,
            "total": total_count,
            "count": len(products),
            "limit": limit,
            "offset": offset
        })

    def handle_get_product_by_id(self, product_id):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            self.send_error_json("Product not found", status=404)
            return

        prod = dict(row)
        try:
            prod['additional_images'] = json.loads(prod['additional_images'] or '[]')
        except Exception:
            prod['additional_images'] = []

        cursor.execute("""
            SELECT * FROM product_offers
            WHERE product_id = ?
            ORDER BY price ASC
        """, (prod['id'],))
        prod['offers'] = [dict(o) for o in cursor.fetchall()]
        prod['comparison'] = prod['offers']

        conn.close()
        self.send_json({"product": prod})

    def handle_get_marketplaces(self):
        conn = get_db()
        cursor = conn.cursor()
        # Find all distinct marketplaces in products and offers
        cursor.execute("""
            SELECT DISTINCT marketplace FROM (
                SELECT marketplace FROM products WHERE status = 'active'
                UNION
                SELECT o.marketplace FROM product_offers o
                JOIN products p ON o.product_id = p.id
                WHERE p.status = 'active'
            ) WHERE marketplace IS NOT NULL AND marketplace != ''
            ORDER BY marketplace ASC
        """)
        marketplaces = [r[0] for r in cursor.fetchall()]
        conn.close()
        self.send_json({"marketplaces": marketplaces})

    def handle_get_categories(self):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT category, COUNT(*) as count
            FROM products
            WHERE status = 'active'
            GROUP BY category
            ORDER BY count DESC, category ASC
        """)
        categories = [{"name": r[0], "count": r[1], "slug": r[0].lower().replace(" ", "-")} for r in cursor.fetchall()]
        conn.close()
        self.send_json({"categories": categories})

    # -----------------------------------------------------------------------
    # POST Handlers
    # -----------------------------------------------------------------------
    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 1. Admin Login
        if path == '/api/admin/login':
            self.handle_admin_login()
            return

        # 2. Admin Logout
        if path == '/api/admin/logout':
            self.handle_admin_logout()
            return

        # 3. Customer Signup
        if path in ['/signup', '/api/customer/signup']:
            self.handle_customer_signup()
            return

        # 4. Customer Login
        if path in ['/login', '/api/customer/login']:
            self.handle_customer_login()
            return

        # 5. Customer Logout
        if path in ['/logout', '/api/customer/logout']:
            self.handle_customer_logout()
            return

        # 6. Customer Forgot Password (safe enumeration response)
        if path in ['/forgot-password', '/api/customer/forgot-password']:
            self.handle_customer_forgot_password()
            return

        # 7. Customer Wishlist save endpoint
        if path in ['/account/wishlist', '/api/customer/account/wishlist']:
            self.handle_customer_wishlist_post()
            return

        # 8. Customer recently viewed endpoint
        if path in ['/account/recently-viewed', '/api/customer/account/recently-viewed']:
            self.handle_customer_recently_viewed_post()
            return

        # 9. AI Try-On Generation
        if path == '/api/ai-tryon/generate':
            self.handle_ai_tryon_generate()
            return

        # 10. Image Upload
        if path == '/api/upload':
            self.handle_image_upload()
            return

        # 11. Add Product
        if path == '/api/products':
            self.handle_add_product()
            return

        self.send_error_json("Not Found", status=404)

    def handle_admin_login(self):
        body = self.get_json_body()
        if not body:
            self.send_error_json("Invalid request body")
            return

        username = body.get('username', '').strip()
        password = body.get('password', '').strip()

        if not username or not password:
            self.send_error_json("Username and password required")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, password_hash, salt FROM admin_users WHERE username = ?", (username,))
        user = cursor.fetchone()

        if not user or not verify_password(password, user['password_hash'], user['salt']):
            conn.close()
            self.send_error_json("Invalid username or password", status=401)
            return

        token = secrets.token_hex(32)
        created_at = datetime.now()
        expires_at = (created_at + timedelta(days=7)).isoformat()

        cursor.execute("""
            INSERT INTO admin_sessions (token, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
        """, (token, user['id'], created_at.isoformat(), expires_at))
        conn.commit()
        conn.close()

        cookie_val = f"aifret_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800"
        self.send_json(
            {"success": True, "token": token, "username": user['username']},
            headers={"Set-Cookie": cookie_val}
        )

    def handle_admin_logout(self):
        token = self.get_session_token('aifret_session')
        if token:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()

        expired_cookie = "aifret_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        self.send_json({"success": True}, headers={"Set-Cookie": expired_cookie})

    def handle_customer_signup(self):
        body = self.get_json_body()
        if not body:
            self.send_error_json("Invalid request body")
            return

        full_name = str(body.get('fullName', '') or body.get('full_name', '')).strip()
        email = str(body.get('email', '')).strip().lower()
        mobile = str(body.get('mobile', '')).strip()
        password = str(body.get('password', '')).strip()

        if not full_name or not email or not mobile or not password:
            self.send_error_json("Full name, email, mobile, and password are required")
            return
        if len(password) < 8:
            self.send_error_json("Password must be at least 8 characters long")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM customer_users WHERE LOWER(email) = LOWER(?) OR mobile = ?", (email, mobile))
        if cursor.fetchone():
            conn.close()
            self.send_error_json("An account with this email or mobile already exists", status=409)
            return

        user_id = f"customer-{secrets.token_hex(8)}"
        customer_id = generate_customer_id(cursor)
        pwd_hash, salt = hash_password(password)
        created_at = datetime.now().isoformat()
        cursor.execute("""
            INSERT INTO customer_users (id, customer_id, full_name, email, mobile, password_hash, salt, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (user_id, customer_id, full_name, email, mobile, pwd_hash, salt, 'active', created_at, created_at))
        conn.commit()

        token = secrets.token_hex(32)
        expires_at = (datetime.now() + timedelta(days=30)).isoformat()
        cursor.execute("INSERT INTO customer_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", (token, user_id, created_at, expires_at))
        conn.commit()
        conn.close()

        customer = {"id": user_id, "customerId": customer_id, "fullName": full_name, "email": email, "mobile": mobile, "status": "active"}
        cookie_val = "aifret_customer_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000".format(token)
        self.send_json({"success": True, "token": token, "user": customer}, headers={"Set-Cookie": cookie_val})

    def handle_customer_login(self):
        body = self.get_json_body()
        if not body:
            self.send_error_json("Invalid request body")
            return

        identifier = str(body.get('identifier', '')).strip()
        password = str(body.get('password', '')).strip()
        if not identifier or not password:
            self.send_error_json("Customer ID, email, or mobile number and password are required")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM customer_users
            WHERE LOWER(customer_id) = LOWER(?)
               OR LOWER(email) = LOWER(?)
               OR mobile = ?
            LIMIT 1
        """, (identifier, identifier, identifier))
        user = cursor.fetchone()
        if not user or not verify_password(password, user['password_hash'], user['salt']):
            conn.close()
            self.send_error_json("Invalid customer ID, email, mobile number, or password", status=401)
            return

        token = secrets.token_hex(32)
        created_at = datetime.now().isoformat()
        expires_at = (datetime.now() + timedelta(days=30)).isoformat()
        cursor.execute("INSERT INTO customer_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", (token, user['id'], created_at, expires_at))
        conn.commit()
        conn.close()

        customer = {"id": user['id'], "customerId": user['customer_id'], "fullName": user['full_name'], "email": user['email'], "mobile": user['mobile'], "status": user['status']}
        cookie_val = "aifret_customer_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000".format(token)
        self.send_json({"success": True, "token": token, "user": customer}, headers={"Set-Cookie": cookie_val})

    def handle_customer_logout(self):
        token = self.get_session_token('aifret_customer_session')
        if token:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM customer_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        expired_cookie = "aifret_customer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        self.send_json({"success": True}, headers={"Set-Cookie": expired_cookie})

    def handle_customer_forgot_password(self):
        self.send_json({"success": True, "message": "If the account exists, password reset instructions have been sent."})

    def handle_customer_profile_update(self):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        body = self.get_json_body() or {}
        full_name = str(body.get('fullName', customer['fullName']) or customer['fullName']).strip()
        email = str(body.get('email', customer['email']) or customer['email']).strip().lower()
        mobile = str(body.get('mobile', customer['mobile']) or customer['mobile']).strip()

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM customer_users WHERE (LOWER(email) = LOWER(?) OR mobile = ?) AND id != ?", (email, mobile, customer['id']))
        if cursor.fetchone():
            conn.close()
            self.send_error_json("This email or mobile number is already in use.", status=409)
            return

        cursor.execute("UPDATE customer_users SET full_name = ?, email = ?, mobile = ?, updated_at = ? WHERE id = ?", (full_name, email, mobile, datetime.now().isoformat(), customer['id']))
        conn.commit()
        conn.close()
        self.send_json({"success": True, "user": {"id": customer['id'], "customerId": customer['customerId'], "fullName": full_name, "email": email, "mobile": mobile, "status": customer['status']}})

    def handle_customer_wishlist_post(self):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        body = self.get_json_body() or {}
        product_id = str(body.get('productId', '') or body.get('product_id', '')).strip()
        product_name = str(body.get('productName', '')).strip()
        product_image = str(body.get('productImage', '')).strip()
        if not product_id:
            self.send_error_json("Product ID is required")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM customer_wishlist WHERE customer_id = ? AND product_id = ?", (customer['customerId'], product_id))
        if cursor.fetchone():
            conn.close()
            self.send_json({"success": True, "saved": True})
            return

        row_id = f"wishlist-{secrets.token_hex(8)}"
        cursor.execute("INSERT INTO customer_wishlist (id, customer_id, product_id, product_name, product_image, added_at) VALUES (?, ?, ?, ?, ?, ?)", (row_id, customer['customerId'], product_id, product_name, product_image, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        self.send_json({"success": True, "saved": True})

    def handle_customer_wishlist_delete(self):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        body = self.get_json_body() or {}
        product_id = str(body.get('productId', '') or body.get('product_id', '')).strip()
        if not product_id:
            self.send_error_json("Product ID is required")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM customer_wishlist WHERE customer_id = ? AND product_id = ?", (customer['customerId'], product_id))
        conn.commit()
        conn.close()
        self.send_json({"success": True, "saved": False})

    def handle_customer_recently_viewed_post(self):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        body = self.get_json_body() or {}
        product_id = str(body.get('productId', '') or body.get('product_id', '')).strip()
        if not product_id:
            self.send_error_json("Product ID is required")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM customer_recently_viewed WHERE customer_id = ? AND product_id = ? ORDER BY viewed_at DESC LIMIT 1", (customer['customerId'], product_id))
        if not cursor.fetchone():
            row_id = f"recent-{secrets.token_hex(8)}"
            cursor.execute("INSERT INTO customer_recently_viewed (id, customer_id, product_id, product_name, product_image, viewed_at) VALUES (?, ?, ?, ?, ?, ?)", (row_id, customer['customerId'], product_id, str(body.get('productName', '')).strip(), str(body.get('productImage', '')).strip(), datetime.now().isoformat()))
            conn.commit()
        conn.close()
        self.send_json({"success": True})

    def handle_customer_ai_preview_delete(self, preview_id):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM customer_ai_previews WHERE customer_id = ? AND preview_id = ?", (customer['customerId'], preview_id))
        conn.commit()
        conn.close()
        self.send_json({"success": True})

    def validate_image_data_url(self, image_string):
        if not image_string or not isinstance(image_string, str):
            return None
        if not image_string.startswith('data:image/') or ', ' not in image_string and ',' not in image_string:
            return None
        header, _, encoded = image_string.partition(',')
        if not encoded:
            return None
        mime_type = header.replace('data:', '').split(';', 1)[0].strip().lower()
        if mime_type not in ['image/jpeg', 'image/png', 'image/webp']:
            return None
        try:
            image_bytes = base64.b64decode(encoded)
        except Exception:
            return None
        if len(image_bytes) == 0 or len(image_bytes) > 10 * 1024 * 1024:
            return None
        return {"mime_type": mime_type, "data": image_bytes, "bytes": len(image_bytes)}

    def handle_ai_tryon_generate(self):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        body = self.get_json_body() or {}
        if not isinstance(body, dict):
            self.send_error_json("Invalid JSON format")
            return

        customer_id = str(body.get('customer_id') or body.get('customerId') or customer['customerId']).strip()
        product_id = str(body.get('product_id') or body.get('productId') or '').strip()
        product_image = str(body.get('product_image') or body.get('productImage') or '').strip()
        customer_photo = str(body.get('customer_photo') or body.get('customerPhoto') or '').strip()
        product_name = str(body.get('product_name') or body.get('productName') or '').strip()

        if not product_id:
            self.send_error_json("Product ID is required")
            return
        if not customer_photo:
            self.send_error_json("Customer photo is required")
            return
        if customer_id != customer['customerId']:
            self.send_error_json("Customer identity mismatch.", status=403)
            return

        validation = self.validate_image_data_url(customer_photo)
        if not validation:
            self.send_error_json("Uploaded photo must be a valid JPG, PNG, or WebP image under 10MB.")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
        product = cursor.fetchone()
        if not product:
            conn.close()
            self.send_error_json("Selected product was not found.", status=404)
            return

        cursor.execute("SELECT COUNT(*) FROM customer_ai_tryon_jobs WHERE customer_id = ? AND status IN ('queued', 'processing')", (customer_id,))
        if cursor.fetchone()[0] > 0:
            conn.close()
            self.send_error_json("A try-on generation is already in progress for your account. Please wait for it to finish.", status=409)
            return

        cursor.execute("SELECT COUNT(*) FROM customer_ai_tryon_jobs WHERE customer_id = ? AND status = 'completed'", (customer_id,))
        if cursor.fetchone()[0] >= AI_VIDEO_MAX_GENERATIONS_PER_CUSTOMER:
            conn.close()
            self.send_error_json(f"You have reached the generation limit of {AI_VIDEO_MAX_GENERATIONS_PER_CUSTOMER} videos for this account.", status=429)
            return

        provider = get_ai_video_provider()
        provider_result = provider.submit_generation(
            customer_id=customer_id,
            product_id=product_id,
            product_image=product_image or product['image'],
            customer_photo=customer_photo,
            product_name=product_name or product['name']
        )

        job_id = f"ai-tryon-{secrets.token_hex(12)}"
        created_at = datetime.now().isoformat()

        cursor.execute("""
            INSERT INTO customer_ai_tryon_jobs (
                id, customer_id, product_id, product_name, product_image, uploaded_photo,
                video_url, provider_job_id, provider, status, progress, created_at, completed_at, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job_id,
            customer_id,
            product_id,
            product_name or product['name'],
            product_image or product['image'],
            customer_photo,
            '',
            provider_result.get('job_id', ''),
            provider_result.get('provider', 'mock'),
            provider_result.get('status', 'queued'),
            int(provider_result.get('progress', 0) or 0),
            created_at,
            '',
            ''
        ))
        conn.commit()
        conn.close()

        self.send_json({
            "success": True,
            "job_id": job_id,
            "status": provider_result.get('status', 'processing'),
            "progress": int(provider_result.get('progress', 0) or 0),
            "message": provider_result.get('message', 'AI video generation started.')
        })

    def handle_ai_tryon_status(self, job_id):
        customer = self.authenticate_customer()
        if not customer:
            self.send_error_json("Please login to your AIFRET account to continue.", status=401)
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM customer_ai_tryon_jobs WHERE id = ? AND customer_id = ?", (job_id, customer['customerId']))
        row = cursor.fetchone()
        if not row:
            conn.close()
            self.send_error_json("AI try-on job not found.", status=404)
            return

        provider = get_ai_video_provider()
        current_status = row['status']
        current_progress = int(row['progress'] or 0)

        if current_status in ['queued', 'processing']:
            provider_result = provider.poll_status(
                job_id=row['id'],
                provider_job_id=row['provider_job_id'],
                current_status=current_status,
                product_name=row['product_name']
            )
            next_status = provider_result.get('status', current_status)
            next_progress = int(provider_result.get('progress', current_progress) or current_progress)

            if next_status == 'completed':
                next_progress = 100
                completed_at = datetime.now().isoformat()
                video_url = provider_result.get('video_url') or row['video_url'] or 'https://samplelib.com/lib/preview/mp4/sample-10s.mp4'
                cursor.execute("UPDATE customer_ai_tryon_jobs SET status = ?, progress = ?, video_url = ?, completed_at = ? WHERE id = ?", (next_status, next_progress, video_url, completed_at, row['id']))
                conn.commit()
                response = {"status": next_status, "progress": next_progress, "video_url": video_url}
            else:
                next_progress = max(current_progress, min(95, next_progress))
                cursor.execute("UPDATE customer_ai_tryon_jobs SET status = ?, progress = ? WHERE id = ?", (next_status, next_progress, row['id']))
                conn.commit()
                response = {"status": next_status, "progress": next_progress}
        else:
            response = {"status": current_status, "progress": current_progress, "video_url": row['video_url'] or None}

        conn.close()
        self.send_json(response)

    def handle_image_upload(self):
        admin = self.authenticate_admin()
        if not admin:
            self.send_error_json("Unauthorized", status=401)
            return

        content_type = self.headers.get('Content-Type', '')

        # Option A: JSON with Base64 payload
        if 'application/json' in content_type:
            body = self.get_json_body()
            if not body or 'data' not in body:
                self.send_error_json("Missing image data in request")
                return

            raw_data = body['data']
            # Expected format: data:image/png;base64,...
            if ',' in raw_data:
                header, base64_str = raw_data.split(',', 1)
                ext = 'jpg'
                if 'image/png' in header: ext = 'png'
                elif 'image/webp' in header: ext = 'webp'
                elif 'image/gif' in header: ext = 'gif'
                elif 'image/jpeg' in header: ext = 'jpg'
            else:
                base64_str = raw_data
                ext = 'jpg'

            import base64
            try:
                img_bytes = base64.b64decode(base64_str)
            except Exception:
                self.send_error_json("Invalid base64 encoding")
                return

            if len(img_bytes) > 10 * 1024 * 1024:
                self.send_error_json("Image exceeds 10 MB limit")
                return

            filename = f"img_{datetime.now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}.{ext}"
            filepath = os.path.join(UPLOADS_DIR, filename)
            with open(filepath, 'wb') as f:
                f.write(img_bytes)

            url = f"/uploads/{filename}"
            self.send_json({"success": True, "url": url, "filename": filename})
            return

        # Option B: Multipart Form Upload
        if 'multipart/form-data' in content_type:
            try:
                import cgi
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': content_type}
                )
                fileitem = form['file'] if 'file' in form else None
                if not fileitem or not fileitem.file:
                    self.send_error_json("No file uploaded")
                    return

                img_bytes = fileitem.file.read()
                if len(img_bytes) > 10 * 1024 * 1024:
                    self.send_error_json("File size exceeds 10 MB limit")
                    return

                original_filename = fileitem.filename or "upload.jpg"
                ext = original_filename.rsplit('.', 1)[-1].lower() if '.' in original_filename else 'jpg'
                if ext not in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
                    self.send_error_json("Invalid file format. JPG, PNG, WebP or GIF allowed.")
                    return

                filename = f"img_{datetime.now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}.{ext}"
                filepath = os.path.join(UPLOADS_DIR, filename)
                with open(filepath, 'wb') as f:
                    f.write(img_bytes)

                url = f"/uploads/{filename}"
                self.send_json({"success": True, "url": url, "filename": filename})
                return
            except Exception as e:
                self.send_error_json(f"Upload error: {str(e)}")
                return

        self.send_error_json("Unsupported content type for upload")

    def handle_add_product(self):
        admin = self.authenticate_admin()
        if not admin:
            self.send_error_json("Unauthorized", status=401)
            return

        body = self.get_json_body()
        if not body:
            self.send_error_json("Invalid JSON body")
            return

        # Validation
        name = body.get('name', '').strip()
        brand = body.get('brand', '').strip()
        category = body.get('category', '').strip()
        subcategory = body.get('subcategory', '').strip()
        description = body.get('description', '').strip()
        image = body.get('image', '').strip()
        additional_images = body.get('additional_images', [])
        marketplace = body.get('marketplace', '').strip()
        product_url = body.get('product_url', '').strip()
        availability = body.get('availability', 'In Stock').strip()
        stock_status = body.get('stock_status', 'in_stock').strip()
        featured = 1 if body.get('featured') in [True, 1, '1', 'true'] else 0
        best_value = 1 if body.get('best_value') in [True, 1, '1', 'true'] else 0
        status = 'inactive' if body.get('status') in ['inactive', '0', 0] else 'active'

        try:
            mrp = float(body.get('mrp', 0))
            selling_price = float(body.get('selling_price', 0))
            rating = float(body.get('rating', 4.0))
            review_count = int(body.get('review_count', 0))
        except (ValueError, TypeError):
            self.send_error_json("MRP, Selling Price, Rating and Review count must be valid numbers")
            return

        if not name or not category or not marketplace or not product_url:
            self.send_error_json("Product Name, Category, Marketplace, and Product URL are required")
            return

        if mrp < 0 or selling_price < 0:
            self.send_error_json("Price cannot be negative")
            return

        if not (product_url.startswith('http://') or product_url.startswith('https://') or product_url.startswith('#')):
            self.send_error_json("Product URL must be a valid web URL")
            return

        # Auto-calculate discount
        if mrp > 0 and selling_price <= mrp:
            discount = round(((mrp - selling_price) / mrp) * 100)
        else:
            discount = 0

        # Custom ID or auto-generated slug
        product_id = body.get('id', '').strip()
        if not product_id:
            base_slug = name.lower().replace(" ", "-")
            clean_slug = "".join(c for c in base_slug if c.isalnum() or c == '-')
            product_id = f"{clean_slug}-{secrets.token_hex(3)}"

        now = datetime.now().isoformat()
        conn = get_db()
        cursor = conn.cursor()

        # Check existing ID
        cursor.execute("SELECT id FROM products WHERE id = ?", (product_id,))
        if cursor.fetchone():
            product_id = f"{product_id}-{secrets.token_hex(2)}"

        cursor.execute("""
            INSERT INTO products (
                id, name, brand, category, subcategory, description, image, additional_images,
                mrp, selling_price, discount, marketplace, product_url, rating, review_count,
                availability, stock_status, featured, best_value, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            product_id, name, brand, category, subcategory, description, image,
            json.dumps(additional_images), mrp, selling_price, discount, marketplace,
            product_url, rating, review_count, availability, stock_status,
            featured, best_value, status, now, now
        ))

        # Insert primary marketplace offer
        primary_offer_id = f"offer-{secrets.token_hex(6)}"
        cursor.execute("""
            INSERT INTO product_offers (
                id, product_id, marketplace, marketplace_slug, store_name, price, mrp,
                discount, product_url, affiliate_url, availability, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            primary_offer_id, product_id, marketplace,
            marketplace.lower().replace(" ", "-"), "",
            selling_price, mrp, discount, product_url,
            body.get('affiliate_url', ''), availability, now
        ))

        # Insert any additional marketplace offers
        offers = body.get('offers', body.get('comparison', []))
        for offer in offers:
            off_market = offer.get('marketplace', '').strip()
            if not off_market or off_market.lower() == marketplace.lower():
                continue
            off_price = float(offer.get('price', selling_price))
            off_mrp = float(offer.get('mrp', mrp))
            off_url = offer.get('product_url', offer.get('url', product_url)).strip()
            off_disc = round(((off_mrp - off_price) / off_mrp) * 100) if off_mrp > 0 else 0
            off_avail = offer.get('availability', availability)
            off_id = f"offer-{secrets.token_hex(6)}"

            cursor.execute("""
                INSERT INTO product_offers (
                    id, product_id, marketplace, marketplace_slug, store_name, price, mrp,
                    discount, product_url, affiliate_url, availability, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                off_id, product_id, off_market,
                off_market.lower().replace(" ", "-"),
                offer.get('store_name', ''), off_price, off_mrp, off_disc,
                off_url, offer.get('affiliate_url', ''), off_avail, now
            ))

        conn.commit()
        conn.close()

        self.send_json({"success": True, "id": product_id, "message": "Product created successfully"}, status=201)

    # -----------------------------------------------------------------------
    # PUT Handlers
    # -----------------------------------------------------------------------
    def do_PUT(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path in ['/account/profile', '/api/customer/account/profile']:
            self.handle_customer_profile_update()
            return

        # Update Product: PUT /api/products/<id>
        if path.startswith('/api/products/'):
            product_id = path[len('/api/products/'):].strip()
            self.handle_update_product(product_id)
            return

        self.send_error_json("Not Found", status=404)

    def handle_update_product(self, product_id):
        admin = self.authenticate_admin()
        if not admin:
            self.send_error_json("Unauthorized", status=401)
            return

        body = self.get_json_body()
        if not body:
            self.send_error_json("Invalid JSON body")
            return

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
        existing = cursor.fetchone()
        if not existing:
            conn.close()
            self.send_error_json("Product not found", status=404)
            return

        name = body.get('name', existing['name']).strip()
        brand = body.get('brand', existing['brand']).strip()
        category = body.get('category', existing['category']).strip()
        subcategory = body.get('subcategory', existing['subcategory']).strip()
        description = body.get('description', existing['description']).strip()
        image = body.get('image', existing['image']).strip()
        additional_images = body.get('additional_images', json.loads(existing['additional_images'] or '[]'))
        marketplace = body.get('marketplace', existing['marketplace']).strip()
        product_url = body.get('product_url', existing['product_url']).strip()
        availability = body.get('availability', existing['availability']).strip()
        stock_status = body.get('stock_status', existing['stock_status']).strip()
        featured = 1 if body.get('featured', existing['featured']) in [True, 1, '1', 'true'] else 0
        best_value = 1 if body.get('best_value', existing['best_value']) in [True, 1, '1', 'true'] else 0
        status = body.get('status', existing['status'])

        mrp = float(body.get('mrp', existing['mrp']))
        selling_price = float(body.get('selling_price', existing['selling_price']))
        rating = float(body.get('rating', existing['rating']))
        review_count = int(body.get('review_count', existing['review_count']))

        if mrp > 0 and selling_price <= mrp:
            discount = round(((mrp - selling_price) / mrp) * 100)
        else:
            discount = 0

        now = datetime.now().isoformat()
        cursor.execute("""
            UPDATE products SET
                name = ?, brand = ?, category = ?, subcategory = ?, description = ?,
                image = ?, additional_images = ?, mrp = ?, selling_price = ?, discount = ?,
                marketplace = ?, product_url = ?, rating = ?, review_count = ?,
                availability = ?, stock_status = ?, featured = ?, best_value = ?,
                status = ?, updated_at = ?
            WHERE id = ?
        """, (
            name, brand, category, subcategory, description, image,
            json.dumps(additional_images), mrp, selling_price, discount,
            marketplace, product_url, rating, review_count, availability,
            stock_status, featured, best_value, status, now, product_id
        ))

        # If offers array provided, replace offers
        if 'offers' in body or 'comparison' in body:
            cursor.execute("DELETE FROM product_offers WHERE product_id = ?", (product_id,))
            offers = body.get('offers', body.get('comparison', []))
            has_primary = False
            for offer in offers:
                off_market = offer.get('marketplace', '').strip()
                if not off_market:
                    continue
                if off_market.lower() == marketplace.lower():
                    has_primary = True
                off_price = float(offer.get('price', selling_price))
                off_mrp = float(offer.get('mrp', mrp))
                off_disc = round(((off_mrp - off_price) / off_mrp) * 100) if off_mrp > 0 else 0
                off_url = offer.get('product_url', offer.get('url', product_url)).strip()
                off_avail = offer.get('availability', availability)
                off_id = f"offer-{secrets.token_hex(6)}"

                cursor.execute("""
                    INSERT INTO product_offers (
                        id, product_id, marketplace, marketplace_slug, store_name, price, mrp,
                        discount, product_url, affiliate_url, availability, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    off_id, product_id, off_market,
                    off_market.lower().replace(" ", "-"),
                    offer.get('store_name', ''), off_price, off_mrp, off_disc,
                    off_url, offer.get('affiliate_url', ''), off_avail, now
                ))

            # Ensure at least primary offer exists
            if not has_primary:
                cursor.execute("""
                    INSERT INTO product_offers (
                        id, product_id, marketplace, marketplace_slug, store_name, price, mrp,
                        discount, product_url, affiliate_url, availability, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    f"offer-{secrets.token_hex(6)}", product_id, marketplace,
                    marketplace.lower().replace(" ", "-"), "",
                    selling_price, mrp, discount, product_url,
                    body.get('affiliate_url', ''), availability, now
                ))

        conn.commit()
        conn.close()

        self.send_json({"success": True, "message": "Product updated successfully"})

    # -----------------------------------------------------------------------
    # PATCH Handlers
    # -----------------------------------------------------------------------
    def do_PATCH(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        admin = self.authenticate_admin()
        if not admin:
            self.send_error_json("Unauthorized", status=401)
            return

        # 1. Toggle Status: PATCH /api/products/<id>/status
        if path.startswith('/api/products/') and path.endswith('/status'):
            product_id = path[len('/api/products/'):-len('/status')].strip()
            self.handle_patch_field(product_id, 'status')
            return

        # 2. Toggle Featured: PATCH /api/products/<id>/featured
        if path.startswith('/api/products/') and path.endswith('/featured'):
            product_id = path[len('/api/products/'):-len('/featured')].strip()
            self.handle_patch_field(product_id, 'featured')
            return

        # 3. Toggle Best Value: PATCH /api/products/<id>/best-value
        if path.startswith('/api/products/') and path.endswith('/best-value'):
            product_id = path[len('/api/products/'):-len('/best-value')].strip()
            self.handle_patch_field(product_id, 'best_value')
            return

        self.send_error_json("Not Found", status=404)

    def handle_patch_field(self, product_id, field_name):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
        existing = cursor.fetchone()
        if not existing:
            conn.close()
            self.send_error_json("Product not found", status=404)
            return

        body = self.get_json_body() or {}
        now = datetime.now().isoformat()

        if field_name == 'status':
            current = existing['status']
            new_val = body.get('status', 'inactive' if current == 'active' else 'active')
            cursor.execute("UPDATE products SET status = ?, updated_at = ? WHERE id = ?", (new_val, now, product_id))
        elif field_name == 'featured':
            current = existing['featured']
            new_val = body.get('featured', 0 if current == 1 else 1)
            cursor.execute("UPDATE products SET featured = ?, updated_at = ? WHERE id = ?", (new_val, now, product_id))
        elif field_name == 'best_value':
            current = existing['best_value']
            new_val = body.get('best_value', 0 if current == 1 else 1)
            cursor.execute("UPDATE products SET best_value = ?, updated_at = ? WHERE id = ?", (new_val, now, product_id))

        conn.commit()
        conn.close()
        self.send_json({"success": True, "field": field_name, "value": new_val})

    # -----------------------------------------------------------------------
    # DELETE Handlers
    # -----------------------------------------------------------------------
    def do_DELETE(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        if path in ['/account/wishlist', '/api/customer/account/wishlist']:
            self.handle_customer_wishlist_delete()
            return

        if path.startswith('/account/ai-previews/') or path.startswith('/api/customer/account/ai-previews/'):
            preview_id = path.split('/')[-1].strip()
            self.handle_customer_ai_preview_delete(preview_id)
            return

        admin = self.authenticate_admin()
        if not admin:
            self.send_error_json("Unauthorized", status=401)
            return

        # Delete Product: DELETE /api/products/<id>?permanent=true/false
        if path.startswith('/api/products/'):
            product_id = path[len('/api/products/'):].strip()
            permanent = query.get('permanent', ['false'])[0].lower() == 'true'

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM products WHERE id = ?", (product_id,))
            if not cursor.fetchone():
                conn.close()
                self.send_error_json("Product not found", status=404)
                return

            if permanent:
                cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
                msg = "Product permanently deleted"
            else:
                now = datetime.now().isoformat()
                cursor.execute("UPDATE products SET status = 'inactive', updated_at = ? WHERE id = ?", (now, product_id))
                msg = "Product deactivated (soft-deleted)"

            conn.commit()
            conn.close()
            self.send_json({"success": True, "message": msg, "permanent": permanent})
            return

        self.send_error_json("Not Found", status=404)

# ---------------------------------------------------------------------------
# Server Startup
# ---------------------------------------------------------------------------

def run_server():
    init_database()
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, AifretRequestHandler)
    print("=" * 60)
    print(f"[AIFRET Server] Running at http://localhost:{PORT}/")
    print(f"[AIFRET DB] Database: {DB_PATH}")
    print(f"[AIFRET Admin] Admin Panel: http://localhost:{PORT}/admin.html")
    print("[AIFRET Admin] Credentials are configured through environment variables.")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping AIFRET server...")
        httpd.server_close()
        sys.exit(0)

if __name__ == '__main__':
    run_server()
