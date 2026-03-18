import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing the module under test
vi.mock('./a2a-path.js', () => ({
  getA2APath: vi.fn(() => null),
  isA2APathResolved: vi.fn()
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true)  // Default: credential file exists
}));

vi.mock('node:http', () => ({
  get: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => Buffer.from('/usr/bin/gemini'))  // Default: CLI exists
}));

import { getA2APath } from './a2a-path.js';
import { readFileSync, existsSync } from 'node:fs';
import * as http from 'node:http';
import { execSync } from 'node:child_process';
import {
  checkCliBinary,
  checkCredentialFile,
  checkAvailability,
  isAvailable,
  checkA2AInstalled,
  checkA2APatched,
  checkA2ARunning
} from './availability.js';

describe('checkCliBinary', () => {
  it('returns true when gemini CLI is in PATH', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/gemini'));
    const result = checkCliBinary();
    expect(result).toBe(true);
  });
});

describe('checkCredentialFile', () => {
  it('returns false when HOME is not set', () => {
    const originalHome = process.env.HOME;
    try {
      delete process.env.HOME;
      const result = checkCredentialFile();
      expect(result).toBe(false);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('returns true when credential file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const result = checkCredentialFile();
    expect(result).toBe(true);
  });
});

describe('checkAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available: true when CLI and credentials are present', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/gemini'));
    vi.mocked(existsSync).mockReturnValue(true);
    
    const result = checkAvailability();
    expect(result.available).toBe(true);
  });

  it('returns CLI_NOT_FOUND when gemini CLI is missing', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Command not found');
    });
    
    const result = checkAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('CLI_NOT_FOUND');
  });

  it('returns NOT_AUTHENTICATED when credentials are missing', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/gemini'));
    vi.mocked(existsSync).mockReturnValue(false);
    
    const result = checkAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('NOT_AUTHENTICATED');
  });

  it('checks CLI before credentials (CLI_NOT_FOUND takes precedence)', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Command not found');
    });
    vi.mocked(existsSync).mockReturnValue(false);
    
    const result = checkAvailability();
    expect(result.reason).toBe('CLI_NOT_FOUND');
  });
});

describe('isAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns boolean matching checkAvailability().available', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/gemini'));
    vi.mocked(existsSync).mockReturnValue(true);
    
    const isAvail = isAvailable();
    const checkAvail = checkAvailability();
    expect(typeof isAvail).toBe('boolean');
    expect(isAvail).toBe(true);
    expect(isAvail).toBe(checkAvail.available);
  });
});

describe('checkA2AInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when A2A is installed', () => {
    vi.mocked(getA2APath).mockReturnValue('/usr/local/bin/gemini-cli-a2a-server');
    const result = checkA2AInstalled();
    expect(result).toBe(true);
    expect(getA2APath).toHaveBeenCalled();
  });

  it('returns false when A2A is not installed', () => {
    vi.mocked(getA2APath).mockReturnValue(null);
    const result = checkA2AInstalled();
    expect(result).toBe(false);
    expect(getA2APath).toHaveBeenCalled();
  });
});

describe('checkA2APatched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when file contains _requestedModel patch marker', () => {
    vi.mocked(readFileSync).mockReturnValue('const _requestedModel = "gemini-2.5-pro";');
    const result = checkA2APatched('/fake/path');
    expect(result).toBe(true);
    expect(readFileSync).toHaveBeenCalledWith('/fake/path', 'utf-8');
  });

  it('returns false when file does not contain patch marker', () => {
    vi.mocked(readFileSync).mockReturnValue('const model = "gemini-2.0-flash";');
    const result = checkA2APatched('/fake/path');
    expect(result).toBe(false);
  });

  it('returns false when file does not exist', () => {
    const error = new Error('ENOENT: no such file or directory');
    (error as any).code = 'ENOENT';
    vi.mocked(readFileSync).mockImplementation(() => {
      throw error;
    });
    const result = checkA2APatched('/fake/path');
    expect(result).toBe(false);
  });
});

describe('checkA2ARunning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when health endpoint returns 200 OK', async () => {
    const mockReq = {
      setTimeout: vi.fn(),
      on: vi.fn(function(event: string, cb: any) {
        if (event === 'response') {
          cb({ statusCode: 200 });
        }
        return mockReq;
      }),
      end: vi.fn()
    };
    vi.mocked(http.get).mockImplementation((url, cb) => {
      setImmediate(() => cb({ statusCode: 200 }));
      return mockReq as any;
    });

    const result = await checkA2ARunning();
    expect(result).toBe(true);
  });

  it('returns false when request fails', async () => {
    const mockReq = {
      setTimeout: vi.fn(),
      on: vi.fn(function(event: string, cb: any) {
        if (event === 'error') {
          setImmediate(() => cb(new Error('Connection refused')));
        }
        return mockReq;
      }),
      end: vi.fn()
    };
    vi.mocked(http.get).mockReturnValue(mockReq as any);

    const result = await checkA2ARunning();
    expect(result).toBe(false);
  });

  it('returns false when request times out', async () => {
    const mockReq = {
      destroy: vi.fn(),
      setTimeout: vi.fn(function(ms: number, cb: any) {
        setImmediate(cb);
        return mockReq;
      }),
      on: vi.fn(),
      end: vi.fn()
    };
    vi.mocked(http.get).mockReturnValue(mockReq as any);

    const result = await checkA2ARunning();
    expect(result).toBe(false);
  });
});

describe('checkAvailability with A2A', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock CLI and credentials as available
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/gemini'));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(getA2APath).mockReturnValue(null);
    vi.mocked(readFileSync).mockReturnValue('');
  });

  it('includes a2a.installed field in result when CLI and credentials are available', () => {
    vi.mocked(getA2APath).mockReturnValue('/usr/local/bin/gemini-cli-a2a-server');
    const result = checkAvailability();
    expect(result.a2a).toBeDefined();
    expect(result.a2a?.installed).toBe(true);
  });

  it('includes a2a.patched field in result when installed', () => {
    vi.mocked(getA2APath).mockReturnValue('/usr/local/bin/gemini-cli-a2a-server');
    vi.mocked(readFileSync).mockReturnValue('const _requestedModel = "test";');
    
    const result = checkAvailability();
    expect(result.a2a?.patched).toBe(true);
  });

  it('calls getA2APath() when checking availability', () => {
    checkAvailability();
    expect(getA2APath).toHaveBeenCalled();
  });

  it('calls readFileSync() with resolved path when A2A is installed', () => {
    const testPath = '/usr/local/bin/gemini-cli-a2a-server';
    vi.mocked(getA2APath).mockReturnValue(testPath);
    vi.mocked(readFileSync).mockReturnValue('const _requestedModel = "test";');
    
    checkAvailability();
    expect(readFileSync).toHaveBeenCalledWith(testPath, 'utf-8');
  });
});
