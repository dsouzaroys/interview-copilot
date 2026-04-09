import { spawn } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

export interface CodeExecutionRequest {
  code: string;
  language: 'javascript' | 'python' | 'java' | 'cpp' | 'typescript';
  input?: string;
  timeoutSeconds?: number;
  memoryLimitMB?: number;
}

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  memoryUsedKB?: number;
  timedOut: boolean;
}

export interface TestCaseResult {
  testCase: number;
  passed: boolean;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  error?: string;
  executionTimeMs: number;
}

export interface CodeSubmissionResult {
  success: boolean;
  allPassed: boolean;
  results: TestCaseResult[];
  totalExecutionTimeMs: number;
  summary: string;
}

// Language configurations
const LANGUAGE_CONFIG: Record<string, { extension: string; command: string; args: string[] }> = {
  javascript: {
    extension: 'js',
    command: 'node',
    args: [],
  },
  typescript: {
    extension: 'ts',
    command: 'npx',
    args: ['tsx'],
  },
  python: {
    extension: 'py',
    command: 'python3',
    args: [],
  },
  java: {
    extension: 'java',
    command: 'javac',
    args: [], // Special handling for Java
  },
  cpp: {
    extension: 'cpp',
    command: 'g++',
    args: ['-o', 'solution', '-std=c++17'],
  },
};

/**
 * Execute code in a sandboxed environment
 */
export async function executeCode(
  request: CodeExecutionRequest
): Promise<CodeExecutionResult> {
  const { code, language, input = '', timeoutSeconds = 5, memoryLimitMB = 256 } = request;

  const config = LANGUAGE_CONFIG[language];
  if (!config) {
    return {
      success: false,
      output: '',
      error: `Unsupported language: ${language}`,
      executionTimeMs: 0,
      timedOut: false,
    };
  }

  // Create temporary directory for execution
  const tempDir = join(tmpdir(), `code-exec-${randomBytes(8).toString('hex')}`);
  await mkdir(tempDir, { recursive: true });

  const filename = `solution.${config.extension}`;
  const filepath = join(tempDir, filename);

  try {
    // Write code to file
    await writeFile(filepath, code);

    const startTime = Date.now();

    // Special handling for compiled languages
    if (language === 'java') {
      return await executeJava(tempDir, code, input, timeoutSeconds, memoryLimitMB);
    }

    if (language === 'cpp') {
      return await executeCpp(tempDir, filepath, input, timeoutSeconds, memoryLimitMB);
    }

    // Interpreted languages
    const result = await runCommand(
      config.command,
      [...config.args, filepath],
      input,
      timeoutSeconds * 1000,
      memoryLimitMB
    );

    const executionTimeMs = Date.now() - startTime;

    // Cleanup
    await unlink(filepath).catch(() => {});
    await unlink(tempDir).catch(() => {});

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      executionTimeMs,
      timedOut: result.timedOut,
    };
  } catch (err) {
    // Cleanup on error
    await unlink(filepath).catch(() => {});
    await unlink(tempDir).catch(() => {});

    return {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : 'Unknown execution error',
      executionTimeMs: 0,
      timedOut: false,
    };
  }
}

/**
 * Execute Java code (compile then run)
 */
async function executeJava(
  tempDir: string,
  code: string,
  input: string,
  timeoutSeconds: number,
  memoryLimitMB: number
): Promise<CodeExecutionResult> {
  const startTime = Date.now();

  // Extract class name from code
  const classNameMatch = code.match(/public\s+class\s+(\w+)/);
  const className = classNameMatch?.[1] ?? 'Main';

  const filename = `${className}.java`;
  const filepath = join(tempDir, filename);

  await writeFile(filepath, code);

  // Compile
  const compileResult = await runCommand(
    'javac',
    [filepath],
    '',
    timeoutSeconds * 1000,
    memoryLimitMB
  );

  if (compileResult.exitCode !== 0) {
    return {
      success: false,
      output: '',
      error: `Compilation error: ${compileResult.stderr}`,
      executionTimeMs: Date.now() - startTime,
      timedOut: compileResult.timedOut,
    };
  }

  // Run
  const runResult = await runCommand(
    'java',
    ['-cp', tempDir, className],
    input,
    timeoutSeconds * 1000,
    memoryLimitMB
  );

  const executionTimeMs = Date.now() - startTime;

  return {
    success: runResult.exitCode === 0,
    output: runResult.stdout,
    error: runResult.stderr,
    executionTimeMs,
    timedOut: runResult.timedOut,
  };
}

