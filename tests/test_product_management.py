import http.cookiejar
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path


SERVER_PATH = Path(__file__).resolve().parents[1] / "server.py"
SPEC = importlib.util.spec_from_file_location("aifret_server", SERVER_PATH)
server_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server_module)


class ProductManagementApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_db_path = server_module.DB_PATH
        self.previous_uploads_dir = server_module.UPLOADS_DIR
        self.previous_username = os.environ.get("AIFRET_ADMIN_USERNAME")
        self.previous_password = os.environ.get("AIFRET_ADMIN_PASSWORD")
        self.previous_affiliate_domains = os.environ.get("AIFRET_ALLOWED_AFFILIATE_DOMAINS")
        server_module.DB_PATH = str(Path(self.temp_dir.name) / "test.sqlite")
        server_module.UPLOADS_DIR = str(Path(self.temp_dir.name) / "uploads")
        Path(server_module.UPLOADS_DIR).mkdir()
        os.environ["AIFRET_ADMIN_USERNAME"] = "test-admin"
        os.environ["AIFRET_ADMIN_PASSWORD"] = "test-password-123"
        server_module.init_database()

        self.httpd = HTTPServer(("127.0.0.1", 0), server_module.AifretRequestHandler)
        self.base_url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        login_status, login = self.request_json("/api/admin/login", {
            "username": "test-admin",
            "password": "test-password-123"
        }, "POST")
        self.assertEqual(login_status, 200)
        self.assertNotIn("token", login)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server_module.DB_PATH = self.previous_db_path
        server_module.UPLOADS_DIR = self.previous_uploads_dir
        if self.previous_username is None:
            os.environ.pop("AIFRET_ADMIN_USERNAME", None)
        else:
            os.environ["AIFRET_ADMIN_USERNAME"] = self.previous_username
        if self.previous_password is None:
            os.environ.pop("AIFRET_ADMIN_PASSWORD", None)
        else:
            os.environ["AIFRET_ADMIN_PASSWORD"] = self.previous_password
        if self.previous_affiliate_domains is None:
            os.environ.pop("AIFRET_ALLOWED_AFFILIATE_DOMAINS", None)
        else:
            os.environ["AIFRET_ALLOWED_AFFILIATE_DOMAINS"] = self.previous_affiliate_domains
        self.temp_dir.cleanup()

    def request_json(self, path, payload=None, method="GET", client=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data is not None else {}
        )
        try:
            with (client or self.client).open(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            status = error.code
            body = json.loads(error.read())
            error.close()
            return status, body

    def make_product(self, **overrides):
        product = {
            "id": "test-wireless-headphones",
            "name": "Test Wireless Headphones",
            "brand": "Test Brand",
            "category": "Electronics",
            "marketplace": "Amazon",
            "mrp": 3000,
            "selling_price": 2200,
            "product_url": "https://www.amazon.in/dp/test-item",
            "affiliate_url": "https://www.amazon.in/dp/test-item?tag=sample",
            "image": "",
            "additional_images": [],
            "description": "Test product description",
            "rating": 4.2,
            "review_count": 12,
            "availability": "In Stock",
            "stock_status": "in_stock",
            "status": "draft",
            "offers": [{
                "marketplace": "Flipkart",
                "price": 2100,
                "mrp": 3000,
                "product_url": "https://www.flipkart.com/test-item",
                "affiliate_url": "https://www.flipkart.com/test-item?affid=sample",
                "availability": "In Stock"
            }]
        }
        product.update(overrides)
        return product

    def test_create_draft_keeps_offers_private_and_assigns_code(self):
        status, created = self.request_json("/api/products", self.make_product(), "POST")
        self.assertEqual(status, 201)
        self.assertEqual(created["status"], "inactive")
        self.assertRegex(created["product_code"], r"^AIFRET-PROD-\d{6}$")

        public_client = urllib.request.build_opener()
        status, hidden = self.request_json(
            "/api/products/test-wireless-headphones", client=public_client
        )
        self.assertEqual(status, 404)
        status, public_listing = self.request_json("/api/products", client=public_client)
        self.assertFalse(any(row["id"] == "test-wireless-headphones" for row in public_listing["products"]))

        status, listing = self.request_json(
            "/api/products?status=all&limit=50"
        )
        self.assertEqual(status, 200)
        product = next(row for row in listing["products"] if row["id"] == "test-wireless-headphones")
        self.assertEqual(len(product["offers"]), 2)
        self.assertEqual(
            product["offers"][0]["affiliate_url"],
            "https://www.flipkart.com/test-item?affid=sample"
        )

    def test_create_route_requires_admin_session(self):
        public_client = urllib.request.build_opener()
        status, response = self.request_json(
            "/api/products", self.make_product(), "POST", client=public_client
        )
        self.assertEqual(status, 401)
        self.assertIn("Unauthorized", response["message"])

    def test_publish_requires_image_and_public_detail_is_then_available(self):
        self.request_json("/api/products", self.make_product(), "POST")
        status, response = self.request_json(
            "/api/products/test-wireless-headphones/status", {}, "PATCH"
        )
        self.assertEqual(status, 400)
        self.assertIn("image", response["message"].lower())

        valid_png = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe"
            "AAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
        )
        status, uploaded = self.request_json(
            "/api/upload",
            {"data": "data:image/png;base64," + valid_png},
            "POST"
        )
        self.assertEqual(status, 200, uploaded)
        self.assertTrue(uploaded["url"].endswith(".png"))

    def test_affiliate_hosts_must_match_or_be_configured(self):
        product = self.make_product(affiliate_url="https://unapproved.example/track")
        status, response = self.request_json("/api/products", product, "POST")
        self.assertEqual(status, 400)
        self.assertIn("AIFRET_ALLOWED_AFFILIATE_DOMAINS", response["message"])

        os.environ["AIFRET_ALLOWED_AFFILIATE_DOMAINS"] = "approved.example"
        product["affiliate_url"] = "https://shop.approved.example/track"
        status, created = self.request_json("/api/products", product, "POST")
        self.assertEqual(status, 201, created)

        status, response = self.request_json(
            "/api/products/test-wireless-headphones",
            self.make_product(image="https://images.example.org/product.webp"),
            "PUT"
        )
        self.assertEqual(status, 200)
        status, response = self.request_json(
            "/api/products/test-wireless-headphones/status", {}, "PATCH"
        )
        self.assertEqual(status, 200)

        public_client = urllib.request.build_opener()
        status, published = self.request_json(
            "/api/products/test-wireless-headphones", client=public_client
        )
        self.assertEqual(status, 200)
        self.assertEqual(published["product"]["status"], "active")

    def test_rejects_unsafe_offer_urls_and_fake_image_uploads(self):
        payload = self.make_product()
        payload["product_url"] = "javascript:alert(1)"
        status, response = self.request_json("/api/products", payload, "POST")
        self.assertEqual(status, 400)
        self.assertIn("URL", response["message"])

        status, response = self.request_json(
            "/api/upload",
            {"data": "data:image/png;base64," + "bm90YW5pbWFnZQ=="},
            "POST"
        )
        self.assertEqual(status, 400)
        self.assertIn("image", response["message"].lower())

    def test_admin_catalog_is_paginated_and_audited(self):
        status, listing = self.request_json("/api/products?status=all&limit=1")
        self.assertEqual(status, 200)
        self.assertEqual(listing["limit"], 1)
        self.assertIn("stats", listing)

        self.request_json("/api/products", self.make_product(), "POST")
        status, audit = self.request_json("/api/admin/audit-logs?limit=10")
        self.assertEqual(status, 200)
        self.assertTrue(any(row["action"] == "create" for row in audit["logs"]))


if __name__ == "__main__":
    unittest.main()
