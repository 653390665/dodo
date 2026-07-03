import assert from 'node:assert/strict';
import test from 'node:test';
import { logger } from '../server/logger';

test('logger.error logs full error stack when present', () => {
  const originalConsoleError = console.error;
  let loggedMsg = '';
  let loggedError: any = null;

  console.error = (msg, err) => {
    loggedMsg = msg;
    loggedError = err;
  };

  try {
    const error = new Error('Test error message');
    logger.error('Test context', error);

    assert.match(loggedMsg, /\[ERROR\] Test context/);
    assert.match(loggedError, /Error: Test error message/);
    assert.match(loggedError, /logger\.test\.ts/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('logger.warn logs sanitized details', () => {
  const originalConsoleWarn = console.warn;
  let loggedMsg = '';
  let loggedDetail: any = null;

  console.warn = (msg, detail) => {
    loggedMsg = msg;
    loggedDetail = detail;
  };

  try {
    logger.warn('Test warning', { content: 'sensitive text', title: 'public title' });

    assert.match(loggedMsg, /\[WARN\] Test warning/);
    assert.deepEqual(loggedDetail, { content: '[redacted]', title: 'public title' });
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('logger.info logs sanitized details', () => {
  const originalConsoleLog = console.log;
  let loggedMsg = '';
  let loggedDetail: any = null;

  console.log = (msg, detail) => {
    loggedMsg = msg;
    loggedDetail = detail;
  };

  try {
    logger.info('Test info', { bio: 'sensitive bio', description: 'sensitive desc', id: '123' });

    assert.match(loggedMsg, /\[INFO\] Test info/);
    assert.deepEqual(loggedDetail, { bio: '[redacted]', description: '[redacted]', id: '123' });
  } finally {
    console.log = originalConsoleLog;
  }
});
