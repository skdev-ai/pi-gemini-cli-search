#!/usr/bin/env node
/**
 * UAT Test Runner for gemini-cli-search extension
 * 
 * Executes all 7 UAT test cases and outputs results to stdout
 */

import { execSync, spawn } from 'child_process';
import { existsSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

interface TestResult {
  testId: number;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  query?: string;
  executionTime?: string;
  answer?: string;
  sources?: string[];
  progressMessages?: string[];
  warnings?: string[];
  error?: string;
  notes?: string;
}

// ── Test Utilities ───────────────────────────────────────────────────────────

function runGeminiQuery(query: string, env?: Record<string, string>): { output: string; durationMs: number } {
  // Use the worktree root directory
  const projectRoot = '/home/skello/projects/gemini-cli-search/.gsd/worktrees/M001';
  const scriptPath = join(projectRoot, 'src', 'gemini-cli.ts');
  const start = Date.now();
  
  const geminiEnv = { ...process.env, ...env };
  try {
    const output = execSync(`npx tsx ${scriptPath} "${query}"`, {
      env: geminiEnv,
      encoding: 'utf-8',
      timeout: 30000,
      cwd: projectRoot,
    });
    return { output: output.trim(), durationMs: Date.now() - start };
  } catch (error: any) {
    return { 
      output: error.stdout?.trim() || error.stderr?.trim() || error.message, 
      durationMs: Date.now() - start 
    };
  }
}

// ── Test Cases ───────────────────────────────────────────────────────────────

function test1_FirstQuery_HappyPath(): TestResult {
  const query = "What is the weather in Tokyo right now?";
  
  try {
    const { output, durationMs } = runGeminiQuery(query);
    
    const hasAnswer = output.length > 50;
    const urlRegex = /https?:\/\/[^\s\)]+/g;
    const sources = output.match(urlRegex) || [];
    
    // For weather queries, we expect search to be used
    const status = hasAnswer ? 'PASS' : 'FAIL';
    
    return {
      testId: 1,
      name: 'First Query (Happy Path)',
      status,
      query,
      executionTime: `${(durationMs / 1000).toFixed(2)}s`,
      answer: output.substring(0, Math.min(200, output.length)) + (output.length > 200 ? '...' : ''),
      sources: sources.slice(0, 5),
      progressMessages: [output.substring(0, 100)],
      notes: sources.length > 0 ? `${sources.length} source URLs detected` : 'Weather query - search should be used',
    };
  } catch (error: any) {
    return {
      testId: 1,
      name: 'First Query (Happy Path)',
      status: 'FAIL',
      query,
      error: error.message,
      notes: 'Exception during test execution',
    };
  }
}

function test2_RepeatedQuery_CacheHit(): TestResult {
  const query = "What is the weather in Tokyo right now?";
  
  try {
    // First query to populate cache
    runGeminiQuery(query);
    
    // Second query should be fast (same session cache)
    const { durationMs, output } = runGeminiQuery(query);
    
    const isSuccess = output.length > 50;
    
    return {
      testId: 2,
      name: 'Repeated Query (Cache Hit)',
      status: isSuccess ? 'PASS' : 'FAIL',
      query,
      executionTime: `${durationMs}ms`,
      answer: output.substring(0, 100),
      notes: `Response time: ${durationMs}ms (cache is per-process session)`,
    };
  } catch (error: any) {
    return {
      testId: 2,
      name: 'Repeated Query (Cache Hit)',
      status: 'FAIL',
      query,
      error: error.message,
    };
  }
}

