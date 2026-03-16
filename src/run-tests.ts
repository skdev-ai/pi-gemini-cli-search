import { run } from 'node:test';

import './url-resolver.test.ts';
import './gemini-cli.test.ts';
import './availability.test.ts';
import './index.test.ts';
import './cache.test.ts';
import './types.test.ts';

// Call run() explicitly to ensure all tests are executed and results are reported.
// This prevents the "node:test run() is being called recursively" warning
// by ensuring run() is only called once.
run();
