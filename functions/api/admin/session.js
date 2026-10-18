// Delegate the explicit admin-session route to the shared API router, where
// authentication and session validation are implemented.
import { onRequest as handleApiRequest } from '../../[[path]].js';

export function onRequest(context) {
  return handleApiRequest(context);
}