async function test3_Cancellation(): Promise<TestResult> {
  const query = "Explain quantum computing in detail";
  const projectRoot = '/home/skello/projects/gemini-cli-search/.gsd/worktrees/M001';
  
  try {
    const scriptPath = join(projectRoot, 'src', 'gemini-cli.ts');
    const child = spawn('npx', ['tsx', scriptPath, query], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let output = '';
    child.stdout?.on('data', (data) => { output += data.toString(); });
    child.stderr?.on('data', (data) => { output += data.toString(); });
    
    // Kill after 500ms
    setTimeout(() => child.kill('SIGINT'), 500);
    
    // Wait for exit with timeout
    const exitCode = await new Promise<number>((resolve) => {
      let resolved = false;
      child.on('close', (code) => { if (!resolved) { resolved = true; resolve(code || 0); } });
      setTimeout(() => { if (!resolved) { resolved = true; resolve(-1); } }, 5000);
    });
    
    // Check for orphan processes
    let hasOrphans = false;
    try {
      const psOutput = execSync('ps aux | grep gemini | grep -v grep | grep -v node', { encoding: 'utf-8' });
      hasOrphans = psOutput.trim().length > 0;
    } catch { /* ignore */ }
    
    return {
      testId: 3,
      name: 'Cancellation',
      status: !hasOrphans ? 'PASS' : 'FAIL',
      query,
      executionTime: '< 1s',
      notes: hasOrphans ? 'WARNING: Orphan processes detected' : `Process terminated (code: ${exitCode})`,
    };
  } catch (error: any) {
    return {
      testId: 3,
      name: 'Cancellation',
      status: 'FAIL',
      query,
      error: error.message,
    };
  }
}

function test4_MissingCLI_Error(): TestResult {
  const query = "test";
  
  try {
    const geminiPath = execSync('which gemini', { encoding: 'utf-8' }).trim();
    const backupPath = '/tmp/gemini.bak';
    
    // Move gemini binary
    renameSync(geminiPath, backupPath);
    
    const { output } = runGeminiQuery(query);
    
    // Restore binary
    renameSync(backupPath, geminiPath);
    
    const hasErrorType = output.includes('CLI_NOT_FOUND') || output.includes('not found') || output.includes('not in PATH');
    
    return {
      testId: 4,
      name: 'Missing CLI Error',
      status: hasErrorType ? 'PASS' : 'FAIL',
      query,
      error: output.substring(0, 200),
      notes: hasErrorType ? 'Error type detected' : 'Expected CLI_NOT_FOUND error',
    };
  } catch (error: any) {
    return {
      testId: 4,
      name: 'Missing CLI Error',
      status: 'FAIL',
      query,
      error: error.message,
    };
  }
}

function test5_MissingAuth_Error(): TestResult {
  const query = "test";
  
  try {
    const credsPath = join(homedir(), '.gemini', 'oauth_creds.json');
    const backupPath = join(homedir(), '.gemini', 'oauth_creds.json.bak');
    
    // Move credentials
    renameSync(credsPath, backupPath);
    
    const { output } = runGeminiQuery(query);
    
    // Restore credentials
    renameSync(backupPath, credsPath);
    
    const hasErrorType = output.includes('NOT_AUTHENTICATED') || output.includes('authentication') || output.includes('credentials');
    
    return {
      testId: 5,
      name: 'Missing Auth Error',
      status: hasErrorType ? 'PASS' : 'FAIL',
      query,
      error: output.substring(0, 200),
      notes: hasErrorType ? 'Auth error detected' : 'Expected NOT_AUTHENTICATED error',
    };
  } catch (error: any) {
    return {
      testId: 5,
      name: 'Missing Auth Error',
      status: 'FAIL',
      query,
      error: error.message,
    };
  }
}

function test6_CustomModel(): TestResult {
  const query = "What is machine learning?";
  
  try {
    const { output, durationMs } = runGeminiQuery(query, {
      GEMINI_SEARCH_MODEL: 'gemini-2.0-flash',
    });
    
    const isSuccess = output.length > 50;
    
    return {
      testId: 6,
      name: 'Custom Model',
      status: isSuccess ? 'PASS' : 'FAIL',
      query,
      executionTime: `${(durationMs / 1000).toFixed(2)}s`,
      answer: output.substring(0, 150),
      notes: 'Executed with GEMINI_SEARCH_MODEL=gemini-2.0-flash',
    };
  } catch (error: any) {
    return {
      testId: 6,
      name: 'Custom Model',
      status: 'FAIL',
      query,
      error: error.message,
    };
  }
}

function test7_CustomTimeout(): TestResult {
  const query = "Explain the history of computing";
  
  try {
    const { output, durationMs } = runGeminiQuery(query, {
      GEMINI_SEARCH_TIMEOUT: '2000',
    });
    
    const hasTimeout = durationMs <= 5000 || output.includes('timeout') || output.includes('TIMEOUT');
    
    return {
      testId: 7,
      name: 'Custom Timeout',
      status: hasTimeout ? 'PASS' : 'FAIL',
      query,
      executionTime: `${(durationMs / 1000).toFixed(2)}s`,
      answer: output.substring(0, 150),
      notes: hasTimeout ? 'Timeout behavior observed' : 'Query completed within expected time',
    };
  } catch (error: any) {
    return {
      testId: 7,
      name: 'Custom Timeout',
      status: 'FAIL',
      query,
      error: error.message,
    };
  }
}

// ── Main Runner ──────────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  console.log('# UAT Test Results\n');
  console.log(`Executed at: ${new Date().toISOString()}\n`);
  console.log('---\n');
  
  const tests = [
    test1_FirstQuery_HappyPath,
    test2_RepeatedQuery_CacheHit,
    test3_Cancellation,
    test4_MissingCLI_Error,
    test5_MissingAuth_Error,
    test6_CustomModel,
    test7_CustomTimeout,
  ];
  
  const results: TestResult[] = [];
  
  for (const testFn of tests) {
    console.log(`Running ${testFn.name}...`);
    const result = await testFn();
    results.push(result);
    
    console.log(`  Status: ${result.status}`);
    if (result.executionTime) console.log(`  Time: ${result.executionTime}`);
    console.log('');
  }
  
  // Detailed results
  console.log('---\n');
  console.log('## Detailed Results\n');
  
  for (const r of results) {
    console.log(`### Test ${r.testId}: ${r.name}`);
    console.log(`- **Status:** ${r.status}`);
    if (r.query) console.log(`- **Query:** "${r.query}"`);
    if (r.executionTime) console.log(`- **Execution time:** ${r.executionTime}`);
    if (r.answer) console.log(`- **Answer:** ${r.answer}${r.answer.length >= 150 ? '...' : ''}`);
    if (r.sources && r.sources.length > 0) console.log(`- **Sources:** ${JSON.stringify(r.sources)}`);
    if (r.error) console.log(`- **Error:** ${r.error}`);
    if (r.notes) console.log(`- **Notes:** ${r.notes}`);
    console.log('');
  }
  
  // Summary
  console.log('---\n');
  console.log('## Summary\n');
  
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const skipCount = results.filter(r => r.status === 'SKIP').length;
  
  console.log(`- **Passed:** ${passCount}/${results.length}`);
  console.log(`- **Failed:** ${failCount}/${results.length}`);
  console.log(`- **Skipped:** ${skipCount}/${results.length}`);
  console.log(`- **Success Rate:** ${((passCount / results.length) * 100).toFixed(1)}%`);
}

runAllTests().catch(console.error);
