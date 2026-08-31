// Load `.env.local` (documented in README) into process.env before any other
// module reads configuration. Imported first in `server.ts`; ESM evaluates
// imports in order, so this runs before config modules are evaluated.
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });