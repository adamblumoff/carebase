import { performance } from 'node:perf_hooks';

type HttpMethod = 'GET' | 'POST' | 'PATCH';

interface Step {
  name: string;
  path: string;
  method?: HttpMethod;
  body?: Record<string, unknown> | null;
}

interface Flow {
  name: string;
  steps: Step[];
  runs: number;
}

interface Options {
  baseUrl: string;
  token: string;
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      // ignore unknown positional args
      continue;
    }
    const key = raw.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      args.set(key, value);
      i += 1;
    } else {
      args.set(key, 'true');
    }
  }

  const baseUrl = args.get('baseUrl') ?? 'http://localhost:3000';
  const token = args.get('token') ?? process.env.CLERK_SESSION_TOKEN ?? '';

  if (!token) {
    throw new Error('Missing session token. Pass via --token or set CLERK_SESSION_TOKEN.');
  }

  return { baseUrl, token };
}

function buildFlows(): Flow[] {
  const flows: Flow[] = [
    {
      name: 'login-bootstrap',
      runs: 3,
      steps: [
        { name: 'auth-session', path: '/api/auth/session' },
        { name: 'plan', path: '/api/plan' },
        { name: 'plan-version', path: '/api/plan/version' },
        { name: 'collaborators', path: '/api/collaborators' },
        { name: 'review-pending', path: '/api/review/pending' },
        { name: 'google-status', path: '/api/integrations/google/status' }
      ]
    },
    {
      name: 'plan-refresh',
      runs: 3,
      steps: [
        { name: 'plan', path: '/api/plan' },
        { name: 'plan-version', path: '/api/plan/version' }
      ]
    }
  ];

  return flows;
}

async function executeStep(baseUrl: string, token: string, step: Step): Promise<number> {
  const url = new URL(step.path, baseUrl);
  const method = step.method ?? 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: step.body ? JSON.stringify(step.body) : undefined,
      signal: controller.signal
    });
    await response.text(); // drain body to avoid leaking handles
    const elapsed = performance.now() - started;
    return elapsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function runFlow(options: Options, flow: Flow): Promise<void> {
  console.log(`\nFlow: ${flow.name}`);
  const totals = new Map<string, number[]>();

  for (let run = 1; run <= flow.runs; run += 1) {
    console.log(`  Run ${run}`);
    for (const step of flow.steps) {
      const elapsed = await executeStep(options.baseUrl, options.token, step);
      const bucket = totals.get(step.name) ?? [];
      bucket.push(elapsed);
      totals.set(step.name, bucket);
      console.log(`    ${step.name}: ${elapsed.toFixed(1)} ms`);
    }
  }

  console.log('  Summary (avg ms):');
  for (const [stepName, samples] of totals.entries()) {
    const avg = samples.reduce((acc, value) => acc + value, 0) / samples.length;
    const max = Math.max(...samples);
    const min = Math.min(...samples);
    console.log(`    ${stepName}: avg ${avg.toFixed(1)} / min ${min.toFixed(1)} / max ${max.toFixed(1)}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const flows = buildFlows();

  for (const flow of flows) {
    await runFlow(options, flow);
  }
}

main().catch((error) => {
  console.error('[measure-auth-latency] Failed:', error);
  process.exitCode = 1;
});