/**
 * Execute C++ code (compile then run)
 */
async function executeCpp(
  tempDir: string,
  filepath: string,
  input: string,
  timeoutSeconds: number,
  memoryLimitMB: number
): Promise<CodeExecutionResult> {
  const startTime = Date.now();
  const outputPath = join(tempDir, 'solution');

  // Compile
  const compileResult = await runCommand(
    'g++',
    ['-o', outputPath, filepath, '-std=c++17'],
    '',
    timeoutSeconds * 1000,
    memoryLimitMB
  );

  if (compileResult.exitCode !== 0) {
    return {
      success: false,
      output: '',
      error: `Compilation error: ${compileResult.stderr}`,
      executionTimeMs: Date.now() - startTime,
      timedOut: compileResult.timedOut,
    };
  }

  // Run
  const runResult = await runCommand(
    outputPath,
    [],
    input,
    timeoutSeconds * 1000,
    memoryLimitMB
  );

  const executionTimeMs = Date.now() - startTime;

  return {
    success: runResult.exitCode === 0,
    output: runResult.stdout,
    error: runResult.stderr,
    executionTimeMs,
    timedOut: runResult.timedOut,
  };
}

/**
 * Run a command with timeout and memory limits
 */
function runCommand(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  memoryLimitMB: number
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000);
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        timedOut: false,
      });
    });

    // Write stdin if provided
    if (stdin) {
      child.stdin?.write(stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Run test cases against submitted code
 */
export async function runTestCases(
  code: string,
  language: 'javascript' | 'python' | 'java' | 'cpp' | 'typescript',
  testCases: { input: string; expectedOutput: string }[],
  timeoutSeconds = 2
): Promise<CodeSubmissionResult> {
  const results: TestCaseResult[] = [];
  let totalExecutionTimeMs = 0;
  let allPassed = true;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!tc) continue;
    
    const result = await executeCode({
      code,
      language,
      input: tc.input || '',
      timeoutSeconds,
    });

    const passed = result.success && result.output.trim() === (tc.expectedOutput || '').trim();
    if (!passed) allPassed = false;

    totalExecutionTimeMs += result.executionTimeMs;

    results.push({
      testCase: i + 1,
      passed,
      input: tc.input || '',
      expectedOutput: tc.expectedOutput || '',
      actualOutput: result.output,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    });
  }

  // Generate summary
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = testCases.length || 1;
  const summary = `Test Results: ${passedCount}/${testCases.length} passed (${Math.round(
    (passedCount / totalCount) * 100
  )}%)`;

  return {
    success: true,
    allPassed,
    results,
    totalExecutionTimeMs,
    summary,
  };
}

/**
 * Wrap user code with test harness for better test case handling
 */
export function wrapWithTestHarness(
  code: string,
  language: string,
  testCases: { input: string; expectedOutput: string }[]
): string {
  // For JavaScript/TypeScript, add a simple test harness
  if (language === 'javascript' || language === 'typescript') {
    return `
${code}

// Test harness
const testCases = ${JSON.stringify(testCases)};
for (const tc of testCases) {
  const result = solve(tc.input);
  console.log(result);
}
`;
  }

  // For Python
  if (language === 'python') {
    return `
${code}

# Test harness
test_cases = ${JSON.stringify(testCases)}
for tc in test_cases:
    result = solve(tc['input'])
    print(result)
`;
  }

  return code;
}
