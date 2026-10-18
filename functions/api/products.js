// Keep the explicit /api/products Pages Function in sync with the shared API
// router. Cloudflare gives this file precedence over [[path]].js for the
// collection route, so an empty module would make product listing and create
// requests fail before reaching the implemented catalog handlers.
import { onRequest as handleApiRequest } from './[[path]].js';

export function onRequest(context) {
  return handleApiRequest(context);
}
