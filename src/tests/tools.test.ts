import { parseCronExpression } from '../runtime/cron.js';
import { logger } from '../utils/logger.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`[PASS] ${message}`);
}

async function testCronParsing() {
  console.log('Testing Cron Parsing...');
  assert(parseCronExpression('every 5 minutes') === '*/5 * * * *', 'every 5 minutes');
  assert(parseCronExpression('at 5pm') === '0 17 * * *', 'at 5pm');
  assert(parseCronExpression('at 8:30am') === '30 8 * * *', 'at 8:30am');
  assert(parseCronExpression('at 14:00') === '0 14 * * *', 'at 14:00');
  assert(parseCronExpression('daily at 9am') === '0 9 * * *', 'daily at 9am');
  assert(parseCronExpression('every monday') === '0 9 * * 1', 'every monday');
}

async function runTests() {
  try {
    await testCronParsing();
    console.log('\nAll tests passed!');
  } catch (err) {
    console.error('\nTest failed:', err);
    process.exit(1);
  }
}

runTests();
