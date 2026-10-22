import { authProxy } from '../server/runtime.mjs';
export const config = { maxDuration: 20 };
export default authProxy();
