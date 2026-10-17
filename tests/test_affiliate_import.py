import os
import unittest
from unittest.mock import patch

from affiliate_import import (
    ImportErrorBase,
    detect_marketplace,
    fetch_authorized_product,
    normalize_provider_response,
    validate_import_url,
)


class AffiliateImportTests(unittest.TestCase):
    @patch('affiliate_import.socket.getaddrinfo', return_value=[])
    def test_detects_supported_marketplaces_and_preserves_tracking_url(self, _dns):
        url = 'https://www.amazon.in/dp/B012345678?tag=aifret-21&psc=1'
        self.assertEqual(detect_marketplace(url)[0], 'Amazon')
        self.assertEqual(validate_import_url(url), url)

    @patch('affiliate_import.socket.getaddrinfo', return_value=[])
    def test_rejects_insecure_private_and_unsupported_urls(self, _dns):
        with self.assertRaises(ImportErrorBase):
            validate_import_url('http://www.amazon.in/dp/example')
        with self.assertRaises(ImportErrorBase):
            validate_import_url('https://127.0.0.1/product')
        with self.assertRaises(ImportErrorBase):
            detect_marketplace('https://unsupported.example/product')

    def test_missing_provider_credentials_keep_manual_fallback(self):
        source = 'https://www.flipkart.com/item/p/itm123?affid=aifret'
        result = fetch_authorized_product(source, 'Flipkart', environ={})
        self.assertFalse(result['ready'])
        self.assertEqual(result['affiliate_url'], source)
        self.assertIn('name', result['missing_fields'])
        self.assertTrue(result['provider']['message'])

    def test_normalizes_authorized_provider_response_without_inventing_fields(self):
        source = 'https://www.myntra.com/shoes/item?utm_source=aifret'
        result = normalize_provider_response({
            'product': {
                'title': 'Example Shoe',
                'brand': 'Example',
                'price': 1299,
                'images': ['https://cdn.example/item.jpg'],
                'features': ['Lightweight'],
            }
        }, source, 'Myntra')
        self.assertEqual(result['name'], 'Example Shoe')
        self.assertEqual(result['price'], 1299)
        self.assertEqual(result['affiliate_url'], source)
        self.assertIn('mrp', result['missing_fields'])
        self.assertIsNone(result['description'])


if __name__ == '__main__':
    unittest.main()
