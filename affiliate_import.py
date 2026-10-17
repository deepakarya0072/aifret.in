"""Safe affiliate-product import helpers.

This module deliberately does not scrape marketplace pages.  A marketplace
adapter is used only when an administrator has configured an authorized JSON
provider endpoint and its server-side token.
"""

import ipaddress
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request


MARKETPLACE_HOSTS = {
    "Amazon": {"amazon.in", "amazon.com", "amzn.in", "amzn.to"},
    "Flipkart": {"flipkart.com", "fkrt.it"},
    "Meesho": {"meesho.com"},
    "Myntra": {"myntra.com"},
}

PROVIDER_ENV = {
    "Amazon": ("AMAZON_CREATORS_API_ENDPOINT", "AMAZON_CREATORS_API_TOKEN"),
    "Flipkart": ("FLIPKART_AFFILIATE_API_ENDPOINT", "FLIPKART_AFFILIATE_API_TOKEN"),
    "Meesho": ("MEESHO_AFFILIATE_API_ENDPOINT", "MEESHO_AFFILIATE_API_TOKEN"),
    "Myntra": ("MYNTRA_AFFILIATE_API_ENDPOINT", "MYNTRA_AFFILIATE_API_TOKEN"),
}

IMPORT_FIELDS = (
    "name", "brand", "description", "category", "subcategory", "image",
    "price", "mrp", "discount", "currency", "availability", "product_id", "model_number",
    "additional_images", "key_features", "specifications", "variants",
)


class ImportErrorBase(ValueError):
    """An expected, safe-to-display import error."""


def _is_private_host(hostname):
    host = (hostname or "").strip().lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
    except ValueError:
        pass
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True
    return False


def validate_import_url(value):
    value = str(value or "").strip()
    if not value:
        raise ImportErrorBase("Paste an affiliate or marketplace product URL first.")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ImportErrorBase("Import URLs must use HTTPS and cannot contain embedded credentials.")
    if _is_private_host(parsed.hostname):
        raise ImportErrorBase("Private, local, or internal network URLs are not allowed.")
    return value


def detect_marketplace(value):
    url = validate_import_url(value)
    host = urllib.parse.urlparse(url).hostname.lower().rstrip(".")
    for marketplace, hosts in MARKETPLACE_HOSTS.items():
        if host in hosts or any(host.endswith("." + item) for item in hosts):
            return marketplace, host
    allowed = {
        item.strip().lower().rstrip(".")
        for item in os.environ.get("AIFRET_IMPORT_ALLOWED_DOMAINS", "").split(",")
        if item.strip()
    }
    if host in allowed or any(host.endswith("." + item) for item in allowed):
        return "Other Stores", host
    supported = ", ".join(sorted(MARKETPLACE_HOSTS))
    raise ImportErrorBase(f"Unsupported marketplace domain. Supported marketplaces: {supported}.")


def provider_configuration(marketplace, environ=None):
    environ = environ or os.environ
    endpoint_key, token_key = PROVIDER_ENV.get(marketplace, ("", ""))
    endpoint = str(environ.get(endpoint_key, "")).strip() if endpoint_key else ""
    token = str(environ.get(token_key, "")).strip() if token_key else ""
    if not endpoint or not token:
        return {
            "configured": False,
            "endpoint_key": endpoint_key,
            "token_key": token_key,
            "message": f"{marketplace} authorized API access is not configured. Enter the details manually or configure the server-side provider credentials.",
        }
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or _is_private_host(parsed.hostname):
        raise ImportErrorBase("The configured provider endpoint must be a public HTTPS URL.")
    return {"configured": True, "endpoint": endpoint, "token": token}


def _value(data, *keys):
    if not isinstance(data, dict):
        return None
    for key in keys:
        current = data
        for part in key.split("."):
            if not isinstance(current, dict) or part not in current:
                current = None
                break
            current = current[part]
        if current not in (None, "", []):
            return current
    return None


def _list_value(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        return [item.strip() for item in value.splitlines() if item.strip()]
    return []


def normalize_provider_response(payload, source_url, marketplace):
    if not isinstance(payload, dict):
        raise ImportErrorBase("The authorized provider returned an invalid response.")
    data = payload.get("product") or payload.get("item") or payload.get("data") or payload
    if isinstance(data, list):
        data = data[0] if data else {}
    if not isinstance(data, dict):
        raise ImportErrorBase("The authorized provider did not return product data.")
    result = {
        "name": _value(data, "name", "title", "product_name"),
        "brand": _value(data, "brand", "brand_name"),
        "description": _value(data, "description", "long_description", "details"),
        "short_description": _value(data, "short_description", "summary"),
        "category": _value(data, "category", "category_name"),
        "subcategory": _value(data, "subcategory", "sub_category"),
        "image": _value(data, "image", "image_url", "primary_image", "images.0"),
        "additional_images": _list_value(_value(data, "additional_images", "images", "gallery")),
        "price": _value(data, "price", "selling_price", "current_price", "offers.price"),
        "mrp": _value(data, "mrp", "original_price", "list_price", "offers.mrp"),
        "discount": _value(data, "discount", "discount_percentage"),
        "currency": _value(data, "currency"),
        "availability": _value(data, "availability", "stock_status", "availability_status"),
        "product_id": _value(data, "product_id", "asin", "sku", "id"),
        "model_number": _value(data, "model_number", "model", "model_no"),
        "manufacturer": _value(data, "manufacturer", "maker"),
        "country_of_origin": _value(data, "country_of_origin", "origin"),
        "material": _value(data, "material"),
        "color": _value(data, "color", "colour"),
        "size": _value(data, "size"),
        "weight": _value(data, "weight"),
        "dimensions": _value(data, "dimensions"),
        "key_features": _list_value(_value(data, "key_features", "features", "bullet_points")),
        "specifications": _value(data, "specifications", "specs") or {},
        "variants": _list_value(_value(data, "variants", "variant_options")),
        "source_url": source_url,
        "affiliate_url": source_url,
        "marketplace": marketplace,
        "data_source": "authorized_provider",
        "verification_status": "needs_verification",
    }
    result["missing_fields"] = [field for field in IMPORT_FIELDS if result.get(field) in (None, "", [], {})]
    return result


def fetch_authorized_product(source_url, marketplace, environ=None, timeout=8):
    config = provider_configuration(marketplace, environ)
    if not config["configured"]:
        return {
            "ready": False,
            "marketplace": marketplace,
            "source_url": source_url,
            "affiliate_url": source_url,
            "data_source": "manual",
            "missing_fields": list(IMPORT_FIELDS),
            "provider": {"configured": False, "message": config["message"]},
        }
    request_body = json.dumps({"url": source_url, "marketplace": marketplace}).encode("utf-8")
    request = urllib.request.Request(
        config["endpoint"], data=request_body, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Bearer {config['token']}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                raise ImportErrorBase(f"The {marketplace} authorized provider returned HTTP {response.status}.")
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise ImportErrorBase(f"The {marketplace} authorized provider returned HTTP {error.code}.") from error
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        raise ImportErrorBase(f"The {marketplace} authorized provider could not be reached. Manual entry is still available.") from error
    product = normalize_provider_response(payload, source_url, marketplace)
    product["ready"] = True
    product["provider"] = {"configured": True, "message": "Data returned by the configured authorized provider."}
    return product
