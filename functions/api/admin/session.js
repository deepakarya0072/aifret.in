// Delegate the explicit admin session route to the existing catch-all API
// handler. The handler lives one directory above this file.
import { onRequest as handleApiRequest } from '../[[path]].js';

export function onRequest(context) {
  return handleApiRequest(context);
}
